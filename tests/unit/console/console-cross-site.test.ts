/**
 * A running console refuses what a web page in the person's browser could
 * send it: a change from another origin, and any request under a rebound
 * DNS name. Its own page, and clients that are not browsers, still work.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { createConsoleServer, type ConsoleServer } from '../../../src/console/server.js';
import { createMemoryRunStore } from '../../../src/coordinator/index.js';

let project: string;
let elsewhere: string;
let assets: string;
let server: ConsoleServer;

/** node:http, because fetch will not let a test choose the Host header. */
function send(method: string, p: string, headers: Record<string, string>, body?: string): Promise<{ status: number; body: string }> {
  const { port } = new URL(server.url);
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, method, path: p, headers }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: text }));
    });
    r.on('error', reject);
    r.end(body);
  });
}

beforeAll(async () => {
  project = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-console-xsite-'));
  elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-console-xsite-other-'));
  assets = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-console-xsite-assets-'));
  fs.writeFileSync(path.join(assets, 'index.html'), '<!doctype html>');
  fs.writeFileSync(path.join(assets, 'app.js'), '');
  server = await createConsoleServer({ projectDir: project, port: 0, watch: false, assetsDir: assets, store: createMemoryRunStore() });
}, 60000);

afterAll(async () => {
  await server.close();
  for (const d of [project, elsewhere, assets]) fs.rmSync(d, { recursive: true, force: true });
});

const own = () => new URL(server.url).host;
const currentProject = async () => JSON.parse((await send('GET', '/api/project', { host: own() })).body).dir as string;

describe('the console against a web page in the same browser', () => {
  it('refuses a plain-text POST from another site, and changes nothing', async () => {
    const res = await send('POST', '/api/project', { host: own(), origin: 'https://attacker.example', 'content-type': 'text/plain' }, JSON.stringify({ dir: elsewhere }));
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body).error).toMatch(/origin/);
    expect(await currentProject()).toBe(project);
  });

  it('refuses to start a command from another site', async () => {
    const res = await send('POST', '/api/cli/run', { host: own(), origin: 'null', 'content-type': 'text/plain' }, JSON.stringify({ argv: ['--version'] }));
    expect(res.status).toBe(403);
  });

  it('refuses a read under a rebound name', async () => {
    const res = await send('GET', '/api/project', { host: `attacker.example:${new URL(server.url).port}` });
    expect(res.status).toBe(403);
    expect(res.body).not.toContain(project);
  });

  it('serves its own page, and takes a change from it', async () => {
    expect((await send('GET', '/', { host: own() })).status).toBe(200);
    const res = await send('POST', '/api/project', { host: own(), origin: `http://${own()}`, 'content-type': 'application/json' }, JSON.stringify({ dir: elsewhere }));
    expect(res.status).toBe(200);
    expect(fs.realpathSync(await currentProject())).toBe(fs.realpathSync(elsewhere));
    await send('POST', '/api/project', { host: own(), 'content-type': 'application/json' }, JSON.stringify({ dir: project }));
  });
});
