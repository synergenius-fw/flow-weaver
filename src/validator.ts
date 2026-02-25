import type {
  TNodeTypeAST,
  TWorkflowAST,
  TValidationError,
  TSourceLocation,
  TConnectionAST,
} from './ast/types';
import {
  RESERVED_NODE_NAMES,
  isStartNode,
  isExitNode,
  isExecutePort,
  isReservedNodeName,
  VALID_NODE_COLORS,
  EXECUTION_STRATEGIES,
} from './constants';
import { findClosestMatches } from './utils/string-distance.js';
import { parseFunctionSignature } from './jsdoc-port-sync/signature-parser.js';
import { checkTypeCompatibilityFromStrings } from './type-checker.js';
import { isValidPortType } from './type-mappings.js';
import { VALID_NODE_ICONS } from './diagram/theme.js';

// Re-export TValidationError for convenience
export type { TValidationError } from './ast/types';

const DOCS_BASE = 'https://docs.flowweaver.dev/reference';

/** Map error codes to the documentation page that explains how to fix them. */
const ERROR_DOC_URLS: Record<string, string> = {
  UNKNOWN_NODE_TYPE: `${DOCS_BASE}/concepts#node-registration`,
  UNKNOWN_SOURCE_PORT: `${DOCS_BASE}/concepts#port-architecture`,
  UNKNOWN_TARGET_PORT: `${DOCS_BASE}/concepts#port-architecture`,
  TYPE_MISMATCH: `${DOCS_BASE}/compilation#type-compatibility`,
  UNREACHABLE_NODE: `${DOCS_BASE}/concepts#graph-structure`,
  MISSING_START_CONNECTION: `${DOCS_BASE}/concepts#start-and-exit`,
  MISSING_EXIT_CONNECTION: `${DOCS_BASE}/concepts#start-and-exit`,
  INFERRED_NODE_TYPE: `${DOCS_BASE}/node-conversion`,
  DUPLICATE_CONNECTION: `${DOCS_BASE}/concepts#connections`,
  STUB_NODE: `${DOCS_BASE}/model-driven#stub-nodes`,
  COERCE_TYPE_MISMATCH: `${DOCS_BASE}/compilation#type-coercion`,
  REDUNDANT_COERCE: `${DOCS_BASE}/compilation#type-coercion`,
  COERCE_ON_FUNCTION_PORT: `${DOCS_BASE}/compilation#type-coercion`,
};

/** Map coerce type to the dataType it produces */
const COERCE_OUTPUT_TYPE: Record<string, string> = {
  string: 'STRING', number: 'NUMBER', boolean: 'BOOLEAN',
  json: 'STRING', object: 'OBJECT',
};

/** Suggest the correct `as <type>` for a given target dataType */
function suggestCoerceType(targetType: string): string {
  switch (targetType) {
    case 'STRING': return 'string';
    case 'NUMBER': return 'number';
    case 'BOOLEAN': return 'boolean';
    case 'OBJECT': return 'object';
    default: return '<type>';
  }
}

export class WorkflowValidator {
  private errors: TValidationError[] = [];
  private warnings: TValidationError[] = [];
  private strictMode = false;
  private draftMode = false;

  /** Look up instance sourceLocation by instance ID */
  private getInstanceLocation(
    workflow: TWorkflowAST,
    instanceId: string
  ): TSourceLocation | undefined {
    const instance = workflow.instances.find((inst) => inst.id === instanceId);
    return instance?.sourceLocation;
  }

  /** Look up connection sourceLocation */
  private getConnectionLocation(conn: TConnectionAST): TSourceLocation | undefined {
    return conn.sourceLocation;
  }

  /**
   * Validate a single node type for scoped port requirements
   *
   * Scoped Port Architecture Rules:
   * - Scope names must be valid JavaScript identifiers
   *
   * Per-Port Scope Architecture:
   * - Scoped OUTPUT ports become callback PARAMETERS (data flows to children)
   * - Scoped INPUT ports become callback RETURN VALUES (data flows from children)
   * - Scoped ports can be ANY data type - they're not functions themselves
   * - The callback function is passed as a function parameter (e.g., forEach's itemProcessor)
   *
   * NOTE: execute/onSuccess/onFailure ports are mandatory base interface ports
   * that are auto-added to ALL nodes - no validation needed for those.
   */
  validateNodeType(nodeType: TNodeTypeAST): string[] {
    const errors: string[] = [];

    // Get all scoped ports (both INPUT and OUTPUT)
    const scopedPorts = [
      ...Object.entries(nodeType.inputs).filter(([_, portDef]) => portDef.scope !== undefined),
      ...Object.entries(nodeType.outputs).filter(([_, portDef]) => portDef.scope !== undefined),
    ];

    // Rule: Validate scope names are valid JavaScript identifiers
    const scopeNameRegex = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;

    scopedPorts.forEach(([portName, portDef]) => {
      if (portDef.scope && !scopeNameRegex.test(portDef.scope)) {
        errors.push(
          `Port "${portName}" has invalid scope name "${portDef.scope}". Scope names must be valid JavaScript identifiers (letters, numbers, underscore, dollar sign; cannot start with number).`
        );
      }
    });

    // Note: Scoped ports can be ANY data type in the per-port scope architecture
    // They become callback parameters/returns, not functions themselves

    return errors;
  }

