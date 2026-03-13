/**
 * Coverage tests for src/cli/commands/mcp-setup.ts
 * Targets uncovered lines: 404, 447-485, 493
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { McpSetupDeps, ToolId } from '../../src/cli/commands/mcp-setup';

// Mock @inquirer/confirm at module level (required because isolate: false)
const mockConfirm = vi.fn();
vi.mock('@inquirer/confirm', () => ({ default: mockConfirm }));

function makeDeps(overrides: Partial<McpSetupDeps> = {}): McpSetupDeps {
  return {
    execCommand: vi.fn().mockResolvedValue({ stdout: '', exitCode: 1 }),
    fileExists: vi.fn().mockResolvedValue(false),
    readFile: vi.fn().mockResolvedValue(null),
    writeFile: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
    cwd: () => '/fake/project',
    homedir: () => '/fake/home',
    log: vi.fn(),
    ...overrides,
  };
}

/** Helper to make deps where cursor is detected (via .cursor dir) but not configured */
function makeCursorDetectedDeps(overrides: Partial<McpSetupDeps> = {}): McpSetupDeps {
  return makeDeps({
    execCommand: vi.fn().mockImplementation(async (cmd: string) => {
      if (cmd.includes('which cursor') || cmd.includes('where cursor'))
        return { stdout: '/usr/bin/cursor', exitCode: 0 };
      return { stdout: '', exitCode: 1 };
    }),
    fileExists: vi.fn().mockImplementation(async (p: string) => {
      if (p.endsWith('.cursor')) return true;
      return false;
    }),
    readFile: vi.fn().mockResolvedValue(null),
    ...overrides,
  });
}

describe('detectCliTools', () => {
  it('returns empty array when no CLI binaries found on PATH (line 404)', async () => {
    const { detectCliTools } = await import('../../src/cli/commands/mcp-setup');
    const deps = makeDeps();
    const result = await detectCliTools(deps);
    expect(result).toEqual([]);
  });

  it('returns tool IDs for binaries that exist on PATH', async () => {
    const { detectCliTools } = await import('../../src/cli/commands/mcp-setup');
    const deps = makeDeps({
      execCommand: vi.fn().mockImplementation(async (cmd: string) => {
        if (cmd.includes('claude')) return { stdout: '/usr/bin/claude', exitCode: 0 };
        return { stdout: '', exitCode: 1 };
      }),
    });
    const result = await detectCliTools(deps);
    expect(result).toContain('claude');
  });
});

describe('mcpSetupCommand — non-interactive branch (lines 447-449)', () => {
  let origIsTTY: boolean | undefined;

  beforeEach(() => {
    origIsTTY = process.stdin.isTTY;
  });

  afterEach(() => {
    (process.stdin as any).isTTY = origIsTTY;
  });

  it('auto-configures all detected tools in non-TTY mode', async () => {
    const { mcpSetupCommand } = await import('../../src/cli/commands/mcp-setup');

    // Make isNonInteractive() return true
    (process.stdin as any).isTTY = undefined;

    const deps = makeCursorDetectedDeps();
    await mcpSetupCommand({}, deps);

    const logCalls = (deps.log as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0]);
    expect(deps.writeFile).toHaveBeenCalled();
    expect(logCalls.some((m: string) => m.includes('Done.'))).toBe(true);
  });
});

describe('mcpSetupCommand — interactive confirm branch (lines 450-485)', () => {
  let origIsTTY: boolean | undefined;

  beforeEach(() => {
    origIsTTY = process.stdin.isTTY;
    mockConfirm.mockReset();
  });

  afterEach(() => {
    (process.stdin as any).isTTY = origIsTTY;
  });

  it('shows detected tools and handles user confirmation in interactive mode', async () => {
    const { mcpSetupCommand } = await import('../../src/cli/commands/mcp-setup');

    // Make isNonInteractive() return false
    (process.stdin as any).isTTY = true;
    mockConfirm.mockResolvedValue(true);

    const deps = makeCursorDetectedDeps();
    await mcpSetupCommand({}, deps);

    const logCalls = (deps.log as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0]);
    expect(logCalls.some((m: string) => typeof m === 'string' && m.includes('Detected tools'))).toBe(true);
    expect(logCalls.some((m: string) => m.includes('Done.'))).toBe(true);
  });

  it('prints "No tools selected." when user declines all (line 493)', async () => {
    const { mcpSetupCommand } = await import('../../src/cli/commands/mcp-setup');

    (process.stdin as any).isTTY = true;
    mockConfirm.mockResolvedValue(false);

    const deps = makeCursorDetectedDeps();
    await mcpSetupCommand({}, deps);

    const logCalls = (deps.log as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0]);
    expect(logCalls.some((m: string) => m.includes('No tools selected'))).toBe(true);
  });

  it('skips already-configured tools with message during interactive confirm', async () => {
    const { mcpSetupCommand } = await import('../../src/cli/commands/mcp-setup');

    (process.stdin as any).isTTY = true;
    mockConfirm.mockResolvedValue(true);

    const deps = makeCursorDetectedDeps({
      readFile: vi.fn().mockImplementation(async (p: string) => {
        if (p.includes('mcp.json')) {
          return JSON.stringify({ mcpServers: { 'flow-weaver': {} } });
        }
        return null;
      }),
    });

    await mcpSetupCommand({}, deps);

    const logCalls = (deps.log as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0]);
    expect(logCalls.some((m: string) => typeof m === 'string' && m.includes('already configured'))).toBe(true);
  });

  it('returns silently when user presses Ctrl+C (ExitPromptError)', async () => {
    const { ExitPromptError } = await import('@inquirer/core');
    const { mcpSetupCommand } = await import('../../src/cli/commands/mcp-setup');

    (process.stdin as any).isTTY = true;
    mockConfirm.mockRejectedValue(new ExitPromptError(''));

    const deps = makeCursorDetectedDeps();
    // Should not throw
    await mcpSetupCommand({}, deps);
  });

  it('shows "no detected tools" message in interactive mode when none found', async () => {
    const { mcpSetupCommand } = await import('../../src/cli/commands/mcp-setup');

    (process.stdin as any).isTTY = true;

    // No tools detected
    const deps = makeDeps();
    await mcpSetupCommand({}, deps);

    const logCalls = (deps.log as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0]);
    expect(logCalls.some((m: string) => m.includes('No AI coding tools detected'))).toBe(true);
  });
});

describe('mcpSetupCommand — --all flag (line 446)', () => {
  it('configures all detected tools when --all is passed', async () => {
    const { mcpSetupCommand } = await import('../../src/cli/commands/mcp-setup');
    const deps = makeCursorDetectedDeps();

    await mcpSetupCommand({ all: true }, deps);

    expect(deps.writeFile).toHaveBeenCalled();
    const logCalls = (deps.log as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0]);
    expect(logCalls.some((m: string) => m.includes('Done.'))).toBe(true);
  });
});
