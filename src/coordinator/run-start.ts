/**
 * Starting a run.
 *
 * Decides whether a run may start (the file parses to one workflow, every
 * required parameter is given), what its record begins as (identity, the
 * bundle digest it is vouched for by, and what the driver said about it),
 * and drives the first segment under the run's claim.
 */
import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import { executeWorkflow, type WorkflowExecutionOutcome } from '../mcp/workflow-executor.js';
import { computeBundleDigest } from './bundle-digest.js';
import { createStoreEffectAdapter } from './effect-receipts.js';
import { missingParams, MissingParamsError } from './params.js';
import type { RunContext } from './run-context.js';
import { commit, fail } from './run-outcome.js';
import type { DriveOptions, RunRecord, RunView, StartRequest } from './run-store.js';
import { observe } from './run-trace.js';
import { toView } from './run-views.js';
import { parseSelected } from './workflow-selection.js';

export async function startRun(ctx: RunContext, request: StartRequest, options: DriveOptions | undefined): Promise<RunView> {
  const { store, claimed } = ctx;
  const filePath = path.resolve(request.filePath);
  const { ast, workflowName } = await parseSelected(filePath, request.workflowName);
  const missing = missingParams(ast, request.params);
  if (missing.length) throw new MissingParamsError(workflowName, missing);
  const bundleDigest = await computeBundleDigest(filePath, workflowName);
  const now = new Date().toISOString();
  const record: RunRecord = {
    formatVersion: 1,
    runId: request.runId ?? randomUUID(),
    filePath,
    workflowName,
    params: request.params ?? {},
    bundleDigest,
    status: 'waiting',
    ...(request.mocks ? { mocks: request.mocks } : {}),
    ...(request.source ? { source: request.source } : {}),
    ...(request.agents ? { agents: request.agents } : {}),
    ...(request.origin ? { origin: request.origin } : {}),
    createdAt: now,
    updatedAt: now,
  };

  return claimed(record.runId, async () => {
    const { kept, request: observed } = observe(options);
    let outcome: WorkflowExecutionOutcome;
    try {
      outcome = await executeWorkflow({
        runId: record.runId,
        bundleDigest,
        filePath,
        params: record.params,
        workflowName,
        mocks: record.mocks,
        ...observed,
        abortSignal: options?.abortSignal,
        effectAdapter: createStoreEffectAdapter(store, record.runId),
      });
    } catch (error) {
      await fail(store, record, error, options, kept);
      throw error;
    }
    return toView(await commit(store, record, outcome, ast, kept));
  });
}
