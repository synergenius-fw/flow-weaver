import { getGeneratedBranding } from '../generated-branding.js';
import { VERSION } from '../generated-version.js';
import { INLINE_ENGINE_SOURCE } from './inline-engine.generated.js';
import type { TModuleFormat } from '../ast/types';

export type TOutputFormat = 'typescript' | 'javascript';

/**
 * What a compiled file exports from its runtime section besides the
 * workflows: the durable engine's public surface, under the same names the
 * package exports, so calling code can import them from either.
 */
export const INLINE_ENGINE_EXPORTS: readonly string[] = [
  'createWorkflowRuntime',
  'acceptContinuation',
  'createContinuationEnvelope',
  'isDurableGateYield',
  'isAmbiguousEffectError',
  'DurableGateYield',
  'AmbiguousEffectError',
  'CancellationError',
  'ENGINE_VERSION',
];

/** The types a host of a compiled file needs, exported beside the values. */
export const INLINE_ENGINE_TYPE_EXPORTS: readonly string[] = [
  'WorkflowRuntime',
  'WorkflowRuntimeServices',
  'CreateWorkflowRuntimeOptions',
  'ContinuationEnvelope',
  'DecodedContinuation',
  'DurableGate',
  'GateResolution',
  'EffectAdapter',
  'WireValue',
];

/**
 * The durable engine as it appears in a compiled file: the package's own
 * source (`continuation-core.ts`, `durable-execution.ts`) with its module
 * syntax removed, preceded by what its imports provided.
 */
function generateInlineEngine(production: boolean): string {
  const lines: string[] = [];
  lines.push('// ============================================================================');
  lines.push('// Durable Engine');
  lines.push("// The package's own engine, copied here so this file runs without it.");
  lines.push('// ============================================================================');
  lines.push('');
  lines.push(`const VERSION = ${JSON.stringify(VERSION)};`);
  if (!production) {
    lines.push('type DebugController = TDebugController;');
  }
  lines.push(
    'type FwMockConfig = { readonly events?: Readonly<Record<string, object>>, readonly invocations?: Readonly<Record<string, object>>, readonly agents?: Readonly<Record<string, object>>, readonly gates?: Readonly<Record<string, object>>, readonly fast?: boolean };',
  );
  lines.push('');
  // Production output carries no debugger types at all; the two the engine
  // names in its services type are erased to `unknown`, which is what the
  // production execution context declares for them anyway.
  const source = production
    ? INLINE_ENGINE_SOURCE.replace(/\bTDebugger\b/g, 'unknown').replace(/\bDebugController\b/g, 'unknown')
    : INLINE_ENGINE_SOURCE;
  lines.push(source);
  return lines.join('\n');
}

/**
 * Strip TypeScript type syntax from code using esbuild.
 * Removes type declarations, interfaces, declare statements, and type annotations
 * while preserving runtime JavaScript code.
 * Uses a lazy import so esbuild is only loaded when actually needed.
 */
export function stripTypeScript(code: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { transformSync } = require('esbuild') as typeof import('esbuild');
  const result = transformSync(code, {
    loader: 'ts',
    target: 'es2020',
    // Keep the code readable (no minification)
    minify: false,
    // Preserve formatting as much as possible
    keepNames: true,
  });
  return result.code;
}

/**
 * Generates inline runtime code for standalone execution
 *
 * This includes all types and the GeneratedExecutionContext class
 * so generated workflows have zero runtime dependencies.
 *
 * @param production - Whether to generate production-optimized code (no debug events)
 * @param exportClasses - Whether to add 'export' keyword to classes (for shared modules)
 * @param outputFormat - Output format: 'typescript' (default) or 'javascript' (strips types)
 * @param moduleFormat - 'esm' (default) exports the engine's helpers with an `export` statement;
 *   'cjs' leaves that to the caller's `module.exports` (see `INLINE_ENGINE_EXPORTS`)
 */
