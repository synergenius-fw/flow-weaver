import type {
  TNodeTypeAST,
  TWorkflowAST,
  TValidationError,
} from '../ast/types';
import { findClosestMatches } from '../utils/string-distance.js';
import type { ValidationContext } from './core-rules.js';
import {
  validateStructure,
  validateDuplicateNodeNames,
  validateDuplicateInstanceIds,
  validateMutableBindings,
  validateReservedNames,
  validateConnections,
  validateDuplicateConnections,
  validateScopeNames,
  validateTypeCompatibility,
  validateRequiredInputs,
  detectUnusedNodes,
  validateStartAndExit,
  validateDataFlow,
  validateCycles,
  validateMultipleInputConnections,
  validateAnnotationSignatureConsistency,
  validateVisualAnnotations,
  validatePortTypes,
  validatePortConfigReferences,
  validateExpressionSyntax,
  validateExecuteWhen,
  validateScopeTopology,
} from './core-rules.js';

// Re-export TValidationError for convenience
export type { TValidationError } from '../ast/types';

// The reference as published with the source. These are the same pages `fw docs`
// prints and the console shows.
const DOCS_BASE = 'https://github.com/synergenius-fw/flow-weaver/blob/main/docs/reference';
const doc = (topic: string, anchor?: string) => `${DOCS_BASE}/${topic}.md${anchor ? `#${anchor}` : ''}`;

/** Map error codes to the documentation page that explains how to fix them. */
const ERROR_DOC_URLS: Record<string, string> = {
  UNKNOWN_NODE_TYPE: doc('concepts', 'node-registration'),
  UNKNOWN_SOURCE_PORT: doc('error-codes'),
  UNKNOWN_TARGET_PORT: doc('error-codes'),
  TYPE_MISMATCH: doc('error-codes'),
  INVALID_SCOPE_NAME: doc('error-codes'),
  INFERRED_NODE_TYPE: doc('node-conversion'),
  DUPLICATE_CONNECTION: doc('error-codes'),
  STUB_NODE: doc('scaffold'),
  COERCE_TYPE_MISMATCH: doc('compilation'),
  REDUNDANT_COERCE: doc('compilation'),
  COERCE_ON_FUNCTION_PORT: doc('compilation'),
};

export class WorkflowValidator {
  private ctx: ValidationContext = { errors: [], warnings: [], strictMode: false, draftMode: false };

  /**
   * The scope-name problems of a single node type, as messages. The same
   * check runs inside validate() as the INVALID_SCOPE_NAME rule; this is the
   * standalone form for callers that hold a node type and no workflow.
   *
   * Scoped OUTPUT ports become callback parameters (data flows to children)
   * and scoped INPUT ports become callback return values (data flows from
   * children); the ports may carry any data type.
   */
  validateNodeType(nodeType: TNodeTypeAST): string[] {
    const ctx: ValidationContext = { errors: [], warnings: [], strictMode: false, draftMode: false };
    validateScopeNames(ctx, {
      type: 'Workflow',
      name: nodeType.name,
      functionName: nodeType.functionName,
      sourceFile: nodeType.sourceLocation?.file ?? '',
      nodeTypes: [nodeType],
      instances: [],
      connections: [],
      startPorts: {},
      exitPorts: {},
      imports: [],
    });
    return ctx.errors.map((e) => e.message);
  }

