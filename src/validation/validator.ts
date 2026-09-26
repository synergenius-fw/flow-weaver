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

/** Errors that only echo an unknown node type, dropped when the instance's type is unknown. */
const CASCADING_CODES = new Set(['UNKNOWN_SOURCE_NODE', 'UNKNOWN_TARGET_NODE', 'MISSING_REQUIRED_INPUT']);

/** The node type an instance names, by name (npm nodes, 'npm/pkg/func') or function name (local nodes). */
function findNodeType(workflow: TWorkflowAST, nodeTypeName: string): TNodeTypeAST | undefined {
  return workflow.nodeTypes.find((nt) => nt.name === nodeTypeName || nt.functionName === nodeTypeName);
}

/**
 * Node types keyed by function name, and by name too when it differs, so
 * npm nodes (name 'npm/pkg/func', functionName 'func') resolve either way.
 */
function indexNodeTypes(workflow: TWorkflowAST): Map<string, TNodeTypeAST> {
  const nodeTypeMap = new Map<string, TNodeTypeAST>();
  workflow.nodeTypes.forEach((nodeType) => {
    nodeTypeMap.set(nodeType.functionName, nodeType);
    if (nodeType.name !== nodeType.functionName) {
      nodeTypeMap.set(nodeType.name, nodeType);
    }
  });
  return nodeTypeMap;
}

/**
 * Instance ID to node type for every instance whose type resolves. Each one
 * that does not is an UNKNOWN_NODE_TYPE error, with a hint: annotate the
 * function when it exists unannotated, or the closest type name.
 */
function resolveInstances(ctx: ValidationContext, workflow: TWorkflowAST): Map<string, TNodeTypeAST> {
  const instanceMap = new Map<string, TNodeTypeAST>();
  workflow.instances.forEach((instance) => {
    const nodeType = findNodeType(workflow, instance.nodeType);
    if (nodeType) {
      instanceMap.set(instance.id, nodeType);
      return;
    }
    const isUnannotatedFunction = workflow.availableFunctionNames?.includes(instance.nodeType) ?? false;
    let hint: string;
    if (isUnannotatedFunction) {
      hint = ` Function "${instance.nodeType}" exists but has no @flowWeaver nodeType annotation. Add /** @flowWeaver nodeType */ above it.`;
    } else {
      const availableTypes = workflow.nodeTypes.map((nt) => nt.functionName);
      const suggestions = findClosestMatches(instance.nodeType, availableTypes);
      hint = suggestions.length > 0 ? ` Did you mean "${suggestions[0]}"?` : '';
    }
    ctx.errors.push({
      type: 'error',
      code: 'UNKNOWN_NODE_TYPE',
      message: `Node "${instance.id}" references unknown node type "${instance.nodeType}".${hint}`,
      node: instance.id,
      location: instance.sourceLocation,
    });
  });
  return instanceMap;
}

/** Info diagnostic for node types auto-inferred from a function signature. */
function reportInferredNodeTypes(ctx: ValidationContext, workflow: TWorkflowAST): void {
  workflow.instances.forEach((instance) => {
    const nodeType = findNodeType(workflow, instance.nodeType);
    if (nodeType?.inferred && nodeType.variant !== 'STUB') {
      ctx.warnings.push({
        type: 'warning',
        code: 'INFERRED_NODE_TYPE',
        message: `Node type "${instance.nodeType}" was auto-inferred from function signature (expression mode). Add @flowWeaver nodeType for explicit port control.`,
        node: instance.id,
        location: instance.sourceLocation,
      });
    }
  });
}

/** Stub nodes are always errors here; draft mode demotes them at the end. */
function reportStubNodes(ctx: ValidationContext, workflow: TWorkflowAST): void {
  workflow.instances.forEach((instance) => {
    const nodeType = findNodeType(workflow, instance.nodeType);
    if (nodeType?.variant === 'STUB') {
      ctx.errors.push({
        type: 'error',
        code: 'STUB_NODE',
        message: `Node "${instance.id}" uses stub type "${instance.nodeType}" which has no implementation. Use draft mode to validate structure, or implement the node.`,
        node: instance.id,
        location: instance.sourceLocation,
      });
    }
  });
}

/**
 * Core validation rules, run in a fixed order. Each rule receives the shared
 * `ctx` and pushes to ctx.errors / ctx.warnings. Ordering is significant: the
 * cascading-error dedup depends on codes emitted here, so this list must
 * preserve the historical execution order.
 */
function runCoreRules(
  ctx: ValidationContext,
  workflow: TWorkflowAST,
  nodeTypeMap: Map<string, TNodeTypeAST>,
  instanceMap: Map<string, TNodeTypeAST>
): void {
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
}

