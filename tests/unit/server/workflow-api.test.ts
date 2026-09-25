/**
 * Workflows as endpoints, through `createWorkflowApi`: a declared `@http`
 * route binds the workflow's parameters from the path, the query or the
 * body and answers with its return ports. A gate answers 202 and a run to
 * follow. `Idempotency-Key` makes a retry the same run. `callback` posts
 * the final response. The same handler serves Node, an Express-style
 * mount and a fetch host. Runs go to a temp store, nothing touches ~/.fw.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createWorkflowApi, planRoutes, type WorkflowApi } from '../../../src/server/api.js';
import { WebhookServer } from '../../../src/server/webhook-server.js';
import { refuseCallbackUrl, isPrivateAddress } from '../../../src/server/callback-url.js';
import { createLocalCoordinator } from '../../../src/coordinator/index.js';
import type { RunResponse } from '../../../src/server/types.js';

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'continuation', 'fixtures');

const MATH = `
/**
 * @flowWeaver nodeType
 * @input n - A number
 * @output out - Twice the number
 */
function dbl(execute: boolean, n: number): { onSuccess: boolean; onFailure: boolean; out: number } {
  return { onSuccess: execute && n >= 0, onFailure: execute && n < 0, out: n * 2 };
}

/**
 * Doubles a number; a negative one takes the failure path.
 * @flowWeaver workflow
 * @http POST /double callback
 * @http GET /double/:n
 * @http POST /double-later mode=async
 * @http GET /ping/:n auth=none
 * @http POST /runs/oops
 * @param n - The number
 * @returns out - Twice the number
 * @node d dbl
 * @connect Start.n -> d.n
 * @connect d.out -> Exit.out
 * @connect d.onSuccess -> Exit.onSuccess
 * @connect d.onFailure -> Exit.onFailure
 */
export async function double(execute: boolean, params: { n: number }): Promise<{ onSuccess: boolean; onFailure: boolean; out: number }> {
  throw new Error('generated body was not installed');
}
`;

const SLOW = `
/**
 * @flowWeaver nodeType
 * @input n - A number
 * @output out - Twice the number, after a while
 */
async function slowDbl(execute: boolean, n: number): Promise<{ onSuccess: boolean; onFailure: boolean; out: number }> {
  await new Promise((r) => setTimeout(r, 400));
  return { onSuccess: execute, onFailure: false, out: n * 2 };
}

/**
 * @flowWeaver workflow
 * @http POST /slow
 * @param n - The number
 * @returns out - Twice the number
 * @node d slowDbl
 * @connect Start.n -> d.n
 * @connect d.out -> Exit.out
 */
export async function slowDouble(execute: boolean, params: { n: number }): Promise<{ onSuccess: boolean; onFailure: boolean; out: number }> {
  throw new Error('generated body was not installed');
}
`;

let dir: string;
let runsDir: string;
let server: WebhookServer;
let base: string;
const TOKEN = 't0k3n';
const auth = { Authorization: `Bearer ${TOKEN}` };
const seen: RunResponse[] = [];
const callbacks: Array<{ runId: string; ok: boolean; attempt: number; error?: string }> = [];

/** A tiny HTTP sink that records what is POSTed to it and answers as told. */
async function sink(answer: (n: number) => number = () => 204) {
  const got: Array<{ headers: http.IncomingHttpHeaders; body: unknown }> = [];
  const s = http.createServer((req, res) => {
    let text = '';
    req.on('data', (c) => { text += c; });
    req.on('end', () => { got.push({ headers: req.headers, body: JSON.parse(text) }); res.writeHead(answer(got.length)); res.end(); });
  });
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const port = (s.address() as { port: number }).port;
  return { got, url: `http://127.0.0.1:${port}/hook`, close: () => s.close() };
}

const call = async (method: string, p: string, body?: unknown, headers: Record<string, string> = auth) => {
  const res = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : undefined };
};

