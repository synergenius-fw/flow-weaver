/**
 * In-memory registry for pending workflow runs that are waiting for agent input.
 * Used by fw_execute_workflow (to store paused runs) and fw_resume_workflow (to resume them).
 */

import type { AgentChannel } from './agent-channel.js';

export interface PendingRun {
  runId: string;
  filePath: string;
  workflowName?: string;
  /** The still-pending execution promise. Resolves when workflow completes. */
  executionPromise: Promise<unknown>;
  agentChannel: AgentChannel;
  /** The agent request data that triggered the pause. */
  request?: object;
  createdAt: number;
  /** Temp files to clean up when the run completes or is cancelled. */
  tmpFiles: string[];
}

const pendingRuns = new Map<string, PendingRun>();

export function storePendingRun(run: PendingRun): void {
  pendingRuns.set(run.runId, run);
}

export function getPendingRun(runId: string): PendingRun | undefined {
  return pendingRuns.get(runId);
}

export function removePendingRun(runId: string): void {
  pendingRuns.delete(runId);
}

export function listPendingRuns(): Array<{
  runId: string;
  filePath: string;
  workflowName?: string;
  request?: object;
  createdAt: number;
}> {
  return Array.from(pendingRuns.values()).map((run) => ({
    runId: run.runId,
    filePath: run.filePath,
    workflowName: run.workflowName,
    request: run.request,
    createdAt: run.createdAt,
  }));
}
