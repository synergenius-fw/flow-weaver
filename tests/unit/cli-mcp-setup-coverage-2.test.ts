/**
 * Additional coverage tests for src/cli/commands/mcp-setup.ts
 * Targets uncovered lines: 294 (openclaw isConfigured JSON parse catch),
 * 354-387 (runMcpSetupFromInit full flow), 482 (ExitPromptError in interactive confirm).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { McpSetupDeps } from '../../src/cli/commands/mcp-setup';

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

afterEach(() => {
  vi.restoreAllMocks();
});

// ── OpenClaw isConfigured JSON parse catch (line 294) ────────────────────────

describe('openclaw isConfigured coverage', () => {
  it('should return false when openclaw.json has invalid JSON', async () => {
    const { detectTools } = await import('../../src/cli/commands/mcp-setup');

    const deps = makeDeps({
      fileExists: vi.fn().mockImplementation(async (p: string) => {
        // openclaw.json exists
        if (p.endsWith('openclaw.json')) return true;
        return false;
      }),
      readFile: vi.fn().mockImplementation(async (p: string) => {
        if (p.endsWith('openclaw.json')) return '{ invalid json !!!';
        return null;
      }),
    });

    const results = await detectTools(deps);
    const openclaw = results.find((r) => r.id === 'openclaw');
    expect(openclaw).toBeDefined();
    expect(openclaw!.detected).toBe(true);
    expect(openclaw!.configured).toBe(false);
  });

  it('should return true when openclaw.json is configured', async () => {
    const { detectTools } = await import('../../src/cli/commands/mcp-setup');

    const deps = makeDeps({
      fileExists: vi.fn().mockImplementation(async (p: string) => {
        if (p.endsWith('openclaw.json')) return true;
        return false;
      }),
      readFile: vi.fn().mockImplementation(async (p: string) => {
        if (p.endsWith('openclaw.json')) {
          return JSON.stringify({ mcpServers: { 'flow-weaver': {} } });
        }
        return null;
      }),
    });

    const results = await detectTools(deps);
    const openclaw = results.find((r) => r.id === 'openclaw');
    expect(openclaw!.detected).toBe(true);
    expect(openclaw!.configured).toBe(true);
  });
});

// ── runMcpSetupFromInit (lines 354-387) ──────────────────────────────────────

describe('runMcpSetupFromInit coverage', () => {
  it('should detect and configure tools, returning configured and failed lists', async () => {
    const { runMcpSetupFromInit } = await import('../../src/cli/commands/mcp-setup');

    const deps = makeDeps({
      fileExists: vi.fn().mockImplementation(async (p: string) => {
        // Cursor detected via .cursor dir
        if (p.endsWith('.cursor')) return true;
        return false;
      }),
      readFile: vi.fn().mockResolvedValue(null),
      writeFile: vi.fn().mockResolvedValue(undefined),
      mkdir: vi.fn().mockResolvedValue(undefined),
    });

    const result = await runMcpSetupFromInit(deps);

    expect(result.configured).toBeDefined();
    expect(result.failed).toBeDefined();
    expect(result.detected).toBeDefined();
    expect(Array.isArray(result.cliTools)).toBe(true);
    expect(Array.isArray(result.guiTools)).toBe(true);
    // Cursor is a GUI tool
    expect(result.detected.some((d) => d.id === 'cursor' && d.detected)).toBe(true);
  });

  it('should include already-configured tools in the configured list', async () => {
    const { runMcpSetupFromInit } = await import('../../src/cli/commands/mcp-setup');

    const deps = makeDeps({
      fileExists: vi.fn().mockImplementation(async (p: string) => {
        if (p.endsWith('.cursor')) return true;
        return false;
      }),
      readFile: vi.fn().mockImplementation(async (p: string) => {
        // Cursor is already configured
        if (p.endsWith('mcp.json')) {
          return JSON.stringify({ mcpServers: { 'flow-weaver': {} } });
        }
        return null;
      }),
    });

    const result = await runMcpSetupFromInit(deps);

    // Cursor should show as already configured
    expect(result.configured).toContain('Cursor');
  });

  it('should report failed tools when configure throws', async () => {
    const { runMcpSetupFromInit } = await import('../../src/cli/commands/mcp-setup');

    const deps = makeDeps({
      fileExists: vi.fn().mockImplementation(async (p: string) => {
        if (p.endsWith('.cursor')) return true;
        return false;
      }),
      readFile: vi.fn().mockResolvedValue(null),
      writeFile: vi.fn().mockRejectedValue(new Error('EACCES')),
      mkdir: vi.fn().mockResolvedValue(undefined),
    });

    const result = await runMcpSetupFromInit(deps);

    expect(result.failed.length).toBeGreaterThan(0);
  });

  it('should use default deps when none provided', async () => {
    const { runMcpSetupFromInit } = await import('../../src/cli/commands/mcp-setup');

    // With default deps, it checks the real filesystem, so results depend
    // on the machine. Just verify it returns the expected shape.
    const result = await runMcpSetupFromInit();

    expect(result).toHaveProperty('configured');
    expect(result).toHaveProperty('failed');
    expect(result).toHaveProperty('detected');
    expect(result).toHaveProperty('cliTools');
    expect(result).toHaveProperty('guiTools');
  });

  it('should classify CLI tools (claude, codex) vs GUI tools correctly', async () => {
    const { runMcpSetupFromInit } = await import('../../src/cli/commands/mcp-setup');

    const deps = makeDeps({
      execCommand: vi.fn().mockImplementation(async (cmd: string) => {
        // Claude binary exists
        if (cmd.includes('claude')) return { stdout: '/usr/bin/claude', exitCode: 0 };
        return { stdout: '', exitCode: 1 };
      }),
      fileExists: vi.fn().mockImplementation(async (p: string) => {
        // Cursor detected too
        if (p.endsWith('.cursor')) return true;
        return false;
      }),
      readFile: vi.fn().mockResolvedValue(null),
      writeFile: vi.fn().mockResolvedValue(undefined),
      mkdir: vi.fn().mockResolvedValue(undefined),
    });

    const result = await runMcpSetupFromInit(deps);

    // Claude is a CLI tool
    expect(result.cliTools).toContain('claude');
    // Cursor is a GUI tool
    expect(result.guiTools).toContain('cursor');
  });
});

// ── Windsurf isConfigured with invalid JSON (similar pattern to openclaw) ────

describe('windsurf isConfigured coverage', () => {
  it('should return false when windsurf mcp_config.json has invalid JSON', async () => {
    const { detectTools } = await import('../../src/cli/commands/mcp-setup');

    const deps = makeDeps({
      fileExists: vi.fn().mockImplementation(async (p: string) => {
        if (p.includes('.codeium/windsurf')) return true;
        return false;
      }),
      readFile: vi.fn().mockImplementation(async (p: string) => {
        if (p.includes('mcp_config.json')) return 'not json';
        return null;
      }),
    });

    const results = await detectTools(deps);
    const windsurf = results.find((r) => r.id === 'windsurf');
    expect(windsurf).toBeDefined();
    expect(windsurf!.detected).toBe(true);
    expect(windsurf!.configured).toBe(false);
  });
});

// ── Codex configure failure ──────────────────────────────────────────────────

describe('codex configure coverage', () => {
  it('should report failure when codex mcp add fails', async () => {
    const { runMcpSetupFromInit } = await import('../../src/cli/commands/mcp-setup');

    const deps = makeDeps({
      execCommand: vi.fn().mockImplementation(async (cmd: string) => {
        if (cmd.includes('which codex') || cmd.includes('where codex'))
          return { stdout: '/usr/bin/codex', exitCode: 0 };
        if (cmd.includes('codex mcp list'))
          return { stdout: '', exitCode: 1 };
        if (cmd.includes('codex mcp add'))
          return { stdout: '', exitCode: 1 };
        return { stdout: '', exitCode: 1 };
      }),
    });

    const result = await runMcpSetupFromInit(deps);
    // Codex configure should fail
    expect(result.failed).toContain('Codex');
  });
});
