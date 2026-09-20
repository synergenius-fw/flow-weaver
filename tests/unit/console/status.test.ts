/**
 * What the console can say about the services around a project: which
 * editors registered the MCP server and from which install, and whether a
 * registry answers with the token it was given.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeAll, afterAll, vi, afterEach } from 'vitest';
import { installVerdict, mcpRegistrations, registryStatuses } from '../../../src/console/status';

let home: string;
let project: string;
let here: string;

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-home-'));
  project = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-proj-'));
  here = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-install-'));
  fs.mkdirSync(path.join(here, 'dist', 'cli'), { recursive: true });
  fs.writeFileSync(path.join(here, 'package.json'), '{"name":"@synergenius/flow-weaver"}');
  fs.writeFileSync(path.join(here, 'dist', 'cli', 'flow-weaver.mjs'), '');
});
afterAll(() => { for (const d of [home, project, here]) fs.rmSync(d, { recursive: true, force: true }); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('installVerdict', () => {
  it('reads npx of the package as whatever npm serves', () => {
    expect(installVerdict('npx', ['@synergenius/flow-weaver@latest', 'mcp-server', '--stdio'], here)).toEqual({ runs: 'npm latest' });
  });

  it('recognises this install by the entry file, through the package root', () => {
    expect(installVerdict('node', [path.join(here, 'dist', 'cli', 'flow-weaver.mjs'), 'mcp-server', '--stdio'], here)).toMatchObject({ runs: 'this install', install: fs.realpathSync(here) });
  });

  it('tells another install apart', () => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-other-'));
    fs.writeFileSync(path.join(other, 'package.json'), '{}');
    fs.mkdirSync(path.join(other, 'dist', 'cli'), { recursive: true });
    const v = installVerdict('node', [path.join(other, 'dist', 'cli', 'flow-weaver.mjs')], here);
    expect(v.runs).toBe('other install');
    fs.rmSync(other, { recursive: true, force: true });
  });

  it('says unknown when the command names nothing it can place', () => {
    expect(installVerdict('fw', ['mcp-server', '--stdio'], here)).toEqual({ runs: 'unknown' });
  });
});

describe('mcpRegistrations', () => {
  it('reads every editor file fw mcp-setup writes, and the Claude Code scopes', () => {
    const entry = { command: 'npx', args: ['@synergenius/flow-weaver@latest', 'mcp-server', '--stdio'] };
    fs.writeFileSync(path.join(project, '.mcp.json'), JSON.stringify({ mcpServers: { 'flow-weaver': entry } }));
    fs.mkdirSync(path.join(project, '.cursor'), { recursive: true });
    fs.writeFileSync(path.join(project, '.cursor', 'mcp.json'), JSON.stringify({ mcpServers: { 'flow-weaver': { command: 'node', args: [path.join(here, 'dist', 'cli', 'flow-weaver.mjs'), 'mcp-server', '--stdio'] } } }));
    fs.mkdirSync(path.join(project, '.vscode'), { recursive: true });
    fs.writeFileSync(path.join(project, '.vscode', 'mcp.json'), JSON.stringify({ servers: { 'flow-weaver': entry, other: { command: 'x' } } }));
    fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ mcpServers: { 'flow-weaver': entry }, projects: { [project]: { mcpServers: { 'flow-weaver': entry } } } }));
    fs.mkdirSync(path.join(home, '.codeium', 'windsurf'), { recursive: true });
    fs.writeFileSync(path.join(home, '.codeium', 'windsurf', 'mcp_config.json'), '{not json');

    const regs = mcpRegistrations(project, home, here);
    expect(regs.map((r) => [r.tool, r.runs])).toEqual([
      ['Claude Code (project)', 'npm latest'],
      ['Claude Code (user)', 'npm latest'],
      ['Claude Code (this project)', 'npm latest'],
      ['Cursor', 'this install'],
      ['VS Code', 'npm latest'],
    ]);
  });

  it('is empty where nothing is registered', () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-bare-'));
    expect(mcpRegistrations(bare, bare, here)).toEqual([]);
    fs.rmSync(bare, { recursive: true, force: true });
  });
});

describe('registryStatuses', () => {
  it('asks each registry who we are, with its token, and reads the answer', async () => {
    const calls: Array<{ url: string; auth?: string }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, auth: (init?.headers as Record<string, string>)?.Authorization });
      if (url.startsWith('https://npm.example.com/')) return { ok: true, status: 200, json: async () => ({ username: 'me' }) } as Response;
      return { ok: false, status: 401, json: async () => ({}) } as Response;
    }));
    const out = await registryStatuses('/p', [
      { url: 'https://registry.npmjs.org/', scopes: [], isDefault: true },
      { url: 'https://npm.example.com/', scopes: ['@acme'], isDefault: false, authorization: 'Bearer t' },
    ]);
    expect(calls.map((c) => c.url)).toEqual(['https://registry.npmjs.org/-/whoami', 'https://npm.example.com/-/whoami']);
    expect(calls[1].auth).toBe('Bearer t');
    // The public registry is reachable although anonymous whoami is refused.
    expect(out[0]).toMatchObject({ ok: true, status: 401, authenticated: false });
    expect(out[1]).toMatchObject({ ok: true, status: 200, authenticated: true, user: 'me' });
  });

  it('reports a registry that does not answer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    const out = await registryStatuses('/p', [{ url: 'https://down.example/', scopes: [], isDefault: true }]);
    expect(out[0]).toMatchObject({ ok: false, error: 'ECONNREFUSED' });
  });
});
