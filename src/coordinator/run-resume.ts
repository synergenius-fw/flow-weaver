/**
 * Resuming a run waiting at a gate.
 *
 * Decides whether a resume is refused before anything runs (no such run,
 * not waiting, the workflow changed since the run paused, an answer the
 * gate cannot take), what the run resumes from (the continuation in its
 * record, or the `continuation` document a run paused by an older version
 * keeps), and refuses a continuation at another gate than the record's.
 * A refusal leaves the run waiting; a segment that throws otherwise fails
 * it.
 */
import type { ContinuationEnvelope } from '../runtime/continuation.js';
import { executeWorkflow, ContinuationRefusalError, type WorkflowExecutionOutcome } from '../mcp/workflow-executor.js';
import { computeBundleDigest } from './bundle-digest.js';
import { createStoreEffectAdapter } from './effect-receipts.js';
import { BundleChangedError, RunNotFoundError, RunNotWaitingError } from './errors.js';
import { buildGateResolution } from './gate-resolution.js';
import type { RunContext } from './run-context.js';
import { commit, fail } from './run-outcome.js';
import type { DriveOptions, ResumeRequest, RunRecord, RunView } from './run-store.js';
import { observe } from './run-trace.js';
import { toView } from './run-views.js';
import { parseSelected } from './workflow-selection.js';

/** The waiting record a resume would act on, or the refusal it would meet before taking the run. */
export async function resumable(ctx: RunContext, request: ResumeRequest): Promise<RunRecord> {
  const record = await ctx.readRecord(request.runId);
  if (!record) throw new RunNotFoundError(request.runId);
  if (record.status !== 'waiting' || !record.gate) throw new RunNotWaitingError(record.status);

  // Refuse before the engine does, with a message that says what to do.
  const digest = await computeBundleDigest(record.filePath, record.workflowName);
  if (digest !== record.bundleDigest) throw new BundleChangedError();

  // Built before the claim so a bad answer is refused without taking it.
  buildGateResolution(record.gate, record.gate.id, request.input);
  return record;
}

export async function resumeRun(ctx: RunContext, request: ResumeRequest, options: DriveOptions | undefined): Promise<RunView> {
  const { store, claimed, readRecord } = ctx;
  const record = await resumable(ctx, request);
  return claimed(record.runId, async () => {
    // Read again under the claim: another process may have finished it,
    // or moved it to a later gate, between the check above and now.
    const current = await readRecord(record.runId);
    if (!current || current.status !== 'waiting' || !current.gate) throw new RunNotWaitingError(current?.status ?? 'cancelled');
    // A run paused by an older version keeps the envelope in a document.
    const continuation = current.continuation ?? ((await store.getDoc(record.runId, 'continuation')) as ContinuationEnvelope | undefined);
    if (!continuation) throw new RunNotWaitingError(current.status);
    if (continuation.gateId !== current.gate.id) {
      // Only an older version's two-write commit can leave these apart.
      // The run is left waiting: nothing ran.
      throw new ContinuationRefusalError({ accepted: false, reason: 'stale-gate', message: `the run's record names gate ${current.gate.id} but its continuation is at gate ${continuation.gateId}` });
    }
    const resolution = buildGateResolution(current.gate, current.gate.id, request.input);
    const { ast } = await parseSelected(record.filePath, record.workflowName);

    // If this process dies after the engine returns but before `commit`
    // writes, the old record and continuation are still intact. A second
    // resume with the same answer re-applies the same resolution, re-runs
    // pure nodes (allowed by definition), and recovers every effect after
    // the gate from its receipt instead of re-executing it. The outcome
    // converges; the claim only keeps two processes from trying at once.
    const { kept, request: observed } = observe(options);
    let outcome: WorkflowExecutionOutcome;
    try {
      outcome = await executeWorkflow({
        runId: record.runId,
        bundleDigest: record.bundleDigest,
        filePath: record.filePath,
        params: record.params,
        workflowName: record.workflowName,
        mocks: record.mocks,
        ...observed,
        abortSignal: options?.abortSignal,
        continuation,
        resolution,
        effectAdapter: createStoreEffectAdapter(store, record.runId),
      });
    } catch (error) {
      // A refusal is thrown before any node runs (the bundle, the
      // continuation or the adapter was not acceptable). The run is
      // still exactly where it paused, so it stays waiting.
      if (error instanceof ContinuationRefusalError) throw error;
      await fail(store, current, error, options, kept);
      throw error;
    }
    return toView(await commit(store, current, outcome, ast, kept));
  });
}
