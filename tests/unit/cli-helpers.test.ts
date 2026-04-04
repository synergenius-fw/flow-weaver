/**
 * Tests for src/cli/utils/cli-helpers.ts
 * 100% coverage for isUuid, requireLogin, readLine, confirm, fmt, formatError, exitWithError.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock credentials and platform-client before importing helpers
const mockLoadCredentials = vi.fn();

vi.mock('../../src/cli/config/credentials.js', () => ({
  loadCredentials: (...args: unknown[]) => mockLoadCredentials(...args),
}));

vi.mock('../../src/cli/config/platform-client.js', () => ({
  PlatformClient: class MockPlatformClient {
    constructor(public creds: unknown) {}
  },
}));

let consoleErrors: string[] = [];
const origErr = console.error;
const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit'); });

beforeEach(() => {
  consoleErrors = [];
  console.error = (...args: unknown[]) => consoleErrors.push(args.join(' '));
  vi.clearAllMocks();
});

afterEach(() => {
  console.error = origErr;
});

const CREDS = {
  token: 'jwt', email: 'u@t.com', plan: 'free' as const,
  platformUrl: 'https://fw.ai', expiresAt: Date.now() + 86_400_000,
};

// ---------------------------------------------------------------------------
// isUuid
// ---------------------------------------------------------------------------

describe('isUuid', () => {
  it('returns true for valid UUID', async () => {
    const { isUuid } = await import('../../src/cli/utils/cli-helpers');
    expect(isUuid('a1b2c3d4-e5f6-7890-abcd-ef1234567890')).toBe(true);
  });

  it('returns true for uppercase UUID', async () => {
    const { isUuid } = await import('../../src/cli/utils/cli-helpers');
    expect(isUuid('A1B2C3D4-E5F6-7890-ABCD-EF1234567890')).toBe(true);
  });

  it('returns false for non-UUID strings', async () => {
    const { isUuid } = await import('../../src/cli/utils/cli-helpers');
    expect(isUuid('acme-corp')).toBe(false);
    expect(isUuid('abc')).toBe(false);
    expect(isUuid('')).toBe(false);
    expect(isUuid('not-a-uuid-at-all-nope')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// requireLogin
// ---------------------------------------------------------------------------

describe('requireLogin', () => {
  it('returns creds and client when logged in', async () => {
    const { requireLogin } = await import('../../src/cli/utils/cli-helpers');
    mockLoadCredentials.mockReturnValue(CREDS);

    const { creds, client } = requireLogin();
    expect(creds).toEqual(CREDS);
    expect(client).toBeDefined();
  });

  it('exits with error when not logged in', async () => {
    const { requireLogin } = await import('../../src/cli/utils/cli-helpers');
    mockLoadCredentials.mockReturnValue(null);

    expect(() => requireLogin()).toThrow('process.exit');
    expect(mockExit).toHaveBeenCalledWith(1);
    expect(consoleErrors.join('\n')).toContain('Not logged in');
    expect(consoleErrors.join('\n')).toContain('fw login');
  });
});

// ---------------------------------------------------------------------------
// readLine
// ---------------------------------------------------------------------------

describe('readLine', () => {
  it('returns null in non-TTY environment', async () => {
    const { readLine } = await import('../../src/cli/utils/cli-helpers');
    const origTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });

    const result = await readLine('prompt: ');
    expect(result).toBeNull();

    Object.defineProperty(process.stdin, 'isTTY', { value: origTTY, configurable: true });
  });

});

describe('confirm', () => {
  it('returns false in non-TTY environment', async () => {
    const { confirm } = await import('../../src/cli/utils/cli-helpers');
    const origTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });

    const result = await confirm('Sure? ');
    expect(result).toBe(false);

    Object.defineProperty(process.stdin, 'isTTY', { value: origTTY, configurable: true });
  });
});

// ---------------------------------------------------------------------------
// fmt
// ---------------------------------------------------------------------------

describe('fmt', () => {
  it('formats ok messages with green checkmark', async () => {
    const { fmt } = await import('../../src/cli/utils/cli-helpers');
    expect(fmt.ok('done')).toContain('✓');
    expect(fmt.ok('done')).toContain('done');
    expect(fmt.ok('done')).toContain('\x1b[32m');
  });

  it('formats err messages with red X', async () => {
    const { fmt } = await import('../../src/cli/utils/cli-helpers');
    expect(fmt.err('bad')).toContain('✗');
    expect(fmt.err('bad')).toContain('\x1b[31m');
  });

  it('formats dim text', async () => {
    const { fmt } = await import('../../src/cli/utils/cli-helpers');
    expect(fmt.dim('faded')).toContain('\x1b[2m');
    expect(fmt.dim('faded')).toContain('faded');
  });

  it('formats bold text', async () => {
    const { fmt } = await import('../../src/cli/utils/cli-helpers');
    expect(fmt.bold('strong')).toContain('\x1b[1m');
  });

  it('formats cyan text', async () => {
    const { fmt } = await import('../../src/cli/utils/cli-helpers');
    expect(fmt.cyan('info')).toContain('\x1b[36m');
  });

  it('formats yellow text', async () => {
    const { fmt } = await import('../../src/cli/utils/cli-helpers');
    expect(fmt.yellow('warn')).toContain('\x1b[33m');
  });
});

// ---------------------------------------------------------------------------
// formatError
// ---------------------------------------------------------------------------

describe('formatError', () => {
  it('returns fallback for non-Error', async () => {
    const { formatError } = await import('../../src/cli/utils/cli-helpers');
    expect(formatError(42, 'fallback')).toBe('fallback');
    expect(formatError(null, 'fallback')).toBe('fallback');
    expect(formatError('string', 'fallback')).toBe('fallback');
  });

  it('returns error message for regular Error', async () => {
    const { formatError } = await import('../../src/cli/utils/cli-helpers');
    expect(formatError(new Error('Something broke'), 'fallback')).toBe('Something broke');
  });

  it('maps 401 to session expired message', async () => {
    const { formatError } = await import('../../src/cli/utils/cli-helpers');
    expect(formatError(new Error('Failed: 401'), 'fallback')).toContain('Session expired');
    expect(formatError(new Error('Failed: 401'), 'fallback')).toContain('fw login');
  });

  it('maps Auth failed to session expired message', async () => {
    const { formatError } = await import('../../src/cli/utils/cli-helpers');
    expect(formatError(new Error('Auth failed: 401'), 'fallback')).toContain('Session expired');
  });

  it('passes through 403 error messages', async () => {
    const { formatError } = await import('../../src/cli/utils/cli-helpers');
    const msg = formatError(new Error('Forbidden: requires Pro plan'), 'fallback');
    expect(msg).toContain('requires Pro plan');
  });

  it('passes through 403 status code messages', async () => {
    const { formatError } = await import('../../src/cli/utils/cli-helpers');
    const msg = formatError(new Error('403: Organizations require a Pro plan'), 'fallback');
    expect(msg).toContain('Organizations require a Pro plan');
  });
});

// ---------------------------------------------------------------------------
// exitWithError
// ---------------------------------------------------------------------------

describe('exitWithError', () => {
  it('logs error and exits with code 1', async () => {
    const { exitWithError } = await import('../../src/cli/utils/cli-helpers');

    expect(() => exitWithError(new Error('boom'), 'fallback')).toThrow('process.exit');
    expect(mockExit).toHaveBeenCalledWith(1);
    expect(consoleErrors.join('\n')).toContain('boom');
  });

  it('uses fallback for non-Error', async () => {
    const { exitWithError } = await import('../../src/cli/utils/cli-helpers');

    expect(() => exitWithError(null, 'something failed')).toThrow('process.exit');
    expect(consoleErrors.join('\n')).toContain('something failed');
  });

  it('maps 401 errors to session expired', async () => {
    const { exitWithError } = await import('../../src/cli/utils/cli-helpers');

    expect(() => exitWithError(new Error('401'), 'fallback')).toThrow('process.exit');
    expect(consoleErrors.join('\n')).toContain('Session expired');
  });
});
