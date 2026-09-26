/**
 * How the end of a segment is written down.
 *
 * Decides what the record says after a segment: waiting at the gate it
 * yielded at, with the continuation and the clock's due time in the same
 * write; completed with its result; or, when the segment threw, cancelled
 * (its driver stopped it) or failed with the error and the step that threw.
 * A terminal outcome drops the `continuation` document an older version
 * kept.
 */
import type { TWorkflowAST } from '../ast/types.js';
import type { WorkflowExecutionOutcome } from '../mcp/workflow-executor.js';
import { getErrorMessage } from '../utils/error-utils.js';
import { labelGate } from './gate-labeling.js';
import type { DriveOptions, RunRecord, TraceEntry } from './run-store.js';
import { appendTrace, failedNodeIn } from './run-trace.js';
import type { RunStore } from './store.js';
import { dueFor } from './time.js';

/**
 * Commit an outcome with one `put`: the gate and the continuation it
 * resumes from are in the same record, so a process that dies before the
 * write leaves the run at its previous gate with that gate's continuation,
 * and a resume with that gate's answer moves it on again. A run with
 * documents and no record is an unacknowledged yield and is ignored
 * everywhere. Runs paused by an older version keep the envelope in a
 * `continuation` document instead; a terminal outcome drops it.
 */
export async function commit(store: RunStore, record: RunRecord, outcome: WorkflowExecutionOutcome, ast: TWorkflowAST, kept?: TraceEntry[]): Promise<RunRecord> {
  const now = new Date().toISOString();
  const traced = await appendTrace(store, record, kept);

  if (outcome.kind === 'yielded') {
    const labeled = labelGate(outcome.gate, ast);
    const gate = {
      id: outcome.gate.id,
      kind: outcome.gate.kind,
      node: outcome.gate.address.nodeId,
      nodeType: outcome.gate.address.nodeType,
      ...labeled,
    };
    const next: RunRecord = {
      ...record,
      traced,
      status: 'waiting',
      gate,
      continuation: outcome.continuation,
      due: dueFor(gate),
      result: undefined,
      error: undefined,
      updatedAt: now,
    };
    if (next.due === undefined) delete next.due;
    await store.put(next);
    return next;
  }

  const next: RunRecord = {
    ...record,
    traced,
    status: 'completed',
    gate: undefined,
    continuation: undefined,
    due: undefined,
    result: outcome.result,
    error: undefined,
    updatedAt: now,
  };
  await store.put(next);
  await store.deleteDoc(record.runId, 'continuation');
  return next;
}

/**
 * A run that did not reach an outcome. Stopped by its driver's signal it
 * is `cancelled`, which is not a failure and is not shown as one; anything
 * else is `failed` with the error.
 */
export async function fail(store: RunStore, record: RunRecord, error: unknown, options: DriveOptions | undefined, kept?: TraceEntry[]): Promise<void> {
  const traced = await appendTrace(store, record, kept);
  const message = getErrorMessage(error);
  const cancelled = options?.abortSignal?.aborted === true;
  await store.put({
    ...record,
    traced,
    status: cancelled ? 'cancelled' : 'failed',
    gate: undefined,
    continuation: undefined,
    due: undefined,
    result: undefined,
    error: cancelled ? undefined : message,
    failedNode: cancelled ? undefined : failedNodeIn(kept),
    updatedAt: new Date().toISOString(),
  } satisfies RunRecord);
  await store.deleteDoc(record.runId, 'continuation');
}
