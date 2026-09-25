/**
 * The execution context a generated workflow body runs against: variable
 * storage, per-node execution indices, scopes, pull execution, debug events,
 * and the calls into the durable engine.
 *
 * This module is written to be inlined, and there is one copy of the class:
 * `scripts/generate-inline-engine.ts` turns this file into text, and
 * `generateInlineRuntime` in `src/api/inline-runtime.ts` writes that text
 * into every compiled file. The class the package exports and the one a
 * compiled workflow runs are therefore the same code. The rules of
 * `durable-execution.ts` apply here too: no Node API, nothing past ES2020,
 * and imports of types only, except `CancellationError`, which the inlined
 * runtime declares ahead of this class. Every comment below this header is
 * copied into compiled files; this header is the one comment the inliner
 * drops.
 *
 * A production build of a compiled file carries no debug instrumentation,
 * and two comment markers say what it leaves out:
 * - a region opened by `inline: development only` and closed by
 *   `inline: end` is removed;
 * - a region opened by `inline: development only, a no-op stub in
 *   production` becomes one `name(_args: unknown): void` stub for each
 *   method in it, so generated calls to those methods still resolve.
 * The package and the development build keep both kinds of region and drop
 * only the marker lines.
 */
import type { TDebugger, TStatusType, TVariableIdentification } from './events';
import { CancellationError } from './CancellationError';
import type { WorkflowRuntime } from './durable-execution.js';
import type { DurableGateKind, ExecutionAddress, WireValue } from './continuation.js';
import type { BranchAddress } from './continuation.js';

/**
 * Address of a variable in the execution context. Variables are stored under
 * the key `id:portName:executionIndex`.
 */
export interface VariableAddress {
  id: string;
  portName: string;
  executionIndex: number;
  nodeTypeName?: string | undefined;
  scope?: string | undefined;
  side?: 'start' | 'exit' | undefined;
  /** Inputs remain live/debug-visible but are never serialized as durable outputs. */
  durable?: boolean | undefined;
}

export interface ExecutionInfo {
  id: string;
  index: number;
  parentIndex?: number | undefined;
  scopeName?: string | undefined;
}

type VariableValue = unknown | (() => unknown) | (() => Promise<unknown>);

/**
 * Variable storage with execution-scoped addressing, per-node execution
 * indices, pull execution (lazy evaluation), scopes and parallel lanes, debug
 * events, and the durable engine calls a generated body makes.
 *
 * Scope counters start at 0 on every construction. A resume replays the body
 * from its first node, skipping what the continuation holds, and so reaches
 * the same iteration ordinals the first run assigned
 * (`tests/continuation/durable-loops.test.ts`).
 */
export class GeneratedExecutionContext {
  private variables: Map<string, VariableValue> = new Map();
  private executions: Map<string, ExecutionInfo> = new Map();
  private executionCounter: number = 0;
  private nodeExecutionCounts: Map<string, number> = new Map();
  private isAsync: boolean;
  // inline: development only
  private flowWeaverDebugger?: TDebugger | undefined;
  // inline: end
  private pullExecutors: Map<string, () => void | Promise<void>> = new Map();
  private nodeExecutionIndices: Map<string, number> = new Map();
  private runtime: WorkflowRuntime;
  private scopeInvocationCounts: Map<string, number> = new Map();
  private nestedInvocationCounts: Map<string, number> = new Map();
  private branchStack: BranchAddress[];
  private allowAncestorDurableVariables = true;

  /** `isAsync` is the workflow's async mode; `runtime` is the execution-scoped runtime. */
  constructor(isAsync: boolean = true, runtime: WorkflowRuntime) {
    this.isAsync = isAsync;
    // inline: development only
    this.flowWeaverDebugger = runtime.services.debugger;
    // inline: end
    this.runtime = runtime;
    this.branchStack = [...runtime.branches];
  }

  registerPullExecutor(id: string, executor: () => void | Promise<void>): void {
    this.pullExecutors.set(id, executor);
  }

  /** Record one execution of a node; each node counts its own executions from 0. */
  addExecution(id: string, parentIndex?: number, scopeName?: string): number {
    const index = this.nodeExecutionCounts.get(id) ?? 0;
    this.nodeExecutionCounts.set(id, index + 1);
    this.executionCounter++;
    this.executions.set(this.getExecutionKey(id, index), {
      id,
      index,
      parentIndex,
      scopeName,
    });
    this.nodeExecutionIndices.set(id, index);
    return index;
  }