  validate(workflow: TWorkflowAST, options?: { strictMode?: boolean; mode?: 'strict' | 'draft' }): {
    valid: boolean;
    errors: TValidationError[];
    warnings: TValidationError[];
  } {
    this.errors = [];
    this.warnings = [];
    this.strictMode = options?.strictMode ?? false;
    this.draftMode = options?.mode === 'draft';
    const nodeTypeMap = new Map<string, TNodeTypeAST>();
    // Map by both functionName and name to support npm nodes (name='npm/pkg/func', functionName='func')
    workflow.nodeTypes.forEach((nodeType) => {
      nodeTypeMap.set(nodeType.functionName, nodeType);
      if (nodeType.name !== nodeType.functionName) {
        nodeTypeMap.set(nodeType.name, nodeType);
      }
    });

    // Build instance map: instance ID -> node type
    const instanceMap = new Map<string, TNodeTypeAST>();
    workflow.instances.forEach((instance) => {
      // Check both name (for npm nodes like 'npm/pkg/func') and functionName (for local nodes)
      const nodeType = workflow.nodeTypes.find((nt) => nt.name === instance.nodeType || nt.functionName === instance.nodeType);
      if (nodeType) {
        instanceMap.set(instance.id, nodeType);
      } else {
        // Check if the function exists but is unannotated
        const isUnannotatedFunction =
          workflow.availableFunctionNames?.includes(instance.nodeType) ?? false;

        let hint: string;
        if (isUnannotatedFunction) {
          hint = ` Function "${instance.nodeType}" exists but has no @flowWeaver nodeType annotation. Add /** @flowWeaver nodeType */ above it.`;
        } else {
          const availableTypes = workflow.nodeTypes.map((nt) => nt.functionName);
          const suggestions = findClosestMatches(instance.nodeType, availableTypes);
          hint = suggestions.length > 0 ? ` Did you mean "${suggestions[0]}"?` : '';
        }
        this.errors.push({
          type: 'error',
          code: 'UNKNOWN_NODE_TYPE',
          message: `Node "${instance.id}" references unknown node type "${instance.nodeType}".${hint}`,
          node: instance.id,
          location: instance.sourceLocation,
        });
      }
    });

    // Info diagnostic for auto-inferred node types
    workflow.instances.forEach((instance) => {
      // Check both name (for npm nodes like 'npm/pkg/func') and functionName (for local nodes)
      const nodeType = workflow.nodeTypes.find((nt) => nt.name === instance.nodeType || nt.functionName === instance.nodeType);
      if (nodeType?.inferred && nodeType.variant !== 'STUB') {
        this.warnings.push({
          type: 'warning',
          code: 'INFERRED_NODE_TYPE',
          message: `Node type "${instance.nodeType}" was auto-inferred from function signature (expression mode). Add @flowWeaver nodeType for explicit port control.`,
          node: instance.id,
          location: instance.sourceLocation,
        });
      }
    });

    // Stub node diagnostics: always emit as errors, draft mode reclassifies at the end
    workflow.instances.forEach((instance) => {
      const nodeType = workflow.nodeTypes.find((nt) => nt.name === instance.nodeType || nt.functionName === instance.nodeType);
      if (nodeType?.variant === 'STUB') {
        this.errors.push({
          type: 'error',
          code: 'STUB_NODE',
          message: `Node "${instance.id}" uses stub type "${instance.nodeType}" which has no implementation. Use draft mode to validate structure, or implement the node.`,
          node: instance.id,
          location: instance.sourceLocation,
        });
      }
    });

    // Structural validation
    this.validateStructure(workflow);
    this.validateDuplicateNodeNames(workflow);
    this.validateDuplicateInstanceIds(workflow);
    this.validateMutableBindings(workflow);

    // Connection and node validation
    this.validateReservedNames(workflow, nodeTypeMap);
    this.validateConnections(workflow, instanceMap);
    this.validateDuplicateConnections(workflow);
    this.validateNodeReferences(workflow, instanceMap);
    this.validateTypeCompatibility(workflow, instanceMap);
    this.validateRequiredInputs(workflow, instanceMap);
    this.detectUnusedNodes(workflow, instanceMap);
    this.validateStartAndExit(workflow);
    this.validateDataFlow(workflow, instanceMap);
    this.validateCycles(workflow);
    this.validateMultipleInputConnections(workflow, instanceMap);
    this.validateAnnotationSignatureConsistency(workflow);
    this.validateVisualAnnotations(workflow, instanceMap);
    this.validatePortTypes(workflow);
    this.validatePortConfigReferences(workflow, instanceMap);
    this.validateExecuteWhen(workflow);
    this.validateScopeTopology(workflow, instanceMap);

    // Deduplicate cascading errors: if a node has UNKNOWN_NODE_TYPE,
    // suppress UNKNOWN_SOURCE_NODE, UNKNOWN_TARGET_NODE, and UNDEFINED_NODE
    // that reference the same node IDs (they're just noise).
    const unknownTypeInstanceIds = new Set(
      workflow.instances.filter((inst) => !nodeTypeMap.has(inst.nodeType)).map((inst) => inst.id)
    );

    if (unknownTypeInstanceIds.size > 0) {
      this.errors = this.errors.filter((error) => {
        if (error.code === 'UNKNOWN_NODE_TYPE') return true; // Always keep root cause

        // Suppress cascading errors that reference unknown-type instances
        const cascadingCodes = new Set([
          'UNKNOWN_SOURCE_NODE',
          'UNKNOWN_TARGET_NODE',
          'UNDEFINED_NODE',
          'MISSING_REQUIRED_INPUT',
        ]);
        if (!cascadingCodes.has(error.code)) return true;

        // Check if this error references an unknown-type instance
        if (error.node && unknownTypeInstanceIds.has(error.node)) return false;
        if (error.connection) {
          if (unknownTypeInstanceIds.has(error.connection.from.node)) return false;
          if (unknownTypeInstanceIds.has(error.connection.to.node)) return false;
        }
        return true;
      });
    }

    // Draft mode post-processing: reclassify stub-related errors as warnings
    if (this.draftMode) {
      const stubTypeNames = new Set(
        workflow.nodeTypes.filter((nt) => nt.variant === 'STUB').map((nt) => nt.functionName)
      );
      // Also index by name for npm-style nodes
      workflow.nodeTypes.filter((nt) => nt.variant === 'STUB').forEach((nt) => {
        stubTypeNames.add(nt.name);
      });
      const stubInstanceIds = new Set(
        workflow.instances
          .filter((inst) => stubTypeNames.has(inst.nodeType))
          .map((inst) => inst.id)
      );

      const promoted: TValidationError[] = [];
      this.errors = this.errors.filter((err) => {
        if (err.code === 'STUB_NODE') {
          promoted.push({ ...err, type: 'warning' });
          return false;
        }
        if (err.code === 'MISSING_REQUIRED_INPUT' && err.node && stubInstanceIds.has(err.node)) {
          promoted.push({ ...err, type: 'warning' });
          return false;
        }
        return true;
      });
      this.warnings.push(...promoted);
    }

    // Attach doc URLs to diagnostics that have mapped error codes
    for (const diag of [...this.errors, ...this.warnings]) {
      if (!diag.docUrl && ERROR_DOC_URLS[diag.code]) {
        diag.docUrl = ERROR_DOC_URLS[diag.code];
      }
    }

    return {
      valid: this.errors.length === 0,
      errors: this.errors,
      warnings: this.warnings,
    };
  }
  private validateStructure(workflow: TWorkflowAST): void {
    if (!workflow.name) {
      this.errors.push({
        type: 'error',
        code: 'MISSING_WORKFLOW_NAME',
        message: 'Workflow must have a name',
      });
    }
    if (!workflow.functionName) {
      this.errors.push({
        type: 'error',
        code: 'MISSING_FUNCTION_NAME',
        message: 'Workflow must have a functionName',
      });
    }
  }

  private validateDuplicateNodeNames(workflow: TWorkflowAST): void {
    const nodeNames = new Set<string>();
    workflow.nodeTypes.forEach((nodeType) => {
      if (nodeNames.has(nodeType.functionName)) {
        this.errors.push({
          type: 'error',
          code: 'DUPLICATE_NODE_NAME',
          message: `Duplicate node type name: "${nodeType.functionName}"`,
          node: nodeType.functionName,
          location: nodeType.sourceLocation,
        });
      }
      nodeNames.add(nodeType.functionName);
    });
  }

  private validateMutableBindings(workflow: TWorkflowAST): void {
    workflow.nodeTypes.forEach((nodeType) => {
      if (nodeType.declarationKind && nodeType.declarationKind !== 'const') {
        this.warnings.push({
          type: 'warning',
          code: 'MUTABLE_NODE_TYPE_BINDING',
          message: `Node type "${nodeType.functionName}" is declared with "${nodeType.declarationKind}" instead of "const". Use "const" to prevent accidental reassignment.`,
          node: nodeType.functionName,
          location: nodeType.sourceLocation,
        });
      }
    });
  }

  private validateReservedNames(
    workflow: TWorkflowAST,
    nodeTypeMap: Map<string, TNodeTypeAST>
  ): void {
    // Check for node types with reserved names (Start, Exit)
    // Note: Port name validation is done during parsing
    nodeTypeMap.forEach((nodeType, nodeName) => {
      if (isReservedNodeName(nodeName)) {
        this.errors.push({
          type: 'error',
          code: 'RESERVED_NODE_NAME',
          message: `Node type name "${nodeName}" is reserved. Reserved node names: ${Object.values(RESERVED_NODE_NAMES).join(', ')}`,
          node: nodeName,
          location: nodeType.sourceLocation,
        });
      }
    });

    // Check for instances with reserved IDs
    workflow.instances.forEach((instance) => {
      if (isReservedNodeName(instance.id)) {
        this.errors.push({
          type: 'error',
          code: 'RESERVED_INSTANCE_ID',
          message: `Instance ID "${instance.id}" is reserved. Reserved names: ${Object.values(RESERVED_NODE_NAMES).join(', ')}`,
          node: instance.id,
          location: instance.sourceLocation,
        });
      }
    });
  }

