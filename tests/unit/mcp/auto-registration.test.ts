import { describe, it, expect, vi, beforeEach } from 'vitest';
import { offerClaudeRegistration } from '../../../src/mcp/auto-registration.js';
import type { RegistrationDeps } from '../../../src/mcp/types.js';

function makeDeps(overrides: Partial<RegistrationDeps> = {}): RegistrationDeps {
  return {
    execCommand: vi.fn().mockResolvedValue({ stdout: '', exitCode: 0 }),
    prompt: vi.fn().mockResolvedValue('n'),
    log: vi.fn(),
    resolveCliPath: vi.fn().mockReturnValue('/usr/local/lib/flow-weaver'),
    ...overrides,
  };
}

describe('offerClaudeRegistration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips registration when Claude Code is not found', async () => {
    const deps = makeDeps({
      execCommand: vi.fn().mockResolvedValue({ stdout: '', exitCode: 1 }),
    });

    await offerClaudeRegistration({}, deps);

    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('not found'));
    // Should not have checked mcp list or prompted
    expect(deps.execCommand).toHaveBeenCalledTimes(1);
    expect(deps.prompt).not.toHaveBeenCalled();
  });

  it('skips registration when flow-weaver is already registered', async () => {
    const execCommand = vi.fn()
      .mockResolvedValueOnce({ stdout: '/usr/local/bin/claude', exitCode: 0 }) // which claude
      .mockResolvedValueOnce({ stdout: 'flow-weaver: npx tsx ...', exitCode: 0 }); // mcp list

    const deps = makeDeps({ execCommand });

    await offerClaudeRegistration({}, deps);

    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('already registered'));
    expect(deps.prompt).not.toHaveBeenCalled();
  });

  it('skips registration when user declines with "n"', async () => {
    const execCommand = vi.fn()
      .mockResolvedValueOnce({ stdout: '/usr/local/bin/claude', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: '', exitCode: 0 });

    const deps = makeDeps({
      execCommand,
      prompt: vi.fn().mockResolvedValue('n'),
    });

    await offerClaudeRegistration({}, deps);

    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('Skipped'));
    // Should not have called the register command (3rd exec)
    expect(execCommand).toHaveBeenCalledTimes(2);
  });

  it('skips registration when user presses Enter (empty response)', async () => {
    const execCommand = vi.fn()
      .mockResolvedValueOnce({ stdout: '/usr/local/bin/claude', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: '', exitCode: 0 });

    const deps = makeDeps({
      execCommand,
      prompt: vi.fn().mockResolvedValue(''),
    });

    await offerClaudeRegistration({}, deps);

    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('Skipped'));
  });

  it('registers when user accepts with "y"', async () => {
    const execCommand = vi.fn()
      .mockResolvedValueOnce({ stdout: '/usr/local/bin/claude', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: '', exitCode: 0 }); // register command

    const deps = makeDeps({
      execCommand,
      prompt: vi.fn().mockResolvedValue('y'),
      resolveCliPath: vi.fn().mockReturnValue('/opt/fw'),
    });

    await offerClaudeRegistration({}, deps);

    // Third call should be the registration command
    expect(execCommand).toHaveBeenCalledTimes(3);
    const registerCmd = execCommand.mock.calls[2][0] as string;
    expect(registerCmd).toContain('claude mcp add');
    expect(registerCmd).toContain('flow-weaver');
    expect(registerCmd).toContain('/opt/fw');
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('Registered'));
  });

  it('registers when user accepts with "yes"', async () => {
    const execCommand = vi.fn()
      .mockResolvedValueOnce({ stdout: '/usr/local/bin/claude', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: '', exitCode: 0 });

    const deps = makeDeps({
      execCommand,
      prompt: vi.fn().mockResolvedValue('yes'),
    });

    await offerClaudeRegistration({}, deps);

    expect(execCommand).toHaveBeenCalledTimes(3);
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('Registered'));
  });

  it('uses "where claude" on win32', async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32' });

    const execCommand = vi.fn()
      .mockResolvedValueOnce({ stdout: '', exitCode: 1 });

    const deps = makeDeps({ execCommand });

    await offerClaudeRegistration({}, deps);

    expect(execCommand.mock.calls[0][0]).toBe('where claude');

    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('uses "which claude" on non-win32 platforms', async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin' });

    const execCommand = vi.fn()
      .mockResolvedValueOnce({ stdout: '', exitCode: 1 });

    const deps = makeDeps({ execCommand });

    await offerClaudeRegistration({}, deps);

    expect(execCommand.mock.calls[0][0]).toBe('which claude');

    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('includes --scope project and --stdio in the registration command', async () => {
    const execCommand = vi.fn()
      .mockResolvedValueOnce({ stdout: '/usr/local/bin/claude', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: '', exitCode: 0 });

    const deps = makeDeps({
      execCommand,
      prompt: vi.fn().mockResolvedValue('y'),
    });

    await offerClaudeRegistration({}, deps);

    const registerCmd = execCommand.mock.calls[2][0] as string;
    expect(registerCmd).toContain('--scope project');
    expect(registerCmd).toContain('--stdio');
  });
});
