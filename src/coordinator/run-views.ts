/**
 * What a driver is shown of a run.
 *
 * Decides how much of a record leaves the coordinator: the minimum a
 * driver acts on (`RunView`: the gate while it waits, the result once
 * completed, the error once failed) and the row a list shows
 * (`RunSummary`: enough to tell two runs apart).
 */
import type { RunRecord, RunSummary, RunView } from './run-store.js';

export function toView(record: RunRecord): RunView {
  const view: RunView = {
    status: record.status,
    runId: record.runId,
    workflowName: record.workflowName,
  };
  if (record.status === 'waiting' && record.gate) {
    view.gate = {
      kind: record.gate.kind,
      node: record.gate.node,
      inputs: record.gate.inputs,
      absent: record.gate.absent,
    };
    if (record.due) view.due = record.due;
  }
  if (record.status === 'completed') view.result = record.result;
  if (record.status === 'failed') view.error = record.error;
  return view;
}

export function toSummary(record: RunRecord): RunSummary {
  return {
    status: record.status,
    runId: record.runId,
    workflowName: record.workflowName,
    filePath: record.filePath,
    gate: record.gate ? { kind: record.gate.kind, node: record.gate.node } : undefined,
    due: record.due,
    params: record.params,
    failedNode: record.failedNode,
    mocks: record.mocks,
    source: record.source,
    agents: record.agents,
    agent: record.agent ? { status: record.agent.status, profile: record.agent.profile, node: record.agent.node } : undefined,
    origin: record.origin,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}
