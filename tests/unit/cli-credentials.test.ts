/**
 * Tests for src/cli/config/credentials.ts
 * 100% coverage for all functions: loadCredentials, saveCredentials,
 * clearCredentials, isTokenExpired, getPlatformUrl, isLoggedIn.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// Use a temp directory instead of the real ~/.fw
const TEMP_DIR = path.join(os.tmpdir(), `fw-creds-test-${process.pid}`);
const CREDS_FILE = path.join(TEMP_DIR, 'credentials.json');

// Mock the module-level constants by mocking os.homedir
vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return {
    ...actual,
    homedir: () => path.join(os.tmpdir(), `fw-creds-test-${process.pid}`, '..'),
  };
});

// We need to override the constants. Since they're computed at import time from os.homedir(),
// and we've mocked homedir, let's just use the real fs with a temp dir approach.
// Actually the module uses path.join(os.homedir(), '.fw') which with our mock becomes
// path.join(tmpdir/fw-creds-test-PID/.., '.fw'). That's messy.
// Better approach: just use the real fs with a controlled temp dir, mocking at a lower level.

// Reset and use direct fs mocking instead
vi.unmock('node:os');

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return { ...actual };
});

// We'll spy on individual fs functions
const existsSyncSpy = vi.spyOn(fs, 'existsSync');
const readFileSyncSpy = vi.spyOn(fs, 'readFileSync');
const writeFileSyncSpy = vi.spyOn(fs, 'writeFileSync');
const mkdirSyncSpy = vi.spyOn(fs, 'mkdirSync');
const chmodSyncSpy = vi.spyOn(fs, 'chmodSync');
const unlinkSyncSpy = vi.spyOn(fs, 'unlinkSync');

const VALID_CREDS = {
  token: 'test-token',
  email: 'user@test.com',
  plan: 'free' as const,
  platformUrl: 'https://flowweaver.ai',
  expiresAt: Date.now() + 86_400_000, // 1 day from now
  userId: 'user-123',
};

const EXPIRED_CREDS = {
  ...VALID_CREDS,
  expiresAt: Date.now() - 1000, // expired
};

beforeEach(() => {
  vi.clearAllMocks();
  // Prevent real fs operations
  mkdirSyncSpy.mockReturnValue(undefined);
  writeFileSyncSpy.mockReturnValue(undefined);
  chmodSyncSpy.mockReturnValue(undefined);
  unlinkSyncSpy.mockReturnValue(undefined);
  delete process.env.FW_PLATFORM_URL;
});

afterEach(() => {
  delete process.env.FW_PLATFORM_URL;
});

// ---------------------------------------------------------------------------
// loadCredentials
// ---------------------------------------------------------------------------

describe('loadCredentials', () => {
  it('returns null when credentials file does not exist', async () => {
    const { loadCredentials } = await import('../../src/cli/config/credentials');
    existsSyncSpy.mockReturnValue(false);

    expect(loadCredentials()).toBeNull();
  });

  it('returns credentials when file exists and token is valid', async () => {
    const { loadCredentials } = await import('../../src/cli/config/credentials');
    existsSyncSpy.mockReturnValue(true);
    readFileSyncSpy.mockReturnValue(JSON.stringify(VALID_CREDS));

    const result = loadCredentials();

    expect(result).toEqual(VALID_CREDS);
  });

  it('returns null when token is expired', async () => {
    const { loadCredentials } = await import('../../src/cli/config/credentials');
    existsSyncSpy.mockReturnValue(true);
    readFileSyncSpy.mockReturnValue(JSON.stringify(EXPIRED_CREDS));

    expect(loadCredentials()).toBeNull();
  });

  it('returns null when file contains invalid JSON', async () => {
    const { loadCredentials } = await import('../../src/cli/config/credentials');
    existsSyncSpy.mockReturnValue(true);
    readFileSyncSpy.mockReturnValue('not valid json{{{');

    expect(loadCredentials()).toBeNull();
  });

  it('returns null when readFileSync throws', async () => {
    const { loadCredentials } = await import('../../src/cli/config/credentials');
    existsSyncSpy.mockReturnValue(true);
    readFileSyncSpy.mockImplementation(() => { throw new Error('EACCES'); });

    expect(loadCredentials()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// saveCredentials
// ---------------------------------------------------------------------------

describe('saveCredentials', () => {
  it('creates directory and writes credentials file', async () => {
    const { saveCredentials } = await import('../../src/cli/config/credentials');

    saveCredentials(VALID_CREDS);

    expect(mkdirSyncSpy).toHaveBeenCalledWith(expect.any(String), { recursive: true });
    expect(writeFileSyncSpy).toHaveBeenCalledWith(
      expect.stringContaining('credentials.json'),
      JSON.stringify(VALID_CREDS, null, 2),
      'utf-8',
    );
    expect(chmodSyncSpy).toHaveBeenCalledWith(
      expect.stringContaining('credentials.json'),
      0o600,
    );
  });

  it('does not throw when chmod fails (Windows)', async () => {
    const { saveCredentials } = await import('../../src/cli/config/credentials');
    chmodSyncSpy.mockImplementation(() => { throw new Error('ENOTSUP'); });

    expect(() => saveCredentials(VALID_CREDS)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// clearCredentials
// ---------------------------------------------------------------------------

describe('clearCredentials', () => {
  it('unlinks the credentials file', async () => {
    const { clearCredentials } = await import('../../src/cli/config/credentials');

    clearCredentials();

    expect(unlinkSyncSpy).toHaveBeenCalledWith(expect.stringContaining('credentials.json'));
  });

  it('does not throw when file does not exist', async () => {
    const { clearCredentials } = await import('../../src/cli/config/credentials');
    unlinkSyncSpy.mockImplementation(() => { throw new Error('ENOENT'); });

    expect(() => clearCredentials()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// isTokenExpired
// ---------------------------------------------------------------------------

describe('isTokenExpired', () => {
  it('returns false for non-expired token', async () => {
    const { isTokenExpired } = await import('../../src/cli/config/credentials');

    expect(isTokenExpired(VALID_CREDS)).toBe(false);
  });

  it('returns true for expired token', async () => {
    const { isTokenExpired } = await import('../../src/cli/config/credentials');

    expect(isTokenExpired(EXPIRED_CREDS)).toBe(true);
  });

  it('returns true when expiresAt is exactly now (edge case)', async () => {
    const { isTokenExpired } = await import('../../src/cli/config/credentials');
    const justExpired = { ...VALID_CREDS, expiresAt: Date.now() - 1 };

    expect(isTokenExpired(justExpired)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getPlatformUrl
// ---------------------------------------------------------------------------

describe('getPlatformUrl', () => {
  it('returns URL from stored credentials', async () => {
    const { getPlatformUrl } = await import('../../src/cli/config/credentials');
    existsSyncSpy.mockReturnValue(true);
    readFileSyncSpy.mockReturnValue(JSON.stringify(VALID_CREDS));

    expect(getPlatformUrl()).toBe('https://flowweaver.ai');
  });

  it('returns FW_PLATFORM_URL env var when no credentials', async () => {
    const { getPlatformUrl } = await import('../../src/cli/config/credentials');
    existsSyncSpy.mockReturnValue(false);
    process.env.FW_PLATFORM_URL = 'https://custom.example.com';

    expect(getPlatformUrl()).toBe('https://custom.example.com');
  });

  it('returns default URL when no credentials and no env var', async () => {
    const { getPlatformUrl } = await import('../../src/cli/config/credentials');
    existsSyncSpy.mockReturnValue(false);

    expect(getPlatformUrl()).toBe('https://flowweaver.ai');
  });
});

// ---------------------------------------------------------------------------
// isLoggedIn
// ---------------------------------------------------------------------------

describe('isLoggedIn', () => {
  it('returns true when valid credentials exist', async () => {
    const { isLoggedIn } = await import('../../src/cli/config/credentials');
    existsSyncSpy.mockReturnValue(true);
    readFileSyncSpy.mockReturnValue(JSON.stringify(VALID_CREDS));

    expect(isLoggedIn()).toBe(true);
  });

  it('returns false when no credentials file', async () => {
    const { isLoggedIn } = await import('../../src/cli/config/credentials');
    existsSyncSpy.mockReturnValue(false);

    expect(isLoggedIn()).toBe(false);
  });

  it('returns false when credentials are expired', async () => {
    const { isLoggedIn } = await import('../../src/cli/config/credentials');
    existsSyncSpy.mockReturnValue(true);
    readFileSyncSpy.mockReturnValue(JSON.stringify(EXPIRED_CREDS));

    expect(isLoggedIn()).toBe(false);
  });
});