/**
 * When an instance's node type is unknown, UNKNOWN_SOURCE_NODE,
 * UNKNOWN_TARGET_NODE and MISSING_REQUIRED_INPUT errors that reference it are
 * noise: drop them and keep the UNKNOWN_NODE_TYPE root cause.
 */
function dropCascadingErrors(
  ctx: ValidationContext,
  workflow: TWorkflowAST,
  nodeTypeMap: Map<string, TNodeTypeAST>
): void {
  const unknownTypeInstanceIds = new Set(
    workflow.instances.filter((inst) => !nodeTypeMap.has(inst.nodeType)).map((inst) => inst.id)
  );
  if (unknownTypeInstanceIds.size === 0) return;

  ctx.errors = ctx.errors.filter((error) => {
    if (error.code === 'UNKNOWN_NODE_TYPE') return true;
    if (!CASCADING_CODES.has(error.code)) return true;
    if (error.node && unknownTypeInstanceIds.has(error.node)) return false;
    if (error.connection) {
      if (unknownTypeInstanceIds.has(error.connection.from.node)) return false;
      if (unknownTypeInstanceIds.has(error.connection.to.node)) return false;
    }
    return true;
  });
}

/**
 * Draft mode: STUB_NODE errors, and MISSING_REQUIRED_INPUT errors on stub
 * instances, become warnings (appended after the existing warnings).
 */
function demoteStubErrors(ctx: ValidationContext, workflow: TWorkflowAST): void {
  const stubTypes = workflow.nodeTypes.filter((nt) => nt.variant === 'STUB');
  const stubTypeNames = new Set(stubTypes.map((nt) => nt.functionName));
  // Also index by name for npm-style nodes
  stubTypes.forEach((nt) => {
    stubTypeNames.add(nt.name);
  });
  const stubInstanceIds = new Set(
    workflow.instances.filter((inst) => stubTypeNames.has(inst.nodeType)).map((inst) => inst.id)
  );

  const promoted: TValidationError[] = [];
  ctx.errors = ctx.errors.filter((err) => {
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
  ctx.warnings.push(...promoted);
}

/** Drop warnings an instance silences with `[suppress: "CODE"]`. */
function applyWarningSuppressions(ctx: ValidationContext, workflow: TWorkflowAST): void {
  const suppressMap = new Map<string, Set<string>>();
  for (const inst of workflow.instances) {
    if (inst.config?.suppressWarnings?.length) {
      suppressMap.set(inst.id, new Set(inst.config.suppressWarnings));
    }
  }
  if (suppressMap.size === 0) return;
  ctx.warnings = ctx.warnings.filter((w) => {
    if (!w.node) return true;
    const codes = suppressMap.get(w.node);
    return !codes || !codes.has(w.code);
  });
}

/** Attach doc URLs to diagnostics that have mapped error codes. */
function attachDocUrls(ctx: ValidationContext): void {
  for (const diag of [...ctx.errors, ...ctx.warnings]) {
    if (!diag.docUrl && ERROR_DOC_URLS[diag.code]) {
      diag.docUrl = ERROR_DOC_URLS[diag.code];
    }
  }
}

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

  /**
   * Validate a workflow: resolve its instances, run the core rules in their
   * fixed order, then post-process the diagnostics (drop cascading errors,
   * demote stub errors in draft mode, apply suppressions, attach doc URLs).
   */
  validate(workflow: TWorkflowAST, options?: { strictMode?: boolean; mode?: 'strict' | 'draft' }): {
    valid: boolean;
    errors: TValidationError[];
    warnings: TValidationError[];
  } {
    this.ctx = {
      errors: [],
      warnings: [],
      strictMode: options?.strictMode ?? options?.mode === 'strict',
      draftMode: options?.mode === 'draft',
    };
    const ctx = this.ctx;

    const nodeTypeMap = indexNodeTypes(workflow);
    const instanceMap = resolveInstances(ctx, workflow);
    reportInferredNodeTypes(ctx, workflow);
    reportStubNodes(ctx, workflow);

    runCoreRules(ctx, workflow, nodeTypeMap, instanceMap);

    dropCascadingErrors(ctx, workflow, nodeTypeMap);
    if (ctx.draftMode) {
      demoteStubErrors(ctx, workflow);
    }
    applyWarningSuppressions(ctx, workflow);
    attachDocUrls(ctx);

    return {
      valid: ctx.errors.length === 0,
      errors: ctx.errors,
      warnings: ctx.warnings,
    };
  }
}

export const validator = new WorkflowValidator();
