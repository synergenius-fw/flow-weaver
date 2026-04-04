/**
 * Tests for src/cli/commands/apikey.ts
 * 100% coverage for apiKeyCreateCommand, apiKeyListCommand, apiKeyRevokeCommand.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockCreateApiKey = vi.fn();
const mockListApiKeys = vi.fn();
const mockRevokeApiKey = vi.fn();

vi.mock('../../src/cli/utils/cli-helpers.js', () => ({
  requireLogin: () => ({
    creds: { token: 'jwt', platformUrl: 'https://fw.ai' },
    client: {
      createApiKey: mockCreateApiKey,
      listApiKeys: mockListApiKeys,
      revokeApiKey: mockRevokeApiKey,
    },
  }),
  isUuid: (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
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

describe('apiKeyCreateCommand', () => {
  it('creates and displays key with warning', async () => {
    const { apiKeyCreateCommand } = await import('../../src/cli/commands/apikey');
    mockCreateApiKey.mockResolvedValue({ id: 'k1', name: 'my-key', keyPrefix: 'fw_abc', key: 'fw_abc123', createdAt: '2026-01-01' });

    await apiKeyCreateCommand('my-key');

    const out = consoleOutput.join('\n');
    expect(out).toContain('API key created');
    expect(out).toContain('fw_abc123');
    expect(out).toContain('Copy this key now');
  });

  it('exits on error', async () => {
    const { apiKeyCreateCommand } = await import('../../src/cli/commands/apikey');
    mockCreateApiKey.mockRejectedValue(new Error('Name required'));
    await expect(apiKeyCreateCommand('test')).rejects.toThrow('process.exit');
    expect(consoleErrors.join('\n')).toContain('Name required');
  });
});

describe('apiKeyListCommand', () => {
  it('lists keys', async () => {
    const { apiKeyListCommand } = await import('../../src/cli/commands/apikey');
    mockListApiKeys.mockResolvedValue([
      { id: 'id-1', name: 'dev', keyPrefix: 'fw_abc', createdAt: '2026-04-01T00:00:00Z' },
    ]);
    await apiKeyListCommand();
    const out = consoleOutput.join('\n');
    expect(out).toContain('1 API key:');
    expect(out).toContain('dev');
  });

  it('shows empty message', async () => {
    const { apiKeyListCommand } = await import('../../src/cli/commands/apikey');
    mockListApiKeys.mockResolvedValue([]);
    await apiKeyListCommand();
    expect(consoleOutput.join('\n')).toContain('No API keys');
  });

  it('shows plural for multiple keys', async () => {
    const { apiKeyListCommand } = await import('../../src/cli/commands/apikey');
    mockListApiKeys.mockResolvedValue([
      { id: 'id-1', name: 'a', keyPrefix: 'fw_a', createdAt: '2026-01-01T00:00:00Z' },
      { id: 'id-2', name: 'b', keyPrefix: 'fw_b', createdAt: '2026-01-02T00:00:00Z' },
    ]);
    await apiKeyListCommand();
    expect(consoleOutput.join('\n')).toContain('2 API keys:');
  });

  it('exits on error', async () => {
    const { apiKeyListCommand } = await import('../../src/cli/commands/apikey');
    mockListApiKeys.mockRejectedValue(new Error('Server error'));
    await expect(apiKeyListCommand()).rejects.toThrow('process.exit');
  });
});

describe('apiKeyRevokeCommand', () => {
  it('revokes by UUID directly', async () => {
    const { apiKeyRevokeCommand } = await import('../../src/cli/commands/apikey');
    mockRevokeApiKey.mockResolvedValue(undefined);
    const uuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    await apiKeyRevokeCommand(uuid);
    expect(mockRevokeApiKey).toHaveBeenCalledWith(uuid);
    expect(consoleOutput.join('\n')).toContain('API key revoked');
  });

  it('resolves prefix to UUID', async () => {
    const { apiKeyRevokeCommand } = await import('../../src/cli/commands/apikey');
    mockListApiKeys.mockResolvedValue([
      { id: 'id-1', name: 'k', keyPrefix: 'fw_abc', createdAt: '2026-01-01T00:00:00Z' },
    ]);
    mockRevokeApiKey.mockResolvedValue(undefined);
    await apiKeyRevokeCommand('fw_abc');
    expect(mockRevokeApiKey).toHaveBeenCalledWith('id-1');
  });

  it('resolves by id prefix', async () => {
    const { apiKeyRevokeCommand } = await import('../../src/cli/commands/apikey');
    mockListApiKeys.mockResolvedValue([
      { id: 'id-unique-123', name: 'k', keyPrefix: 'fw_nope', createdAt: '2026-01-01T00:00:00Z' },
    ]);
    mockRevokeApiKey.mockResolvedValue(undefined);
    await apiKeyRevokeCommand('id-unique');
    expect(mockRevokeApiKey).toHaveBeenCalledWith('id-unique-123');
  });

  it('errors when no match', async () => {
    const { apiKeyRevokeCommand } = await import('../../src/cli/commands/apikey');
    mockListApiKeys.mockResolvedValue([]);
    await expect(apiKeyRevokeCommand('fw_zzz')).rejects.toThrow('process.exit');
    expect(consoleErrors.join('\n')).toContain('No API key matching');
  });

  it('errors when ambiguous', async () => {
    const { apiKeyRevokeCommand } = await import('../../src/cli/commands/apikey');
    mockListApiKeys.mockResolvedValue([
      { id: 'id-1', name: 'a', keyPrefix: 'fw_abc1', createdAt: '2026-01-01T00:00:00Z' },
      { id: 'id-2', name: 'b', keyPrefix: 'fw_abc2', createdAt: '2026-01-02T00:00:00Z' },
    ]);
    await expect(apiKeyRevokeCommand('fw_abc')).rejects.toThrow('process.exit');
    expect(consoleErrors.join('\n')).toContain('Ambiguous');
  });

  it('exits on API error', async () => {
    const { apiKeyRevokeCommand } = await import('../../src/cli/commands/apikey');
    mockRevokeApiKey.mockRejectedValue(new Error('Not found'));
    const uuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    await expect(apiKeyRevokeCommand(uuid)).rejects.toThrow('process.exit');
  });
});

// PlatformClient API key method tests are in platform-client-apikey.test.ts
