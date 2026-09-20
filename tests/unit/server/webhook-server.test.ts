/**
 * `fw serve` over real HTTP: a workflow endpoint that pauses at a gate and
 * answers 202 with a run id, the run resources that resolve and follow it,
 * the bearer token, and an agent gate answered by a profile with a fake
 * model behind it. The server listens on a free port; runs go to a temp
 * store so nothing touches ~/.fw.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebhookServer } from '../../../src/server/webhook-server.js';
import type { RunResponse } from '../../../src/server/types.js';
import type { AgentProvider, StreamEvent } from '../../../src/agent/types.js';
import { SUBMIT_TOOL } from '../../../src/agent/gate.js';

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'continuation', 'fixtures');

let dir: string;
let runsDir: string;
let server: WebhookServer;
let base: string;
const TOKEN = 'test-token-123';
const auth = { Authorization: `Bearer ${TOKEN}` };

/** A model that submits a fixed answer on its first turn. */
function fakeProvider(): AgentProvider {
  const turn: StreamEvent[] = [
    { type: 'text_delta', text: 'Reviewing…' },
    { type: 'tool_use_start', id: 't', name: SUBMIT_TOOL },
    { type: 'tool_use_end', id: 't', arguments: { summary: 'No tests.', risk: 'high' } },
    { type: 'usage', promptTokens: 12, completionTokens: 4 },
    { type: 'message_stop', finishReason: 'tool_calls' },
  ];
  return { async *stream() { for (const ev of turn) yield ev; } };
}

const api = async (method: string, p: string, body?: unknown, headers: Record<string, string> = auth) => {
  const res = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined };
};

const until = async (pred: () => Promise<boolean>, ms = 15000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await pred()) return; await new Promise((r) => setTimeout(r, 50)); }
  throw new Error('condition not met in time');
};

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-serve-'));
  runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-serve-runs-'));
  fs.copyFileSync(path.join(fixtures, 'durable-approval.ts'), path.join(dir, 'approval.ts'));
  fs.copyFileSync(path.join(fixtures, 'durable-agent-labeled.ts'), path.join(dir, 'review.ts'));
  fs.mkdirSync(path.join(dir, '.flowweaver'));
  fs.writeFileSync(path.join(dir, '.flowweaver', 'agents.yaml'), 'default: reviewer\nagents:\n  reviewer:\n    provider: anthropic\n    model: fake\n');
  server = new WebhookServer({
    port: 0, host: '127.0.0.1', workflowDir: dir, watchEnabled: false, token: TOKEN, runsDir, trace: true,
    env: { ANTHROPIC_API_KEY: 'x' }, agentProvider: () => fakeProvider(),
  });
  await server.start();
  base = server.url;
}, 60000);

afterAll(async () => {
  await server.stop();
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(runsDir, { recursive: true, force: true });
});

describe('auth and description', () => {
  it('answers /health without a token and everything else only with it', async () => {
    const open = await api('GET', '/health', undefined, {});
    expect(open.status).toBe(200);
    expect(open.body).toMatchObject({ status: 'ok', auth: 'token', agents: true, workflows: 2 });
    expect((await api('GET', '/workflows', undefined, {})).status).toBe(401);
    expect((await api('GET', '/workflows', undefined, { Authorization: 'Bearer wrong' })).status).toBe(401);
    expect((await api('GET', '/workflows')).status).toBe(200);
  });

  it('lists the workflows with their schemas and gate counts', async () => {
    const { body } = await api('GET', '/workflows');
    const names = body.workflows.map((w: { name: string }) => w.name).sort();
    expect(names).toEqual(['durableApproval', 'reviewFile']);
    const approval = body.workflows.find((w: { name: string }) => w.name === 'durableApproval');
    expect(approval.gates).toBe(1);
    expect(approval.inputSchema.properties.value).toEqual({ type: 'number', description: 'Input value' });
    expect(approval.inputSchema.required).toEqual(['value']);
  });

  it('describes one endpoint and refuses an unknown one', async () => {
    expect((await api('GET', '/workflows/durableApproval')).body.path).toBe('/workflows/durableApproval');
    const missing = await api('GET', '/workflows/nope');
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('WORKFLOW_NOT_FOUND');
  });

  it('publishes an OpenAPI document with the run resources and the bearer scheme', async () => {
    const { body } = await api('GET', '/openapi.json');
    expect(Object.keys(body.paths)).toEqual(expect.arrayContaining(['/workflows/durableApproval', '/runs', '/runs/{runId}', '/runs/{runId}/resolve', '/runs/{runId}/events', '/health']));
    expect(body.components.securitySchemes.bearer).toEqual({ type: 'http', scheme: 'bearer' });
    expect(body.paths['/workflows/durableApproval'].post.responses['202']).toBeDefined();
  });
});