  private validateConnections(
    workflow: TWorkflowAST,
    instanceMap: Map<string, TNodeTypeAST>
  ): void {
    workflow.connections.forEach((conn, _index) => {
      const fromNode = conn.from.node;
      const fromPort = conn.from.port;
      const connLocation = this.getConnectionLocation(conn);
      if (!isStartNode(fromNode) && !instanceMap.has(fromNode)) {
        const instanceIds = [...instanceMap.keys()];
        const suggestions = findClosestMatches(fromNode, instanceIds);
        const suggestion = suggestions.length > 0 ? ` Did you mean "${suggestions[0]}"?` : '';
        this.errors.push({
          type: 'error',
          code: 'UNKNOWN_SOURCE_NODE',
          message: `Connection references unknown source node: "${fromNode}"${suggestion}`,
          connection: conn,
          location: connLocation,
        });
      }
      const toNode = conn.to.node;
      const toPort = conn.to.port;
      if (!isExitNode(toNode) && !instanceMap.has(toNode)) {
        const instanceIds = [...instanceMap.keys()];
        const suggestions = findClosestMatches(toNode, instanceIds);
        const suggestion = suggestions.length > 0 ? ` Did you mean "${suggestions[0]}"?` : '';
        this.errors.push({
          type: 'error',
          code: 'UNKNOWN_TARGET_NODE',
          message: `Connection references unknown target node: "${toNode}"${suggestion}`,
          connection: conn,
          location: connLocation,
        });
      }
      if (!isStartNode(fromNode)) {
        const sourceNode = instanceMap.get(fromNode);
        if (sourceNode && !sourceNode.outputs.hasOwnProperty(fromPort)) {
          const portNames = Object.keys(sourceNode.outputs);
          const suggestions = findClosestMatches(fromPort, portNames);
          const suggestion = suggestions.length > 0 ? ` Did you mean "${suggestions[0]}"?` : '';
          this.errors.push({
            type: 'error',
            code: 'UNKNOWN_SOURCE_PORT',
            message: `Node "${fromNode}" does not have output port "${fromPort}"${suggestion}`,
            node: fromNode,
            connection: conn,
            location: connLocation,
          });
        }
      } else {
        // Validate Start output port against declared @param ports
        // 'execute' is always implicit on Start
        const validStartPorts = new Set(['execute', ...Object.keys(workflow.startPorts)]);
        if (!validStartPorts.has(fromPort)) {
          const portNames = Array.from(validStartPorts);
          const suggestions = findClosestMatches(fromPort, portNames);
          let hint: string;
          if (suggestions.length > 0) {
            hint = ` Did you mean "${suggestions[0]}"?`;
          } else {
            hint = `\nAdd '@param ${fromPort}' to the workflow JSDoc and include it in the params object:\n(execute: boolean, params: { ${fromPort}: type, ... })`;
          }
          this.errors.push({
            type: 'error',
            code: 'UNKNOWN_SOURCE_PORT',
            message: `Start node does not have output port "${fromPort}".${hint}`,
            node: fromNode,
            connection: conn,
            location: connLocation,
          });
        }
      }
      if (!isExitNode(toNode)) {
        const targetNode = instanceMap.get(toNode);
        if (targetNode && !targetNode.inputs.hasOwnProperty(toPort)) {
          const portNames = Object.keys(targetNode.inputs);
          const suggestions = findClosestMatches(toPort, portNames);
          const suggestion = suggestions.length > 0 ? ` Did you mean "${suggestions[0]}"?` : '';
          this.errors.push({
            type: 'error',
            code: 'UNKNOWN_TARGET_PORT',
            message: `Node "${toNode}" does not have input port "${toPort}"${suggestion}`,
            node: toNode,
            connection: conn,
            location: connLocation,
          });
        }
      } else {
        // Validate Exit input port against declared @returns ports
        // 'onSuccess' and 'onFailure' are always implicit on Exit
        const validExitPorts = new Set([
          'onSuccess',
          'onFailure',
          ...Object.keys(workflow.exitPorts),
        ]);
        if (!validExitPorts.has(toPort)) {
          const portNames = Array.from(validExitPorts);
          const suggestions = findClosestMatches(toPort, portNames);
          const suggestion = suggestions.length > 0 ? ` Did you mean "${suggestions[0]}"?` : '';
          this.errors.push({
            type: 'error',
            code: 'UNKNOWN_TARGET_PORT',
            message: `Exit node does not have input port "${toPort}"${suggestion}`,
            node: toNode,
            connection: conn,
            location: connLocation,
          });
        }
      }
    });
  }

  /**
   * Validate type compatibility for connections with coercion support
   *
   * Type coercion rules:
   * - ANY type connections always allowed (no warning)
   * - Safe coercions: NUMBER → STRING, BOOLEAN → STRING (no warning)
   * - Lossy coercions: STRING → NUMBER, STRING → BOOLEAN, OBJECT → STRING (warning or error in strict mode)
   * - Unusual coercions: NUMBER → BOOLEAN, BOOLEAN → NUMBER (warning or error in strict mode)
   * - Same type connections always allowed (no warning)
   *
   * Strict types mode (@strictTypes):
   * - When enabled, type incompatibilities are errors instead of warnings
   */
  private validateTypeCompatibility(
    workflow: TWorkflowAST,
    instanceMap: Map<string, TNodeTypeAST>
  ): void {
    const strictTypes = this.strictMode || workflow.options?.strictTypes === true;

    // Helper to push to errors or warnings based on strictTypes mode
    const pushTypeIssue = (issue: TValidationError, isIncompatible: boolean = false) => {
      if (strictTypes && isIncompatible) {
        this.errors.push({ ...issue, type: 'error', code: 'TYPE_INCOMPATIBLE' });
      } else {
        this.warnings.push(issue);
      }
    };

    workflow.connections.forEach((conn) => {
      const fromNode = conn.from.node;
      const fromPort = conn.from.port;
      const toNode = conn.to.node;
      const toPort = conn.to.port;
      const connLocation = this.getConnectionLocation(conn);

      // Skip Start and Exit nodes (they handle types dynamically)
      if (isStartNode(fromNode) || isExitNode(toNode)) {
        return;
      }

      // Get source and target port types
      const sourceNode = instanceMap.get(fromNode);
      const targetNode = instanceMap.get(toNode);

      if (!sourceNode || !targetNode) {
        return; // Already caught by validateConnections
      }

      const sourcePortDef = sourceNode.outputs[fromPort];
      const targetPortDef = targetNode.inputs[toPort];

      if (!sourcePortDef || !targetPortDef) {
        return; // Already caught by validateConnections
      }

      const sourceType = sourcePortDef.dataType;
      const targetType = targetPortDef.dataType;
      const sourceTsType = sourcePortDef.tsType;
      const targetTsType = targetPortDef.tsType;

      // Validate STEP port connections - STEP must connect to STEP only
      if (sourceType === 'STEP' && targetType !== 'STEP') {
        this.errors.push({
          type: 'error',
          code: 'STEP_PORT_TYPE_MISMATCH',
          message: `STEP port "${fromPort}" on node "${fromNode}" cannot connect to non-STEP port "${toPort}" (${this.formatType(targetType, targetTsType)}) on node "${toNode}"`,
          connection: conn,
          location: connLocation,
        });
        return;
      }
      if (targetType === 'STEP' && sourceType !== 'STEP') {
        this.errors.push({
          type: 'error',
          code: 'STEP_PORT_TYPE_MISMATCH',
          message: `Non-STEP port "${fromPort}" (${this.formatType(sourceType, sourceTsType)}) on node "${fromNode}" cannot connect to STEP port "${toPort}" on node "${toNode}"`,
          connection: conn,
          location: connLocation,
        });
        return;
      }
      // Skip further type checking for STEP-to-STEP (valid control flow)
      if (sourceType === 'STEP' && targetType === 'STEP') {
        return;
      }

      // Block coercion on FUNCTION ports — coercing a function value is nonsensical
      if (conn.coerce && (sourceType === 'FUNCTION' || targetType === 'FUNCTION')) {
        this.errors.push({
          type: 'error',
          code: 'COERCE_ON_FUNCTION_PORT',
          message: `Coercion \`as ${conn.coerce}\` cannot be used on FUNCTION ports in connection "${fromNode}.${fromPort}" → "${toNode}.${toPort}". FUNCTION values cannot be meaningfully coerced.`,
          connection: conn,
          location: connLocation,
        });
        return;
      }

      // Same type - check for structural compatibility if both are OBJECT
      if (sourceType === targetType) {
        // Redundant coerce: same types don't need coercion
        if (conn.coerce) {
          this.warnings.push({
            type: 'warning',
            code: 'REDUNDANT_COERCE',
            message: `Coercion \`as ${conn.coerce}\` on connection "${fromNode}.${fromPort}" → "${toNode}.${toPort}" is redundant — source and target are both ${sourceType}.`,
            connection: conn,
            location: connLocation,
          });
          return;
        }
        // For OBJECT types, check if tsType differs (structural mismatch)
        if (sourceType === 'OBJECT' && sourcePortDef.tsType && targetPortDef.tsType) {
          const normalizedSource = this.normalizeTypeString(sourcePortDef.tsType);
          const normalizedTarget = this.normalizeTypeString(targetPortDef.tsType);
          if (normalizedSource !== normalizedTarget) {
            // Use string-based compatibility check to suppress false positives (e.g. when one side is 'any')
            const compat = checkTypeCompatibilityFromStrings(sourcePortDef.tsType, targetPortDef.tsType);
            if (!compat.isCompatible) {
              this.warnings.push({
                type: 'warning',
                code: 'OBJECT_TYPE_MISMATCH',
                message: `Structural type mismatch: ${fromNode}.${fromPort} outputs "${sourcePortDef.tsType}" but ${toNode}.${toPort} expects "${targetPortDef.tsType}". Verify the object shapes are compatible.`,
                connection: conn,
                location: connLocation,
              });
            }
          }
        }
        return;
      }

      // ANY type - always compatible (no warning)
      if (sourceType === 'ANY' || targetType === 'ANY') {
        return;
      }

      // Validate explicit coerce: check that produced type matches target
      if (conn.coerce) {
        const producedType = COERCE_OUTPUT_TYPE[conn.coerce];
        if (producedType === targetType) {
          return; // Coerce correctly resolves the mismatch
        }
        // Wrong coerce type — produced type doesn't match target
        pushTypeIssue(
          {
            type: 'warning',
            code: 'COERCE_TYPE_MISMATCH',
            message: `Coercion \`as ${conn.coerce}\` produces ${producedType} but target port "${toPort}" on "${toNode}" expects ${targetType}. Use \`as ${suggestCoerceType(targetType)}\` instead.`,
            connection: conn,
            location: connLocation,
          },
          true
        );
        return;
      }

      // Safe coercions (no warning)
      const safeCoercions = [
        ['NUMBER', 'STRING'],
        ['BOOLEAN', 'STRING'],
      ];

      for (const [from, to] of safeCoercions) {
        if (sourceType === from && targetType === to) {
          return; // Safe coercion, no warning
        }
      }

      // Lossy coercions (warning)
      const lossyCoercions = [
        ['STRING', 'NUMBER', 'May result in NaN if string is not a valid number'],
        ['STRING', 'BOOLEAN', 'Will use JavaScript truthy/falsy conversion'],
        ['OBJECT', 'STRING', 'Will use JSON.stringify()'],
        ['ARRAY', 'STRING', 'Will use JSON.stringify()'],
      ];

      for (const [from, to, reason] of lossyCoercions) {
        if (sourceType === from && targetType === to) {
          pushTypeIssue(
            {
              type: 'warning',
              code: 'LOSSY_TYPE_COERCION',
              message: `Lossy type coercion from ${this.formatType(sourceType, sourceTsType)} to ${this.formatType(targetType, targetTsType)} in connection ${fromNode}.${fromPort} → ${toNode}.${toPort}. ${reason}. Add @strictTypes to your workflow annotation to enforce type safety.`,
              connection: conn,
              location: connLocation,
            },
            true
          );
          return;
        }
      }

      // Unusual coercions (warning)
      const unusualCoercions = [
        [
          'NUMBER',
          'BOOLEAN',
          'Will use JavaScript truthy/falsy conversion (0 = false, non-zero = true)',
        ],
        ['BOOLEAN', 'NUMBER', 'Will convert false to 0, true to 1'],
        ['STRING', 'OBJECT', 'May fail if string is not valid JSON'],
        ['STRING', 'ARRAY', 'May fail if string is not valid JSON array'],
      ];

      for (const [from, to, reason] of unusualCoercions) {
        if (sourceType === from && targetType === to) {
          pushTypeIssue(
            {
              type: 'warning',
              code: 'UNUSUAL_TYPE_COERCION',
              message: `Unusual type coercion from ${this.formatType(sourceType, sourceTsType)} to ${this.formatType(targetType, targetTsType)} in connection ${fromNode}.${fromPort} → ${toNode}.${toPort}. ${reason}.`,
              connection: conn,
              location: connLocation,
            },
            true
          );
          return;
        }
      }

      // All other type mismatches
      pushTypeIssue(
        {
          type: 'warning',
          code: 'TYPE_MISMATCH',
          message: `Type mismatch in connection ${fromNode}.${fromPort} (${this.formatType(sourceType, sourceTsType)}) → ${toNode}.${toPort} (${this.formatType(targetType, targetTsType)}). Runtime coercion will be attempted.`,
          connection: conn,
          location: connLocation,
        },
        true
      );
    });
  }

