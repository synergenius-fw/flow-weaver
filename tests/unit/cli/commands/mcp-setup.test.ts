import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  mcpSetupCommand,
  detectTools,
  mergeJsonConfig,
  TOOL_REGISTRY,
  type McpSetupDeps,
  type ToolId,
} from '../../../../src/cli/commands/mcp-setup';

function createMockDeps(overrides?: Partial<McpSetupDeps>): McpSetupDeps {
  return {
    execCommand: vi.fn().mockResolvedValue({ stdout: '', exitCode: 1 }),
    fileExists: vi.fn().mockResolvedValue(false),
    readFile: vi.fn().mockResolvedValue(null),
    writeFile: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
    cwd: () => '/project',
    homedir: () => '/home/user',
    log: vi.fn(),
    ...overrides,
  };
}

// Helper: make execCommand return success for specific binaries
function mockWhich(deps: McpSetupDeps, binaries: string[]) {
  const exec = deps.execCommand as ReturnType<typeof vi.fn>;
  exec.mockImplementation(async (cmd: string) => {
    // which/where commands
    for (const bin of binaries) {
      if (cmd === `which ${bin}` || cmd === `where ${bin}`) {
        return { stdout: `/usr/bin/${bin}`, exitCode: 0 };
      }
    }
    // claude mcp list / codex mcp list
    if (cmd === 'claude mcp list' || cmd === 'codex mcp list') {
      return { stdout: '', exitCode: 0 };
    }
    return { stdout: '', exitCode: 1 };
  });
}

