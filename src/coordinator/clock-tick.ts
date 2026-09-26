/**
 * The clock acting on waiting runs.
 *
 * Decides which runs are due (waiting, with a `due` time at or before
 * now), what each is resumed with (a sleep wakes with the time it woke, a
 * gate past its timeout is refused along its failure path), and how a run
 * that could not be moved is reported: busy, no longer waiting, changed
 * underneath, or failed with the error.
 */
import { getErrorMessage } from '../utils/error-utils.js';
import type { ResolveInput } from './gate-resolution.js';
import type { ResumeRequest, RunView, TickResult } from './run-store.js';
import type { RunStore } from './store.js';

export async function tickDue(store: RunStore, resume: (request: ResumeRequest) => Promise<RunView>, now: number): Promise<TickResult> {
  const result: TickResult = { woke: [], timedOut: [], skipped: [] };
  const at = new Date(now).toISOString();
  for (const summary of await store.list()) {
    if (summary.status !== 'waiting' || !summary.due || summary.due.at > at) continue;
    const { runId, due } = summary;
    // A sleep wakes with the time it woke; a timeout is a refusal the
    // workflow reads on the gate's failure port, like any other.
    const input: ResolveInput = due.action === 'wake'
      ? { answer: summary.gate?.outputs.length ? at : null }
      : { reject: `no answer within ${String(summary.gate?.inputs.timeout ?? 'the timeout')}` };
    try {
      const view = await resume({ runId, input });
      (due.action === 'wake' ? result.woke : result.timedOut).push(view);
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      const reason = name === 'RunBusyError' ? 'busy' : name === 'RunNotWaitingError' ? 'not-waiting' : name === 'BundleChangedError' ? 'bundle-changed' : 'failed';
      result.skipped.push({ runId, reason, ...(reason === 'failed' ? { message: getErrorMessage(error) } : {}) });
    }
  }
  return result;
}