const until = async (pred: () => Promise<boolean>, ms = 15000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await pred()) return; await new Promise((r) => setTimeout(r, 50)); }
  throw new Error('condition not met in time');
};

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-api-'));
  runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-api-runs-'));
  // The approval fixture, declared on a route of its own.
  const approval = fs.readFileSync(path.join(fixtures, 'durable-approval.ts'), 'utf8').replace(' * @flowWeaver workflow\n', ' * @flowWeaver workflow\n * @http POST /approvals callback\n');
  fs.writeFileSync(path.join(dir, 'approval.ts'), approval);
  fs.writeFileSync(path.join(dir, 'math.ts'), MATH);
  fs.writeFileSync(path.join(dir, 'slow.ts'), SLOW);
  server = new WebhookServer({
    port: 0, host: '127.0.0.1', workflowDir: dir, watchEnabled: false, token: TOKEN, runsDir, agents: false,
    // The test's sinks are on loopback, which the default policy refuses. Name the host instead of allowing everything.
    callbacks: { hosts: ['127.0.0.1'], sweepMs: 150 },
    onRun: (r) => { seen.push(r); },
    onCallback: (o) => { callbacks.push({ runId: o.runId, ok: o.ok, attempt: o.attempt, error: o.error }); },
  });
  await server.start();
  base = server.url;
}, 60000);

afterAll(async () => {
  await server.stop();
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(runsDir, { recursive: true, force: true });
});

