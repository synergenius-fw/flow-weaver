/**
 * Ending a run by hand: giving up on it, or forgetting it.
 *
 * Decides which runs may be cancelled (only one waiting at a gate, checked
 * again under the claim so a result a driver just committed is never turned
 * into `cancelled`) and which may be removed (only one that is not
 * waiting; a waiting run is cancelled first).
 */
import { RunNotFoundError, RunNotWaitingError } from './errors.js';
import type { RunContext } from './run-context.js';
import type { RunRecord, RunView } from './run-store.js';
import { toView } from './run-views.js';

export async function cancelRun(ctx: RunContext, runId: string): Promise<RunView> {
  const { store, claimed, readRecord } = ctx;
  const record = await readRecord(runId);
  if (!record) throw new RunNotFoundError(runId);
  if (record.status !== 'waiting') throw new RunNotWaitingError(record.status);
  return claimed(runId, async () => {
    // Read again under the claim: a driver may have completed the run
    // since the check above, and its result must not become "cancelled".
    const current = await readRecord(runId);
    if (!current || current.status !== 'waiting') throw new RunNotWaitingError(current?.status ?? 'cancelled');
    const next: RunRecord = {
      ...current,
      status: 'cancelled',
      gate: undefined,
      continuation: undefined,
      due: undefined,
      updatedAt: new Date().toISOString(),
    };
    await store.put(next);
    await store.deleteDoc(runId, 'continuation');
    return toView(next);
  });
}

export async function removeRun(ctx: RunContext, runId: string): Promise<void> {
  const record = await ctx.readRecord(runId);
  if (!record) throw new RunNotFoundError(runId);
  if (record.status === 'waiting') throw new RunNotWaitingError(record.status);
  await ctx.store.remove(runId);
}