  validate(workflow: TWorkflowAST, options?: { strictMode?: boolean; mode?: 'strict' | 'draft' }): {
    valid: boolean;
    errors: TValidationError[];
    warnings: TValidationError[];
  } {
    this.ctx = {
      errors: [],
      warnings: [],
      strictMode: options?.strictMode ?? false,
      draftMode: options?.mode === 'draft',
    };
    const ctx = this.ctx;
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
        this.ctx.errors.push({
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
        this.ctx.warnings.push({
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
        this.ctx.errors.push({
          type: 'error',
          code: 'STUB_NODE',
          message: `Node "${instance.id}" uses stub type "${instance.nodeType}" which has no implementation. Use draft mode to validate structure, or implement the node.`,
          node: instance.id,
          location: instance.sourceLocation,
        });
      }
    });

    // Core validation rules, run in a fixed order. Each rule receives the
    // shared `ctx` and pushes to ctx.errors / ctx.warnings. Ordering is
    // significant: the cascading-error dedup below depends on codes emitted
    // here, so this list must preserve the historical execution order.
    const rules: Array<{ name: string; run: () => void }> = [
      // Structural validation
      { name: 'structure', run: () => validateStructure(ctx, workflow) },
      { name: 'duplicateNodeNames', run: () => validateDuplicateNodeNames(ctx, workflow) },
      { name: 'duplicateInstanceIds', run: () => validateDuplicateInstanceIds(ctx, workflow) },
      { name: 'mutableBindings', run: () => validateMutableBindings(ctx, workflow) },
      // Connection and node validation
      { name: 'reservedNames', run: () => validateReservedNames(ctx, workflow, nodeTypeMap) },
      { name: 'connections', run: () => validateConnections(ctx, workflow, instanceMap) },
      { name: 'duplicateConnections', run: () => validateDuplicateConnections(ctx, workflow) },
      { name: 'scopeNames', run: () => validateScopeNames(ctx, workflow) },
      { name: 'typeCompatibility', run: () => validateTypeCompatibility(ctx, workflow, instanceMap) },
      { name: 'requiredInputs', run: () => validateRequiredInputs(ctx, workflow, instanceMap) },
      { name: 'unusedNodes', run: () => detectUnusedNodes(ctx, workflow, instanceMap) },
      { name: 'startAndExit', run: () => validateStartAndExit(ctx, workflow) },
      { name: 'dataFlow', run: () => validateDataFlow(ctx, workflow, instanceMap) },
      { name: 'cycles', run: () => validateCycles(ctx, workflow) },
      { name: 'multipleInputConnections', run: () => validateMultipleInputConnections(ctx, workflow, instanceMap) },
      { name: 'annotationSignatureConsistency', run: () => validateAnnotationSignatureConsistency(ctx, workflow) },
      { name: 'visualAnnotations', run: () => validateVisualAnnotations(ctx, workflow, instanceMap) },
      { name: 'portTypes', run: () => validatePortTypes(ctx, workflow) },
      { name: 'portConfigReferences', run: () => validatePortConfigReferences(ctx, workflow, instanceMap) },
      { name: 'expressionSyntax', run: () => validateExpressionSyntax(ctx, workflow) },
      { name: 'executeWhen', run: () => validateExecuteWhen(ctx, workflow) },
      { name: 'scopeTopology', run: () => validateScopeTopology(ctx, workflow, instanceMap) },
    ];
    for (const rule of rules) {
      rule.run();
    }

    // Deduplicate cascading errors: if a node has UNKNOWN_NODE_TYPE,
    // suppress UNKNOWN_SOURCE_NODE, UNKNOWN_TARGET_NODE and MISSING_REQUIRED_INPUT
    // that reference the same node IDs (they're just noise).
    const unknownTypeInstanceIds = new Set(
      workflow.instances.filter((inst) => !nodeTypeMap.has(inst.nodeType)).map((inst) => inst.id)
    );

    if (unknownTypeInstanceIds.size > 0) {
      this.ctx.errors = this.ctx.errors.filter((error) => {
        if (error.code === 'UNKNOWN_NODE_TYPE') return true; // Always keep root cause

        // Suppress cascading errors that reference unknown-type instances
        const cascadingCodes = new Set([
          'UNKNOWN_SOURCE_NODE',
          'UNKNOWN_TARGET_NODE',
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
    if (this.ctx.draftMode) {
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
      this.ctx.errors = this.ctx.errors.filter((err) => {
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
      this.ctx.warnings.push(...promoted);
    }

    // Filter out warnings suppressed by per-instance [suppress: "CODE"] annotations
    const suppressMap = new Map<string, Set<string>>();
    for (const inst of workflow.instances) {
      if (inst.config?.suppressWarnings?.length) {
        suppressMap.set(inst.id, new Set(inst.config.suppressWarnings));
      }
    }
    if (suppressMap.size > 0) {
      this.ctx.warnings = this.ctx.warnings.filter((w) => {
        if (!w.node) return true;
        const codes = suppressMap.get(w.node);
        return !codes || !codes.has(w.code);
      });
    }

    // Attach doc URLs to diagnostics that have mapped error codes
    for (const diag of [...this.ctx.errors, ...this.ctx.warnings]) {
      if (!diag.docUrl && ERROR_DOC_URLS[diag.code]) {
        diag.docUrl = ERROR_DOC_URLS[diag.code];
      }
    }

    return {
      valid: this.ctx.errors.length === 0,
      errors: this.ctx.errors,
      warnings: this.ctx.warnings,
    };
  }
}

export const validator = new WorkflowValidator();
