/**
 * `fw agents`: says there is no file and how to get one, writes the starter
 * with --init and refuses to overwrite it, and reports each profile's
 * readiness from the environment without ever printing a key.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { agentsCommand } from '../../src/cli/commands/agents.js';

let dir: string;
let out: string[];
let origLog: typeof console.log;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-agents-cmd-'));
  out = [];
  origLog = console.log;
  console.log = vi.fn((...a: unknown[]) => { out.push(a.map(String).join(' ')); }) as typeof console.log;
});
afterEach(() => {
  console.log = origLog;
  fs.rmSync(dir, { recursive: true, force: true });
});

const json = () => JSON.parse(out.join('\n'));

describe('fw agents', () => {
  it('reports no file, then writes the starter and refuses to overwrite it', async () => {
    await agentsCommand(dir, { json: true });
    expect(json()).toMatchObject({ exists: false, profiles: [], default: null });

    await agentsCommand(dir, { init: true, json: true });
    const file = path.join(dir, '.flowweaver', 'agents.yaml');
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.readFileSync(file, 'utf8')).toContain('agents:');

    await expect(agentsCommand(dir, { init: true })).rejects.toThrow(/already exists/);
    fs.writeFileSync(file, 'default: x\nagents:\n  x:\n    provider: anthropic\n');
    await agentsCommand(dir, { init: true, force: true, json: true });
    expect(fs.readFileSync(file, 'utf8')).not.toContain('default: x');
  });

  it('lists profiles with their readiness and never a key', async () => {
    fs.mkdirSync(path.join(dir, '.flowweaver'));
    fs.writeFileSync(path.join(dir, '.flowweaver', 'agents.yaml'), 'default: reviewer\nagents:\n  reviewer:\n    provider: anthropic\n    apiKeyEnv: FW_TEST_AGENT_KEY\n  local:\n    provider: openai\n    baseUrl: http://localhost:11434/v1\ngates:\n  reviewFile/agent: local\n');
    const previous = process.env.FW_TEST_AGENT_KEY;
    process.env.FW_TEST_AGENT_KEY = 'sk-secret-value';
    try {
      out = [];
      await agentsCommand(dir, { json: true });
      const r = json();
      expect(r.default).toBe('reviewer');
      expect(r.profiles).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'reviewer', provider: 'anthropic', keyEnv: 'FW_TEST_AGENT_KEY', ready: true, isDefault: true }),
        expect.objectContaining({ name: 'local', provider: 'openai', ready: true, isDefault: false }),
      ]));
      expect(r.gates).toEqual({ 'reviewFile/agent': 'local' });
      expect(out.join('\n')).not.toContain('sk-secret-value');

      delete process.env.FW_TEST_AGENT_KEY;
      out = [];
      await agentsCommand(dir, { json: true });
      const reviewer = json().profiles.find((p: { name: string }) => p.name === 'reviewer');
      expect(reviewer.ready).toBe(false);
      expect(reviewer.reason).toContain('FW_TEST_AGENT_KEY');
    } finally {
      if (previous === undefined) delete process.env.FW_TEST_AGENT_KEY; else process.env.FW_TEST_AGENT_KEY = previous;
    }
  });
});
