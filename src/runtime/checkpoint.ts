/**
 * Checkpoint serialization for crash recovery.
 *
 * Writes workflow state to disk after each node completes. If the process
 * crashes, the checkpoint file persists and can be used to resume execution
 * from the last completed node.
 *
 * Checkpoint files live in .fw-checkpoints/ next to the workflow file and
 * are auto-deleted after successful workflow completion.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { GeneratedExecutionContext, ExecutionInfo } from './ExecutionContext';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Marker stored in place of values that couldn't be serialized */
export interface UnserializableMarker {
  __fw_unserializable__: true;
  nodeId: string;
  portName: string;
  reason: string;
}

export interface CheckpointData {
  /** Format version for forward compatibility */
  version: 1;
  /** SHA-256 hash of the workflow source file */
  workflowHash: string;
  /** Workflow function name */
  workflowName: string;
  /** Original file path */
  filePath: string;
  /** Input parameters the workflow was called with */
  params: Record<string, unknown>;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Node IDs in completion order */
  completedNodes: string[];
  /** Full topological execution order */
  executionOrder: string[];
  /** Current position in execution order */
  position: number;
  /** Serialized variables: key -> value */
  variables: Record<string, unknown>;
  /** Execution info for completed nodes */
  executions: Record<string, ExecutionInfo>;
  /** Execution counter value */
  executionCounter: number;
  /** Per-node execution counts */
  nodeExecutionCounts: Record<string, number>;
  /** Nodes whose outputs couldn't be fully serialized */
  unsafeNodes: string[];
}

// ---------------------------------------------------------------------------
// Serialization helpers
// ---------------------------------------------------------------------------

function isUnserializableMarker(value: unknown): value is UnserializableMarker {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<string, unknown>).__fw_unserializable__ === true
  );
}

/**
 * Try to serialize a value. If it contains functions, invoke them first.
 * If serialization fails, return a marker.
 */
function serializeValue(
  key: string,
  value: unknown,
  unsafeNodes: Set<string>
): unknown {
  // Resolve function values (pull execution lazy evaluation)
  if (typeof value === 'function') {
    try {
      value = (value as () => unknown)();
    } catch {
      const parts = key.split(':');
      unsafeNodes.add(parts[0]);
      return {
        __fw_unserializable__: true,
        nodeId: parts[0],
        portName: parts[1] || 'unknown',
        reason: 'Function invocation failed',
      } satisfies UnserializableMarker;
    }
  }

  // Handle Promises: can't serialize, mark as unsafe
  if (value instanceof Promise) {
    const parts = key.split(':');
    unsafeNodes.add(parts[0]);
    return {
      __fw_unserializable__: true,
      nodeId: parts[0],
      portName: parts[1] || 'unknown',
      reason: 'Promise value',
    } satisfies UnserializableMarker;
  }

  // Test serialization
  try {
    JSON.stringify(value);
    return value;
  } catch {
    const parts = key.split(':');
    unsafeNodes.add(parts[0]);
    return {
      __fw_unserializable__: true,
      nodeId: parts[0],
      portName: parts[1] || 'unknown',
      reason: 'Not JSON-serializable',
    } satisfies UnserializableMarker;
  }
}

/**
 * Compute SHA-256 hash of a file's contents.
 */
function hashFile(filePath: string): string {
  const content = fs.readFileSync(filePath, 'utf8');
  return crypto.createHash('sha256').update(content).digest('hex');
}

// ---------------------------------------------------------------------------
// CheckpointWriter
// ---------------------------------------------------------------------------

export class CheckpointWriter {
  private dir: string;
  private filePath: string;
  private workflowName: string;
  private runId: string;
  private params: Record<string, unknown>;
  private workflowHash: string;
  private checkpointPath: string;
  private writeLock: Promise<void> = Promise.resolve();

  constructor(
    workflowFilePath: string,
    workflowName: string,
    runId: string,
    params: Record<string, unknown> = {}
  ) {
    this.filePath = path.resolve(workflowFilePath);
    this.workflowName = workflowName;
    this.runId = runId;
    this.params = params;
    this.dir = path.join(path.dirname(this.filePath), '.fw-checkpoints');
    this.checkpointPath = path.join(this.dir, `${workflowName}-${runId}.json`);
    this.workflowHash = hashFile(this.filePath);
  }

  /**
   * Write a checkpoint after a node completes. Uses a write lock so
   * concurrent calls from parallel nodes are serialized.
   */
  async write(
    completedNodes: string[],
    executionOrder: string[],
    position: number,
    ctx: GeneratedExecutionContext
  ): Promise<void> {
    // Serialize under a lock to prevent concurrent writes (parallel nodes)
    this.writeLock = this.writeLock.then(() =>
      this._writeCheckpoint(completedNodes, executionOrder, position, ctx)
    );
    await this.writeLock;
  }

