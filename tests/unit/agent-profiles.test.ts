/**
 * Agent profiles: reading `.flowweaver/agents.yaml`, matching a gate to a
 * profile, and saying whether a profile can run here without a network call.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadAgentProfiles, saveAgentProfiles, validateProfile, profileForGate, readiness, agentsFile, keyEnvOf, STARTER_AGENTS_YAML } from '../../src/agent/profiles';

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-agents-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const write = (yaml: string) => {
  fs.mkdirSync(path.dirname(agentsFile(dir)), { recursive: true });
  fs.writeFileSync(agentsFile(dir), yaml);
};

describe('loadAgentProfiles', () => {
  it('reports a missing file as no profiles, without an error', () => {
    const p = loadAgentProfiles(dir);
    expect(p.exists).toBe(false);
    expect(p.agents).toEqual({});
    expect(p.errors).toEqual([]);
  });

  it('reads profiles, the default and the gate mapping', () => {
    write(`default: reviewer
agents:
  reviewer:
    provider: anthropic
    model: claude-sonnet-5
    system: Be terse.
    maxIterations: 4
  local:
    provider: openai
    baseUrl: http://localhost:11434/v1
    model: llama3
gates:
  review: reviewer
  figmaToPage/plan: local
`);
    const p = loadAgentProfiles(dir);
    expect(p.exists).toBe(true);
    expect(p.errors).toEqual([]);
    expect(p.default).toBe('reviewer');
    expect(p.agents.reviewer).toMatchObject({ name: 'reviewer', provider: 'anthropic', model: 'claude-sonnet-5', system: 'Be terse.', maxIterations: 4 });
    expect(p.agents.local.baseUrl).toBe('http://localhost:11434/v1');
    expect(p.gates).toEqual({ review: 'reviewer', 'figmaToPage/plan': 'local' });
  });

  it('names what is wrong and keeps what is right', () => {
    write(`default: nobody
agents:
  ok: { provider: openai }
  bad: { provider: gemini }
  worse: 12
gates:
  x: missing
  y: ok
`);
    const p = loadAgentProfiles(dir);
    expect(Object.keys(p.agents)).toEqual(['ok']);
    expect(p.default).toBeUndefined();
    expect(p.gates).toEqual({ y: 'ok' });
    expect(p.errors.join('\n')).toMatch(/default names an unknown profile: nobody/);
    expect(p.errors.join('\n')).toMatch(/agents\.bad\.provider must be one of/);
    expect(p.errors.join('\n')).toMatch(/agents\.worse must be a mapping/);
    expect(p.errors.join('\n')).toMatch(/gates\.x names an unknown profile: missing/);
  });

  it('reports a file that does not parse', () => {
    write('agents: [\n  - :');
    const p = loadAgentProfiles(dir);
    expect(p.exists).toBe(true);
    expect(p.errors[0]).toMatch(/could not parse/);
  });

  it('accepts its own starter file', () => {
    write(STARTER_AGENTS_YAML);
    const p = loadAgentProfiles(dir);
    expect(p.errors).toEqual([]);
    expect(p.default).toBe('assistant');
    expect(p.agents.assistant.provider).toBe('anthropic');
  });
});

describe('profileForGate', () => {
  const profiles = () => {
    write(`default: fallback
agents:
  fallback: { provider: openai }
  reviewer: { provider: anthropic }
  planner: { provider: claude-cli }
gates:
  review: reviewer
  figmaToPage/plan: planner
`);
    return loadAgentProfiles(dir);
  };

  it('matches workflow/node before agentId before the default', () => {
    const p = profiles();
    expect(profileForGate(p, { workflow: 'figmaToPage', node: 'plan', agentId: 'review' })?.name).toBe('planner');
    expect(profileForGate(p, { workflow: 'other', node: 'agent', agentId: 'review' })?.name).toBe('reviewer');
    expect(profileForGate(p, { workflow: 'other', node: 'agent', agentId: 'unknown' })?.name).toBe('fallback');
    expect(profileForGate(p, { workflow: 'other', node: 'agent', agentId: null })?.name).toBe('fallback');
  });

  it('leaves the gate to a person when nothing matches and there is no default', () => {
    write(`agents:\n  reviewer: { provider: anthropic }\ngates:\n  review: reviewer\n`);
    const p = loadAgentProfiles(dir);
    expect(profileForGate(p, { workflow: 'w', node: 'n', agentId: 'other' })).toBeUndefined();
  });
});

describe('readiness', () => {
  it('needs the named key in the environment for API providers', () => {
    const anthropic = { name: 'a', provider: 'anthropic' as const };
    expect(readiness(anthropic, {})).toMatchObject({ ready: false, keyEnv: 'ANTHROPIC_API_KEY' });
    expect(readiness(anthropic, { ANTHROPIC_API_KEY: 'sk' })).toMatchObject({ ready: true, keyEnv: 'ANTHROPIC_API_KEY' });
    const custom = { name: 'b', provider: 'openai' as const, apiKeyEnv: 'GROQ_KEY' };
    expect(keyEnvOf(custom)).toBe('GROQ_KEY');
    expect(readiness(custom, { OPENAI_API_KEY: 'x' }).ready).toBe(false);
    expect(readiness(custom, { GROQ_KEY: 'x' }).ready).toBe(true);
  });

  it('lets an OpenAI-compatible base URL run without a key', () => {
    const local = { name: 'l', provider: 'openai' as const, baseUrl: 'http://localhost:11434/v1' };
    const r = readiness(local, {});
    expect(r.ready).toBe(true);
    expect(r.reason).toMatch(/not needed with a base URL/);
  });

  it('looks for the claude binary on PATH, or at the given path', () => {
    const bin = path.join(dir, 'claude');
    fs.writeFileSync(bin, '#!/bin/sh\n');
    expect(readiness({ name: 'c', provider: 'claude-cli' }, { PATH: dir }).ready).toBe(true);
    expect(readiness({ name: 'c', provider: 'claude-cli' }, { PATH: '/nonexistent' })).toMatchObject({ ready: false });
    expect(readiness({ name: 'c', provider: 'claude-cli', bin }, { PATH: '' }).ready).toBe(true);
  });
});

describe('saveAgentProfiles', () => {
  it('writes what loadAgentProfiles reads back, and drops empty fields', () => {
    saveAgentProfiles(dir, {
      default: 'reviewer',
      agents: {
        reviewer: { name: 'reviewer', provider: 'anthropic', model: 'claude-sonnet-5', apiKeyEnv: 'ANTHROPIC_API_KEY', system: 'Be terse.\nAlways.', maxIterations: 4, baseUrl: '', description: undefined },
        local: { name: 'local', provider: 'openai', baseUrl: 'http://localhost:11434/v1', model: 'llama3' },
      },
      gates: { review: 'reviewer', 'figmaToPage/plan': 'local' },
    });
    const text = fs.readFileSync(agentsFile(dir), 'utf8');
    expect(text.startsWith('# Agent profiles')).toBe(true);
    expect(text).not.toMatch(/baseUrl: ""/);
    const p = loadAgentProfiles(dir);
    expect(p.errors).toEqual([]);
    expect(p.default).toBe('reviewer');
    expect(p.agents.reviewer).toMatchObject({ provider: 'anthropic', model: 'claude-sonnet-5', apiKeyEnv: 'ANTHROPIC_API_KEY', system: 'Be terse.\nAlways.', maxIterations: 4 });
    expect(p.agents.reviewer.baseUrl).toBeUndefined();
    expect(p.agents.local).toMatchObject({ provider: 'openai', baseUrl: 'http://localhost:11434/v1' });
    expect(p.gates).toEqual({ review: 'reviewer', 'figmaToPage/plan': 'local' });
  });

  it('does not write a default that names no profile, and omits an empty gates map', () => {
    saveAgentProfiles(dir, { default: 'gone', agents: { a: { name: 'a', provider: 'openai' } }, gates: {} });
    const p = loadAgentProfiles(dir);
    expect(p.default).toBeUndefined();
    expect(p.errors).toEqual([]);
    expect(fs.readFileSync(agentsFile(dir), 'utf8')).not.toMatch(/gates:/);
  });
});

describe('validateProfile', () => {
  it('accepts a sane profile and names each problem otherwise', () => {
    expect(validateProfile({ name: 'reviewer', provider: 'anthropic', apiKeyEnv: 'MY_KEY', maxIterations: 8 })).toEqual([]);
    const bad = validateProfile({ name: '9x', provider: 'gemini' as never, apiKeyEnv: 'my key', baseUrl: 'localhost:1', maxIterations: 0 });
    expect(bad.join('\n')).toMatch(/name is letters/);
    expect(bad.join('\n')).toMatch(/pick a provider/);
    expect(bad.join('\n')).toMatch(/environment variable name/);
    expect(bad.join('\n')).toMatch(/turns is a whole number/);
    // The base URL rule only applies to the openai provider.
    expect(validateProfile({ name: 'l', provider: 'openai', baseUrl: 'localhost:11434' }).join('\n')).toMatch(/base URL starts with/);
  });
});
