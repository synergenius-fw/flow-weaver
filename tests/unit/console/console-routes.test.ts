/**
 * The console's HTTP routes, answered by a running console over a project
 * with one workflow: what each returns, and how each refuses a request it
 * cannot serve. Runs and the store have their own tests (console-store).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createConsoleServer, type ConsoleServer } from '../../../src/console/server.js';
import { createMemoryRunStore } from '../../../src/coordinator/index.js';

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'continuation', 'fixtures');

let project: string;
let assets: string;
let file: string;
let server: ConsoleServer;

type Body = Record<string, unknown>;
const api = async <T = Body>(method: string, p: string, body?: unknown) => {
  const res = await fetch(server.url + p, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  const text = await res.text();
  let parsed: unknown = text;
  try { parsed = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body: parsed as T, type: res.headers.get('content-type') ?? '', headers: res.headers };
};
const q = (p: string, params: Record<string, string>) => `${p}?${new URLSearchParams(params)}`;

beforeAll(async () => {
  project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fw-console-routes-')));
  assets = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-console-routes-assets-'));
  fs.mkdirSync(path.join(project, 'flows'));
  fs.mkdirSync(path.join(project, 'node_modules'));
  fs.mkdirSync(path.join(project, '.hidden'));
  file = path.join(project, 'flows', 'approval.ts');
  fs.copyFileSync(path.join(fixtures, 'durable-approval.ts'), file);
  fs.writeFileSync(path.join(assets, 'index.html'), '<!doctype html><title>console</title>');
  fs.writeFileSync(path.join(assets, 'app.js'), 'export {};');
  fs.writeFileSync(path.join(assets, 'styles.css'), 'body{}');
  server = await createConsoleServer({ projectDir: project, port: 0, watch: false, assetsDir: assets, store: createMemoryRunStore() });
}, 60000);

afterAll(async () => {
  await server.close();
  for (const d of [project, assets]) fs.rmSync(d, { recursive: true, force: true });
});

describe('the console client', () => {
  it('serves the page, the script and the styles with their types', async () => {
    expect(await api('GET', '/')).toMatchObject({ status: 200, type: 'text/html' });
    expect(await api('GET', '/app.js')).toMatchObject({ status: 200, type: 'text/javascript' });
    expect(await api('GET', '/styles.css')).toMatchObject({ status: 200, type: 'text/css' });
  });

  it('answers 404 with a JSON error for anything it does not know', async () => {
    expect(await api('GET', '/api/nothing-here')).toEqual(expect.objectContaining({ status: 404, body: { error: 'not found' } }));
  });
});

describe('the project', () => {
  it('names the project it is open on', async () => {
    const res = await api('GET', '/api/project');
    expect(res.body).toEqual({ dir: project, name: path.basename(project), parent: path.dirname(project) });
  });

  it('refuses to open something that is not a directory', async () => {
    const res = await api('POST', '/api/project', { dir: file });
    expect(res.status).toBe(400);
    expect((await api<Body>('GET', '/api/project')).body.dir).toBe(project);
  });

  it('browses directories, leaving out hidden ones and node_modules, with crumbs to walk back', async () => {
    const res = await api<{ dir: string; entries: Array<{ name: string }>; crumbs: Array<{ name: string; dir: string }> }>('GET', q('/api/browse', { dir: project }));
    expect(res.status).toBe(200);
    expect(res.body.entries.map((e) => e.name)).toEqual(['flows']);
    expect(res.body.crumbs.at(-1)).toEqual({ name: path.basename(project), dir: project });
  });

  it('answers 400 when the directory to browse does not exist', async () => {
    expect((await api('GET', q('/api/browse', { dir: path.join(project, 'missing') }))).status).toBe(400);
  });

  it('lists the workflows in the project, with how many runs wait on each', async () => {
    const res = await api<Array<{ file: string; name: string; waiting: number }>>('GET', '/api/workflows');
    expect(res.body).toEqual([expect.objectContaining({ file, name: 'durableApproval', waiting: 0 })]);
  });
});

describe('one workflow', () => {
  it('describes it: steps, parameters, returns and issues', async () => {
    const res = await api<Body>('GET', q('/api/workflow', { file, name: 'durableApproval' }));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ file, rel: 'flows/approval.ts', name: 'durableApproval', compiled: false, http: [] });
    expect(Object.keys(res.body.nodes as Body).length).toBeGreaterThan(0);
    expect(Array.isArray(res.body.issues)).toBe(true);
  });

  it('refuses a file outside the project, on every route that takes one', async () => {
    const outside = path.join(os.tmpdir(), 'elsewhere.ts');
    for (const route of ['/api/workflow', '/api/diff', '/api/git/history', '/api/artifact']) {
      const res = await api<Body>('GET', q(route, { file: outside, name: 'x', kind: 'brief' }));
      expect(res.status, route).toBe(400);
      expect(res.body.error, route).toBe('file is outside the project');
    }
    for (const [method, route] of [['PUT', '/api/workflow/http'], ['POST', '/api/export'], ['POST', '/api/runs']]) {
      const res = await api<Body>(method, route, { file: outside, name: 'x', routes: [] });
      expect(res.status, route).toBe(400);
    }
  });

  it('refuses an artifact kind it does not make', async () => {
    const res = await api<Body>('GET', q('/api/artifact', { file, name: 'durableApproval', kind: 'poster' }));
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('poster');
  });
});

describe('exposing a workflow over HTTP', () => {
  const put = (routes: unknown[]) => api<Body>('PUT', '/api/workflow/http', { file, name: 'durableApproval', routes });

  it('refuses a route with a bad method, a bad path, a reserved path, or listed twice', async () => {
    expect((await put([{ method: 'FETCH', path: '/a' }])).body.error).toContain('method must be one of');
    expect((await put([{ method: 'POST', path: 'no-slash' }])).body.error).toContain('starts with /');
    expect((await put([{ method: 'POST', path: '/has space' }])).body.error).toContain('starts with /');
    expect((await put([{ method: 'GET', path: '/runs' }])).body.error).toContain('reserved');
    expect((await put([{ method: 'POST', path: '/a' }, { method: 'post', path: '/a' }])).body.error).toContain('listed twice');
    expect((await put(['/a'])).body.error).toBe('a route is an object');
  });

  it('writes the @http lines, reads them back, and touches nothing else in the file', async () => {
    const before = fs.readFileSync(file, 'utf8');
    const res = await put([{ method: 'post', path: '/approve', mode: 'async', auth: 'none', callback: true }]);
    expect(res.status).toBe(200);
    expect(res.body.http).toEqual([{ method: 'POST', path: '/approve', mode: 'async', auth: 'none', callback: true }]);
    const after = fs.readFileSync(file, 'utf8');
    expect(after).toContain('@http POST /approve');
    expect(after.replace(/^[ \t]*\*[ \t]*@http\b[^\n]*\n/gm, '')).toBe(before);

    // And removed again: an empty list takes the lines out.
    const cleared = await put([]);
    expect(cleared.body.http).toEqual([]);
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
  });

  it('refuses a workflow the file does not have', async () => {
    const res = await api<Body>('PUT', '/api/workflow/http', { file, name: 'noSuchWorkflow', routes: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('noSuchWorkflow');
  });

  it('lists the project endpoints: workflows with routes, and those that could have them', async () => {
    const res = await api<{ workflows: unknown[]; candidates: Array<{ name: string }>; problems: unknown[]; serve: Body }>('GET', '/api/endpoints');
    expect(res.status).toBe(200);
    expect(res.body.workflows).toEqual([]);
    expect(res.body.candidates.map((c) => c.name)).toEqual(['durableApproval']);
    expect(res.body.serve).toMatchObject({ running: null, command: 'fw serve --trace' });
  });
});

describe('the guide', () => {
  it('answers nothing for a query shorter than two letters, and caps the limit', async () => {
    expect((await api('GET', q('/api/docs/search', { q: 'a' }))).body).toEqual([]);
    const many = await api<unknown[]>('GET', q('/api/docs/search', { q: 'workflow', limit: '1000' }));
    expect(many.body.length).toBeGreaterThan(0);
    expect(many.body.length).toBeLessThanOrEqual(80);
    const few = await api<unknown[]>('GET', q('/api/docs/search', { q: 'workflow', limit: '0' }));
    expect(few.body.length).toBeLessThanOrEqual(12);
  });

  it('reads a topic, and answers 404 for one that does not exist', async () => {
    const topics = await api<Array<{ slug: string }>>('GET', '/api/docs/topics');
    const slug = topics.body[0].slug;
    const topic = await api<Body>('GET', q('/api/docs/topic', { slug }));
    expect(topic.status).toBe(200);
    expect(topic.body).toMatchObject({ slug, markdown: expect.any(String), compact: expect.any(String) });
    expect((await api('GET', q('/api/docs/topic', { slug: 'no-such-topic' }))).status).toBe(404);
  });

  it('finds the section for an error code, and null for an unknown one', async () => {
    expect((await api<Body>('GET', q('/api/docs/error', { code: 'UNKNOWN_NODE_TYPE' }))).body).toMatchObject({ heading: expect.stringContaining('UNKNOWN_NODE_TYPE') });
    expect((await api('GET', q('/api/docs/error', { code: 'NOT_A_CODE_AT_ALL' }))).body).toBeNull();
  });
});

describe('agent profiles', () => {
  it('says whether a variable is set, never its value, and only for a variable name', async () => {
    process.env.FW_CONSOLE_ROUTES_TEST = 'secret-value';
    try {
      const set = await api<Body>('GET', q('/api/agents/env', { name: 'FW_CONSOLE_ROUTES_TEST' }));
      expect(set.body).toEqual({ name: 'FW_CONSOLE_ROUTES_TEST', set: true });
      expect(JSON.stringify(set.body)).not.toContain('secret-value');
      expect((await api<Body>('GET', q('/api/agents/env', { name: 'path' }))).body.set).toBe(false);
      expect((await api<Body>('GET', q('/api/agents/env', { name: 'NOT_SET_ANYWHERE_42' }))).body.set).toBe(false);
    } finally {
      delete process.env.FW_CONSOLE_ROUTES_TEST;
    }
  });

  it('adds a profile, makes the first one the default, and removes it again', async () => {
    const added = await api<{ agents: Array<{ name: string }>; default: string | null }>('PUT', '/api/agents/profiles/reviewer', { provider: 'anthropic', model: ' claude-test ', maxIterations: '5' });
    expect(added.status).toBe(200);
    expect(added.body.agents.map((a) => a.name)).toEqual(['reviewer']);
    expect(added.body.default).toBe('reviewer');

    const gated = await api<{ gates: Record<string, string> }>('PUT', '/api/agents/gates', { key: 'durableApproval/approve', profile: 'reviewer' });
    expect(gated.body.gates).toEqual({ 'durableApproval/approve': 'reviewer' });

    const removed = await api<{ agents: unknown[]; default: string | null; gates: Record<string, string> }>('DELETE', '/api/agents/profiles/reviewer');
    expect(removed.body).toMatchObject({ agents: [], default: null, gates: {} });
  });

  it('refuses a profile it cannot use, a default or gate naming no profile, and an empty gate key', async () => {
    expect((await api<Body>('PUT', '/api/agents/profiles/bad', { provider: 'nobody' })).body.error).toContain('provider');
    expect((await api<Body>('PUT', '/api/agents/profiles/bad', { provider: 'anthropic', maxIterations: 99 })).body.error).toContain('turns');
    expect((await api('PUT', '/api/agents/default', { name: 'ghost' })).status).toBe(400);
    expect((await api('PUT', '/api/agents/gates', { key: 'x', profile: 'ghost' })).status).toBe(400);
    expect((await api('PUT', '/api/agents/gates', { key: '   ' })).status).toBe(400);
    expect((await api('DELETE', '/api/agents/profiles/ghost')).status).toBe(404);
    expect((await api('POST', '/api/agents/try/ghost')).status).toBe(404);
  });
});

describe('services', () => {
  it('lists the services and their settings', async () => {
    const res = await api<{ services: unknown[]; settings: Body }>('GET', '/api/services');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.settings).sort()).toEqual(['serve', 'watch']);
  });

  it('answers 405 to a GET that would start or stop one', async () => {
    expect((await api('GET', '/api/services/serve/start')).status).toBe(405);
  });
});

describe('runs', () => {
  it('answers 404 for a run that does not exist, whatever is asked of it', async () => {
    for (const [method, p] of [['GET', '/api/runs/nope'], ['DELETE', '/api/runs/nope'], ['POST', '/api/runs/nope/cancel'], ['POST', '/api/runs/nope/resolve']]) {
      expect((await api(method, p, method === 'GET' || method === 'DELETE' ? undefined : {})).status, `${method} ${p}`).toBe(404);
    }
  });

  it('lists no runs for a fresh project', async () => {
    expect((await api('GET', '/api/runs')).body).toEqual([]);
  });
});

describe('request bodies', () => {
  it('answers 400 to a body over the size limit', async () => {
    const res = await api<Body>('POST', '/api/project', JSON.stringify({ dir: 'x'.repeat(1024 * 1024 + 10) }));
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('may not exceed');
  });
});
