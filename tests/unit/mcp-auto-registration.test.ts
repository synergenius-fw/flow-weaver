import type { RegistrationDeps, McpServerOptions } from '../../src/mcp/types';
import { offerClaudeRegistration } from '../../src/mcp/auto-registration';

function createMockDeps(overrides: Partial<RegistrationDeps> = {}): RegistrationDeps {
  return {
    execCommand: vi.fn().mockResolvedValue({ stdout: '', exitCode: 0 }),
    prompt: vi.fn().mockResolvedValue('n'),
    log: vi.fn(),
    resolveCliPath: vi.fn().mockReturnValue('/fake/cli/path'),
    ...overrides,
  };
}

describe('offerClaudeRegistration', () => {
  it('skips when Claude Code is not found in PATH', async () => {
    const deps = createMockDeps({
      execCommand: vi.fn().mockResolvedValue({ stdout: '', exitCode: 1 }),
    });

    await offerClaudeRegistration({}, deps);

    expect(deps.log).toHaveBeenCalledWith(
      'Claude Code not found in PATH. Skipping auto-registration.'
    );
    expect(deps.prompt).not.toHaveBeenCalled();
  });

  it('skips when flow-weaver is already registered', async () => {
    const deps = createMockDeps({
      execCommand: vi.fn().mockImplementation(async (cmd: string) => {
        if (cmd.includes('mcp list')) {
          return { stdout: 'flow-weaver  stdio  npx tsx ...', exitCode: 0 };
        }
        return { stdout: '/usr/local/bin/claude', exitCode: 0 };
      }),
    });

    await offerClaudeRegistration({}, deps);

    expect(deps.log).toHaveBeenCalledWith(
      'Flow Weaver MCP server already registered in Claude Code.'
    );
    expect(deps.prompt).not.toHaveBeenCalled();
  });

  it('skips registration when user declines prompt', async () => {
    const deps = createMockDeps({
      execCommand: vi.fn().mockImplementation(async (cmd: string) => {
        if (cmd.includes('mcp list')) {
          return { stdout: 'some-other-tool', exitCode: 0 };
        }
        return { stdout: '/usr/local/bin/claude', exitCode: 0 };
      }),
      prompt: vi.fn().mockResolvedValue('n'),
    });

    await offerClaudeRegistration({}, deps);

    expect(deps.log).toHaveBeenCalledWith('Skipped MCP server registration.');
  });

  it('registers when user accepts with "y"', async () => {
    const execCommand = vi.fn().mockImplementation(async (cmd: string) => {
      if (cmd.includes('mcp list')) {
        return { stdout: '', exitCode: 0 };
      }
      return { stdout: '', exitCode: 0 };
    });

    const deps = createMockDeps({
      execCommand,
      prompt: vi.fn().mockResolvedValue('y'),
      resolveCliPath: vi.fn().mockReturnValue('/my/cli'),
    });

    await offerClaudeRegistration({}, deps);

    // Should have called claude mcp add
    const addCall = execCommand.mock.calls.find(
      (c: string[]) => typeof c[0] === 'string' && c[0].includes('claude mcp add')
    );
    expect(addCall).toBeTruthy();
    expect(addCall![0]).toContain('/my/cli/index.ts');
    expect(deps.log).toHaveBeenCalledWith(
      'Registered Flow Weaver MCP server. Restart Claude Code to activate.'
    );
  });

  it('registers when user accepts with "yes"', async () => {
    const execCommand = vi.fn().mockImplementation(async (cmd: string) => {
      if (cmd.includes('mcp list')) {
        return { stdout: '', exitCode: 0 };
      }
      return { stdout: '', exitCode: 0 };
    });

    const deps = createMockDeps({
      execCommand,
      prompt: vi.fn().mockResolvedValue('yes'),
    });

    await offerClaudeRegistration({}, deps);

    const addCall = execCommand.mock.calls.find(
      (c: string[]) => typeof c[0] === 'string' && c[0].includes('claude mcp add')
    );
    expect(addCall).toBeTruthy();
  });

  it('uses correct which command on win32', async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32' });

    const execCommand = vi.fn().mockResolvedValue({ stdout: '', exitCode: 1 });
    const deps = createMockDeps({ execCommand });

    await offerClaudeRegistration({}, deps);

    expect(execCommand).toHaveBeenCalledWith('where claude');

    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('uses correct which command on non-win32', async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin' });

    const execCommand = vi.fn().mockResolvedValue({ stdout: '', exitCode: 1 });
    const deps = createMockDeps({ execCommand });

    await offerClaudeRegistration({}, deps);

    expect(execCommand).toHaveBeenCalledWith('which claude');

    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });
});
