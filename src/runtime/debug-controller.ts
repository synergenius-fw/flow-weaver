/**
 * DebugController intercepts workflow execution at node boundaries,
 * enabling step-through debugging and checkpoint/resume.
 *
 * Injected via globalThis.__fw_debug_controller__ (same pattern as
 * __fw_debugger__ and __fw_agent_channel__). The generated code calls
 * beforeNode/afterNode at each node boundary; the controller decides
 * whether to skip, pause, checkpoint, or continue.
 */

import type { GeneratedExecutionContext } from './ExecutionContext';
import type { CheckpointWriter } from './checkpoint';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DebugMode =
  | 'step'                  // Pause before every node
  | 'continue'              // Run to completion
  | 'continueToBreakpoint'  // Run until a breakpoint is hit
  | 'run';                  // No pausing (checkpoint-only mode)

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

export interface DebugControllerConfig {
  /** Enable step-through debugging (pauses before first node) */
  debug?: boolean;
  /** Enable checkpointing to disk after each node */
  checkpoint?: boolean;
  /** Checkpoint writer instance (required when checkpoint=true) */
  checkpointWriter?: CheckpointWriter;
  /** Initial breakpoint node IDs */
  breakpoints?: string[];
  /** Execution order (set by executor after compilation) */
  executionOrder?: string[];
  /** Nodes to skip on resume (loaded from checkpoint) */
  skipNodes?: Map<string, Record<string, unknown>>;
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

  // Checkpoint
  private checkpointEnabled: boolean;
  private checkpointWriter: CheckpointWriter | null;

  // Skip nodes (for resume from checkpoint)
  private skipNodes: Map<string, Record<string, unknown>>;

  // Pause/resume channel (mirrors AgentChannel pattern)
  private _gateResolve: ((action: DebugResumeAction) => void) | null = null;
  private _pauseResolve: ((state: DebugPauseState) => void) | null = null;
  private _pausePromise: Promise<DebugPauseState>;

  // Variable modification buffer: applied before next node runs
  private pendingModifications: Map<string, unknown> = new Map();

  constructor(config: DebugControllerConfig = {}) {
    this.mode = config.debug ? 'step' : 'run';
    this.breakpoints = new Set(config.breakpoints ?? []);
    this.checkpointEnabled = config.checkpoint ?? false;
    this.checkpointWriter = config.checkpointWriter ?? null;
    this.executionOrder = config.executionOrder ?? [];
    this.skipNodes = config.skipNodes ?? new Map();
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
   * Returns true if the node should execute, false to skip.
   */
  async beforeNode(nodeId: string, ctx: GeneratedExecutionContext): Promise<boolean> {
    // Apply any pending variable modifications
    this.applyPendingModifications(ctx);

    // If this node should be skipped (resume from checkpoint), restore its
    // outputs into the context and return false
    if (this.skipNodes.has(nodeId)) {
      const savedOutputs = this.skipNodes.get(nodeId)!;
      this.restoreNodeOutputs(nodeId, savedOutputs, ctx);
      this.completedNodes.push(nodeId);
      this.completedSet.add(nodeId);
      this.lastCompletedNodeId = nodeId;
      this.position++;
      return false;
    }

    // Check if we should pause here
    const shouldPause =
      this.mode === 'step' ||
      (this.mode === 'continueToBreakpoint' && this.breakpoints.has(nodeId));

    if (shouldPause) {
      const action = await this.pause(nodeId, 'before', ctx);
      if (action.type === 'abort') {
        throw new Error(`Debug session aborted at node "${nodeId}"`);
      }
      // Action may change mode for subsequent nodes
      this.applyAction(action);
    }

    return true;
  }

  /**
   * Called after a node completes successfully.
   */
  async afterNode(nodeId: string, ctx: GeneratedExecutionContext): Promise<void> {
    this.completedNodes.push(nodeId);
    this.completedSet.add(nodeId);
    this.lastCompletedNodeId = nodeId;
    this.position++;

    // Write checkpoint to disk
    if (this.checkpointEnabled && this.checkpointWriter) {
      await this.checkpointWriter.write(
        this.completedNodes,
        this.executionOrder,
        this.position,
        ctx
      );
    }

    // Pause after node in step mode
    if (this.mode === 'step') {
      const action = await this.pause(nodeId, 'after', ctx);
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
    const state = this.buildState(nodeId, phase, ctx);

    // Signal the executor that we're paused
    this._pauseResolve?.(state);

    // Suspend on a gate Promise until resume() is called
    return new Promise<DebugResumeAction>((resolve) => {
      this._gateResolve = (action) => resolve(action);
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

  private restoreNodeOutputs(
    nodeId: string,
    outputs: Record<string, unknown>,
    ctx: GeneratedExecutionContext
  ): void {
    // outputs is keyed by "portName:executionIndex" -> value
    for (const [portKey, value] of Object.entries(outputs)) {
      const colonIdx = portKey.lastIndexOf(':');
      if (colonIdx === -1) continue;
      const portName = portKey.substring(0, colonIdx);
      const executionIndex = parseInt(portKey.substring(colonIdx + 1), 10);

      // Register the execution so downstream nodes can find it
      ctx.addExecution(nodeId);
      ctx.setVariable(
        { id: nodeId, portName, executionIndex },
        value
      );
    }
  }

  private extractVariables(ctx: GeneratedExecutionContext): Record<string, unknown> {
    const serialized = ctx.serialize();
    return serialized.variables;
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