  private validateNodeReferences(
    workflow: TWorkflowAST,
    instanceMap: Map<string, TNodeTypeAST>
  ): void {
    const referencedNodes = new Set<string>();
    workflow.connections.forEach((conn) => {
      const fromNode = conn.from.node;
      const toNode = conn.to.node;
      if (!isStartNode(fromNode) && !isExitNode(fromNode)) {
        referencedNodes.add(fromNode);
      }
      if (!isStartNode(toNode) && !isExitNode(toNode)) {
        referencedNodes.add(toNode);
      }
    });
    referencedNodes.forEach((nodeName) => {
      if (!instanceMap.has(nodeName)) {
        this.errors.push({
          type: 'error',
          code: 'UNDEFINED_NODE',
          message: `Workflow references undefined node: "${nodeName}"`,
          node: nodeName,
        });
      }
    });
  }
  private validateRequiredInputs(
    workflow: TWorkflowAST,
    instanceMap: Map<string, TNodeTypeAST>
  ): void {
    instanceMap.forEach((nodeType, instanceId) => {
      // Find the instance to check for port-level constant expressions
      const instance = workflow.instances.find((inst) => inst.id === instanceId);

      Object.entries(nodeType.inputs).forEach(([portName, portConfig]) => {
        if (isExecutePort(portName)) return;
        // Skip scoped INPUT ports - they're provided by scope function execution, not external connections
        if (portConfig.scope) return;

        // Check if instance has an expression for this port
        const instancePortConfig = instance?.config?.portConfigs?.find(
          (pc) => pc.portName === portName && (pc.direction == null || pc.direction === 'INPUT')
        );
        const hasInstanceExpression = instancePortConfig?.expression !== undefined;

        const isRequired =
          !portConfig.optional &&
          portConfig.default === undefined &&
          !portConfig.expression &&
          !hasInstanceExpression;

        if (isRequired) {
          const isConnected = workflow.connections.some((conn) => {
            return conn.to.node === instanceId && conn.to.port === portName;
          });
          if (!isConnected) {
            this.errors.push({
              type: 'error',
              code: 'MISSING_REQUIRED_INPUT',
              message: `Node "${instanceId}" has unconnected required input port "${portName}". Connect a value to it, or mark it optional with @input [${portName}].`,
              node: instanceId,
              location: instance?.sourceLocation,
            });
          }
        }
      });
    });
  }
  private detectUnusedNodes(workflow: TWorkflowAST, instanceMap: Map<string, TNodeTypeAST>): void {
    const usedNodes = new Set<string>();
    workflow.connections.forEach((conn) => {
      const fromNode = conn.from.node;
      const toNode = conn.to.node;
      if (!isStartNode(fromNode) && !isExitNode(fromNode)) {
        usedNodes.add(fromNode);
      }
      if (!isStartNode(toNode) && !isExitNode(toNode)) {
        usedNodes.add(toNode);
      }
    });
    instanceMap.forEach((_nodeType, instanceId) => {
      if (!usedNodes.has(instanceId)) {
        this.warnings.push({
          type: 'warning',
          code: 'UNUSED_NODE',
          message: `Node "${instanceId}" is defined but never used in workflow`,
          node: instanceId,
          location: this.getInstanceLocation(workflow, instanceId),
        });
      }
    });
  }
  private validateStartAndExit(workflow: TWorkflowAST): void {
    const hasStartConnections = workflow.connections.some((conn) => {
      return isStartNode(conn.from.node);
    });
    if (!hasStartConnections) {
      this.warnings.push({
        type: 'warning',
        code: 'NO_START_CONNECTIONS',
        message: 'Workflow has no connections from Start node',
      });
    }
    const hasExitConnections = workflow.connections.some((conn) => {
      return isExitNode(conn.to.node);
    });
    if (!hasExitConnections) {
      this.warnings.push({
        type: 'warning',
        code: 'NO_EXIT_CONNECTIONS',
        message: 'Workflow has no connections to Exit node (no return value)',
      });
    }

    // Validate that onSuccess and onFailure exit ports are STEP type
    if (workflow.exitPorts.onSuccess) {
      if (workflow.exitPorts.onSuccess.dataType !== 'STEP') {
        this.errors.push({
          type: 'error',
          code: 'INVALID_EXIT_PORT_TYPE',
          message:
            "Exit port 'onSuccess' must be of type STEP (control flow), found: " +
            workflow.exitPorts.onSuccess.dataType,
        });
      }
    }
    if (workflow.exitPorts.onFailure) {
      if (workflow.exitPorts.onFailure.dataType !== 'STEP') {
        this.errors.push({
          type: 'error',
          code: 'INVALID_EXIT_PORT_TYPE',
          message:
            "Exit port 'onFailure' must be of type STEP (control flow), found: " +
            workflow.exitPorts.onFailure.dataType,
        });
      }
    }
  }

