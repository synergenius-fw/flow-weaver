/**
 * DebugController intercepts workflow execution at node boundaries,
 * enabling live step-through debugging. It is execution-scoped and is not a
 * durable continuation or crash-recovery mechanism.
 */

import type { GeneratedExecutionContext } from './ExecutionContext';
import { CancellationError } from './CancellationError';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DebugMode =
  | 'step'                  // Pause before every node
  | 'continue'              // Run to completion
  | 'continueToBreakpoint'  // Run until a breakpoint is hit
  | 'run';                  // No pausing

export interface DebugPauseState {
  /** Node we're paused at */
  currentNodeId: string;
  /** Whether we paused before or after the node executed */
  phase: 'before' | 'after';
  /** Nodes that have finished executing */
  completedNodes: string[];
  /** Full topological execution order */
  executionOrder: string[];
  /** Current index in executionOrder */
  position: number;
  /** All variable values, keyed by "nodeId:portName" */
  variables: Record<string, unknown>;
  /** Outputs of the most recently completed node (convenience shortcut) */
  currentNodeOutputs?: Record<string, unknown>;
  /** Active breakpoints */
  breakpoints: string[];
}

export type DebugResumeAction =
  | { type: 'step' }
  | { type: 'continue' }
  | { type: 'continueToBreakpoint' }
  | { type: 'abort' };

/**
 * Minimal interface for the debug controller as referenced by generated code.
 * The full DebugController class implements this, but generated code only
 * needs beforeNode/afterNode — so this type is what gets imported.
 */
export type TDebugController = {
  beforeNode(nodeId: string, ctx: GeneratedExecutionContext): Promise<void> | void;
  afterNode(nodeId: string, ctx: GeneratedExecutionContext): Promise<void> | void;
};

export interface DebugControllerConfig {
  /** Enable step-through debugging (pauses before first node) */
  debug?: boolean;
  /** Initial breakpoint node IDs */
  breakpoints?: string[];
  /** Execution order (set by executor after compilation) */
  executionOrder?: string[];
}

// ---------------------------------------------------------------------------
// DebugController
// ---------------------------------------------------------------------------

export class DebugController {
  private mode: DebugMode;
  private breakpoints: Set<string>;
  private completedNodes: string[] = [];
  private completedSet: Set<string> = new Set();
  private executionOrder: string[] = [];
  private position: number = 0;
  private lastCompletedNodeId: string | null = null;

  // Execution-scoped live debugger pause state.
  private _gateResolve: ((action: DebugResumeAction) => void) | null = null;
  private _pauseResolve: ((state: DebugPauseState) => void) | null = null;
  private _pausePromise: Promise<DebugPauseState>;

  // Variable modification buffer: applied before next node runs
  private pendingModifications: Map<string, unknown> = new Map();

  constructor(config: DebugControllerConfig = {}) {
    this.mode = config.debug ? 'step' : 'run';
    this.breakpoints = new Set(config.breakpoints ?? []);
    this.executionOrder = config.executionOrder ?? [];
    this._pausePromise = this._createPausePromise();
  }

  /** Set the execution order (called by executor after compilation) */
  setExecutionOrder(order: string[]): void {
    this.executionOrder = order;
  }

  // -----------------------------------------------------------------------
  // Node boundary hooks (called by generated code)
  // -----------------------------------------------------------------------

  /**
   * Called before a node executes.
   */
  async beforeNode(nodeId: string, ctx: GeneratedExecutionContext): Promise<void> {
    // Apply any pending variable modifications
    this.applyPendingModifications(ctx);

    // Check if we should pause here
    const shouldPause =
      this.mode === 'step' ||
      (this.mode === 'continueToBreakpoint' && this.breakpoints.has(nodeId));

    if (shouldPause) {
      const action = await this.pause(nodeId, 'before', ctx);
      ctx.checkAborted(nodeId);
      if (action.type === 'abort') {
        throw new Error(`Debug session aborted at node "${nodeId}"`);
      }
      // Action may change mode for subsequent nodes
      this.applyAction(action);
    }

  }

  /**
   * Called after a node completes successfully.
   */
  async afterNode(nodeId: string, ctx: GeneratedExecutionContext): Promise<void> {
    this.completedNodes.push(nodeId);
    this.completedSet.add(nodeId);
    this.lastCompletedNodeId = nodeId;
    this.position++;

    // Pause after node in step mode
    if (this.mode === 'step') {
      const action = await this.pause(nodeId, 'after', ctx);
      ctx.checkAborted(nodeId);
      if (action.type === 'abort') {
        throw new Error(`Debug session aborted after node "${nodeId}"`);
      }
      this.applyAction(action);
    }
  }

  // -----------------------------------------------------------------------
  // Pause/resume channel
  // -----------------------------------------------------------------------

  /**
   * Awaited by the executor to detect when the controller pauses.
   * Resolves with the current debug state.
   */
  onPause(): Promise<DebugPauseState> {
    return this._pausePromise;
  }