  setVariable(address: VariableAddress, value: VariableValue): void | Promise<void> {
    const key = this.getVariableKey(address);
    this.variables.set(key, value);
    if (typeof value !== 'function' && address.durable !== false) {
      this.runtime.durable.setVariable(this.executionAddress(address), address.portName, value);
    }
    // inline: development only
    if (this.flowWeaverDebugger) {
      const actualValue = typeof value === 'function' ? value() : value;
      this.sendVariableSetEvent({
        identifier: {
          nodeTypeName: address.nodeTypeName || 'unknown',
          id: address.id,
          portName: address.portName,
          executionIndex: address.executionIndex,
          key: 'default',
          ...(address.scope && { scope: address.scope }),
          ...(address.side && { side: address.side }),
        },
        value: actualValue,
      });
    }
    // inline: end
    return this.isAsync ? Promise.resolve() : undefined;
  }

  getVariable(address: VariableAddress): unknown | Promise<unknown> {
    const executor = this.pullExecutors.get(address.id);
    if (executor) {
      if (!this.hasVariable(address)) {
        const result = executor();
        // Handle async executor (returns Promise)
        if (result instanceof Promise) {
          return result.then(() => {
            const trackedIndex = this.nodeExecutionIndices.get(address.id);
            const finalAddress = trackedIndex !== undefined ? { ...address, executionIndex: trackedIndex } : address;
            return this.retrieveVariable(finalAddress);
          });
        }
        // Handle sync executor (returns void)
        const trackedIndex = this.nodeExecutionIndices.get(address.id);
        const finalAddress = trackedIndex !== undefined ? { ...address, executionIndex: trackedIndex } : address;
        return this.retrieveVariable(finalAddress);
      }
    }
    return this.retrieveVariable(address);
  }

  private retrieveVariable(address: VariableAddress): unknown | Promise<unknown> {
    const key = this.getVariableKey(address);
    let value = this.variables.get(key);
    if (!this.variables.has(key)) {
      value = this.runtime.durable.getVariable(
        this.executionAddress(address),
        address.portName,
        this.allowAncestorDurableVariables,
      );
      if (value === undefined) {
        throw new Error(`Variable not found: ${address.id}.${address.portName}[${address.executionIndex}]`);
      }
      this.variables.set(key, value);
    }
    if (typeof value === 'function') {
      const result = value();
      if (result instanceof Promise) {
        return result;
      }
      return this.isAsync ? Promise.resolve(result) : result;
    }
    return this.isAsync ? Promise.resolve(value) : value;
  }

  hasVariable(address: VariableAddress): boolean {
    const key = this.getVariableKey(address);
    return (
      this.variables.has(key) ||
      this.runtime.durable.getVariable(
        this.executionAddress(address),
        address.portName,
        this.allowAncestorDurableVariables,
      ) !== undefined
    );
  }

  executionAddress(address: Pick<VariableAddress, 'id' | 'executionIndex' | 'nodeTypeName'>): ExecutionAddress {
    const runtime = this.getRuntime();
    return runtime.durable.address(runtime, address.id, address.nodeTypeName ?? address.id, address.executionIndex);
  }

  shouldExecute(nodeId: string, nodeType: string, executionIndex: number): boolean {
    const runtime = this.getRuntime();
    return runtime.durable.shouldExecute(runtime.durable.address(runtime, nodeId, nodeType, executionIndex));
  }

  commitNode(nodeId: string, nodeType: string, executionIndex: number): void {
    const runtime = this.getRuntime();
    runtime.durable.commitNode(runtime.durable.address(runtime, nodeId, nodeType, executionIndex));
  }

  /** The first thing a gated body does: name its workflow and graph to the engine. */
  bindWorkflow(workflowId: string, graphFingerprint: string): void {
    this.runtime.durable.bind(this.runtime, workflowId, graphFingerprint);
  }

  resolveGate(
    kind: DurableGateKind,
    nodeId: string,
    nodeType: string,
    executionIndex: number,
    payload: WireValue,
  ): WireValue {
    const runtime = this.getRuntime();
    return runtime.durable.resolveGate(runtime, { kind, nodeId, nodeType, executionIndex, payload });
  }

  executeEffect<T extends WireValue>(
    nodeId: string,
    nodeType: string,
    executionIndex: number,
    execute: (operationKey: string) => Promise<{ result: T; receipt: WireValue }>,
  ): Promise<T> {
    const runtime = this.getRuntime();
    return runtime.durable.executeEffect(runtime, { nodeId, nodeType, executionIndex }, execute);
  }