  /**
   * Validate data flow in the workflow
   *
   * Checks for:
   * - Unused output ports (data produced but never consumed)
   * - Unreachable Exit ports (Exit expects data but no connection provides it)
   * - Dead-end data paths (data that never reaches Exit)
   */
  private validateDataFlow(workflow: TWorkflowAST, instanceMap: Map<string, TNodeTypeAST>): void {
    // Track which output ports are connected
    const connectedOutputPorts = new Set<string>();
    workflow.connections.forEach((conn) => {
      const portKey = `${conn.from.node}.${conn.from.port}`;
      connectedOutputPorts.add(portKey);
    });

    // Check for unused output ports (excluding control flow ports and scoped ports)
    instanceMap.forEach((nodeType, instanceId) => {
      Object.keys(nodeType.outputs).forEach((portName) => {
        const portKey = `${instanceId}.${portName}`;
        const portDef = nodeType.outputs[portName];

        // Skip control flow ports (onSuccess, onFailure)
        if (portDef.isControlFlow || portDef.failure) {
          return;
        }

        // Skip scoped output ports - they flow through the scope function, not external connections
        if (portDef.scope) {
          return;
        }

        if (!connectedOutputPorts.has(portKey)) {
          this.warnings.push({
            type: 'warning',
            code: 'UNUSED_OUTPUT_PORT',
            message: `Output port "${portName}" of node "${instanceId}" is never connected. Data will be discarded.`,
            node: instanceId,
            location: this.getInstanceLocation(workflow, instanceId),
          });
        }
      });
    });

    // Check for unreachable Exit ports and multiple connections to same Exit port
    // Build a map of Exit ports to their incoming connections
    const exitPortConnections = new Map<string, typeof workflow.connections>();
    workflow.connections.forEach((conn) => {
      if (isExitNode(conn.to.node)) {
        const port = conn.to.port;
        if (!exitPortConnections.has(port)) {
          exitPortConnections.set(port, []);
        }
        exitPortConnections.get(port)!.push(conn);
      }
    });

    // Check if all Exit ports have connections
    Object.entries(workflow.exitPorts).forEach(([portName, portDef]) => {
      // Skip control flow ports
      if (portDef.isControlFlow) {
        return;
      }

      if (!exitPortConnections.has(portName)) {
        this.warnings.push({
          type: 'warning',
          code: 'UNREACHABLE_EXIT_PORT',
          message: `Exit port "${portName}" has no incoming connection. Return value will be undefined.`,
        });
      }
    });

    // Check for multiple connections to the same Exit port
    exitPortConnections.forEach((connections, portName) => {
      if (connections.length > 1) {
        const sourceNodes = connections.map((c) => c.from.node);
        if (this.areMutuallyExclusive(sourceNodes, workflow, instanceMap)) {
          return; // Suppress — mutually exclusive branches
        }
        const sources = connections.map((c) => `${c.from.node}.${c.from.port}`).join(', ');
        this.warnings.push({
          type: 'warning',
          code: 'MULTIPLE_EXIT_CONNECTIONS',
          message: `Exit port "${portName}" has ${connections.length} incoming connections (${sources}). Only one value will be used - consider using separate Exit ports.`,
        });
      }
    });
  }

  /**
   * Validate for cycles (loops) in the workflow graph.
   * Cycles are connections that form a loop back to an earlier node.
   * Scoped nodes handle loops internally, so cycles within same scope are checked.
   */
  private validateCycles(workflow: TWorkflowAST): void {
    // Group instances by parent (scope layer)
    const instancesByParent = new Map<string | null, typeof workflow.instances>();
    instancesByParent.set(null, []);

    for (const instance of workflow.instances) {
      const parentId = instance.parent?.id || null;
      if (!instancesByParent.has(parentId)) {
        instancesByParent.set(parentId, []);
      }
      instancesByParent.get(parentId)!.push(instance);
    }

    // Group connections by parent (only connections where both ends are in same scope)
    const connectionsByParent = new Map<string | null, typeof workflow.connections>();
    connectionsByParent.set(null, []);

    for (const connection of workflow.connections) {
      const sourceInstance = workflow.instances.find((n) => n.id === connection.from.node);
      const targetInstance = workflow.instances.find((n) => n.id === connection.to.node);

      // Skip connections involving Start/Exit (they're virtual)
      if (!sourceInstance || !targetInstance) continue;

      const sourceParent = sourceInstance.parent?.id || null;
      const targetParent = targetInstance.parent?.id || null;

      // Only check connections within the same scope
      if (sourceParent === targetParent) {
        if (!connectionsByParent.has(sourceParent)) {
          connectionsByParent.set(sourceParent, []);
        }
        connectionsByParent.get(sourceParent)!.push(connection);
      }
    }

    // Run cycle detection per scope layer
    for (const [parentId, instances] of instancesByParent.entries()) {
      const connections = connectionsByParent.get(parentId) || [];
      this.detectCyclesInLayer(parentId, instances, connections);
    }
  }

  private detectCyclesInLayer(
    parentId: string | null,
    instances: TWorkflowAST['instances'],
    connections: TWorkflowAST['connections']
  ): void {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const reportedCycles = new Set<string>(); // Track reported cycles to avoid duplicates

    // Self-loops are allowed (used for iteration patterns)
    const selfLoopNodes = new Set(
      connections.filter((c) => c.from.node === c.to.node).map((c) => c.from.node)
    );

    // Exclude self-loops from cycle detection
    const nonSelfLoopConnections = connections.filter((c) => c.from.node !== c.to.node);

    const dfs = (nodeName: string, path: string[]): boolean => {
      if (recursionStack.has(nodeName)) {
        // Node with self-loop is not considered a cycle entry point
        if (selfLoopNodes.has(nodeName)) {
          return false;
        }

        const cycleStart = path.indexOf(nodeName);
        const cyclePath = [...path.slice(cycleStart), nodeName];

        // Normalize cycle for deduplication (start from smallest node name)
        const cycleNodes = cyclePath.slice(0, -1); // Remove duplicate end node
        const sortedCycle = [...cycleNodes].sort();
        const cycleKey = sortedCycle.join(',');

        // Only report if not already reported
        if (!reportedCycles.has(cycleKey)) {
          reportedCycles.add(cycleKey);
          const parentContext = parentId ? ` in scope "${parentId}"` : '';
          const instance = instances.find((n) => n.id === nodeName);
          this.errors.push({
            type: 'error',
            code: 'CYCLE_DETECTED',
            message: `Loop detected${parentContext}: ${cyclePath.join(' -> ')}`,
            node: nodeName,
            location: instance?.sourceLocation,
          });
        }
        return true;
      }

      if (visited.has(nodeName)) {
        return false;
      }

      recursionStack.add(nodeName);
      const newPath = [...path, nodeName];

      const instance = instances.find((n) => n.id === nodeName);
      if (!instance) {
        recursionStack.delete(nodeName);
        return false;
      }

      const outgoing = nonSelfLoopConnections.filter((c) => c.from.node === nodeName);
      let hasCycle = false;

      for (const conn of outgoing) {
        if (dfs(conn.to.node, newPath)) {
          hasCycle = true;
        }
      }

      recursionStack.delete(nodeName);
      if (!hasCycle) {
        visited.add(nodeName);
      }

      return hasCycle;
    };

    // Run DFS from each node (but use shared visited/reportedCycles sets)
    for (const instance of instances) {
      if (!visited.has(instance.id)) {
        dfs(instance.id, []);
      }
    }
  }

