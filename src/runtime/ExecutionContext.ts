import type { TDebugger, TStatusType, TVariableIdentification } from './events';
import { CancellationError } from './CancellationError';
import type { WorkflowRuntime } from './durable-execution.js';
import type { DurableGateKind, ExecutionAddress, WireValue } from './continuation.js';
import type { BranchAddress } from './continuation.js';

/**
 * Address for accessing a variable in the execution context
 *
 * Variables are stored with key format: `nodeName:portName:executionIndex`
 *
 * @example
 * ```typescript
 * const address: VariableAddress = {
 *   nodeName: 'adder1',
 *   portName: 'result',
 *   executionIndex: 0,
 *   nodeTypeName: 'Add'
 * };
 * const value = await ctx.getVariable(address);
 * // Key used internally: "adder1:result:0"
 * ```
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
 * Runtime execution context for generated workflows
 *
 * Manages variable storage, execution tracking, and pull execution (lazy evaluation).
 * This class is used internally by generated workflow code.
 *
 * Key Features:
 * - Variable storage with execution-scoped addressing
 * - Pull execution support (lazy evaluation)
 * - Debug event emission
 * - Async and sync execution modes
 *
 * @example
 * ```typescript
 * const ctx = new GeneratedExecutionContext(true, runtime);
 * const execIndex = ctx.addExecution('node1');
 * ctx.setVariable({ nodeName: 'node1', portName: 'result', executionIndex: execIndex }, 42);
 * const value = await ctx.getVariable({ nodeName: 'node1', portName: 'result', executionIndex: execIndex });
 * ```
 */
export class GeneratedExecutionContext {
  private variables: Map<string, VariableValue> = new Map();
  private executions: Map<string, ExecutionInfo> = new Map();
  private executionCounter: number = 0;
  private isAsync: boolean;
  private flowWeaverDebugger?: TDebugger | undefined;
  private pullExecutors: Map<string, () => void | Promise<void>> = new Map();
  private nodeExecutionIndices: Map<string, number> = new Map();
  private nodeExecutionCounts: Map<string, number> = new Map();
  private runtime: WorkflowRuntime;
  private scopeInvocationCounts: Map<string, number> = new Map();
  private nestedInvocationCounts: Map<string, number> = new Map();
  private branchStack: BranchAddress[];
  private allowAncestorDurableVariables = true;

  /**
   * Create a new execution context
   * @param isAsync - Whether the workflow runs in async mode (default: true)
   * @param runtime - Required execution-scoped runtime
   */
  constructor(isAsync: boolean = true, runtime: WorkflowRuntime) {
    this.isAsync = isAsync;
    this.flowWeaverDebugger = runtime.services.debugger;
    this.runtime = runtime;
    this.branchStack = [...runtime.branches];
  }
  registerPullExecutor(id: string, executor: () => void | Promise<void>): void {
    this.pullExecutors.set(id, executor);
  }
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
    if (this.flowWeaverDebugger) {
      const actualValue = typeof value === 'function' ? value() : value;
      this.sendVariableSetEvent({
        identifier: {
          nodeTypeName: address.nodeTypeName || 'unknown',
          id: address.id,
          portName: address.portName,
          executionIndex: address.executionIndex,
          key: 'default',
          ...(address.scope !== undefined && { scope: address.scope }),
          ...(address.side !== undefined && { side: address.side }),
        },
        value: actualValue,
      });
    }
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
  getExecution(id: string, index: number): ExecutionInfo | undefined {
    return this.executions.get(this.getExecutionKey(id, index));
  }