describe('declared routes', () => {
  it('mounts what the workflows declare and refuses a reserved path', () => {
    const { routes, problems } = server.api.routes();
    expect(routes.map((r) => `${r.method} ${r.path}`).sort()).toEqual(['GET /double/:n', 'GET /ping/:n', 'POST /approvals', 'POST /double', 'POST /double-later', 'POST /slow']);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('POST /runs/oops');
    expect(routes.find((r) => r.path === '/double-later')?.mode).toBe('async');
    expect(routes.find((r) => r.path === '/ping/:n')?.auth).toBe('none');
    expect(routes.find((r) => r.path === '/double')?.callback).toBe(true);
    expect(routes.find((r) => r.path === '/approvals')?.gates).toBe(1);
  });

  it('reports a clash between two workflows', () => {
    const plan = planRoutes([
      { name: 'a', routes: [{ method: 'POST', path: '/x' }] },
      { name: 'b', routes: [{ method: 'POST', path: '/x' }, { method: 'GET', path: '/x' }] },
    ]);
    expect(plan.mounted.map((m) => `${m.owner.name} ${m.route.method}`)).toEqual(['a POST', 'b GET']);
    expect(plan.problems[0]).toContain('already declared by a');
  });

  it('answers a POST with the return ports and the run id', async () => {
    const r = await call('POST', '/double', { n: 21 });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ out: 42 });
    expect(r.headers.get('x-run-id')).toMatch(/^[0-9a-f-]{36}$/);
    const run = await call('GET', `/runs/${r.headers.get('x-run-id')}`);
    expect(run.body).toMatchObject({ status: 'completed', workflow: 'double', params: { n: 21 } });
  });

  it('binds a path parameter with the declared type, and a GET takes the query', async () => {
    const r = await call('GET', '/double/4');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ out: 8 });
  });

  it('answers 422 when the workflow ends on its failure path', async () => {
    const r = await call('POST', '/double', { n: -3 });
    expect(r.status).toBe(422);
    expect(r.body).toEqual({ out: -6 });
  });

  it('takes a form post, reading the fields by the parameters\' types', async () => {
    const res = await fetch(`${base}/double`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'n=6' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ out: 12 });
  });

  it('tells the embedding about every state change', async () => {
    seen.length = 0;
    const r = await call('POST', '/double', { n: 1 });
    const id = r.headers.get('x-run-id');
    expect(seen.filter((s) => s.runId === id).map((s) => s.status)).toEqual(['completed']);
  });

  it('refuses a missing or mistyped parameter with 400 and field details', async () => {
    const missing = await call('POST', '/double', {});
    expect(missing.status).toBe(400);
    expect(missing.body.error).toMatchObject({ code: 'VALIDATION_ERROR', details: [{ path: 'n', message: 'required' }] });
    const wrong = await call('POST', '/double', { n: 'many' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.message).toContain('must be a number');
    const notANumber = await call('GET', '/double/many');
    expect(notANumber.status).toBe(400);
  });

  it('pauses at a gate with 202, a Location to follow, and the run', async () => {
    const r = await call('POST', '/approvals', { value: 4 });
    expect(r.status).toBe(202);
    expect(r.body.status).toBe('waiting');
    expect(r.body.gate.kind).toBe('approval');
    expect(r.headers.get('location')).toBe(`/runs/${r.body.runId}/result`);
    const done = await call('POST', `/runs/${r.body.runId}/resolve`, { answer: 8 });
    expect(done.status).toBe(200);
    expect(done.body.result.result).toBe(9);
  });

  it('answers 202 at once on an async route and the run can be followed', async () => {
    const r = await call('POST', '/double-later', { n: 5 });
    expect(r.status).toBe(202);
    expect(r.headers.get('location')).toBe(`/runs/${r.body.runId}/result`);
    await until(async () => (await call('GET', `/runs/${r.body.runId}`)).body.status === 'completed');
  });

  it('serves an auth=none route without the token while the rest still needs it', async () => {
    expect((await call('GET', '/ping/2', undefined, {})).status).toBe(200);
    expect((await call('GET', '/double/2', undefined, {})).status).toBe(401);
    expect((await call('POST', '/double', { n: 1 }, {})).status).toBe(401);
  });

  it('makes a retried request the same run with Idempotency-Key', async () => {
    const key = `k-${Date.now()}`;
    const first = await call('POST', '/double', { n: 7 }, { ...auth, 'Idempotency-Key': key });
    const again = await call('POST', '/double', { n: 7 }, { ...auth, 'Idempotency-Key': key });
    expect(first.status).toBe(200);
    expect(again.status).toBe(200);
    expect(again.headers.get('x-run-id')).toBe(first.headers.get('x-run-id'));
    expect(again.headers.get('idempotent-replayed')).toBe('true');
    expect(first.headers.get('idempotent-replayed')).toBeNull();
    // Another key is another run.
    const other = await call('POST', '/double', { n: 7 }, { ...auth, 'Idempotency-Key': `${key}-2` });
    expect(other.headers.get('x-run-id')).not.toBe(first.headers.get('x-run-id'));
    // The same key with other parameters is a bug on the caller's side, not a replay.
    const mismatch = await call('POST', '/double', { n: 8 }, { ...auth, 'Idempotency-Key': key });
    expect(mismatch.status).toBe(409);
    expect(mismatch.body.error.code).toBe('IDEMPOTENCY_MISMATCH');
  });

  it('posts the final response to a callback URL, signed with the token', async () => {
    const s = await sink();
    try {
      const r = await call('POST', '/double', { n: 9, callbackUrl: s.url });
      expect(r.status).toBe(200);
      await until(async () => s.got.length > 0);
      expect(s.got[0].body).toMatchObject({ runId: r.headers.get('x-run-id'), workflow: 'double', status: 'completed', result: { out: 18 }, failed: false });
      expect(s.got[0].headers['x-flow-weaver-signature']).toMatch(/^sha256=[0-9a-f]{64}$/);
      expect(s.got[0].headers['x-flow-weaver-status']).toBe('completed');
      expect(s.got[0].headers['x-flow-weaver-attempt']).toBe('1');
      expect(callbacks.find((c) => c.runId === r.headers.get('x-run-id'))).toMatchObject({ ok: true, attempt: 1 });
    } finally {
      s.close();
    }
  });

  it('delivers the callback when the gate is answered by another process', async () => {
    const s = await sink();
    try {
      const r = await call('POST', '/approvals', { value: 3, callbackUrl: s.url });
      expect(r.status).toBe(202);
      const id = r.body.runId as string;
      // The console, an assistant over MCP: another coordinator on the same store.
      const elsewhere = createLocalCoordinator({ rootDir: runsDir });
      await elsewhere.resume({ runId: id, input: { answer: 6 } });
      await until(async () => s.got.length > 0);
      expect(s.got[0].body).toMatchObject({ runId: id, status: 'completed', result: { result: 7 } });
    } finally {
      s.close();
    }
  });

  it('retries a failed callback later and records the attempts', async () => {
    const s = await sink((n) => (n === 1 ? 500 : 204));
    try {
      const r = await call('POST', '/double', { n: 2, callbackUrl: s.url });
      const id = r.headers.get('x-run-id')!;
      await until(async () => callbacks.some((c) => c.runId === id && !c.ok));
      expect(callbacks.find((c) => c.runId === id && !c.ok)).toMatchObject({ attempt: 1, error: 'callback answered 500' });
      expect(s.got).toHaveLength(1);
      // The retry is two seconds out; nothing more is sent before then.
      await new Promise((res) => setTimeout(res, 400));
      expect(s.got).toHaveLength(1);
    } finally {
      s.close();
    }
  });

  it('refuses a callback to a private address unless the policy allows it', async () => {
    const refused = await call('POST', '/double', { n: 1, callbackUrl: 'http://10.0.0.5/hook' });
    expect(refused.status).toBe(400);
    expect(refused.body.error.code).toBe('CALLBACK_REFUSED');
    expect(await refuseCallbackUrl('http://localhost:9000/x')).toContain('private');
    expect(await refuseCallbackUrl('http://169.254.169.254/latest/meta-data')).toContain('private');
    expect(await refuseCallbackUrl('ftp://example.com/x')).toContain('http');
    expect(await refuseCallbackUrl('http://user:pw@example.com/x')).toContain('credentials');
    expect(await refuseCallbackUrl('http://localhost:9000/x', { allowPrivate: true })).toBeUndefined();
    expect(await refuseCallbackUrl('https://hooks.example.com/x', { hosts: ['*.example.com'] })).toBeUndefined();
    expect(await refuseCallbackUrl('https://evil.example.org/x', { hosts: ['*.example.com'] })).toContain('not among');
    expect(await refuseCallbackUrl('https://a.example.com/x', { allow: () => 'no thanks' })).toBe('no thanks');
    expect(isPrivateAddress('172.31.255.1')).toBe(true);
    expect(isPrivateAddress('172.32.0.1')).toBe(false);
    expect(isPrivateAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateAddress('fd12::1')).toBe(true);
    expect(isPrivateAddress('8.8.8.8')).toBe(false);
  });

  it('keeps the run-resource form of every workflow too', async () => {
    const r = await call('POST', '/workflows/double', { n: 2 });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'completed', result: { out: 4, onSuccess: true } });
  });

  it('describes the declared routes in OpenAPI and lists them per workflow', async () => {
    const spec = (await call('GET', '/openapi.json')).body;
    expect(spec.paths['/double/{n}'].get.parameters).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'n', in: 'path', required: true, schema: expect.objectContaining({ type: 'number' }) })]));
    expect(spec.paths['/double'].post.requestBody.content['application/json'].schema.properties.callbackUrl).toBeDefined();
    expect(spec.paths['/double'].post.responses['422']).toBeDefined();
    expect(spec.paths['/approvals'].post.responses['202']).toBeDefined();
    expect(spec.paths['/ping/{n}'].get.security).toEqual([]);
    const list = (await call('GET', '/workflows')).body;
    const dbl = list.workflows.find((w: { name: string }) => w.name === 'double');
    expect(dbl.routes).toHaveLength(5);
    expect(list.problems).toHaveLength(1);
    expect((await call('GET', '/health', undefined, {})).body.routes).toBe(6);
  });

  it('hands a slow run over with 202 when it outlasts the wait budget, and the result URL answers in the declared shape', async () => {
    const r = await call('POST', '/slow', { n: 4 }, { ...auth, Prefer: 'wait=0.05' });
    expect(r.status).toBe(202);
    expect(r.body.status).toBe('running');
    const loc = r.headers.get('location')!;
    expect(loc).toBe(`/runs/${r.body.runId}/result`);
    expect(r.headers.get('retry-after')).toBe('2');
    await until(async () => (await call('GET', loc)).status === 200);
    expect((await call('GET', loc)).body).toEqual({ out: 8 });
  });

  it('answers in the declared shape at /result for a gated run: 202 while waiting, 200 after, 410 when cancelled', async () => {
    const r = await call('POST', '/approvals', { value: 1 });
    const loc = `/runs/${r.body.runId}/result`;
    const waiting = await call('GET', loc);
    expect(waiting.status).toBe(202);
    expect(waiting.body.gate.kind).toBe('approval');
    await call('POST', `/runs/${r.body.runId}/resolve`, { answer: 2 });
    const done = await call('GET', loc);
    expect(done.status).toBe(200);
    expect(done.body).toEqual({ result: 3 });
    const other = await call('POST', '/approvals', { value: 1 });
    await call('POST', `/runs/${other.body.runId}/cancel`);
    const gone = await call('GET', `/runs/${other.body.runId}/result`);
    expect(gone.status).toBe(410);
    expect(gone.body.error.code).toBe('RUN_CANCELLED');
  });

  it('answers 400, not 500, to a path segment that is not valid percent-encoding', async () => {
    const bad = await call('GET', '/workflows/%E0');
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('BAD_PATH');
    const badRoute = await call('GET', '/double/%E0');
    expect(badRoute.status).toBe(400);
  });

  it('sends one allowed origin at a time when several are configured, and varies on Origin', async () => {
    const withCors = new WebhookServer({ port: 0, host: '127.0.0.1', workflowDir: dir, watchEnabled: false, token: TOKEN, runsDir, agents: false, corsOrigin: ['https://a.example', 'https://b.example'] });
    await withCors.start();
    try {
      const b = await fetch(`${withCors.url}/health`, { headers: { Origin: 'https://b.example' } });
      expect(b.headers.get('access-control-allow-origin')).toBe('https://b.example');
      expect(b.headers.get('vary')).toContain('Origin');
      const other = await fetch(`${withCors.url}/health`, { headers: { Origin: 'https://evil.example' } });
      expect(other.headers.get('access-control-allow-origin')).toBeNull();
      const preflight = await fetch(`${withCors.url}/double`, { method: 'OPTIONS', headers: { Origin: 'https://a.example' } });
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get('access-control-allow-origin')).toBe('https://a.example');
    } finally {
      await withCors.stop();
    }
  }, 30000);

  it('serves Swagger and the document without the token only when docs are on', async () => {
    expect((await call('GET', '/docs')).status).toBe(404);
    const withDocs = new WebhookServer({ port: 0, host: '127.0.0.1', workflowDir: dir, watchEnabled: false, token: TOKEN, runsDir, agents: false, swaggerEnabled: true });
    await withDocs.start();
    try {
      const page = await fetch(`${withDocs.url}/docs`);
      expect(page.status).toBe(200);
      expect(await page.text()).toContain('swagger-ui');
      expect((await fetch(`${withDocs.url}/openapi.json`)).status).toBe(200);
      expect((await fetch(`${withDocs.url}/workflows`)).status).toBe(401);
    } finally {
      await withDocs.stop();
    }
  }, 30000);
});

