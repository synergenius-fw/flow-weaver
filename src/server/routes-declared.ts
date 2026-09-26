/**
 * A request on a declared `@http` route, and the shape it is answered in.
 * The route decides the auth, where the parameters come from and whether
 * the answer is sync or async; the request may ask for 202 at once or wait
 * less. An `Idempotency-Key` makes a retry the same run, and the same key
 * with other parameters a conflict. A named callback URL is checked against
 * the policy before the run starts and noted beside the run so it survives
 * a restart. The answer is the workflow's data ports (200, or 422 on its
 * failure path), its error (500), 410 once cancelled, or 202 with the run
 * and a Location to poll.
 */
import { randomUUID, createHash } from 'node:crypto';
import { refuseCallbackUrl } from './callback-url.js';
import type { HttpNote } from './callback-delivery.js';
import type { ApiContext } from './context.js';
import { authorized } from './access.js';
import { HttpError } from './http-error.js';
import { header, json, readBody, settledWithin, waitBudget, wantsAsync, type Json } from './respond.js';
import { paramsFor } from './route-params.js';
import type { CompiledRoute } from './route-plan.js';
import { dataOf } from './run-view.js';
import type { ServerRequest, ServerResponse } from './transport.js';

/** JSON with keys in a fixed order, so two parameter objects compare by content. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (typeof v === 'object' && v !== null) return `{${Object.keys(v as Json).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Json)[k])}`).join(',')}}`;
  return JSON.stringify(v) ?? 'null';
}

/** A stable run id from an idempotency key, in UUID form so the store treats it like any other. */
function idempotentRunId(scope: string, key: string): string {
  const h = createHash('sha256').update(`${scope}\0${key}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/**
 * Answer in the declared shape from the run's state: the data ports with
 * 200 or 422, the error with 500, or 202 with the run and a Location to
 * poll -- `/runs/:id/result`, which answers in this same shape, so a
 * client sees one shape from its first request to the final answer.
 */
export async function answerDeclared(ctx: ApiContext, res: ServerResponse, id: string, base: string, replayed: boolean, executionTime?: number): Promise<void> {
  const snap = (await ctx.runs.snapshot(id, base))!;
  const extra: Record<string, string> = { 'X-Run-Id': id, ...(replayed ? { 'Idempotent-Replayed': 'true' } : {}) };
  if (snap.status === 'completed') {
    const { data, failed } = dataOf(snap.result);
    return json(res, failed ? 422 : 200, data, extra);
  }
  if (snap.status === 'failed') return json(res, 500, { error: snap.error, runId: id, links: snap.links }, extra);
  if (snap.status === 'cancelled') return json(res, 410, { error: { code: 'RUN_CANCELLED', message: 'the run was cancelled' }, runId: id, links: snap.links }, extra);
  if (executionTime !== undefined) snap.executionTime = executionTime;
  return json(res, 202, snap, { ...extra, Location: snap.links.result, 'Retry-After': '2' });
}

export async function declaredRoute(ctx: ApiContext, req: ServerRequest, res: ServerResponse, c: CompiledRoute, m: RegExpMatchArray, url: URL, base: string, given?: unknown): Promise<void> {
  const { coordinator, runs } = ctx;
  if (c.route.auth !== 'none' && !authorized(req, ctx.token)) throw new HttpError(401, 'UNAUTHORIZED', 'a bearer token is required');
  const { body, form } = c.route.method === 'GET' || c.route.method === 'DELETE' ? { body: {}, form: false } : await readBody(req, given, ctx.maxBody);
  const { params, callbackUrl, mocks } = paramsFor(c, m, url, body, form, ctx.dev);
  if (callbackUrl) {
    const why = await refuseCallbackUrl(callbackUrl, ctx.callbackPolicy);
    if (why) throw new HttpError(400, 'CALLBACK_REFUSED', `callbackUrl refused: ${why}`, [{ path: 'callbackUrl', message: why }]);
  }
  const idem = header(req, 'idempotency-key');
  const id = idem ? idempotentRunId(`${c.route.method} ${c.route.path}`, idem) : randomUUID();
  if (idem) {
    const before = (await coordinator.record(id))?.params ?? runs.inFlightParams(id);
    if (before) {
      // The same request again: the same run, wherever it got to. The
      // same key with other parameters is a caller's bug, not a replay.
      if (stable(before) !== stable(params)) throw new HttpError(409, 'IDEMPOTENCY_MISMATCH', 'this Idempotency-Key was already used with different parameters');
      return answerDeclared(ctx, res, id, base, true);
    }
  }
  runs.admit();
  const started = Date.now();
  const async = c.route.mode === 'async' || wantsAsync(req, url);
  const segment = runs.start(c.endpoint, id, params, mocks);
  // The note lands right after the run directory exists, so a callback
  // survives a restart between now and the run's end.
  const noteWhenPossible = (async () => {
    for (let i = 0; i < 50 && !(await coordinator.record(id)); i++) await new Promise((r) => setTimeout(r, 20));
    if (!(await coordinator.record(id))) return;
    await coordinator.keep(id, 'http', { route: { method: c.route.method, path: c.route.path }, ...(callbackUrl ? { callbackUrl } : {}) } satisfies HttpNote);
    if (callbackUrl) runs.callbacks.owe(id);
  })();
  if (async) { segment.catch(() => undefined); void noteWhenPossible; return json(res, 202, await runs.snapshot(id, base), { 'X-Run-Id': id, Location: `${base}/runs/${id}/result` }); }
  if (!(await settledWithin(segment, waitBudget(req, ctx.maxWait)))) {
    // Still running past what this request will wait: hand over the run.
    void noteWhenPossible;
    return answerDeclared(ctx, res, id, base, false, Date.now() - started);
  }
  await segment;
  await noteWhenPossible;
  // A callback named on a run that already ended fires now.
  void runs.callbacks.deliver(id);
  return answerDeclared(ctx, res, id, base, false, Date.now() - started);
}