  /**
   * Create an isolated execution scope for container nodes
   *
   * Scopes provide isolated variable storage for nodes like ForEach loops.
   * Child nodes execute within the scope, then variables are merged back.
   *
   * @param _parentNodeName - ID of the container node creating the scope
   * @param _parentIndex - Execution index of the container
   * @param _scopeName - Name of the scope (e.g., 'iteration')
   * @param cleanScope - If true, create fresh scope without parent variables (per-port scopes). If false, inherit parent variables (node-level scopes).
   * @returns New ExecutionContext for the scoped execution
   *
   * @example
   * ```typescript
   * // Per-port scope (clean=true): isolated variables
   * const scopedCtx = ctx.createScope('forEach1', 0, 'iteration', true);
   *
   * // Node-level scope (clean=false): inherited variables
   * const scopedCtx = ctx.createScope('container1', 0, 'block', false);
   * ```
   */
  createScope(
    _parentNodeName: string,
    _parentIndex: number,
    _scopeName: string,
    cleanScope: boolean = false,
  ): GeneratedExecutionContext {
    const scopeKey = `${_parentNodeName}:${_parentIndex}:${_scopeName}`;
    const invocation = this.scopeInvocationCounts.get(scopeKey) ?? 0;
    this.scopeInvocationCounts.set(scopeKey, invocation + 1);
    const parentRuntime = this.getRuntime();
    const scopedRuntime: WorkflowRuntime = {
      ...parentRuntime,
      scopes: [
        ...parentRuntime.scopes,
        {
          parentNodeId: _parentNodeName,
          parentExecutionIndex: _parentIndex,
          scopeName: _scopeName,
          invocation,
          loopIteration: invocation,
        },
      ],
    };
    const scopedContext = new GeneratedExecutionContext(this.isAsync, scopedRuntime);
    scopedContext.allowAncestorDurableVariables = this.allowAncestorDurableVariables && !cleanScope;

    if (cleanScope) {
      // Fresh scope - don't copy parent variables (per-port scopes)
      scopedContext.executionCounter = this.executionCounter;
    } else {
      // Inherited scope - copy parent variables (node-level scopes)
      scopedContext.variables = new Map(this.variables);
      scopedContext.executions = new Map(this.executions);
      scopedContext.executionCounter = this.executionCounter;
    }

    return scopedContext;
  }

  /**
   * Merge a scoped execution context back into the parent context
   *
   * Copies all variables and execution info from the scoped context to this context.
   * Updates the execution counter to maintain unique execution indices.
   *
   * @param scopedContext - The scoped context to merge
   */
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

  /**
   * Forks the mutable generated-code bookkeeping used by one Promise.all lane.
   * Durable state remains execution-scoped and shared through `runtime`, while
   * branch/scoped address stacks are copied so concurrent lanes cannot corrupt
   * one another's continuation addresses.
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

  /**
   * Check if the workflow has been aborted
   */
  isAborted(): boolean {
    return this.runtime.abortSignal?.aborted ?? false;
  }

  /** Return the parent-owned signal without transferring ownership. */
  getAbortSignal(): AbortSignal | undefined {
    return this.runtime.abortSignal;
  }

  /**
   * Throw CancellationError if the workflow has been aborted
   * @param nodeId - Optional node ID to include in the error
   */
  checkAborted(nodeId?: string): void {
    if (this.runtime.abortSignal?.aborted) {
      throw new CancellationError(
        `Workflow execution cancelled${nodeId ? ` at ${nodeId}` : ''}`,
        this.executionCounter,
        nodeId,
      );
    }
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
    return runtime.durable.resolveGate(runtime, {
      kind,
      nodeId,
      nodeType,
      executionIndex,
      payload,
    });
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

  getRuntime(): WorkflowRuntime {
    return { ...this.runtime, branches: [...this.branchStack] };
  }

  enterBranch(nodeId: string, executionIndex: number, arm: string): void {
    const frameDepth = this.runtime.frames.length - 1;
    const workflowId = this.runtime.frames[frameDepth].workflowId;
    this.branchStack.push({
      workflowId,
      frameDepth,
      nodeId,
      executionIndex,
      arm,
    });
  }

  exitBranch(): void {
    this.branchStack.pop();
  }

  sendStatusChangedEvent(args: {
    nodeTypeName: string;
    id: string;
    scope?: string;
    side?: 'start' | 'exit';
    executionIndex: number;
    status: TStatusType;
  }): void {
    if (this.flowWeaverDebugger) {
      this.flowWeaverDebugger.sendEvent({
        type: 'STATUS_CHANGED',
        ...args,
        innerFlowInvocation: this.flowWeaverDebugger.innerFlowInvocation,
      });
    }
  }
  sendVariableSetEvent(args: { identifier: TVariableIdentification; value: unknown }): void {
    if (this.flowWeaverDebugger) {
      this.flowWeaverDebugger.sendEvent({
        type: 'VARIABLE_SET',
        ...args,
        innerFlowInvocation: this.flowWeaverDebugger.innerFlowInvocation,
      });
    }
  }
  sendLogErrorEvent(args: {
    nodeTypeName: string;
    id: string;
    scope?: string;
    side?: 'start' | 'exit';
    executionIndex: number;
    error: string;
    code?: string;
  }): void {
    if (this.flowWeaverDebugger) {
      this.flowWeaverDebugger.sendEvent({
        type: 'LOG_ERROR',
        ...args,
        innerFlowInvocation: this.flowWeaverDebugger.innerFlowInvocation,
      });
    }
  }
  sendWorkflowCompletedEvent(args: {
    executionIndex: number;
    status: 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
    result?: unknown;
  }): void {
    if (this.flowWeaverDebugger) {
      this.flowWeaverDebugger.sendEvent({
        type: 'WORKFLOW_COMPLETED',
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
}