describe('mcp-setup', () => {
  describe('detectTools', () => {
    it('detects claude when binary is found', async () => {
      const deps = createMockDeps();
      mockWhich(deps, ['claude']);

      const results = await detectTools(deps);
      const claude = results.find((r) => r.id === 'claude');
      expect(claude?.detected).toBe(true);
    });

    it('detects cursor when .cursor/ dir exists', async () => {
      const deps = createMockDeps({
        fileExists: vi.fn().mockImplementation(async (p: string) => {
          return p === '/project/.cursor';
        }),
      });

      const results = await detectTools(deps);
      const cursor = results.find((r) => r.id === 'cursor');
      expect(cursor?.detected).toBe(true);
    });

    it('detects vscode when code binary is found', async () => {
      const deps = createMockDeps();
      mockWhich(deps, ['code']);

      const results = await detectTools(deps);
      const vscode = results.find((r) => r.id === 'vscode');
      expect(vscode?.detected).toBe(true);
    });

    it('detects windsurf when .codeium/windsurf dir exists', async () => {
      const deps = createMockDeps({
        fileExists: vi.fn().mockImplementation(async (p: string) => {
          return p === '/home/user/.codeium/windsurf';
        }),
      });

      const results = await detectTools(deps);
      const windsurf = results.find((r) => r.id === 'windsurf');
      expect(windsurf?.detected).toBe(true);
    });

    it('detects codex when binary is found', async () => {
      const deps = createMockDeps();
      mockWhich(deps, ['codex']);

      const results = await detectTools(deps);
      const codex = results.find((r) => r.id === 'codex');
      expect(codex?.detected).toBe(true);
    });

    it('detects openclaw when openclaw.json exists', async () => {
      const deps = createMockDeps({
        fileExists: vi.fn().mockImplementation(async (p: string) => {
          return p === '/project/openclaw.json';
        }),
      });

      const results = await detectTools(deps);
      const oc = results.find((r) => r.id === 'openclaw');
      expect(oc?.detected).toBe(true);
    });

    it('returns not detected when nothing is found', async () => {
      const deps = createMockDeps();

      const results = await detectTools(deps);
      expect(results.every((r) => !r.detected)).toBe(true);
    });

    it('marks tool as configured when already present', async () => {
      const deps = createMockDeps({
        fileExists: vi.fn().mockImplementation(async (p: string) => {
          return p === '/project/.cursor';
        }),
        readFile: vi.fn().mockImplementation(async (p: string) => {
          if (p === '/project/.cursor/mcp.json') {
            return JSON.stringify({ mcpServers: { 'flow-weaver': {} } });
          }
          return null;
        }),
      });

      const results = await detectTools(deps);
      const cursor = results.find((r) => r.id === 'cursor');
      expect(cursor?.detected).toBe(true);
      expect(cursor?.configured).toBe(true);
    });
  });

  describe('mergeJsonConfig', () => {
    it('creates new file when none exists', async () => {
      const deps = createMockDeps();

      const result = await mergeJsonConfig(deps, '/project/.cursor/mcp.json', 'mcpServers');
      expect(result.action).toBe('created');
      expect(deps.mkdir).toHaveBeenCalledWith('/project/.cursor');
      expect(deps.writeFile).toHaveBeenCalledWith(
        '/project/.cursor/mcp.json',
        expect.stringContaining('"flow-weaver"'),
      );
    });

    it('merges into existing file preserving other servers', async () => {
      const existing = JSON.stringify({
        mcpServers: { 'other-server': { command: 'other' } },
      });
      const deps = createMockDeps({
        readFile: vi.fn().mockResolvedValue(existing),
      });

      const result = await mergeJsonConfig(deps, '/project/.cursor/mcp.json', 'mcpServers');
      expect(result.action).toBe('added');

      const written = (deps.writeFile as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
      const parsed = JSON.parse(written);
      expect(parsed.mcpServers['other-server']).toBeDefined();
      expect(parsed.mcpServers['flow-weaver']).toBeDefined();
    });

    it('returns already-configured when flow-weaver exists', async () => {
      const existing = JSON.stringify({
        mcpServers: { 'flow-weaver': { command: 'npx', args: ['old'] } },
      });
      const deps = createMockDeps({
        readFile: vi.fn().mockResolvedValue(existing),
      });

      const result = await mergeJsonConfig(deps, '/project/.cursor/mcp.json', 'mcpServers');
      expect(result.action).toBe('already-configured');
      expect(deps.writeFile).not.toHaveBeenCalled();
    });

    it('throws on invalid JSON', async () => {
      const deps = createMockDeps({
        readFile: vi.fn().mockResolvedValue('not json {{{'),
      });

      await expect(
        mergeJsonConfig(deps, '/project/.cursor/mcp.json', 'mcpServers'),
      ).rejects.toThrow('invalid JSON');
    });

    it('creates root key if missing from existing file', async () => {
      const existing = JSON.stringify({ someOtherKey: true });
      const deps = createMockDeps({
        readFile: vi.fn().mockResolvedValue(existing),
      });

      const result = await mergeJsonConfig(deps, '/project/.vscode/mcp.json', 'servers');
      expect(result.action).toBe('added');

      const written = (deps.writeFile as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
      const parsed = JSON.parse(written);
      expect(parsed.servers['flow-weaver']).toBeDefined();
      expect(parsed.someOtherKey).toBe(true);
    });

    it('uses "servers" key for VS Code format', async () => {
      const deps = createMockDeps();

      await mergeJsonConfig(deps, '/project/.vscode/mcp.json', 'servers');

      const written = (deps.writeFile as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
      const parsed = JSON.parse(written);
      expect(parsed.servers).toBeDefined();
      expect(parsed.mcpServers).toBeUndefined();
    });
  });

  describe('mcpSetupCommand --list', () => {
    it('prints detected tools without configuring', async () => {
      const deps = createMockDeps();
      mockWhich(deps, ['claude']);

      await mcpSetupCommand({ list: true }, deps);

      expect(deps.log).toHaveBeenCalled();
      expect(deps.writeFile).not.toHaveBeenCalled();
      expect(deps.execCommand).not.toHaveBeenCalledWith(
        expect.stringContaining('claude mcp add'),
      );
    });
  });

  describe('mcpSetupCommand --all', () => {
    it('configures all detected tools', async () => {
      const deps = createMockDeps({
        fileExists: vi.fn().mockImplementation(async (p: string) => {
          return p === '/project/.cursor';
        }),
      });
      mockWhich(deps, ['claude']);
      // Override exec to also handle claude mcp add
      const exec = deps.execCommand as ReturnType<typeof vi.fn>;
      const originalImpl = exec.getMockImplementation()!;
      exec.mockImplementation(async (cmd: string) => {
        if (cmd.startsWith('claude mcp add')) {
          return { stdout: '', exitCode: 0 };
        }
        return originalImpl(cmd);
      });

      await mcpSetupCommand({ all: true }, deps);

      // Claude configured via CLI
      expect(deps.execCommand).toHaveBeenCalledWith(
        expect.stringContaining('claude mcp add'),
      );
      // Cursor configured via JSON
      expect(deps.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('.cursor/mcp.json'),
        expect.any(String),
      );
    });

    it('skips tools that are not detected', async () => {
      const deps = createMockDeps();
      // Nothing detected

      await mcpSetupCommand({ all: true }, deps);

      expect(deps.writeFile).not.toHaveBeenCalled();
      const logCalls = (deps.log as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
      expect(logCalls.some((m: string) => m.includes('No AI coding tools detected'))).toBe(true);
    });

    it('reports already-configured tools', async () => {
      const deps = createMockDeps({
        fileExists: vi.fn().mockImplementation(async (p: string) => {
          return p === '/project/.cursor';
        }),
        readFile: vi.fn().mockImplementation(async (p: string) => {
          if (p === '/project/.cursor/mcp.json') {
            return JSON.stringify({ mcpServers: { 'flow-weaver': {} } });
          }
          return null;
        }),
      });

      await mcpSetupCommand({ all: true }, deps);

      const logCalls = (deps.log as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
      expect(logCalls.some((m: string) => m.includes('already configured'))).toBe(true);
    });
  });

  describe('mcpSetupCommand --tool', () => {
    it('configures only specified tools', async () => {
      const deps = createMockDeps({
        fileExists: vi.fn().mockImplementation(async (p: string) => {
          return p === '/project/.cursor';
        }),
      });
      mockWhich(deps, ['claude']);

      await mcpSetupCommand({ tool: ['cursor'] }, deps);

      // Should write cursor config
      expect(deps.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('.cursor/mcp.json'),
        expect.any(String),
      );
      // Should NOT configure claude (not in --tool list)
      expect(deps.execCommand).not.toHaveBeenCalledWith(
        expect.stringContaining('claude mcp add'),
      );
    });

    it('rejects unknown tool names', async () => {
      const deps = createMockDeps();

      await mcpSetupCommand({ tool: ['nonexistent'] }, deps);

      const logCalls = (deps.log as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
      expect(logCalls.some((m: string) => m.includes('Unknown tool'))).toBe(true);
    });
  });

  describe('tool configuration', () => {
    it('claude: calls claude mcp add with correct args', async () => {
      const deps = createMockDeps();
      const exec = deps.execCommand as ReturnType<typeof vi.fn>;
      exec.mockImplementation(async (cmd: string) => {
        if (cmd.includes('which claude') || cmd.includes('where claude')) {
          return { stdout: '/usr/bin/claude', exitCode: 0 };
        }
        if (cmd === 'claude mcp list') {
          return { stdout: '', exitCode: 0 };
        }
        if (cmd.startsWith('claude mcp add')) {
          return { stdout: '', exitCode: 0 };
        }
        return { stdout: '', exitCode: 1 };
      });

      await mcpSetupCommand({ tool: ['claude'] }, deps);

      expect(exec).toHaveBeenCalledWith(
        expect.stringMatching(/claude mcp add --scope project flow-weaver/),
      );
    });

    it('codex: calls codex mcp add with correct args', async () => {
      const deps = createMockDeps();
      const exec = deps.execCommand as ReturnType<typeof vi.fn>;
      exec.mockImplementation(async (cmd: string) => {
        if (cmd.includes('which codex') || cmd.includes('where codex')) {
          return { stdout: '/usr/bin/codex', exitCode: 0 };
        }
        if (cmd === 'codex mcp list') {
          return { stdout: '', exitCode: 0 };
        }
        if (cmd.startsWith('codex mcp add')) {
          return { stdout: '', exitCode: 0 };
        }
        return { stdout: '', exitCode: 1 };
      });

      await mcpSetupCommand({ tool: ['codex'] }, deps);

      expect(exec).toHaveBeenCalledWith(
        expect.stringMatching(/codex mcp add flow-weaver/),
      );
    });

    it('vscode: writes .vscode/mcp.json with "servers" root key', async () => {
      const deps = createMockDeps();
      mockWhich(deps, ['code']);

      await mcpSetupCommand({ tool: ['vscode'] }, deps);

      const written = (deps.writeFile as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
      const parsed = JSON.parse(written);
      expect(parsed.servers?.['flow-weaver']).toBeDefined();
    });

    it('windsurf: writes to ~/.codeium/windsurf/mcp_config.json', async () => {
      const deps = createMockDeps({
        fileExists: vi.fn().mockImplementation(async (p: string) => {
          return p === '/home/user/.codeium/windsurf';
        }),
      });

      await mcpSetupCommand({ tool: ['windsurf'] }, deps);

      expect(deps.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('.codeium/windsurf/mcp_config.json'),
        expect.any(String),
      );
    });

    it('openclaw: writes to openclaw.json with mcpServers key', async () => {
      const deps = createMockDeps({
        fileExists: vi.fn().mockImplementation(async (p: string) => {
          return p === '/project/openclaw.json';
        }),
      });

      await mcpSetupCommand({ tool: ['openclaw'] }, deps);

      expect(deps.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('openclaw.json'),
        expect.any(String),
      );
      const written = (deps.writeFile as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
      const parsed = JSON.parse(written);
      expect(parsed.mcpServers?.['flow-weaver']).toBeDefined();
    });

    it('handles configure failure gracefully', async () => {
      const deps = createMockDeps();
      const exec = deps.execCommand as ReturnType<typeof vi.fn>;
      exec.mockImplementation(async (cmd: string) => {
        if (cmd.includes('which claude') || cmd.includes('where claude')) {
          return { stdout: '/usr/bin/claude', exitCode: 0 };
        }
        if (cmd === 'claude mcp list') {
          return { stdout: '', exitCode: 0 };
        }
        // claude mcp add fails
        if (cmd.startsWith('claude mcp add')) {
          return { stdout: '', exitCode: 1 };
        }
        return { stdout: '', exitCode: 1 };
      });

      await mcpSetupCommand({ tool: ['claude'] }, deps);

      const logCalls = (deps.log as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
      expect(logCalls.some((m: string) => m.includes('failed'))).toBe(true);
    });
  });

  describe('TOOL_REGISTRY', () => {
    it('has entries for all supported tools', () => {
      const ids = TOOL_REGISTRY.map((t) => t.id);
      expect(ids).toContain('claude');
      expect(ids).toContain('cursor');
      expect(ids).toContain('vscode');
      expect(ids).toContain('windsurf');
      expect(ids).toContain('codex');
      expect(ids).toContain('openclaw');
    });
  });
});