  createNestedRuntime(workflowId: string, callerNodeId: string, callerExecutionIndex: number): WorkflowRuntime {
    const invocation = this.nestedInvocationCounts.get(callerNodeId) ?? 0;
    this.nestedInvocationCounts.set(callerNodeId, invocation + 1);
    const parentRuntime = this.getRuntime();
    return {
      ...parentRuntime,
      frames: [...parentRuntime.frames, { workflowId, invocation, callerNodeId, callerExecutionIndex }],
      scopes: parentRuntime.scopes,
    };
  }

  enterBranch(nodeId: string, executionIndex: number, arm: string): void {
    const frameDepth = this.runtime.frames.length - 1;
    const workflowId = this.runtime.frames[frameDepth].workflowId;
    this.branchStack.push({ workflowId, frameDepth, nodeId, executionIndex, arm });
  }

  exitBranch(): void {
    this.branchStack.pop();
  }

  getRuntime(): WorkflowRuntime {
    return { ...this.runtime, branches: [...this.branchStack] };
  }

  /**
   * Fork the mutable bookkeeping for one lane of a parallel group. Durable
   * state stays execution-scoped and shared through `runtime`, while the
   * branch and scope address stacks are copied so concurrent lanes cannot
   * corrupt one another's continuation addresses.
   */
  forkParallel(): GeneratedExecutionContext {
    const parallelContext = new GeneratedExecutionContext(this.isAsync, this.getRuntime());
    parallelContext.variables = new Map(this.variables);
    parallelContext.executions = new Map(this.executions);
    parallelContext.executionCounter = this.executionCounter;
    parallelContext.pullExecutors = new Map(this.pullExecutors);
    parallelContext.nodeExecutionIndices = new Map(this.nodeExecutionIndices);
    parallelContext.nodeExecutionCounts = new Map(this.nodeExecutionCounts);
    parallelContext.scopeInvocationCounts = new Map(this.scopeInvocationCounts);
    parallelContext.nestedInvocationCounts = new Map(this.nestedInvocationCounts);
    parallelContext.allowAncestorDurableVariables = this.allowAncestorDurableVariables;
    return parallelContext;
  }

  mergeParallel(parallelContext: GeneratedExecutionContext): void {
    this.mergeScope(parallelContext);
    parallelContext.nodeExecutionIndices.forEach((index, id) => {
      this.nodeExecutionIndices.set(id, index);
    });
    parallelContext.scopeInvocationCounts.forEach((count, key) => {
      this.scopeInvocationCounts.set(key, Math.max(this.scopeInvocationCounts.get(key) ?? 0, count));
    });
    parallelContext.nestedInvocationCounts.forEach((count, key) => {
      this.nestedInvocationCounts.set(key, Math.max(this.nestedInvocationCounts.get(key) ?? 0, count));
    });
  }

  getExecution(id: string, index: number): ExecutionInfo | undefined {
    return this.executions.get(this.getExecutionKey(id, index));
  }

  /**
   * Create the execution context for one invocation of a scope (a loop body,
   * a per-port function). Each call is the next invocation of that scope key.
   * A clean scope (a per-port scope) starts with no variables and cannot read
   * its ancestors' durable variables; any other (a node-level scope) inherits
   * the parent's variables. `isAsyncOverride` is the scope's own async mode,
   * when it differs from the parent's.
   */
  createScope(
    _parentNodeName: string,
    _parentIndex: number,
    _scopeName: string,
    cleanScope: boolean = false,
    isAsyncOverride?: boolean,
  ): GeneratedExecutionContext {
    const effectiveIsAsync = isAsyncOverride !== undefined ? isAsyncOverride : this.isAsync;
    const scopeKey = `${_parentNodeName}:${_parentIndex}:${_scopeName}`;
    const scopeInvocation = this.scopeInvocationCounts.get(scopeKey) ?? 0;
    this.scopeInvocationCounts.set(scopeKey, scopeInvocation + 1);
    const parentRuntime = this.getRuntime();
    const scopedRuntime: WorkflowRuntime = {
      ...parentRuntime,
      scopes: [
        ...parentRuntime.scopes,
        {
          parentNodeId: _parentNodeName,
          parentExecutionIndex: _parentIndex,
          scopeName: _scopeName,
          invocation: scopeInvocation,
          loopIteration: scopeInvocation,
        },
      ],
    };
    const scopedContext = new GeneratedExecutionContext(effectiveIsAsync, scopedRuntime);
    scopedContext.variables = cleanScope ? new Map() : new Map(this.variables);
    scopedContext.allowAncestorDurableVariables = this.allowAncestorDurableVariables && !cleanScope;
    scopedContext.executions = new Map(this.executions);
    scopedContext.executionCounter = this.executionCounter;
    scopedContext.nodeExecutionCounts = new Map(this.nodeExecutionCounts);
    return scopedContext;
  }

