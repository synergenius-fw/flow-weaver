/**
 * The run resources: `/runs` and `/runs/:id` with its result, events,
 * agent transcript, resolve and cancel, and the legacy start at
 * `POST /workflows/:name` that answers with one. A run resource answers
 * with the run itself and the status its state reads as -- 200 completed,
 * 500 failed, 202 otherwise with a Location to follow -- except `/result`,
 * which answers in the declared route's shape.
 */
import { randomUUID } from 'node:crypto';
import { transcriptName } from '../coordinator/index.js';
import type { FwMockConfig } from '../built-in-nodes/mock-types.js';
import type { ApiContext } from './context.js';
import { HttpError } from './http-error.js';
import { json, readBody, settledWithin, waitBudget, wantsAsync, type Json } from './respond.js';
import { answerDeclared } from './routes-declared.js';
import { statusFor } from './run-view.js';
import type { ServerRequest, ServerResponse } from './transport.js';
import type { WorkflowEndpoint } from './types.js';

/**
 * Answer a segment a request started, as the run resource: 202 at once when
 * asked, otherwise once it settles or the wait budget runs out, with the
 * status the run's state reads as.
 */
async function answerSegment(ctx: ApiContext, req: ServerRequest, res: ServerResponse, id: string, url: URL, base: string, started: number, segment: Promise<void>): Promise<void> {
  const { runs } = ctx;
  if (wantsAsync(req, url)) { segment.catch(() => undefined); return json(res, 202, await runs.snapshot(id, base), { Location: `${base}/runs/${id}` }); }
  if (await settledWithin(segment, waitBudget(req, ctx.maxWait))) await segment;
  const snap = (await runs.snapshot(id, base))!;
  snap.executionTime = Date.now() - started;
  return json(res, statusFor(snap), snap, snap.status === 'running' ? { Location: snap.links.self, 'Retry-After': '2' } : {});
}

/** `POST /workflows/:name`: the body is the params, or `{ params, mocks }`; the answer is the run resource. */
export async function legacyStart(ctx: ApiContext, req: ServerRequest, res: ServerResponse, endpoint: WorkflowEndpoint, url: URL, base: string, given?: unknown): Promise<void> {
  const { runs } = ctx;
  const { body: b } = await readBody(req, given, ctx.maxBody);
  const envelope = 'params' in b && typeof b.params === 'object' && b.params !== null && !Array.isArray(b.params) && Object.keys(b).every((k) => ['params', 'mocks'].includes(k));
  const params = (envelope ? b.params : b) as Json;
  const mocks = envelope && ctx.dev && typeof b.mocks === 'object' && b.mocks !== null ? (b.mocks as FwMockConfig) : undefined;
  runs.admit();
  const id = randomUUID();
  const started = Date.now();
  return answerSegment(ctx, req, res, id, url, base, started, runs.start(endpoint, id, params, mocks));
}

/** `POST /runs/:id/resolve`: exactly one of `answer` or `reject`, then the run resumes. */
async function resolveRoute(ctx: ApiContext, req: ServerRequest, res: ServerResponse, id: string, url: URL, base: string, given?: unknown): Promise<void> {
  const { runs } = ctx;
  const { body: b } = await readBody(req, given, ctx.maxBody);
  const hasAnswer = 'answer' in b, hasReject = 'reject' in b;
  if (hasAnswer === hasReject) throw new HttpError(400, 'INVALID_INPUT', 'give exactly one of answer or reject');
  const input = hasReject ? { reject: String(b.reject ?? '') } : { answer: b.answer };
  runs.admit();
  const started = Date.now();
  return answerSegment(ctx, req, res, id, url, base, started, runs.resume(id, input));
}

/** Answer a request under `/runs`. False when the path is not a run resource. */
export async function serveRuns(ctx: ApiContext, req: ServerRequest, res: ServerResponse, method: string, p: string, url: URL, base: string, given?: unknown): Promise<boolean> {
  const { runs, coordinator } = ctx;
  if (method === 'GET' && p === '/runs') { json(res, 200, await runs.listRuns(url.searchParams.get('workflow') ?? undefined, base)); return true; }
  const m = p.match(/^\/runs\/([^/]+)(?:\/(events|resolve|cancel|agent|result))?$/);
  if (!m) return false;
  const id = m[1];
  const snap = await runs.snapshot(id, base);
  if (!snap) throw new HttpError(404, 'RUN_NOT_FOUND', `no run with id ${id}`);
  if (!m[2] && method === 'GET') { json(res, 200, snap); return true; }
  if (m[2] === 'result' && method === 'GET') { await answerDeclared(ctx, res, id, base, false); return true; }
  if (m[2] === 'events' && method === 'GET') { await runs.follow(req, res, id, base); return true; }
  if (m[2] === 'agent' && method === 'GET') {
    const rec = await coordinator.record(id);
    const gateId = rec?.agent?.gateId;
    const kept = gateId ? await coordinator.kept(id, transcriptName(gateId)) : undefined;
    if (!kept) throw new HttpError(404, 'NO_TRANSCRIPT', 'no agent has answered this run');
    json(res, 200, kept); return true;
  }
  if (m[2] === 'resolve' && method === 'POST') { await resolveRoute(ctx, req, res, id, url, base, given); return true; }
  if (m[2] === 'cancel' && method === 'POST') { await runs.cancel(id); json(res, 200, (await runs.snapshot(id, base))!); return true; }
  throw new HttpError(405, 'METHOD_NOT_ALLOWED', `${method} is not allowed here`);
}
