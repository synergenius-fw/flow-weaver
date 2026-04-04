/**
 * Tests for src/cli/commands/account.ts
 * 100% coverage for accountCommand, formatLimit, usageBar.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockGetUser = vi.fn();
const mockGetDetailedUsage = vi.fn();

vi.mock('../../src/cli/utils/cli-helpers.js', () => ({
  requireLogin: () => ({
    creds: { token: 'jwt', platformUrl: 'https://fw.ai' },
    client: { getUser: mockGetUser, getDetailedUsage: mockGetDetailedUsage },
  }),
  fmt: {
    ok: (m: string) => `✓ ${m}`,
    err: (m: string) => `✗ ${m}`,
    dim: (m: string) => m,
    bold: (m: string) => m,
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

describe('accountCommand', () => {
  it('shows account + usage together', async () => {
    const { accountCommand } = await import('../../src/cli/commands/account');
    mockGetUser.mockResolvedValue({ id: 'u1', name: 'Alice', email: 'alice@fw.ai', plan: 'pro' });
    mockGetDetailedUsage.mockResolvedValue({
      plan: 'pro', usage: {
        workflows: { used: 2, limit: 25 },
        deployments: { used: 1, limit: 10 },
        executions: { used: 45, limit: 10000, period: 'month' },
      }, limits: { timeoutMs: 30000 },
    });
    await accountCommand();
    const out = consoleOutput.join('\n');
    expect(out).toContain('Alice');
    expect(out).toContain('alice@fw.ai');
    expect(out).toContain('2 / 25');
    expect(out).toContain('30s per run');
  });

  it('shows account without usage when fetch fails', async () => {
    const { accountCommand } = await import('../../src/cli/commands/account');
    mockGetUser.mockResolvedValue({ id: 'u1', name: 'Bob', email: 'bob@fw.ai', plan: 'free' });
    mockGetDetailedUsage.mockRejectedValue(new Error('fail'));
    await accountCommand();
    const out = consoleOutput.join('\n');
    expect(out).toContain('Bob');
    expect(out).not.toContain('Workflows');
  });

  it('shows unlimited format', async () => {
    const { accountCommand } = await import('../../src/cli/commands/account');
    mockGetUser.mockResolvedValue({ id: 'u1', name: 'C', email: 'c@fw.ai', plan: 'business' });
    mockGetDetailedUsage.mockResolvedValue({
      plan: 'business', usage: {
        workflows: { used: 50, limit: -1 },
        deployments: { used: 20, limit: -1 },
        executions: { used: 5000, limit: -1, period: 'month' },
      }, limits: { timeoutMs: 120000 },
    });
    await accountCommand();
    const out = consoleOutput.join('\n');
    expect(out).toContain('50 (unlimited)');
    expect(out).toContain('∞');
  });

  it('shows warning colors at high usage', async () => {
    const { accountCommand } = await import('../../src/cli/commands/account');
    mockGetUser.mockResolvedValue({ id: 'u1', name: 'D', email: 'd@fw.ai', plan: 'free' });
    mockGetDetailedUsage.mockResolvedValue({
      plan: 'free', usage: {
        workflows: { used: 3, limit: 3 },
        deployments: { used: 0, limit: 1 },
        executions: { used: 80, limit: 100, period: 'month' },
      }, limits: { timeoutMs: 10000 },
    });
    await accountCommand();
    const out = consoleOutput.join('\n');
    expect(out).toContain('\x1b[31m'); // red
    expect(out).toContain('\x1b[33m'); // yellow
  });

  it('exits on getUser error', async () => {
    const { accountCommand } = await import('../../src/cli/commands/account');
    mockGetUser.mockRejectedValue(new Error('Auth failed'));
    await expect(accountCommand()).rejects.toThrow('process.exit');
  });
});

describe('formatLimit', () => {
  it('formats normal limits', async () => {
    const { formatLimit } = await import('../../src/cli/commands/account');
    expect(formatLimit(2, 3)).toBe('2 / 3');
  });

  it('formats unlimited', async () => {
    const { formatLimit } = await import('../../src/cli/commands/account');
    expect(formatLimit(50, -1)).toBe('50 (unlimited)');
  });
});

describe('usageBar', () => {
  it('returns ∞ for unlimited', async () => {
    const { usageBar } = await import('../../src/cli/commands/account');
    expect(usageBar(50, -1)).toContain('∞');
  });

  it('shows green for low usage', async () => {
    const { usageBar } = await import('../../src/cli/commands/account');
    expect(usageBar(1, 10)).toContain('\x1b[32m');
  });

  it('shows yellow for 70%+', async () => {
    const { usageBar } = await import('../../src/cli/commands/account');
    expect(usageBar(75, 100)).toContain('\x1b[33m');
  });

  it('shows red for 90%+', async () => {
    const { usageBar } = await import('../../src/cli/commands/account');
    expect(usageBar(95, 100)).toContain('\x1b[31m');
  });

  it('returns dash for zero limit', async () => {
    const { usageBar } = await import('../../src/cli/commands/account');
    expect(usageBar(0, 0)).toContain('-');
  });
});
