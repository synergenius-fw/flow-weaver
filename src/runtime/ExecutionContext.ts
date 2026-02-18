import type { TDebugger, TStatusType, TVariableIdentification } from './events';
import { CancellationError } from './CancellationError';

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
 * const ctx = new GeneratedExecutionContext(true, debugger);
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
  private abortSignal?: AbortSignal | undefined;

  /**
   * Create a new execution context
   * @param isAsync - Whether the workflow runs in async mode (default: true)
   * @param flowWeaverDebugger - Optional debugger for emitting execution events
   * @param abortSignal - Optional AbortSignal for cancellation support
   */
  constructor(isAsync: boolean = true, flowWeaverDebugger?: TDebugger, abortSignal?: AbortSignal) {
    this.isAsync = isAsync;
    this.flowWeaverDebugger = flowWeaverDebugger;
    this.abortSignal = abortSignal;
  }
  registerPullExecutor(id: string, executor: () => void | Promise<void>): void {
    this.pullExecutors.set(id, executor);
  }
  addExecution(id: string, parentIndex?: number, scopeName?: string): number {
    const index = this.executionCounter++;
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
    if (this.flowWeaverDebugger) {
      const actualValue = typeof value === 'function' ? value() : value;
      this.sendVariableSetEvent({
        identifier: {
          nodeTypeName: address.nodeTypeName || 'unknown',
          id: address.id,
          portName: address.portName,
          executionIndex: address.executionIndex,
          key: 'default',
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
            const finalAddress =
              trackedIndex !== undefined ? { ...address, executionIndex: trackedIndex } : address;
            return this.retrieveVariable(finalAddress);
          });
        }

        // Handle sync executor (returns void)
        const trackedIndex = this.nodeExecutionIndices.get(address.id);
        const finalAddress =
          trackedIndex !== undefined ? { ...address, executionIndex: trackedIndex } : address;
        return this.retrieveVariable(finalAddress);
      }
    }

    return this.retrieveVariable(address);
  }
  private retrieveVariable(address: VariableAddress): unknown | Promise<unknown> {
    const key = this.getVariableKey(address);
    if (!this.variables.has(key)) {
      throw new Error(
        `Variable not found: ${address.id}.${address.portName}[${address.executionIndex}]`
      );
    }
    const value = this.variables.get(key);
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
    return this.variables.has(key);
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
    cleanScope: boolean = false
  ): GeneratedExecutionContext {
    const scopedContext = new GeneratedExecutionContext(this.isAsync, undefined, this.abortSignal);

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
  }

  /**
   * Check if the workflow has been aborted
   */
  isAborted(): boolean {
    return this.abortSignal?.aborted ?? false;
  }

  /**
   * Throw CancellationError if the workflow has been aborted
   * @param nodeId - Optional node ID to include in the error
   */
  checkAborted(nodeId?: string): void {
    if (this.abortSignal?.aborted) {
      throw new CancellationError(
        `Workflow execution cancelled${nodeId ? ` at ${nodeId}` : ''}`,
        this.executionCounter,
        nodeId
      );
    }
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
}
