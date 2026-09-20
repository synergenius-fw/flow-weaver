/**
 * The console on a run store of the caller's own: it starts, lists and
 * resolves runs there, and writes nothing to the directory it would
 * otherwise use.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createConsoleServer, type ConsoleServer } from '../../src/console/server.js';
import { createMemoryRunStore } from '../../src/coordinator/index.js';

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'continuation', 'fixtures');

let project: string;
let assets: string;
let runsDir: string;
let server: ConsoleServer;
const store = createMemoryRunStore();
const previousRunsDir = process.env.FW_RUNS_DIR;

const api = async (method: string, p: string, body?: unknown) => {
  const res = await fetch(server.url + p, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};
const until = async (pred: () => Promise<boolean>, ms = 15000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await pred()) return; await new Promise((r) => setTimeout(r, 50)); }
  throw new Error('condition not met in time');
};

beforeAll(async () => {
  project = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-console-store-'));
  assets = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-console-assets-'));
  runsDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fw-console-runs-')), 'runs');
  process.env.FW_RUNS_DIR = runsDir;
  fs.copyFileSync(path.join(fixtures, 'durable-approval.ts'), path.join(project, 'approval.ts'));
  // The client is not under test. The server only needs the two files to exist.
  fs.writeFileSync(path.join(assets, 'index.html'), '<!doctype html>');
  fs.writeFileSync(path.join(assets, 'app.js'), '');
  server = await createConsoleServer({ projectDir: project, port: 0, watch: false, assetsDir: assets, store });
}, 60000);

afterAll(async () => {
  await server.close();
  if (previousRunsDir === undefined) delete process.env.FW_RUNS_DIR; else process.env.FW_RUNS_DIR = previousRunsDir;
  for (const d of [project, assets, path.dirname(runsDir)]) fs.rmSync(d, { recursive: true, force: true });
});

describe('the console on a store of its own', () => {
  it('starts, lists and resolves a run in the store, and leaves the runs directory alone', async () => {
    const file = path.join(project, 'approval.ts');
    const started = await api('POST', '/api/runs', { file, name: 'durableApproval', params: { value: 4 } });
    expect(started.status).toBe(200);
    const id = started.body.id as string;
    await until(async () => (await api('GET', `/api/runs/${id}`)).body.status === 'waiting');
    expect((await store.get(id))?.status).toBe('waiting');
    expect(await store.getDoc(id, 'continuation')).toBeDefined();
    // The gate card gets the author's words beside the types: each handed-over
    // input and each output by its @input/@output label, and the gate
    // function's description as what is being asked.
    const gate = (await api('GET', `/api/runs/${id}`)).body.gate as { kind: string; inputLabels: Record<string, string>; outputLabels: Record<string, string>; description: string };
    expect(gate).toMatchObject({ kind: 'approval', inputLabels: { value: 'Value requiring approval' }, outputLabels: { value: 'Approved value' } });
    expect(typeof gate.description).toBe('string');

    const listed = await api('GET', `/api/runs?file=${encodeURIComponent(file)}&name=durableApproval`);
    expect(listed.body.map((r: { id: string }) => r.id)).toEqual([id]);

    const resolved = await api('POST', `/api/runs/${id}/resolve`, { answer: 8 });
    expect(resolved.status).toBe(200);
    await until(async () => (await api('GET', `/api/runs/${id}`)).body.status === 'completed');
    expect((await api('GET', `/api/runs/${id}`)).body.result).toEqual({ onSuccess: true, onFailure: false, result: 9 });
    expect((await store.get(id))?.status).toBe('completed');

    expect(fs.existsSync(runsDir)).toBe(false);
    const status = await api('GET', '/api/status');
    expect(status.body.console.runsDir).toBe('a run store of your own');
  }, 60000);
});
