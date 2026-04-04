/**
 * Tests for src/cli/commands/ai-credentials.ts
 * 100% coverage.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockCreateAiCredential = vi.fn();
const mockListAiCredentials = vi.fn();
const mockRevokeAiCredential = vi.fn();
const mockTestAiCredential = vi.fn();
const mockReadLine = vi.fn();
const mockConfirm = vi.fn();

vi.mock('../../src/cli/utils/cli-helpers.js', () => ({
  requireLogin: () => ({
    creds: { token: 'jwt', platformUrl: 'https://fw.ai' },
    client: {
      createAiCredential: mockCreateAiCredential,
      listAiCredentials: mockListAiCredentials,
      revokeAiCredential: mockRevokeAiCredential,
      testAiCredential: mockTestAiCredential,
    },
  }),
  readLine: (...args: unknown[]) => mockReadLine(...args),
  confirm: (...args: unknown[]) => mockConfirm(...args),
  fmt: {
    ok: (m: string) => `✓ ${m}`,
    err: (m: string) => `✗ ${m}`,
    dim: (m: string) => m,
    bold: (m: string) => m,
    cyan: (m: string) => m,
    yellow: (m: string) => m,
  },
  exitWithError: (err: unknown, fallback: string) => {
    const msg = err instanceof Error ? err.message : fallback;
    console.error(`✗ ${msg}`);
    process.exit(1);
  },
}));

let consoleOutput: string[] = [];
let consoleErrors: string[] = [];
const origLog = console.log;
const origErr = console.error;
vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit'); });

beforeEach(() => {
  consoleOutput = [];
  consoleErrors = [];
  console.log = (...args: unknown[]) => consoleOutput.push(args.join(' '));
  console.error = (...args: unknown[]) => consoleErrors.push(args.join(' '));
  vi.clearAllMocks();
});

afterEach(() => { console.log = origLog; console.error = origErr; });

describe('aiAddCommand', () => {
  it('adds credential with --key flag and shows next steps', async () => {
    const { aiAddCommand } = await import('../../src/cli/commands/ai-credentials');
    mockCreateAiCredential.mockResolvedValue({ id: 'c1', provider: 'anthropic', label: 'my key', createdAt: '2026-01-01' });
    await aiAddCommand('anthropic', { key: 'sk-test', label: 'my key' });
    const out = consoleOutput.join('\n');
    expect(out).toContain('Credential added');
    expect(out).toContain('fw ai test c1');
  });

  it('prompts interactively when no --key', async () => {
    const { aiAddCommand } = await import('../../src/cli/commands/ai-credentials');
    mockReadLine.mockResolvedValue('sk-from-stdin');
    mockCreateAiCredential.mockResolvedValue({ id: 'c1', provider: 'openai', label: 'openai key', createdAt: '2026-01-01' });
    await aiAddCommand('openai', {});
    expect(mockCreateAiCredential).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'sk-from-stdin' }));
  });

  it('uses default label', async () => {
    const { aiAddCommand } = await import('../../src/cli/commands/ai-credentials');
    mockCreateAiCredential.mockResolvedValue({ id: 'c1', provider: 'anthropic', label: 'anthropic key', createdAt: '2026-01-01' });
    await aiAddCommand('anthropic', { key: 'k' });
    expect(mockCreateAiCredential).toHaveBeenCalledWith(expect.objectContaining({ label: 'anthropic key' }));
  });

  it('passes model and default options', async () => {
    const { aiAddCommand } = await import('../../src/cli/commands/ai-credentials');
    mockCreateAiCredential.mockResolvedValue({ id: 'c1', provider: 'anthropic', label: 'k', createdAt: '2026-01-01' });
    await aiAddCommand('anthropic', { key: 'k', model: 'claude-sonnet-4-20250514', default: true });
    expect(mockCreateAiCredential).toHaveBeenCalledWith(expect.objectContaining({ defaultModel: 'claude-sonnet-4-20250514', isDefault: true }));
  });

  it('rejects invalid provider', async () => {
    const { aiAddCommand } = await import('../../src/cli/commands/ai-credentials');
    await expect(aiAddCommand('gemini', { key: 'k' })).rejects.toThrow('process.exit');
    expect(consoleErrors.join('\n')).toContain('Invalid provider');
  });

  it('exits when stdin returns null (non-TTY)', async () => {
    const { aiAddCommand } = await import('../../src/cli/commands/ai-credentials');
    mockReadLine.mockResolvedValue(null);
    await expect(aiAddCommand('anthropic', {})).rejects.toThrow('process.exit');
    expect(consoleErrors.join('\n')).toContain('No API key provided');
  });

  it('exits when stdin returns empty', async () => {
    const { aiAddCommand } = await import('../../src/cli/commands/ai-credentials');
    mockReadLine.mockResolvedValue('');
    await expect(aiAddCommand('anthropic', {})).rejects.toThrow('process.exit');
    expect(consoleErrors.join('\n')).toContain('No API key provided');
  });

  it('exits on API error', async () => {
    const { aiAddCommand } = await import('../../src/cli/commands/ai-credentials');
    mockCreateAiCredential.mockRejectedValue(new Error('Bad key'));
    await expect(aiAddCommand('anthropic', { key: 'k' })).rejects.toThrow('process.exit');
    expect(consoleErrors.join('\n')).toContain('Bad key');
  });
});

describe('aiListCommand', () => {
  it('lists credentials with details', async () => {
    const { aiListCommand } = await import('../../src/cli/commands/ai-credentials');
    mockListAiCredentials.mockResolvedValue([
      { id: 'c1', provider: 'anthropic', label: 'main', defaultModel: 'claude-sonnet-4-20250514', isDefault: true, createdAt: '2026-01-01' },
      { id: 'c2', provider: 'openai', label: 'backup', isDefault: false, createdAt: '2026-01-02' },
    ]);
    await aiListCommand();
    const out = consoleOutput.join('\n');
    expect(out).toContain('2 credentials');
    expect(out).toContain('★ default');
  });

  it('shows singular', async () => {
    const { aiListCommand } = await import('../../src/cli/commands/ai-credentials');
    mockListAiCredentials.mockResolvedValue([{ id: 'c1', provider: 'anthropic', label: 'only', isDefault: false, createdAt: '2026-01-01' }]);
    await aiListCommand();
    expect(consoleOutput.join('\n')).toContain('1 credential:');
  });

  it('shows empty message', async () => {
    const { aiListCommand } = await import('../../src/cli/commands/ai-credentials');
    mockListAiCredentials.mockResolvedValue([]);
    await aiListCommand();
    expect(consoleOutput.join('\n')).toContain('No AI credentials');
  });

  it('exits on error', async () => {
    const { aiListCommand } = await import('../../src/cli/commands/ai-credentials');
    mockListAiCredentials.mockRejectedValue(new Error('fail'));
    await expect(aiListCommand()).rejects.toThrow('process.exit');
  });
});

describe('aiRevokeCommand', () => {
  it('revokes with --force', async () => {
    const { aiRevokeCommand } = await import('../../src/cli/commands/ai-credentials');
    mockRevokeAiCredential.mockResolvedValue(undefined);
    await aiRevokeCommand('c1', { force: true });
    expect(consoleOutput.join('\n')).toContain('Credential revoked');
  });

  it('prompts and proceeds on y', async () => {
    const { aiRevokeCommand } = await import('../../src/cli/commands/ai-credentials');
    mockConfirm.mockResolvedValue(true);
    mockRevokeAiCredential.mockResolvedValue(undefined);
    await aiRevokeCommand('c1', {});
    expect(consoleOutput.join('\n')).toContain('Credential revoked');
  });

  it('cancels on n', async () => {
    const { aiRevokeCommand } = await import('../../src/cli/commands/ai-credentials');
    mockConfirm.mockResolvedValue(false);
    await aiRevokeCommand('c1', {});
    expect(consoleOutput.join('\n')).toContain('Cancelled');
    expect(mockRevokeAiCredential).not.toHaveBeenCalled();
  });

  it('exits on API error', async () => {
    const { aiRevokeCommand } = await import('../../src/cli/commands/ai-credentials');
    mockRevokeAiCredential.mockRejectedValue(new Error('Not found'));
    await expect(aiRevokeCommand('c1', { force: true })).rejects.toThrow('process.exit');
  });
});

describe('aiTestCommand', () => {
  it('shows success', async () => {
    const { aiTestCommand } = await import('../../src/cli/commands/ai-credentials');
    mockTestAiCredential.mockResolvedValue({ success: true });
    await aiTestCommand('c1');
    expect(consoleOutput.join('\n')).toContain('Credential is valid');
  });

  it('shows failure with message', async () => {
    const { aiTestCommand } = await import('../../src/cli/commands/ai-credentials');
    mockTestAiCredential.mockResolvedValue({ success: false, message: 'Invalid key' });
    await aiTestCommand('c1');
    expect(consoleOutput.join('\n')).toContain('test failed');
    expect(consoleOutput.join('\n')).toContain('Invalid key');
  });

  it('shows failure without message', async () => {
    const { aiTestCommand } = await import('../../src/cli/commands/ai-credentials');
    mockTestAiCredential.mockResolvedValue({ success: false });
    await aiTestCommand('c1');
    expect(consoleOutput.join('\n')).toContain('test failed');
  });

  it('exits on API error', async () => {
    const { aiTestCommand } = await import('../../src/cli/commands/ai-credentials');
    mockTestAiCredential.mockRejectedValue(new Error('Network'));
    await expect(aiTestCommand('c1')).rejects.toThrow('process.exit');
  });
});
