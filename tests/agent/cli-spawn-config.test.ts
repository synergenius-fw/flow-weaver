/**
 * Tests for centralized CLI spawn configuration.
 * Ensures tool lockdown args are always present and cannot be bypassed.
 */

import { describe, it, expect } from 'vitest';
import { getCliBaseArgs, getCliSessionConfig } from '../../src/agent/cli-spawn-config.js';

describe('getCliBaseArgs', () => {
  it('always includes only the current --allowed-tools "" contract', () => {
    const args = getCliBaseArgs();
    const idx = args.indexOf('--allowed-tools');
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe('');
    expect(args).not.toContain('--tools');
  });

  it('always includes --strict-mcp-config', () => {
    expect(getCliBaseArgs()).toContain('--strict-mcp-config');
  });

  it('always includes --dangerously-skip-permissions', () => {
    expect(getCliBaseArgs()).toContain('--dangerously-skip-permissions');
  });

  it('always includes -p', () => {
    expect(getCliBaseArgs()).toContain('-p');
  });

  it('passes model when provided', () => {
    const args = getCliBaseArgs({ model: 'claude-sonnet-4-6' });
    const idx = args.indexOf('--model');
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe('claude-sonnet-4-6');
  });

  it('passes outputFormat when provided', () => {
    const args = getCliBaseArgs({ outputFormat: 'stream-json' });
    expect(args).toContain('--output-format');
    expect(args[args.indexOf('--output-format') + 1]).toBe('stream-json');
  });

  it('passes jsonSchema when provided', () => {
    const args = getCliBaseArgs({ jsonSchema: '{"type":"object"}' });
    expect(args).toContain('--json-schema');
  });

  it('passes appendSystemPrompt when provided', () => {
    const args = getCliBaseArgs({ appendSystemPrompt: 'You are Weaver.' });
    expect(args).toContain('--append-system-prompt');
    expect(args[args.indexOf('--append-system-prompt') + 1]).toBe('You are Weaver.');
  });
});

describe('getCliSessionConfig', () => {
  it('always sets allowedTools to an empty list', () => {
    const config = getCliSessionConfig({ cwd: '/tmp', model: 'test' });
    expect(config.allowedTools).toEqual([]);
    expect(config).not.toHaveProperty('tools');
  });

  it('always sets strictMcpConfig to true', () => {
    const config = getCliSessionConfig({ cwd: '/tmp', model: 'test' });
    expect(config.strictMcpConfig).toBe(true);
  });

  it('passes through cwd and model', () => {
    const config = getCliSessionConfig({ cwd: '/workspace', model: 'claude-opus-4-6' });
    expect(config.cwd).toBe('/workspace');
    expect(config.model).toBe('claude-opus-4-6');
  });

  it('defaults binPath to claude', () => {
    const config = getCliSessionConfig({ cwd: '/tmp', model: 'test' });
    expect(config.binPath).toBe('claude');
  });

  it('passes through mcpConfigPath', () => {
    const config = getCliSessionConfig({ cwd: '/tmp', model: 'test', mcpConfigPath: '/mcp.json' });
    expect(config.mcpConfigPath).toBe('/mcp.json');
  });

  it('passes through disallowedTools', () => {
    const config = getCliSessionConfig({ cwd: '/tmp', model: 'test', disallowedTools: ['mcp__x__y'] });
    expect(config.disallowedTools).toEqual(['mcp__x__y']);
  });
});