export function generateInlineRuntime(
  production: boolean,
  exportClasses: boolean = false,
  outputFormat: TOutputFormat = 'typescript',
  moduleFormat: TModuleFormat = 'esm',
): string {
  const exportKeyword = exportClasses ? 'export ' : '';
  const lines: string[] = [];

  // Type definitions
  lines.push('// ============================================================================');
  lines.push('// Runtime Types');
  lines.push('// ============================================================================');
  lines.push('');
  lines.push('type TStatusType =');
  lines.push('  | "RUNNING"');
  lines.push('  | "SCHEDULED"');
  lines.push('  | "SUCCEEDED"');
  lines.push('  | "FAILED"');
  lines.push('  | "CANCELLED"');
  lines.push('  | "PENDING";');
  lines.push('');
  lines.push('type TVariableIdentification = {');
  lines.push('  nodeTypeName: string;');
  lines.push('  id: string;');
  lines.push('  scope?: string | undefined;');
  lines.push('  side?: "start" | "exit" | undefined;');
  lines.push('  portName: string;');
  lines.push('  executionIndex: number;');
  lines.push('  key?: string | undefined;');
  lines.push('};');
  lines.push('');

  if (!production) {
    // Debug types only in development mode
    lines.push('type TStatusChangedEvent = {');
    lines.push('  type: "STATUS_CHANGED";');
    lines.push('  nodeTypeName: string;');
    lines.push('  id: string;');
    lines.push('  scope?: string;');
    lines.push('  side?: "start" | "exit";');
    lines.push('  executionIndex: number;');
    lines.push('  status: TStatusType;');
    lines.push('  innerFlowInvocation?: boolean;');
    lines.push('};');
    lines.push('');
    lines.push('type TVariableSetEvent = {');
    lines.push('  type: "VARIABLE_SET";');
    lines.push('  identifier: TVariableIdentification;');
    lines.push('  value?: unknown;');
    lines.push('  innerFlowInvocation?: boolean;');
    lines.push('};');
    lines.push('');
    lines.push('type TErrorLogEvent = {');
    lines.push('  type: "LOG_ERROR";');
    lines.push('  nodeTypeName: string;');
    lines.push('  id: string;');
    lines.push('  scope?: string;');
    lines.push('  side?: "start" | "exit";');
    lines.push('  executionIndex: number;');
    lines.push('  error: string;');
    lines.push('  code?: string;');
    lines.push('  innerFlowInvocation?: boolean;');
    lines.push('};');
    lines.push('');
    lines.push('type TWorkflowCompletedEvent = {');
    lines.push('  type: "WORKFLOW_COMPLETED";');
    lines.push('  executionIndex: number;');
    lines.push('  status: "SUCCEEDED" | "FAILED" | "CANCELLED";');
    lines.push('  result?: unknown;');
    lines.push('  innerFlowInvocation?: boolean;');
    lines.push('};');
    lines.push('');
    lines.push(`${exportKeyword}type TEvent =`);
    lines.push('  | TStatusChangedEvent');
    lines.push('  | TVariableSetEvent');
    lines.push('  | TErrorLogEvent');
    lines.push('  | TWorkflowCompletedEvent;');
    lines.push('');
    lines.push(`${exportKeyword}type TDebugger = {`);
    lines.push('  sendEvent: (event: TEvent) => void | Promise<void>;');
    lines.push('  innerFlowInvocation: boolean;');
    lines.push('  sessionId?: string;');
    lines.push('};');
    lines.push('');
    // Debug controller type for live step-through debugging only. The
    // context parameter is deliberately loose: the compiled file declares
    // its own GeneratedExecutionContext, and a caller hands in the package's
    // runtime, whose controller is typed against the package's class. Two
    // classes with private members are never assignable to each other, so
    // naming the class here would reject every runtime built with
    // createWorkflowRuntime().
    lines.push('type TDebugController = {');
    lines.push('  beforeNode(nodeId: string, ctx: unknown): Promise<void> | void;');
    lines.push('  afterNode(nodeId: string, ctx: unknown): Promise<void> | void;');
    lines.push('};');
    lines.push('');
  }

  lines.push('interface VariableAddress {');
  lines.push('  id: string;');
  lines.push('  portName: string;');
  lines.push('  executionIndex: number;');
  lines.push('  nodeTypeName?: string | undefined;');
  lines.push('  scope?: string | undefined;');
  lines.push("  side?: 'start' | 'exit' | undefined;");
  lines.push('  durable?: boolean | undefined;');
  lines.push('}');
  lines.push('');
  lines.push('interface ExecutionInfo {');
  lines.push('  id: string;');
  lines.push('  index: number;');
  lines.push('  parentIndex?: number | undefined;');
  lines.push('  scopeName?: string | undefined;');
  lines.push('}');
  lines.push('');
  // The address types, WireValue, DurableGateKind and the WorkflowRuntime
  // interface come from the inlined engine below.
  lines.push('type VariableValue = unknown | (() => unknown) | (() => Promise<unknown>);');
  lines.push('');

  // CancellationError class
  lines.push('// ============================================================================');
  lines.push('// Cancellation Error');
  lines.push('// ============================================================================');
  lines.push('');
  lines.push(`${exportKeyword}class CancellationError extends Error {`);
  lines.push('  public readonly executionIndex: number;');
  lines.push('  public readonly nodeId?: string;');
  lines.push('  public readonly timestamp: number;');
  lines.push('');
  lines.push('  constructor(');
  lines.push("    message: string = 'Workflow execution cancelled',");
  lines.push('    executionIndex: number = 0,');
  lines.push('    nodeId?: string,');
  lines.push('    timestamp: number = Date.now()');
  lines.push('  ) {');
  lines.push('    super(message);');
  lines.push("    this.name = 'CancellationError';");
  lines.push('    this.executionIndex = executionIndex;');
  lines.push('    this.nodeId = nodeId;');
  lines.push('    this.timestamp = timestamp;');
  lines.push('  }');
  lines.push('');
  lines.push('  static isCancellationError(error: unknown): error is CancellationError {');
  lines.push('    return (');
  lines.push('      error instanceof CancellationError ||');
  lines.push("      (error instanceof Error && error.name === 'CancellationError')");
  lines.push('    );');
  lines.push('  }');
  lines.push('}');
  lines.push('');

  // GeneratedExecutionContext class
  lines.push('// ============================================================================');
  lines.push('// Execution Context');
  lines.push('// ============================================================================');
  lines.push('');
  lines.push(`${exportKeyword}class GeneratedExecutionContext {`);
  lines.push('  private variables: Map<string, VariableValue> = new Map();');
  lines.push('  private executions: Map<string, ExecutionInfo> = new Map();');
  lines.push('  private executionCounter: number = 0;');
  lines.push('  private nodeExecutionCounts: Map<string, number> = new Map();');
  lines.push('  private isAsync: boolean;');

  if (!production) {
    lines.push('  private flowWeaverDebugger?: TDebugger | undefined;');
  }

  lines.push('  private pullExecutors: Map<string, () => void | Promise<void>> = new Map();');
  lines.push('  private nodeExecutionIndices: Map<string, number> = new Map();');
  lines.push('  private runtime: WorkflowRuntime;');
  lines.push('  private scopeInvocationCounts: Map<string, number> = new Map();');
  lines.push('  private nestedInvocationCounts: Map<string, number> = new Map();');
  lines.push('  private branchStack: BranchAddress[];');
  lines.push('  private allowAncestorDurableVariables = true;');
  lines.push('');

  // Constructor
  if (production) {
    lines.push('  constructor(isAsync: boolean = true, runtime: WorkflowRuntime) {');
    lines.push('    this.isAsync = isAsync;');
    lines.push('    this.runtime = runtime;');
    lines.push('    this.branchStack = [...runtime.branches];');
    lines.push('  }');
  } else {
    lines.push(
      '  constructor(isAsync: boolean = true, runtime: WorkflowRuntime) {'
    );
    lines.push('    this.isAsync = isAsync;');
    lines.push('    this.flowWeaverDebugger = runtime.services.debugger;');
    lines.push('    this.runtime = runtime;');
    lines.push('    this.branchStack = [...runtime.branches];');
    lines.push('  }');
  }
  lines.push('');

  // Core methods (always included)
  lines.push('  registerPullExecutor(id: string, executor: () => void | Promise<void>): void {');
  lines.push('    this.pullExecutors.set(id, executor);');
  lines.push('  }');
  lines.push('');
  lines.push('  addExecution(id: string, parentIndex?: number, scopeName?: string): number {');
  lines.push('    // Use per-node execution counter (each node starts at 0)');
  lines.push('    const currentCount = this.nodeExecutionCounts.get(id) || 0;');
  lines.push('    const index = currentCount;');
  lines.push('    this.nodeExecutionCounts.set(id, currentCount + 1);');
  lines.push('    this.executionCounter++;');
  lines.push('    this.executions.set(this.getExecutionKey(id, index), {');
  lines.push('      id,');
  lines.push('      index,');
  lines.push('      parentIndex,');
  lines.push('      scopeName,');
  lines.push('    });');
  lines.push('    this.nodeExecutionIndices.set(id, index);');
  lines.push('    return index;');
  lines.push('  }');
  lines.push('');

  // setVariable with conditional debug code
  lines.push(
    '  setVariable(address: VariableAddress, value: VariableValue): void | Promise<void> {'
  );
  lines.push('    const key = this.getVariableKey(address);');
  lines.push('    this.variables.set(key, value);');
  lines.push('    if (typeof value !== "function" && address.durable !== false) {');
  lines.push('      this.runtime.durable.setVariable(this.executionAddress(address), address.portName, value);');
  lines.push('    }');

  if (!production) {
    lines.push('    if (this.flowWeaverDebugger) {');
    lines.push('      const actualValue = typeof value === "function" ? value() : value;');
    lines.push('      this.sendVariableSetEvent({');
    lines.push('        identifier: {');
    lines.push('          nodeTypeName: address.nodeTypeName || "unknown",');
    lines.push('          id: address.id,');
    lines.push('          portName: address.portName,');
    lines.push('          executionIndex: address.executionIndex,');
    lines.push('          key: "default",');
    lines.push('          ...(address.scope && { scope: address.scope }),');
    lines.push('          ...(address.side && { side: address.side }),');
    lines.push('        },');
    lines.push('        value: actualValue,');
    lines.push('      });');
    lines.push('    }');
  }

  lines.push('    return this.isAsync ? Promise.resolve() : undefined;');
  lines.push('  }');
  lines.push('');

  // getVariable
  lines.push('  getVariable(address: VariableAddress): unknown | Promise<unknown> {');
  lines.push('    const executor = this.pullExecutors.get(address.id);');
  lines.push('    if (executor) {');
  lines.push('      if (!this.hasVariable(address)) {');
  lines.push('        const result = executor();');
  lines.push('        // Handle async executor (returns Promise)');
  lines.push('        if (result instanceof Promise) {');
  lines.push('          return result.then(() => {');
  lines.push('            const trackedIndex = this.nodeExecutionIndices.get(address.id);');
  lines.push('            const finalAddress = trackedIndex !== undefined');
  lines.push('              ? { ...address, executionIndex: trackedIndex }');
  lines.push('              : address;');
  lines.push('            return this.retrieveVariable(finalAddress);');
  lines.push('          });');
  lines.push('        }');
  lines.push('        // Handle sync executor (returns void)');
  lines.push('        const trackedIndex = this.nodeExecutionIndices.get(address.id);');
  lines.push('        const finalAddress = trackedIndex !== undefined');
  lines.push('          ? { ...address, executionIndex: trackedIndex }');
  lines.push('          : address;');
  lines.push('        return this.retrieveVariable(finalAddress);');
  lines.push('      }');
  lines.push('    }');
  lines.push('    return this.retrieveVariable(address);');
  lines.push('  }');
  lines.push('');

  // retrieveVariable
  lines.push('  private retrieveVariable(address: VariableAddress): unknown | Promise<unknown> {');
  lines.push('    const key = this.getVariableKey(address);');
  lines.push('    let value = this.variables.get(key);');
  lines.push('    if (!this.variables.has(key)) {');
  lines.push(
    '      value = this.runtime.durable.getVariable(this.executionAddress(address), address.portName, this.allowAncestorDurableVariables);'
  );
  lines.push('      if (value === undefined) {');
  lines.push('        throw new Error(`Variable not found: ${address.id}.${address.portName}[${address.executionIndex}]`);');
  lines.push('      }');
  lines.push('      this.variables.set(key, value);');
  lines.push('    }');
  lines.push('    if (typeof value === "function") {');
  lines.push('      const result = value();');
  lines.push('      if (result instanceof Promise) {');
  lines.push('        return result;');
  lines.push('      }');
  lines.push('      return this.isAsync ? Promise.resolve(result) : result;');
  lines.push('    }');
  lines.push('    return this.isAsync ? Promise.resolve(value) : value;');
  lines.push('  }');
  lines.push('');

  // hasVariable
  lines.push('  hasVariable(address: VariableAddress): boolean {');
  lines.push('    const key = this.getVariableKey(address);');
  lines.push(
    '    return this.variables.has(key) || this.runtime.durable.getVariable(this.executionAddress(address), address.portName, this.allowAncestorDurableVariables) !== undefined;'
  );
  lines.push('  }');
  lines.push('');

  lines.push('  executionAddress(address: Pick<VariableAddress, "id" | "executionIndex" | "nodeTypeName">): ExecutionAddress {');
  lines.push('    const runtime = this.getRuntime();');
  lines.push('    return runtime.durable.address(runtime, address.id, address.nodeTypeName ?? address.id, address.executionIndex);');
  lines.push('  }');
  lines.push('');
  lines.push('  shouldExecute(nodeId: string, nodeType: string, executionIndex: number): boolean {');
  lines.push('    const runtime = this.getRuntime();');
  lines.push('    return runtime.durable.shouldExecute(runtime.durable.address(runtime, nodeId, nodeType, executionIndex));');
  lines.push('  }');
  lines.push('');
  lines.push('  commitNode(nodeId: string, nodeType: string, executionIndex: number): void {');
  lines.push('    const runtime = this.getRuntime();');
  lines.push('    runtime.durable.commitNode(runtime.durable.address(runtime, nodeId, nodeType, executionIndex));');
  lines.push('  }');
  lines.push('');
  lines.push('  bindWorkflow(workflowId: string, graphFingerprint: string): void {');
  lines.push('    this.runtime.durable.bind(this.runtime, workflowId, graphFingerprint);');
  lines.push('  }');
  lines.push('');
  lines.push('  resolveGate(kind: DurableGateKind, nodeId: string, nodeType: string, executionIndex: number, payload: WireValue): WireValue {');
  lines.push('    const runtime = this.getRuntime();');
  lines.push('    return runtime.durable.resolveGate(runtime, { kind, nodeId, nodeType, executionIndex, payload });');
  lines.push('  }');
  lines.push('');
  lines.push('  executeEffect<T extends WireValue>(nodeId: string, nodeType: string, executionIndex: number, execute: (operationKey: string) => Promise<{ result: T; receipt: WireValue }>): Promise<T> {');
  lines.push('    const runtime = this.getRuntime();');
  lines.push('    return runtime.durable.executeEffect(runtime, { nodeId, nodeType, executionIndex }, execute);');
  lines.push('  }');
  lines.push('');
  lines.push('  createNestedRuntime(workflowId: string, callerNodeId: string, callerExecutionIndex: number): WorkflowRuntime {');
  lines.push('    const invocation = this.nestedInvocationCounts.get(callerNodeId) ?? 0;');
  lines.push('    this.nestedInvocationCounts.set(callerNodeId, invocation + 1);');
  lines.push('    const parentRuntime = this.getRuntime();');
  lines.push('    return { ...parentRuntime, frames: [...parentRuntime.frames, { workflowId, invocation, callerNodeId, callerExecutionIndex }], scopes: parentRuntime.scopes };');
  lines.push('  }');
  lines.push('');
  lines.push('  enterBranch(nodeId: string, executionIndex: number, arm: string): void { const frameDepth = this.runtime.frames.length - 1; const workflowId = this.runtime.frames[frameDepth].workflowId; this.branchStack.push({ workflowId, frameDepth, nodeId, executionIndex, arm }); }');
  lines.push('  exitBranch(): void { this.branchStack.pop(); }');
  lines.push('  getRuntime(): WorkflowRuntime { return { ...this.runtime, branches: [...this.branchStack] }; }');
  lines.push('  forkParallel(): GeneratedExecutionContext {');
  lines.push('    const parallelContext = new GeneratedExecutionContext(this.isAsync, this.getRuntime());');
  lines.push('    parallelContext.variables = new Map(this.variables);');
  lines.push('    parallelContext.executions = new Map(this.executions);');
  lines.push('    parallelContext.executionCounter = this.executionCounter;');
  lines.push('    parallelContext.pullExecutors = new Map(this.pullExecutors);');
  lines.push('    parallelContext.nodeExecutionIndices = new Map(this.nodeExecutionIndices);');
  lines.push('    parallelContext.nodeExecutionCounts = new Map(this.nodeExecutionCounts);');
  lines.push('    parallelContext.scopeInvocationCounts = new Map(this.scopeInvocationCounts);');
  lines.push('    parallelContext.nestedInvocationCounts = new Map(this.nestedInvocationCounts);');
  lines.push('    parallelContext.allowAncestorDurableVariables = this.allowAncestorDurableVariables;');
  lines.push('    return parallelContext;');
  lines.push('  }');
  lines.push('  mergeParallel(parallelContext: GeneratedExecutionContext): void {');
  lines.push('    this.mergeScope(parallelContext);');
  lines.push('    parallelContext.nodeExecutionIndices.forEach((index, id) => { this.nodeExecutionIndices.set(id, index); });');
  lines.push('    parallelContext.scopeInvocationCounts.forEach((count, key) => { this.scopeInvocationCounts.set(key, Math.max(this.scopeInvocationCounts.get(key) ?? 0, count)); });');
  lines.push('    parallelContext.nestedInvocationCounts.forEach((count, key) => { this.nestedInvocationCounts.set(key, Math.max(this.nestedInvocationCounts.get(key) ?? 0, count)); });');
  lines.push('  }');
  lines.push('');

  // getExecution
  lines.push('  getExecution(id: string, index: number): ExecutionInfo | undefined {');
  lines.push('    return this.executions.get(this.getExecutionKey(id, index));');
  lines.push('  }');
  lines.push('');

  // createScope
  lines.push(
    '  createScope(_parentNodeName: string, _parentIndex: number, _scopeName: string, cleanScope: boolean = false, isAsyncOverride?: boolean): GeneratedExecutionContext {'
  );
  lines.push(
    '    const effectiveIsAsync = isAsyncOverride !== undefined ? isAsyncOverride : this.isAsync;'
  );
  lines.push('    const scopeKey = `${_parentNodeName}:${_parentIndex}:${_scopeName}`;');
  lines.push('    const scopeInvocation = this.scopeInvocationCounts.get(scopeKey) ?? 0;');
  lines.push('    this.scopeInvocationCounts.set(scopeKey, scopeInvocation + 1);');
  lines.push('    const parentRuntime = this.getRuntime();');
  lines.push('    const scopedRuntime: WorkflowRuntime = { ...parentRuntime, scopes: [...parentRuntime.scopes, { parentNodeId: _parentNodeName, parentExecutionIndex: _parentIndex, scopeName: _scopeName, invocation: scopeInvocation, loopIteration: scopeInvocation }] };');
  lines.push('    const scopedContext = new GeneratedExecutionContext(effectiveIsAsync, scopedRuntime);');
  lines.push('    // For per-port function scopes (cleanScope=true), start with empty variables');
  lines.push('    // For node-level scopes (cleanScope=false), inherit parent variables');
  lines.push('    scopedContext.variables = cleanScope ? new Map() : new Map(this.variables);');
  lines.push(
    '    scopedContext.allowAncestorDurableVariables = this.allowAncestorDurableVariables && !cleanScope;'
  );
  lines.push('    scopedContext.executions = new Map(this.executions);');
  lines.push('    scopedContext.executionCounter = this.executionCounter;');
  lines.push('    scopedContext.nodeExecutionCounts = new Map(this.nodeExecutionCounts);');
  lines.push('    return scopedContext;');
  lines.push('  }');
  lines.push('');

  // mergeScope
  lines.push('  mergeScope(scopedContext: GeneratedExecutionContext): void {');
  lines.push('    scopedContext.executions.forEach((info, key) => {');
  lines.push('      this.executions.set(key, info);');
  lines.push('    });');
  lines.push('    scopedContext.variables.forEach((value, key) => {');
  lines.push('      this.variables.set(key, value);');
  lines.push('    });');
  lines.push(
    '    this.executionCounter = Math.max(this.executionCounter, scopedContext.executionCounter);'
  );
  lines.push('    scopedContext.nodeExecutionCounts.forEach((count, id) => {');
  lines.push('      const currentCount = this.nodeExecutionCounts.get(id) || 0;');
  lines.push('      this.nodeExecutionCounts.set(id, Math.max(currentCount, count));');
  lines.push('    });');
  lines.push('  }');
  lines.push('');

  // Helper methods
  lines.push('  private getVariableKey(address: VariableAddress): string {');
  lines.push('    return `${address.id}:${address.portName}:${address.executionIndex}`;');
  lines.push('  }');
  lines.push('');
  lines.push('  private getExecutionKey(id: string, index: number): string {');
  lines.push('    return `${id}:${index}`;');
  lines.push('  }');
  lines.push('');
  lines.push('  getExecutionCount(): number {');
  lines.push('    return this.executionCounter;');
  lines.push('  }');
  lines.push('');
  lines.push('  reset(): void {');
  lines.push('    this.variables.clear();');
  lines.push('    this.executions.clear();');
  lines.push('    this.executionCounter = 0;');
  lines.push('    this.nodeExecutionCounts.clear();');
  lines.push('  }');
  lines.push('');

  // Cancellation methods
  lines.push('  isAborted(): boolean {');
  lines.push('    return this.runtime.abortSignal?.aborted ?? false;');
  lines.push('  }');
  lines.push('');
  lines.push('  getAbortSignal(): AbortSignal | undefined {');
  lines.push('    return this.runtime.abortSignal;');
  lines.push('  }');
  lines.push('');
  lines.push('  checkAborted(nodeId?: string): void {');
  lines.push('    if (this.runtime.abortSignal?.aborted) {');
  lines.push('      throw new CancellationError(');
  lines.push("        `Workflow execution cancelled${nodeId ? ` at ${nodeId}` : ''}`,");
  lines.push('        this.executionCounter,');
  lines.push('        nodeId');
  lines.push('      );');
  lines.push('    }');
  lines.push('  }');
  lines.push('');

  // Debug event methods (only in development mode)
  if (!production) {
    lines.push('  async sendStatusChangedEvent(args: {');
    lines.push('    nodeTypeName: string;');
    lines.push('    id: string;');
    lines.push('    scope?: string;');
    lines.push('    side?: "start" | "exit";');
    lines.push('    executionIndex: number;');
    lines.push('    status: TStatusType;');
    lines.push('  }): Promise<void> {');
    lines.push('    if (this.flowWeaverDebugger) {');
    lines.push('      await this.flowWeaverDebugger.sendEvent({');
    lines.push('        type: "STATUS_CHANGED",');
    lines.push('        ...args,');
    lines.push('        innerFlowInvocation: this.flowWeaverDebugger.innerFlowInvocation,');
    lines.push('      });');
    lines.push('    }');
    lines.push('  }');
    lines.push('');
    lines.push('  private async sendVariableSetEvent(args: {');
    lines.push('    identifier: TVariableIdentification;');
    lines.push('    value: unknown;');
    lines.push('  }): Promise<void> {');
    lines.push('    if (this.flowWeaverDebugger) {');
    lines.push('      await this.flowWeaverDebugger.sendEvent({');
    lines.push('        type: "VARIABLE_SET",');
    lines.push('        ...args,');
    lines.push('        innerFlowInvocation: this.flowWeaverDebugger.innerFlowInvocation,');
    lines.push('      });');
    lines.push('    }');
    lines.push('  }');
    lines.push('');
    lines.push('  async sendLogErrorEvent(args: {');
    lines.push('    nodeTypeName: string;');
    lines.push('    id: string;');
    lines.push('    scope?: string;');
    lines.push('    side?: "start" | "exit";');
    lines.push('    executionIndex: number;');
    lines.push('    error: string;');
    lines.push('    code?: string;');
    lines.push('  }): Promise<void> {');
    lines.push('    if (this.flowWeaverDebugger) {');
    lines.push('      await this.flowWeaverDebugger.sendEvent({');
    lines.push('        type: "LOG_ERROR",');
    lines.push('        ...args,');
    lines.push('        innerFlowInvocation: this.flowWeaverDebugger.innerFlowInvocation,');
    lines.push('      });');
    lines.push('    }');
    lines.push('  }');
    lines.push('');
    lines.push('  async sendWorkflowCompletedEvent(args: {');
    lines.push('    executionIndex: number;');
    lines.push('    status: "SUCCEEDED" | "FAILED" | "CANCELLED";');
    lines.push('    result?: unknown;');
    lines.push('  }): Promise<void> {');
    lines.push('    if (this.flowWeaverDebugger) {');
    lines.push('      await this.flowWeaverDebugger.sendEvent({');
    lines.push('        type: "WORKFLOW_COMPLETED",');
    lines.push('        ...args,');
    lines.push('        innerFlowInvocation: this.flowWeaverDebugger.innerFlowInvocation,');
    lines.push('      });');
    lines.push('    }');
    lines.push('  }');
  } else {
    // Production mode: stub implementations (no-ops)
    lines.push('  sendStatusChangedEvent(_args: unknown): void {');
    lines.push('    // No-op in production mode');
    lines.push('  }');
    lines.push('');
    lines.push('  sendLogErrorEvent(_args: unknown): void {');
    lines.push('    // No-op in production mode');
    lines.push('  }');
    lines.push('');
    lines.push('  sendWorkflowCompletedEvent(_args: unknown): void {');
    lines.push('    // No-op in production mode');
    lines.push('  }');
  }

  // Live debugger inspection never invokes lazy values.
  if (!production) {
    lines.push('');
    lines.push('  inspectVariables(): Record<string, unknown> {');
    lines.push('    const vars: Record<string, unknown> = {};');
    lines.push('    for (const [key, value] of this.variables) {');
    lines.push('      vars[key] = typeof value === "function" ? "[lazy value]" : value;');
    lines.push('    }');
    lines.push('    return vars;');
    lines.push('  }');
  }

  lines.push('}');
  lines.push('');

  lines.push(generateInlineEngine(production));
  lines.push('');
  if (moduleFormat === 'esm') {
    // A shared runtime module already exports its classes by keyword.
    const values = INLINE_ENGINE_EXPORTS.filter((name) => !exportClasses || name !== 'CancellationError');
    lines.push(`export { ${values.join(', ')} };`);
    lines.push(`export type { ${INLINE_ENGINE_TYPE_EXPORTS.join(', ')} };`);
    lines.push('');
  }

  const output = lines.join('\n');
  if (outputFormat === 'javascript') {
    return stripTypeScript(output);
  }
  return output;
}