describe('the clock', () => {
  const NAP = `
/**
 * @flowWeaver nodeType
 * @expression
 * @input wokeAt - When the run woke
 * @output note - A line about it
 */
function report(wokeAt: string): string { return \`woke at \${wokeAt}\`; }

/**
 * @flowWeaver workflow
 * @http POST /nap
 * @param label - A label
 * @returns note - A line about it
 * @node z sleep [expr: duration="'150ms'"]
 * @node say report
 * @path Start -> z -> say -> Exit
 * @connect z.wokeAt -> say.wokeAt
 */
export async function nap(execute: boolean, params: { label: string }): Promise<{ onSuccess: boolean; onFailure: boolean; note: string }> {
  throw new Error('generated body was not installed');
}
`;
  let api: WorkflowApi;
  const announced: RunResponse[] = [];
  beforeAll(async () => {
    fs.writeFileSync(path.join(dir, 'nap.ts'), NAP);
    api = createWorkflowApi({ dir, runsDir, agents: false, callbacks: { sweepMs: 60_000 }, onRun: (r) => { announced.push(r); } });
    await api.ready();
  });
  afterAll(async () => { await api.close(); });

  it('answers 202 with the wake time for a sleeping run, and the sweep wakes it', async () => {
    const post = (p: string, body: unknown) => api.fetch(new Request(`http://x${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
    const first = await post('/nap', { label: 'a' });
    expect(first.status).toBe(202);
    const run = (await first.json()) as RunResponse;
    expect(run.status).toBe('waiting');
    expect(run.gate).toMatchObject({ kind: 'timer', node: 'z', inputs: { duration: '150ms' } });
    expect(run.due?.action).toBe('wake');
    expect(Date.parse(run.due!.at) - Date.now()).toBeLessThanOrEqual(150);

    // Not yet: the clock leaves it.
    await api.tick();
    expect((await api.fetch(new Request(`http://x${first.headers.get('location')}`))).status).toBe(202);

    await new Promise((r) => setTimeout(r, 200));
    await api.deliverCallbacks();   // the periodic sweep: the clock first
    const done = await api.fetch(new Request(`http://x${first.headers.get('location')}`));
    expect(done.status).toBe(200);
    expect(((await done.json()) as { note: string }).note).toMatch(/^woke at \d{4}-/);
    // Announced like any other state change.
    expect(announced.some((r) => r.runId === run.runId && r.status === 'completed')).toBe(true);
  });
});

describe('embedding', () => {
  let api: WorkflowApi;
  beforeAll(async () => {
    api = createWorkflowApi({ dir, runsDir, agents: false });
    await api.ready();
  });
  afterAll(async () => { await api.close(); });

  it('hands over after maxWaitMs, and refuses more than maxInFlight with 503', async () => {
    // Its own instance: a tight wait and a cap of one would make every other
    // test here depend on how fast this machine is.
    const limited = createWorkflowApi({ dir, runsDir, agents: false, maxWaitMs: 100, maxInFlight: 1 });
    await limited.ready();
    try {
      const post = (p: string, body: unknown) => limited.fetch(new Request(`http://x${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
      const first = await post('/slow', { n: 1 });
      expect(first.status).toBe(202);
      const busy = await post('/double', { n: 2 });
      expect(busy.status).toBe(503);
      expect(busy.headers.get('retry-after')).toBe('2');
      expect(((await busy.json()) as { error: { code: string } }).error.code).toBe('BUSY');
      const loc = first.headers.get('location')!;
      await until(async () => (await limited.fetch(new Request(`http://x${loc}`))).status === 200);
      expect(await (await limited.fetch(new Request(`http://x${loc}`))).json()).toEqual({ out: 2 });
      // Room again once the slow run is done: admitted, whether or not it finishes inside the 100 ms.
      expect([200, 202]).toContain((await post('/double', { n: 2 })).status);
    } finally {
      await limited.close();
    }
  });

  it('mounts under a prefix as Express-style middleware and links under it', async () => {
    const mw = api.express();
    const host = http.createServer(async (req, res) => {
      if (!req.url?.startsWith('/api')) { res.writeHead(200); res.end('the app'); return; }
      // What express.json() does before our middleware sees the request: the
      // stream is consumed and req.body holds the object.
      if (req.method === 'POST') {
        let text = '';
        for await (const c of req) text += c;
        (req as http.IncomingMessage & { body: unknown }).body = text ? JSON.parse(text) : {};
      }
      (req as http.IncomingMessage & { baseUrl: string }).baseUrl = '/api';
      mw(req, res, (err?: unknown) => { res.writeHead(err ? 500 : 404); res.end(err ? String(err) : 'app 404'); });
    });
    await new Promise<void>((r) => host.listen(0, '127.0.0.1', r));
    const port = (host.address() as { port: number }).port;
    try {
      expect(await (await fetch(`http://127.0.0.1:${port}/`)).text()).toBe('the app');
      expect(await (await fetch(`http://127.0.0.1:${port}/api/nothing`)).text()).toBe('app 404');
      const health = await fetch(`http://127.0.0.1:${port}/api/health`);
      expect(health.status).toBe(200);
      const paused = await fetch(`http://127.0.0.1:${port}/api/approvals`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: 1 }) });
      expect(paused.status).toBe(202);
      const run = (await paused.json()) as { runId: string; links: { resolve: string } };
      expect(paused.headers.get('location')).toBe(`/api/runs/${run.runId}/result`);
      expect(run.links.resolve).toBe(`/api/runs/${run.runId}/resolve`);
      const spec = (await (await fetch(`http://127.0.0.1:${port}/api/openapi.json`)).json()) as { servers: { url: string }[] };
      expect(spec.servers[0].url).toBe('/api');
      const doubled = await fetch(`http://127.0.0.1:${port}/api/double`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ n: 20 }) });
      expect(await doubled.json()).toEqual({ out: 40 });
    } finally {
      host.closeAllConnections();
      await new Promise<void>((r) => host.close(() => r()));
    }
  });

  it('answers a fetch Request and streams events through it', async () => {
    const health = await api.fetch(new Request('http://x/health'));
    expect(health.status).toBe(200);
    expect(((await health.json()) as { status: string }).status).toBe('ok');
    const doubled = await api.fetch(new Request('http://x/double', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ n: 3 }) }));
    expect(doubled.status).toBe(200);
    expect(await doubled.json()).toEqual({ out: 6 });
    const missing = await api.fetch(new Request('http://x/nowhere'));
    expect(missing.status).toBe(404);
    const id = doubled.headers.get('x-run-id')!;
    const ctrl = new AbortController();
    const events = await api.fetch(new Request(`http://x/runs/${id}/events`, { signal: ctrl.signal }));
    expect(events.headers.get('content-type')).toContain('text/event-stream');
    const reader = events.body!.getReader();
    let text = '';
    while (!text.includes('"synced"')) {
      const { value, done } = await reader.read();
      if (done) break;
      text += new TextDecoder().decode(value);
    }
    ctrl.abort();
    expect(text.split('\n\n')[0]).toContain('"type":"run"');
  });

  it('takes a body the host already parsed, as Fastify hands it over', async () => {
    const listener = api.node();
    const host = http.createServer(async (req, res) => {
      let text = '';
      for await (const c of req) text += c;
      // A Fastify route would call api.handle(request.raw, reply.raw, { body: request.body }) and hijack the reply.
      const handled = await api.handle(req, res, { body: text ? JSON.parse(text) : undefined });
      if (!handled) listener(req, res);
    });
    await new Promise<void>((r) => host.listen(0, '127.0.0.1', r));
    const port = (host.address() as { port: number }).port;
    try {
      const r = await fetch(`http://127.0.0.1:${port}/double`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ n: 15 }) });
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ out: 30 });
    } finally {
      host.closeAllConnections();
      await new Promise<void>((r) => host.close(() => r()));
    }
  });

  it('serves the same store, so a run started over Node is visible here', async () => {
    const r = await call('POST', '/double', { n: 11 });
    const seen = await api.fetch(new Request(`http://x/runs/${r.headers.get('x-run-id')}`));
    expect(seen.status).toBe(200);
    expect(((await seen.json()) as { params: unknown }).params).toEqual({ n: 11 });
  });
});