  /**
   * Validate that no input port has multiple connections.
   * Only one value can be received per input port.
   * (STEP ports can have multiple connections as they're control flow)
   */
  private validateMultipleInputConnections(
    workflow: TWorkflowAST,
    instanceMap: Map<string, TNodeTypeAST>
  ): void {
    const inputConnections = new Map<string, typeof workflow.connections>();

    for (const conn of workflow.connections) {
      const targetKey = `${conn.to.node}.${conn.to.port}`;

      // Skip Exit node (handled separately in validateDataFlow)
      if (isExitNode(conn.to.node)) continue;

      // Get target port type to check if it's STEP or has mergeStrategy
      const targetNodeType = instanceMap.get(conn.to.node);
      if (targetNodeType) {
        const targetPortDef = targetNodeType.inputs[conn.to.port];
        // STEP ports can have multiple connections (control flow)
        if (targetPortDef?.dataType === 'STEP') continue;
        // Ports with mergeStrategy can have multiple connections (fan-in)
        if (targetPortDef?.mergeStrategy) continue;
      }

      if (!inputConnections.has(targetKey)) {
        inputConnections.set(targetKey, []);
      }
      inputConnections.get(targetKey)!.push(conn);
    }

    for (const [, connections] of inputConnections) {
      if (connections.length > 1) {
        const [firstConn] = connections;
        const sources = connections.map((c) => `${c.from.node}.${c.from.port}`).join(', ');

        this.errors.push({
          type: 'error',
          code: 'MULTIPLE_CONNECTIONS_TO_INPUT',
          message: `Input port "${firstConn.to.port}" on node "${firstConn.to.node}" has ${connections.length} connections (${sources}). Only one value can be received.`,
          node: firstConn.to.node,
          connection: firstConn,
          location: this.getConnectionLocation(firstConn),
        });
      }
    }
  }
  /**
   * Cross-check @input annotations against TypeScript function signatures.
   * Warns on optionality and type mismatches between annotations and actual code.
   */
  private validateAnnotationSignatureConsistency(workflow: TWorkflowAST): void {
    for (const nodeType of workflow.nodeTypes) {
      if (!nodeType.functionText) continue;

      let sigParams: ReturnType<typeof parseFunctionSignature>['params'];
      try {
        const sig = parseFunctionSignature(nodeType.functionText);
        sigParams = sig.params;
      } catch {
        continue; // Can't parse signature, skip
      }

      // Skip the first param (execute: boolean) - it's a control flow param
      const sigParamMap = new Map<string, (typeof sigParams)[0]>();
      for (const p of sigParams.slice(1)) {
        sigParamMap.set(p.name, p);
      }

      for (const [portName, portDef] of Object.entries(nodeType.inputs)) {
        if (portName === 'execute') continue; // Skip control flow port

        const sigParam = sigParamMap.get(portName);
        if (!sigParam) continue; // Port not in signature (may be added by framework)

        // Check optionality mismatch: annotation says required but sig says optional
        if (!portDef.optional && sigParam.optional) {
          this.warnings.push({
            type: 'warning',
            code: 'ANNOTATION_SIGNATURE_MISMATCH',
            message: `Port "${portName}" in node type "${nodeType.functionName}" is optional in signature but required in annotation. Consider using @input [${portName}] to mark it optional.`,
            node: nodeType.functionName,
            location: nodeType.sourceLocation,
          });
        }

        // Check type mismatch: annotation specifies a type that differs from signature
        if (portDef.tsType && sigParam.tsType) {
          const annotationType = this.normalizeTypeString(portDef.tsType);
          const signatureType = this.normalizeTypeString(sigParam.tsType);

          // Skip if no real type info (untyped JS)
          if (!signatureType || signatureType === 'any') continue;

          if (annotationType !== signatureType) {
            this.warnings.push({
              type: 'warning',
              code: 'ANNOTATION_SIGNATURE_TYPE_MISMATCH',
              message: `Port "${portName}" in node type "${nodeType.functionName}" has type "${portDef.tsType}" in annotation but "${sigParam.tsType}" in function signature.`,
              node: nodeType.functionName,
              location: nodeType.sourceLocation,
            });
          }
        }
      }
    }
  }

  /**
   * Check if a set of source nodes are mutually exclusive — i.e., they descend
   * from opposite branches (onSuccess vs onFailure) of the same branching node.
   */
  private areMutuallyExclusive(
    sourceNodes: string[],
    workflow: TWorkflowAST,
    instanceMap: Map<string, TNodeTypeAST>
  ): boolean {
    if (sourceNodes.length < 2) return false;

    // Build reverse connection map: targetNode -> [{fromNode, fromPort}]
    const reverseMap = new Map<string, Array<{ fromNode: string; fromPort: string }>>();
    for (const conn of workflow.connections) {
      if (!reverseMap.has(conn.to.node)) {
        reverseMap.set(conn.to.node, []);
      }
      reverseMap.get(conn.to.node)!.push({ fromNode: conn.from.node, fromPort: conn.from.port });
    }

    // For each source node, trace backwards to find a branching ancestor and which branch it's on
    type BranchInfo = { branchNode: string; branch: 'onSuccess' | 'onFailure' };
    const findBranchAncestor = (nodeId: string): BranchInfo | null => {
      const visited = new Set<string>();
      const queue = [nodeId];
      while (queue.length > 0) {
        const current = queue.shift()!;
        if (visited.has(current)) continue;
        visited.add(current);

        const incomingEdges = reverseMap.get(current);
        if (!incomingEdges) continue;

        for (const edge of incomingEdges) {
          // Check if this incoming edge is from a branching port
          if (edge.fromPort === 'onSuccess' || edge.fromPort === 'onFailure') {
            const parentNodeType = instanceMap.get(edge.fromNode);
            if (parentNodeType?.hasSuccessPort && parentNodeType?.hasFailurePort) {
              return { branchNode: edge.fromNode, branch: edge.fromPort as 'onSuccess' | 'onFailure' };
            }
          }
          queue.push(edge.fromNode);
        }
      }
      return null;
    };

    // Get branch info for all source nodes
    const branchInfos = sourceNodes.map(findBranchAncestor);

    // All must have a branch ancestor
    if (branchInfos.some((info) => info === null)) return false;

    // All must share the same branch node
    const branchNode = branchInfos[0]!.branchNode;
    if (!branchInfos.every((info) => info!.branchNode === branchNode)) return false;

    // They must be on different branches (not all on the same one)
    const branches = new Set(branchInfos.map((info) => info!.branch));
    return branches.size > 1;
  }