describe('a gated workflow as an endpoint', () => {
  let runId: string;

  it('runs to its gate and answers 202 with the run and the gate', async () => {
    const r = await api('POST', '/workflows/durableApproval', { value: 4 });
    expect(r.status).toBe(202);
    const run = r.body as RunResponse;
    runId = run.runId;
    expect(run.status).toBe('waiting');
    expect(run.gate).toMatchObject({ kind: 'approval', node: 'approval', inputs: { value: 8 }, outputs: ['value'], hasFailurePort: true });
    expect(run.links.resolve).toBe(`/runs/${runId}/resolve`);
    expect(typeof run.executionTime).toBe('number');
  });

  it('shows the run and lists it', async () => {
    expect((await api('GET', `/runs/${runId}`)).body.status).toBe('waiting');
    const list = await api('GET', '/runs?workflow=durableApproval');
    expect(list.body.runs.map((r: RunResponse) => r.runId)).toContain(runId);
  });

  it('refuses a bad answer body and an answer that does not fit', async () => {
    const both = await api('POST', `/runs/${runId}/resolve`, { answer: 1, reject: 'x' });
    expect(both.status).toBe(400);
    expect(both.body.error.code).toBe('INVALID_INPUT');
    const bad = await api('POST', `/runs/${runId}/resolve`, { answer: () => 1 });
    expect(bad.status).toBe(400);
  });

  it('resumes with the answer and completes', async () => {
    const r = await api('POST', `/runs/${runId}/resolve`, { answer: 8 });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('completed');
    expect(r.body.result).toEqual({ onSuccess: true, onFailure: false, result: 9 });
  });

  it('will not resume a run that is not waiting, and 404s an unknown one', async () => {
    const again = await api('POST', `/runs/${runId}/resolve`, { answer: 8 });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('RUN_NOT_WAITING');
    expect((await api('GET', '/runs/nope')).status).toBe(404);
  });

  it('answers at once when asked to, and can be followed', async () => {
    const r = await api('POST', '/workflows/durableApproval?async=1', { value: 1 });
    expect(r.status).toBe(202);
    expect(['running', 'waiting']).toContain(r.body.status);
    await until(async () => (await api('GET', `/runs/${r.body.runId}`)).body.status === 'waiting');
    const cancelled = await api('POST', `/runs/${r.body.runId}/cancel`);
    expect(cancelled.body.status).toBe('cancelled');
  });

  it('streams the run, its trace and a synced marker', async () => {
    const started = await api('POST', '/workflows/durableApproval', { value: 2 });
    const ctrl = new AbortController();
    const res = await fetch(`${base}/runs/${started.body.runId}/events`, { headers: auth, signal: ctrl.signal });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body!.getReader();
    let text = '';
    while (!text.includes('"synced"')) {
      const { value, done } = await reader.read();
      if (done) break;
      text += new TextDecoder().decode(value);
    }
    ctrl.abort();
    const types = text.split('\n\n').filter(Boolean).map((l) => JSON.parse(l.replace(/^data: /, '')).type);
    expect(types[0]).toBe('run');
    expect(types).toContain('event');
    expect(types.at(-1)).toBe('synced');
  });

  it('rejects a body that is not JSON', async () => {
    const res = await fetch(`${base}/workflows/durableApproval`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: '{not json' });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('INVALID_JSON');
  });
});

describe('an agent gate answered by a profile', () => {
  it('lets the profile answer and the run finish, and keeps the transcript', async () => {
    const r = await api('POST', '/workflows/reviewFile', { path: 'notes.md', text: 'TODO: ship it.' });
    expect(r.status).toBe(202);
    const id = r.body.runId as string;
    expect(r.body.gate.kind).toBe('agent');
    await until(async () => (await api('GET', `/runs/${id}`)).body.status === 'completed');
    const done = (await api('GET', `/runs/${id}`)).body as RunResponse;
    expect((done.result as { report: string }).report).toContain('risk: high');
    expect(done.agent).toMatchObject({ status: 'answered', profile: 'reviewer', provider: 'anthropic', usage: { promptTokens: 12, completionTokens: 4 } });
    const transcript = await api('GET', `/runs/${id}/agent`);
    expect(transcript.status).toBe(200);
    expect(transcript.body.outcome).toEqual({ kind: 'answer', answer: { summary: 'No tests.', risk: 'high' } });
    expect(transcript.body.messages.length).toBeGreaterThan(0);
  });
});

describe('with agents off', () => {
  it('leaves an agent gate waiting for a person', async () => {
    const quiet = new WebhookServer({ port: 0, host: '127.0.0.1', workflowDir: dir, watchEnabled: false, runsDir, agents: false, agentProvider: () => fakeProvider(), env: { ANTHROPIC_API_KEY: 'x' } });
    await quiet.start();
    try {
      const res = await fetch(`${quiet.url}/workflows/reviewFile`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: 'a', text: 'b' }) });
      const run = (await res.json()) as RunResponse;
      expect(res.status).toBe(202);
      expect(run.status).toBe('waiting');
      await new Promise((r) => setTimeout(r, 200));
      const later = (await (await fetch(`${quiet.url}/runs/${run.runId}`)).json()) as RunResponse;
      expect(later.status).toBe('waiting');
      expect(later.agent).toBeUndefined();
      const health = await (await fetch(`${quiet.url}/health`)).json();
      expect(health).toMatchObject({ auth: 'open', agents: false });
    } finally {
      await quiet.stop();
    }
  }, 30000);
});