  /**
   * Called by MCP tools or CLI to resume execution.
   */
  resume(action: DebugResumeAction): void {
    if (action.type !== 'abort') {
      this.applyAction(action);
    }
    this._gateResolve?.(action);
    this._gateResolve = null;
    this._pausePromise = this._createPausePromise();
  }

  // -----------------------------------------------------------------------
  // Variable modification
  // -----------------------------------------------------------------------

  /**
   * Queue a variable modification. Applied before the next node runs.
   * Key format: "nodeId:portName:executionIndex"
   */
  setVariable(key: string, value: unknown): void {
    this.pendingModifications.set(key, value);
  }

  // -----------------------------------------------------------------------
  // Breakpoints
  // -----------------------------------------------------------------------

  addBreakpoint(nodeId: string): void {
    this.breakpoints.add(nodeId);
  }

  removeBreakpoint(nodeId: string): void {
    this.breakpoints.delete(nodeId);
  }

  getBreakpoints(): string[] {
    return [...this.breakpoints];
  }

  // -----------------------------------------------------------------------
  // State inspection
  // -----------------------------------------------------------------------

  /** Build the current debug state for external consumers */
  buildState(nodeId: string, phase: 'before' | 'after', ctx: GeneratedExecutionContext): DebugPauseState {
    const variables = this.extractVariables(ctx);
    const currentNodeOutputs = this.lastCompletedNodeId
      ? this.extractNodeOutputs(this.lastCompletedNodeId, variables)
      : undefined;

    return {
      currentNodeId: nodeId,
      phase,
      completedNodes: [...this.completedNodes],
      executionOrder: [...this.executionOrder],
      position: this.position,
      variables,
      currentNodeOutputs,
      breakpoints: [...this.breakpoints],
    };
  }

  /** Get completed nodes list */
  getCompletedNodes(): string[] {
    return [...this.completedNodes];
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  private async pause(
    nodeId: string,
    phase: 'before' | 'after',
    ctx: GeneratedExecutionContext
  ): Promise<DebugResumeAction> {
    const abortSignal = ctx.getAbortSignal();
    if (abortSignal?.aborted) {
      throw new CancellationError(
        `Workflow execution cancelled at debug ${phase} gate for node "${nodeId}"`,
        0,
        nodeId
      );
    }

    const state = this.buildState(nodeId, phase, ctx);

    // Signal the executor that we're paused
    this._pauseResolve?.(state);

    // Suspend on a gate Promise until resume() or parent cancellation.
    return new Promise<DebugResumeAction>((resolve, reject) => {
      let settled = false;
      const cleanup = () => abortSignal?.removeEventListener('abort', onAbort);
      const onAbort = () => {
        if (settled) return;
        settled = true;
        cleanup();
        this._gateResolve = null;
        reject(
          new CancellationError(
            `Workflow execution cancelled at debug ${phase} gate for node "${nodeId}"`,
            0,
            nodeId
          )
        );
      };

      this._gateResolve = (action) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(action);
      };
      abortSignal?.addEventListener('abort', onAbort, { once: true });
      if (abortSignal?.aborted) onAbort();
    });
  }

  private applyAction(action: DebugResumeAction): void {
    switch (action.type) {
      case 'step':
        this.mode = 'step';
        break;
      case 'continue':
        this.mode = 'continue';
        break;
      case 'continueToBreakpoint':
        this.mode = 'continueToBreakpoint';
        break;
      // 'abort' is handled by the caller (throws)
    }
  }

  private applyPendingModifications(ctx: GeneratedExecutionContext): void {
    if (this.pendingModifications.size === 0) return;

    for (const [key, value] of this.pendingModifications) {
      // Key format: "nodeId:portName:executionIndex"
      const parts = key.split(':');
      if (parts.length >= 3) {
        const address = {
          id: parts[0],
          portName: parts[1],
          executionIndex: parseInt(parts[2], 10),
        };
        ctx.setVariable(address, value);
      }
    }
    this.pendingModifications.clear();
  }

  private extractVariables(ctx: GeneratedExecutionContext): Record<string, unknown> {
    return ctx.inspectVariables();
  }

  private extractNodeOutputs(
    nodeId: string,
    allVariables: Record<string, unknown>
  ): Record<string, unknown> {
    const outputs: Record<string, unknown> = {};
    const prefix = `${nodeId}:`;
    for (const [key, value] of Object.entries(allVariables)) {
      if (key.startsWith(prefix)) {
        // Extract portName from key "nodeId:portName:executionIndex"
        const rest = key.substring(prefix.length);
        const colonIdx = rest.lastIndexOf(':');
        const portName = colonIdx >= 0 ? rest.substring(0, colonIdx) : rest;
        outputs[portName] = value;
      }
    }
    return outputs;
  }

  private _createPausePromise(): Promise<DebugPauseState> {
    return new Promise<DebugPauseState>((resolve) => {
      this._pauseResolve = resolve;
    });
  }
}