  /** Merge a scope's variables, executions and counters back into this context. */
  mergeScope(scopedContext: GeneratedExecutionContext): void {
    scopedContext.executions.forEach((info, key) => {
      this.executions.set(key, info);
    });
    scopedContext.variables.forEach((value, key) => {
      this.variables.set(key, value);
    });
    this.executionCounter = Math.max(this.executionCounter, scopedContext.executionCounter);
    scopedContext.nodeExecutionCounts.forEach((count, id) => {
      this.nodeExecutionCounts.set(id, Math.max(this.nodeExecutionCounts.get(id) ?? 0, count));
    });
  }

  private getVariableKey(address: VariableAddress): string {
    return `${address.id}:${address.portName}:${address.executionIndex}`;
  }

  private getExecutionKey(id: string, index: number): string {
    return `${id}:${index}`;
  }

  getExecutionCount(): number {
    return this.executionCounter;
  }

  reset(): void {
    this.variables.clear();
    this.executions.clear();
    this.executionCounter = 0;
    this.nodeExecutionCounts.clear();
  }

  isAborted(): boolean {
    return this.runtime.abortSignal?.aborted ?? false;
  }

  /** Return the parent-owned signal without transferring ownership. */
  getAbortSignal(): AbortSignal | undefined {
    return this.runtime.abortSignal;
  }

  /** Throw a CancellationError, naming `nodeId` when given, if the run was aborted. */
  checkAborted(nodeId?: string): void {
    if (this.runtime.abortSignal?.aborted) {
      throw new CancellationError(
        `Workflow execution cancelled${nodeId ? ` at ${nodeId}` : ''}`,
        this.executionCounter,
        nodeId,
      );
    }
  }

  // inline: development only, a no-op stub in production
  /** Awaited by generated code, so a debugger can hold a node at a breakpoint. */
  async sendStatusChangedEvent(args: {
    nodeTypeName: string;
    id: string;
    scope?: string;
    side?: 'start' | 'exit';
    executionIndex: number;
    status: TStatusType;
  }): Promise<void> {
    if (this.flowWeaverDebugger) {
      await this.flowWeaverDebugger.sendEvent({
        type: 'STATUS_CHANGED',
        ...args,
        innerFlowInvocation: this.flowWeaverDebugger.innerFlowInvocation,
      });
    }
  }

  async sendLogErrorEvent(args: {
    nodeTypeName: string;
    id: string;
    scope?: string;
    side?: 'start' | 'exit';
    executionIndex: number;
    error: string;
    code?: string;
  }): Promise<void> {
    if (this.flowWeaverDebugger) {
      await this.flowWeaverDebugger.sendEvent({
        type: 'LOG_ERROR',
        ...args,
        innerFlowInvocation: this.flowWeaverDebugger.innerFlowInvocation,
      });
    }
  }

  async sendWorkflowCompletedEvent(args: {
    executionIndex: number;
    status: 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
    result?: unknown;
  }): Promise<void> {
    if (this.flowWeaverDebugger) {
      await this.flowWeaverDebugger.sendEvent({
        type: 'WORKFLOW_COMPLETED',
        ...args,
        innerFlowInvocation: this.flowWeaverDebugger.innerFlowInvocation,
      });
    }
  }
  // inline: end
  // inline: development only

  private async sendVariableSetEvent(args: { identifier: TVariableIdentification; value: unknown }): Promise<void> {
    if (this.flowWeaverDebugger) {
      await this.flowWeaverDebugger.sendEvent({
        type: 'VARIABLE_SET',
        ...args,
        innerFlowInvocation: this.flowWeaverDebugger.innerFlowInvocation,
      });
    }
  }

  /** Return live debugger-visible variables without invoking lazy values. */
  inspectVariables(): Record<string, unknown> {
    const vars: Record<string, unknown> = {};
    for (const [key, value] of this.variables) {
      vars[key] = typeof value === 'function' ? '[lazy value]' : value;
    }
    return vars;
  }
  // inline: end
}
