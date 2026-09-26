/**
 * How a run reads from outside: the run resource built from its stored
 * record and, while a segment is in flight here, from that segment; the
 * data ports of a result without the control ports; and the HTTP status each
 * state answers with on a run resource.
 */
import type { RunRecord } from '../coordinator/index.js';
import type { RunResponse } from './types.js';
import type { Json } from './respond.js';

const CONTROL = new Set(['onSuccess', 'onFailure']);

/** What a segment in flight here knows of its run before, or besides, the store. */
export interface InFlightRun {
  workflow: string;
  params: Json;
  startedAt: number;
  error?: string;
}

/** The run resource, with links under `base`. Undefined when neither the store nor this process knows the run. */
export function runView(id: string, base: string, l: InFlightRun | undefined, rec: RunRecord | undefined): RunResponse | undefined {
  const links = { self: `${base}/runs/${id}`, events: `${base}/runs/${id}/events`, result: `${base}/runs/${id}/result` };
  if (l && !rec) {
    return l.error
      ? { runId: id, workflow: l.workflow, status: 'failed', startedAt: new Date(l.startedAt).toISOString(), updatedAt: new Date().toISOString(), params: l.params, error: { code: 'EXECUTION_ERROR', message: l.error }, links }
      : { runId: id, workflow: l.workflow, status: 'running', startedAt: new Date(l.startedAt).toISOString(), updatedAt: new Date().toISOString(), params: l.params, links: { ...links, cancel: `${base}/runs/${id}/cancel` } };
  }
  if (l && rec) {
    return { runId: id, workflow: rec.workflowName, status: 'running', startedAt: rec.createdAt, updatedAt: new Date().toISOString(), params: rec.params, agent: rec.agent, links: { ...links, cancel: `${base}/runs/${id}/cancel` } };
  }
  if (!rec) return undefined;
  const out: RunResponse = { runId: id, workflow: rec.workflowName, status: rec.status, startedAt: rec.createdAt, updatedAt: rec.updatedAt, params: rec.params, links };
  if (rec.status === 'waiting' && rec.gate) {
    out.gate = { id: rec.gate.id, kind: rec.gate.kind, node: rec.gate.node, inputs: rec.gate.inputs, absent: rec.gate.absent, outputs: rec.gate.outputs, hasFailurePort: rec.gate.hasFailurePort };
    if (rec.due) out.due = rec.due;
    out.links = { ...links, resolve: `${base}/runs/${id}/resolve`, cancel: `${base}/runs/${id}/cancel` };
  }
  if (rec.agent) out.agent = rec.agent;
  if (rec.status === 'completed') out.result = rec.result;
  if (rec.status === 'failed') out.error = { code: 'EXECUTION_ERROR', message: rec.error ?? 'failed' };
  return out;
}

/** The output ports of a completed run, without the control ports. */
export function dataOf(result: unknown): { data: Json; failed: boolean } {
  if (typeof result !== 'object' || result === null || Array.isArray(result)) return { data: { result }, failed: false };
  const r = result as Json;
  const data: Json = {};
  for (const [k, v] of Object.entries(r)) if (!CONTROL.has(k)) data[k] = v;
  return { data, failed: r.onFailure === true };
}

/** The HTTP status a run's state reads as on a run resource. */
export const statusFor = (run: RunResponse) => (run.status === 'completed' ? 200 : run.status === 'failed' ? 500 : 202);