  /** Clean up checkpoint file after successful completion */
  cleanup(): void {
    try {
      if (fs.existsSync(this.checkpointPath)) {
        fs.unlinkSync(this.checkpointPath);
      }
      // Remove directory if empty
      if (fs.existsSync(this.dir)) {
        const remaining = fs.readdirSync(this.dir);
        if (remaining.length === 0) {
          fs.rmdirSync(this.dir);
        }
      }
    } catch {
      // Best-effort cleanup
    }
  }

  getCheckpointPath(): string {
    return this.checkpointPath;
  }

  private _writeCheckpoint(
    completedNodes: string[],
    executionOrder: string[],
    position: number,
    ctx: GeneratedExecutionContext
  ): void {
    const serialized = ctx.serialize();
    const unsafeNodes = new Set<string>();

    // Serialize variables, handling unserializable values
    const variables: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(serialized.variables)) {
      variables[key] = serializeValue(key, value, unsafeNodes);
    }

    const data: CheckpointData = {
      version: 1,
      workflowHash: this.workflowHash,
      workflowName: this.workflowName,
      filePath: this.filePath,
      params: this.params,
      timestamp: new Date().toISOString(),
      completedNodes: [...completedNodes],
      executionOrder: [...executionOrder],
      position,
      variables,
      executions: serialized.executions,
      executionCounter: serialized.executionCounter,
      nodeExecutionCounts: serialized.nodeExecutionCounts,
      unsafeNodes: [...unsafeNodes],
    };

    // Ensure directory exists
    if (!fs.existsSync(this.dir)) {
      fs.mkdirSync(this.dir, { recursive: true });
    }

    fs.writeFileSync(this.checkpointPath, JSON.stringify(data, null, 2), 'utf8');
  }
}

// ---------------------------------------------------------------------------
// Checkpoint reading and resume
// ---------------------------------------------------------------------------

/**
 * Load a checkpoint file and validate it against the current workflow.
 * Returns the checkpoint data and a list of nodes that need to be re-run
 * (because their outputs weren't serializable).
 */
export function loadCheckpoint(
  checkpointPath: string,
  workflowFilePath?: string
): {
  data: CheckpointData;
  stale: boolean;
  rerunNodes: string[];
  skipNodes: Map<string, Record<string, unknown>>;
} {
  const raw = fs.readFileSync(checkpointPath, 'utf8');
  const data: CheckpointData = JSON.parse(raw);

  if (data.version !== 1) {
    throw new Error(`Unsupported checkpoint version: ${data.version}`);
  }

  // Check if the workflow has changed since the checkpoint was written
  let stale = false;
  if (workflowFilePath) {
    const currentHash = hashFile(path.resolve(workflowFilePath));
    stale = currentHash !== data.workflowHash;
  }

  // Determine which nodes can be skipped (all outputs serialized) vs
  // which need re-running (any output was unserializable)
  const unsafeSet = new Set(data.unsafeNodes);
  const rerunNodes: string[] = [];
  const skipNodes = new Map<string, Record<string, unknown>>();

  // Walk execution order up to the checkpoint position.
  // Once we hit an unsafe node, everything from that point forward re-runs.
  let hitUnsafe = false;
  for (const nodeId of data.completedNodes) {
    if (hitUnsafe || unsafeSet.has(nodeId)) {
      hitUnsafe = true;
      rerunNodes.push(nodeId);
      continue;
    }

    // Collect this node's outputs from the variables map
    const nodeOutputs: Record<string, unknown> = {};
    const prefix = `${nodeId}:`;
    for (const [key, value] of Object.entries(data.variables)) {
      if (key.startsWith(prefix) && !isUnserializableMarker(value)) {
        // Store with portName:executionIndex as key
        const rest = key.substring(prefix.length);
        nodeOutputs[rest] = value;
      }
    }

    skipNodes.set(nodeId, nodeOutputs);
  }

  return { data, stale, rerunNodes, skipNodes };
}

/**
 * Find the most recent checkpoint file for a workflow.
 */
export function findLatestCheckpoint(
  workflowFilePath: string,
  workflowName?: string
): string | null {
  const dir = path.join(path.dirname(path.resolve(workflowFilePath)), '.fw-checkpoints');
  if (!fs.existsSync(dir)) return null;

  const files = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .filter((f) => !workflowName || f.startsWith(`${workflowName}-`));

  if (files.length === 0) return null;

  // Sort by modification time, newest first
  const sorted = files
    .map((f) => ({ name: f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  return path.join(dir, sorted[0].name);
}