  /**
   * Validate inner graph topology for nodes that have scoped ports.
   *
   * For each scoped node instance, checks that:
   * 1. Inner nodes (children) have their required inputs connected within the scope
   * 2. Scoped input ports (callback returns) have connections from inner nodes
   */
  private validateScopeTopology(
    workflow: TWorkflowAST,
    instanceMap: Map<string, TNodeTypeAST>
  ): void {
    // P: Scope consistency - check if any instance appears in multiple scope arrays
    if (workflow.scopes) {
      const instanceToScope = new Map<string, string>();
      for (const [scopeKey, childIds] of Object.entries(workflow.scopes)) {
        for (const childId of childIds) {
          const existing = instanceToScope.get(childId);
          if (existing && existing !== scopeKey) {
            this.errors.push({
              type: 'error',
              code: 'SCOPE_INCONSISTENT',
              message: `Instance "${childId}" appears in multiple scopes: "${existing}" and "${scopeKey}". A node can only belong to one scope.`,
              node: childId,
              location: this.getInstanceLocation(workflow, childId),
            });
          }
          instanceToScope.set(childId, scopeKey);
        }
      }
    }

    // Find all instances that have scoped ports
    for (const instance of workflow.instances) {
      const nodeType = instanceMap.get(instance.id);
      if (!nodeType) continue;

      // Collect scoped port pairs per scope name
      const scopeNames = new Set<string>();
      for (const portDef of Object.values(nodeType.outputs)) {
        if (portDef.scope) scopeNames.add(portDef.scope);
      }
      for (const portDef of Object.values(nodeType.inputs)) {
        if (portDef.scope) scopeNames.add(portDef.scope);
      }

      if (scopeNames.size === 0) continue;

      // Check: connections with scope qualifiers must reference valid scope names on this instance
      for (const conn of workflow.connections) {
        if (conn.from.scope && conn.from.node === instance.id) {
          if (!scopeNames.has(conn.from.scope)) {
            this.errors.push({
              type: 'error',
              code: 'SCOPE_WRONG_SCOPE_NAME',
              message: `Connection from "${instance.id}.${conn.from.port}" uses scope qualifier ":${conn.from.scope}" but node "${instance.id}" does not define scope "${conn.from.scope}". Available scopes: ${[...scopeNames].join(', ')}.`,
              connection: conn,
              location: this.getConnectionLocation(conn),
            });
          }
        }
        if (conn.to.scope && conn.to.node === instance.id) {
          if (!scopeNames.has(conn.to.scope)) {
            this.errors.push({
              type: 'error',
              code: 'SCOPE_WRONG_SCOPE_NAME',
              message: `Connection to "${instance.id}.${conn.to.port}" uses scope qualifier ":${conn.to.scope}" but node "${instance.id}" does not define scope "${conn.to.scope}". Available scopes: ${[...scopeNames].join(', ')}.`,
              connection: conn,
              location: this.getConnectionLocation(conn),
            });
          }
        }
      }

      for (const scopeName of scopeNames) {
        // Find children in this scope
        const childIds: string[] = [];
        for (const child of workflow.instances) {
          if (
            child.parent &&
            child.parent.id === instance.id &&
            child.parent.scope === scopeName
          ) {
            childIds.push(child.id);
          }
        }

        // O: Empty scope warning
        if (childIds.length === 0) {
          this.warnings.push({
            type: 'warning',
            code: 'SCOPE_EMPTY',
            message: `Scope "${scopeName}" on node "${instance.id}" has no child nodes.`,
            node: instance.id,
            location: this.getInstanceLocation(workflow, instance.id),
          });
          continue;
        }

        // Collect scoped connections (connections with scope tags)
        const scopedConnections = workflow.connections.filter(
          (conn) =>
            (conn.from.scope === scopeName && conn.from.node === instance.id) ||
            (conn.to.scope === scopeName && conn.to.node === instance.id) ||
            (conn.from.scope === scopeName && childIds.includes(conn.from.node)) ||
            (conn.to.scope === scopeName && childIds.includes(conn.to.node))
        );

        // Check: scoped connections reference actual scoped ports on the parent
        for (const conn of scopedConnections) {
          if (conn.from.node === instance.id && conn.from.scope === scopeName) {
            const portDef = nodeType.outputs[conn.from.port];
            if (!portDef) {
              const availablePorts = Object.entries(nodeType.outputs)
                .filter(([, p]) => p.scope === scopeName)
                .map(([n]) => n);
              this.errors.push({
                type: 'error',
                code: 'SCOPE_UNKNOWN_PORT',
                message: `Scoped connection references non-existent output port "${conn.from.port}" on "${instance.id}" in scope "${scopeName}". Available scoped outputs: ${availablePorts.join(', ') || 'none'}.`,
                connection: conn,
                location: this.getConnectionLocation(conn),
              });
            } else if (portDef.scope !== scopeName) {
              this.errors.push({
                type: 'error',
                code: 'SCOPE_UNKNOWN_PORT',
                message: `Output port "${conn.from.port}" on "${instance.id}" is not a scoped port of scope "${scopeName}"${portDef.scope ? ` (it belongs to scope "${portDef.scope}")` : ' (it is an unscoped port)'}.`,
                connection: conn,
                location: this.getConnectionLocation(conn),
              });
            }
          }
          if (conn.to.node === instance.id && conn.to.scope === scopeName) {
            const portDef = nodeType.inputs[conn.to.port];
            if (!portDef) {
              const availablePorts = Object.entries(nodeType.inputs)
                .filter(([, p]) => p.scope === scopeName)
                .map(([n]) => n);
              this.errors.push({
                type: 'error',
                code: 'SCOPE_UNKNOWN_PORT',
                message: `Scoped connection references non-existent input port "${conn.to.port}" on "${instance.id}" in scope "${scopeName}". Available scoped inputs: ${availablePorts.join(', ') || 'none'}.`,
                connection: conn,
                location: this.getConnectionLocation(conn),
              });
            } else if (portDef.scope !== scopeName) {
              this.errors.push({
                type: 'error',
                code: 'SCOPE_UNKNOWN_PORT',
                message: `Input port "${conn.to.port}" on "${instance.id}" is not a scoped port of scope "${scopeName}"${portDef.scope ? ` (it belongs to scope "${portDef.scope}")` : ' (it is an unscoped port)'}.`,
                connection: conn,
                location: this.getConnectionLocation(conn),
              });
            }
          }
        }

        // Check: scoped connections must stay within the scope boundary
        for (const conn of scopedConnections) {
          if (conn.from.scope === scopeName && childIds.includes(conn.from.node)) {
            if (conn.to.node !== instance.id && !childIds.includes(conn.to.node)) {
              this.errors.push({
                type: 'error',
                code: 'SCOPE_CONNECTION_OUTSIDE',
                message: `Scoped connection from "${conn.from.node}.${conn.from.port}" targets "${conn.to.node}" which is not inside scope "${scopeName}" of "${instance.id}".`,
                connection: conn,
                location: this.getConnectionLocation(conn),
              });
            }
          }
          if (conn.to.scope === scopeName && childIds.includes(conn.to.node)) {
            if (conn.from.node !== instance.id && !childIds.includes(conn.from.node)) {
              this.errors.push({
                type: 'error',
                code: 'SCOPE_CONNECTION_OUTSIDE',
                message: `Scoped connection to "${conn.to.node}.${conn.to.port}" sources from "${conn.from.node}" which is not inside scope "${scopeName}" of "${instance.id}".`,
                connection: conn,
                location: this.getConnectionLocation(conn),
              });
            }
          }
        }

        // Check: type compatibility for scoped connections between parent and children
        for (const conn of scopedConnections) {
          // Parent scoped output -> child input
          if (conn.from.node === instance.id && conn.from.scope === scopeName) {
            const parentPort = nodeType.outputs[conn.from.port];
            const childType = instanceMap.get(conn.to.node);
            const childPort = childType?.inputs[conn.to.port];
            if (parentPort && childPort && parentPort.dataType !== 'STEP' && childPort.dataType !== 'STEP') {
              if (parentPort.dataType !== childPort.dataType && parentPort.dataType !== 'ANY' && childPort.dataType !== 'ANY') {
                this.warnings.push({
                  type: 'warning',
                  code: 'SCOPE_PORT_TYPE_MISMATCH',
                  message: `Type mismatch in scope "${scopeName}": "${instance.id}.${conn.from.port}" outputs ${this.formatType(parentPort.dataType, parentPort.tsType)} but "${conn.to.node}.${conn.to.port}" expects ${this.formatType(childPort.dataType, childPort.tsType)}.`,
                  connection: conn,
                  location: this.getConnectionLocation(conn),
                });
              }
            }
          }
          // Child output -> parent scoped input
          if (conn.to.node === instance.id && conn.to.scope === scopeName) {
            const parentPort = nodeType.inputs[conn.to.port];
            const childType = instanceMap.get(conn.from.node);
            const childPort = childType?.outputs[conn.from.port];
            if (parentPort && childPort && parentPort.dataType !== 'STEP' && childPort.dataType !== 'STEP') {
              if (parentPort.dataType !== childPort.dataType && parentPort.dataType !== 'ANY' && childPort.dataType !== 'ANY') {
                this.warnings.push({
                  type: 'warning',
                  code: 'SCOPE_PORT_TYPE_MISMATCH',
                  message: `Type mismatch in scope "${scopeName}": "${conn.from.node}.${conn.from.port}" outputs ${this.formatType(childPort.dataType, childPort.tsType)} but "${instance.id}.${conn.to.port}" expects ${this.formatType(parentPort.dataType, parentPort.tsType)}.`,
                  connection: conn,
                  location: this.getConnectionLocation(conn),
                });
              }
            }
          }
        }

        // Check: each child's required inputs must be satisfied within the scope
        for (const childId of childIds) {
          const childType = instanceMap.get(childId);
          if (!childType) continue;

          for (const [portName, portConfig] of Object.entries(childType.inputs)) {
            if (isExecutePort(portName)) continue;
            if (portConfig.scope) continue; // Skip scoped ports on children
            if (portConfig.optional || portConfig.default !== undefined) continue;

            // Check instance expression overrides
            const childInstance = workflow.instances.find((i) => i.id === childId);
            const instancePortConfig = childInstance?.config?.portConfigs?.find(
              (pc) => pc.portName === portName && (pc.direction == null || pc.direction === 'INPUT')
            );
            if (portConfig.expression || instancePortConfig?.expression !== undefined) continue;

            // Check if connected by any connection (scoped, inter-child, or outer)
            const isConnected = workflow.connections.some(
              (conn) => conn.to.node === childId && conn.to.port === portName
            );

            if (!isConnected) {
              this.errors.push({
                type: 'error',
                code: 'SCOPE_MISSING_REQUIRED_INPUT',
                message: `Scoped child "${childId}" has unconnected required input "${portName}" within scope "${scopeName}" of "${instance.id}".`,
                node: childId,
                location: childInstance?.sourceLocation,
              });
            }
          }
        }

        // Check: scoped INPUT ports should have connections from inner nodes
        const scopedInputPorts = Object.entries(nodeType.inputs).filter(
          ([_, portDef]) => portDef.scope === scopeName
        );

        for (const [portName] of scopedInputPorts) {
          const hasConnection = scopedConnections.some(
            (conn) =>
              conn.to.node === instance.id &&
              conn.to.port === portName &&
              conn.to.scope === scopeName
          );

          if (!hasConnection) {
            this.warnings.push({
              type: 'warning',
              code: 'SCOPE_UNUSED_INPUT',
              message: `Scoped input port "${portName}" of "${instance.id}" (scope "${scopeName}") has no connection from inner nodes. Data will not flow back from the scope.`,
              node: instance.id,
              location: this.getInstanceLocation(workflow, instance.id),
            });
          }
        }

        // Check: each child should have at least one scoped connection to/from the parent
        for (const childId of childIds) {
          const hasConnectionFromParent = scopedConnections.some(
            (conn) =>
              conn.from.node === instance.id &&
              conn.from.scope === scopeName &&
              conn.to.node === childId
          );
          const hasConnectionToParent = scopedConnections.some(
            (conn) =>
              conn.to.node === instance.id &&
              conn.to.scope === scopeName &&
              conn.from.node === childId
          );
          if (!hasConnectionFromParent && !hasConnectionToParent) {
            this.warnings.push({
              type: 'warning',
              code: 'SCOPE_ORPHANED_CHILD',
              message: `Child node "${childId}" is declared inside scope "${scopeName}" of "${instance.id}" but has no scoped connections to or from the parent. It is disconnected from the scope's data flow.`,
              node: childId,
              location: this.getInstanceLocation(workflow, childId),
            });
          }
        }
      }
    }
  }