/**
 * Generates a standalone runtime module file for multi-workflow bundles.
 * This exports all runtime types and classes so individual workflow files can import them.
 *
 * @param production - Whether to generate production-optimized code (no debug events)
 * @param moduleFormat - The module format to use ('esm' or 'cjs')
 */
export function generateStandaloneRuntimeModule(
  production: boolean,
  moduleFormat: TModuleFormat = 'esm'
): string {
  const lines: string[] = [];

  lines.push('// ============================================================================');
  lines.push('// Shared Runtime Module');
  lines.push(getGeneratedBranding().header());
  lines.push('// ============================================================================');
  lines.push('');

  // Include the inline runtime (all types, GeneratedExecutionContext and the
  // durable engine). Pass exportClasses=true to add 'export' keywords for
  // module use.
  const inlineRuntime = generateInlineRuntime(production, true, 'typescript', moduleFormat);
  lines.push(inlineRuntime);
  lines.push('');


  if (moduleFormat === 'cjs') {
    // CommonJS exports
    lines.push('// ============================================================================');
    lines.push('// Exports');
    lines.push('// ============================================================================');
    lines.push('');
    const exports = ['GeneratedExecutionContext', ...INLINE_ENGINE_EXPORTS];
    lines.push(`module.exports = { ${exports.join(', ')} };`);
  }
  // For ESM, exports are added via 'export' keyword in the generated code

  lines.push('');

  return lines.join('\n');
}