  // ── H: Duplicate instance IDs ──────────────────────────────────────────

  private validateDuplicateInstanceIds(workflow: TWorkflowAST): void {
    const seen = new Set<string>();
    for (const instance of workflow.instances) {
      if (seen.has(instance.id)) {
        this.errors.push({
          type: 'error',
          code: 'DUPLICATE_INSTANCE_ID',
          message: `Duplicate instance ID "${instance.id}" in workflow. Each @node must have a unique ID.`,
          node: instance.id,
          location: instance.sourceLocation,
        });
      }
      seen.add(instance.id);
    }
  }

  // ── I: Duplicate connections ──────────────────────────────────────────

  private validateDuplicateConnections(workflow: TWorkflowAST): void {
    const seen = new Set<string>();
    for (const conn of workflow.connections) {
      const key = `${conn.from.node}.${conn.from.port}->${conn.to.node}.${conn.to.port}`;
      if (seen.has(key)) {
        this.errors.push({
          type: 'error',
          code: 'DUPLICATE_CONNECTION',
          message: `Duplicate connection: ${key}`,
          connection: conn,
          location: this.getConnectionLocation(conn),
        });
      }
      seen.add(key);
    }
  }

  // ── J+K: Visual annotation validation ────────────────────────────────

  private validateVisualAnnotations(
    workflow: TWorkflowAST,
    instanceMap: Map<string, TNodeTypeAST>
  ): void {
    const validColors = VALID_NODE_COLORS as readonly string[];
    const validIcons = VALID_NODE_ICONS as readonly string[];

    // Check node type colors and icons (stored in visuals)
    for (const nodeType of workflow.nodeTypes) {
      const color = nodeType.visuals?.color;
      const icon = nodeType.visuals?.icon;
      if (color && !validColors.includes(color)) {
        const suggestions = findClosestMatches(color, [...validColors]);
        const hint = suggestions.length > 0 ? ` Did you mean "${suggestions[0]}"?` : '';
        this.warnings.push({
          type: 'warning',
          code: 'INVALID_COLOR',
          message: `Node type "${nodeType.functionName}" has invalid color "${color}".${hint} Valid colors: ${validColors.join(', ')}.`,
          node: nodeType.functionName,
          location: nodeType.sourceLocation,
        });
      }
      if (icon && !validIcons.includes(icon)) {
        const suggestions = findClosestMatches(icon, [...validIcons]);
        const hint = suggestions.length > 0 ? ` Did you mean "${suggestions[0]}"?` : '';
        this.warnings.push({
          type: 'warning',
          code: 'INVALID_ICON',
          message: `Node type "${nodeType.functionName}" has invalid icon "${icon}".${hint}`,
          node: nodeType.functionName,
          location: nodeType.sourceLocation,
        });
      }
    }

    // Check instance-level color and icon overrides
    for (const instance of workflow.instances) {
      if (instance.config?.color && !validColors.includes(instance.config.color)) {
        const suggestions = findClosestMatches(instance.config.color, [...validColors]);
        const hint = suggestions.length > 0 ? ` Did you mean "${suggestions[0]}"?` : '';
        this.warnings.push({
          type: 'warning',
          code: 'INVALID_COLOR',
          message: `Instance "${instance.id}" has invalid color "${instance.config.color}".${hint} Valid colors: ${validColors.join(', ')}.`,
          node: instance.id,
          location: instance.sourceLocation,
        });
      }
      if (instance.config?.icon && !validIcons.includes(instance.config.icon)) {
        const suggestions = findClosestMatches(instance.config.icon, [...validIcons]);
        const hint = suggestions.length > 0 ? ` Did you mean "${suggestions[0]}"?` : '';
        this.warnings.push({
          type: 'warning',
          code: 'INVALID_ICON',
          message: `Instance "${instance.id}" has invalid icon "${instance.config.icon}".${hint}`,
          node: instance.id,
          location: instance.sourceLocation,
        });
      }
    }
  }

  // ── L: Port type validation ──────────────────────────────────────────

  private validatePortTypes(workflow: TWorkflowAST): void {
    for (const nodeType of workflow.nodeTypes) {
      for (const [portName, portDef] of Object.entries(nodeType.inputs)) {
        if (!isValidPortType(portDef.dataType)) {
          this.warnings.push({
            type: 'warning',
            code: 'INVALID_PORT_TYPE',
            message: `Port "${portName}" on node type "${nodeType.functionName}" has invalid type "${portDef.dataType}".`,
            node: nodeType.functionName,
            location: nodeType.sourceLocation,
          });
        }
      }
      for (const [portName, portDef] of Object.entries(nodeType.outputs)) {
        if (!isValidPortType(portDef.dataType)) {
          this.warnings.push({
            type: 'warning',
            code: 'INVALID_PORT_TYPE',
            message: `Port "${portName}" on node type "${nodeType.functionName}" has invalid type "${portDef.dataType}".`,
            node: nodeType.functionName,
            location: nodeType.sourceLocation,
          });
        }
      }
    }
  }

  // ── M: portOrder/portLabel reference validation ──────────────────────

  private validatePortConfigReferences(
    workflow: TWorkflowAST,
    instanceMap: Map<string, TNodeTypeAST>
  ): void {
    for (const instance of workflow.instances) {
      const portConfigs = instance.config?.portConfigs;
      if (!portConfigs) continue;

      const nodeType = instanceMap.get(instance.id);
      if (!nodeType) continue;

      const allPorts = new Set([
        ...Object.keys(nodeType.inputs),
        ...Object.keys(nodeType.outputs),
      ]);

      for (const pc of portConfigs) {
        if (!allPorts.has(pc.portName)) {
          const suggestions = findClosestMatches(pc.portName, [...allPorts]);
          const hint = suggestions.length > 0 ? ` Did you mean "${suggestions[0]}"?` : '';
          this.warnings.push({
            type: 'warning',
            code: 'INVALID_PORT_CONFIG_REF',
            message: `Instance "${instance.id}" references port "${pc.portName}" in portConfig, but this port does not exist on node type "${instance.nodeType}".${hint}`,
            node: instance.id,
            location: instance.sourceLocation,
          });
        }
      }
    }
  }

  // ── N: @executeWhen value validation ─────────────────────────────────

  private validateExecuteWhen(workflow: TWorkflowAST): void {
    const validStrategies = Object.values(EXECUTION_STRATEGIES) as string[];
    for (const nodeType of workflow.nodeTypes) {
      if (nodeType.executeWhen && !validStrategies.includes(nodeType.executeWhen)) {
        const suggestions = findClosestMatches(nodeType.executeWhen, validStrategies);
        const hint = suggestions.length > 0 ? ` Did you mean "${suggestions[0]}"?` : '';
        this.warnings.push({
          type: 'warning',
          code: 'INVALID_EXECUTE_WHEN',
          message: `Node type "${nodeType.functionName}" has invalid @executeWhen value "${nodeType.executeWhen}".${hint} Valid values: ${validStrategies.join(', ')}.`,
          node: nodeType.functionName,
          location: nodeType.sourceLocation,
        });
      }
    }
  }

  /**
   * Format a type for display in error messages.
   * Prefers the structural TypeScript type when available, falling back to the enum name.
   */
  private formatType(dataType: string, tsType?: string): string {
    if (tsType) {
      return `${tsType} (${dataType})`;
    }
    return dataType;
  }

  private normalizeTypeString(type: string): string {
    let n = type;
    // Remove all whitespace
    n = n.replace(/\s+/g, '');
    // Normalize Array<T> → T[]
    n = n.replace(/Array<(.+?)>/g, '$1[]');
    // Remove trailing semicolons before closing braces/brackets
    n = n.replace(/;(?=[}\]])/g, '');
    // Lowercase for case-insensitive compare
    n = n.toLowerCase();
    return n;
  }
}

export const validator = new WorkflowValidator();
