/**
 * Tests for src/cli/config/credentials.ts
 * Covers save, load, clear credentials, token expiry, platform URL resolution, and login status.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// Compute fake home using real os.tmpdir before mocks kick in
const REAL_TMPDIR = os.tmpdir();
const fakeHome = path.join(REAL_TMPDIR, 'fw-cred-test-home');

// vi.mock calls are hoisted to the top of the file by vitest.
// The homedir mock must return fakeHome immediately so the module-level
// constant FW_CONFIG_DIR is computed correctly at import time.
vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  const fakePath = path.join(actual.tmpdir(), 'fw-cred-test-home');
  return {
    ...actual,
    homedir: vi.fn().mockReturnValue(fakePath),
  };
});

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    chmodSync: vi.fn(),
    unlinkSync: vi.fn(),
  };
});

const expectedConfigDir = path.join(fakeHome, '.fw');
const expectedCredsFile = path.join(expectedConfigDir, 'credentials.json');

import {
  saveCredentials,
  loadCredentials,
  clearCredentials,
  isTokenExpired,
  getPlatformUrl,
  isLoggedIn,
  type StoredCredentials,
} from '../../src/cli/config/credentials.js';

function makeCreds(overrides: Partial<StoredCredentials> = {}): StoredCredentials {
  return {
    token: 'test-jwt-token',
    email: 'user@example.com',
    plan: 'pro',
    platformUrl: 'https://app.synergenius.pt',
    expiresAt: Date.now() + 3600_000,
    ...overrides,
  };
}

describe('credentials', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-apply the homedir mock after clearAllMocks resets it
    (os.homedir as ReturnType<typeof vi.fn>).mockReturnValue(fakeHome);
    delete process.env.FW_PLATFORM_URL;
  });

  afterEach(() => {
    delete process.env.FW_PLATFORM_URL;
  });

  // ── saveCredentials ──────────────────────────────────────────────

  describe('saveCredentials', () => {
    it('writes JSON to ~/.fw/credentials.json', () => {
      const creds = makeCreds();
      saveCredentials(creds);

      expect(fs.mkdirSync).toHaveBeenCalledWith(expectedConfigDir, { recursive: true });
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expectedCredsFile,
        JSON.stringify(creds, null, 2),
        'utf-8',
      );
    });

    it('creates directory if missing (recursive)', () => {
      saveCredentials(makeCreds());
      expect(fs.mkdirSync).toHaveBeenCalledWith(expectedConfigDir, { recursive: true });
    });

    it('sets file permissions to 0o600', () => {
      saveCredentials(makeCreds());
      expect(fs.chmodSync).toHaveBeenCalledWith(expectedCredsFile, 0o600);
    });

    it('does not throw if chmodSync fails (Windows)', () => {
      (fs.chmodSync as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('Not supported');
      });
      expect(() => saveCredentials(makeCreds())).not.toThrow();
    });
  });

  // ── loadCredentials ──────────────────────────────────────────────

  describe('loadCredentials', () => {
    it('returns stored data when file exists and token is valid', () => {
      const creds = makeCreds();
      (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify(creds));

      const result = loadCredentials();
      expect(result).toEqual(creds);
    });

    it('returns null if file is missing', () => {
      (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);

      expect(loadCredentials()).toBeNull();
      expect(fs.readFileSync).not.toHaveBeenCalled();
    });

    it('returns null if token is expired', () => {
      const creds = makeCreds({ expiresAt: Date.now() - 1000 });
      (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify(creds));

      expect(loadCredentials()).toBeNull();
    });

    it('returns null if file contains invalid JSON', () => {
      (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue('not json');

      expect(loadCredentials()).toBeNull();
    });
  });

  // ── clearCredentials ─────────────────────────────────────────────

  describe('clearCredentials', () => {
    it('removes the credentials file', () => {
      clearCredentials();
      expect(fs.unlinkSync).toHaveBeenCalledWith(expectedCredsFile);
    });

    it('does not throw if file is missing', () => {
      (fs.unlinkSync as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('ENOENT');
      });
      expect(() => clearCredentials()).not.toThrow();
    });
  });

  // ── isTokenExpired ───────────────────────────────────────────────

  describe('isTokenExpired', () => {
    it('returns true when past expiry', () => {
      const creds = makeCreds({ expiresAt: Date.now() - 1000 });
      expect(isTokenExpired(creds)).toBe(true);
    });

    it('returns false when not expired', () => {
      const creds = makeCreds({ expiresAt: Date.now() + 3600_000 });
      expect(isTokenExpired(creds)).toBe(false);
    });

    it('returns false when expiresAt equals current time (boundary)', () => {
      const now = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(now);
      const creds = makeCreds({ expiresAt: now });
      // Date.now() > expiresAt is false when equal
      expect(isTokenExpired(creds)).toBe(false);
      vi.restoreAllMocks();
    });
  });

  // ── getPlatformUrl ───────────────────────────────────────────────

  describe('getPlatformUrl', () => {
    it('returns stored URL when logged in', () => {
      const creds = makeCreds({ platformUrl: 'https://custom.example.com' });
      (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify(creds));

      expect(getPlatformUrl()).toBe('https://custom.example.com');
    });

    it('returns env var FW_PLATFORM_URL when not logged in', () => {
      (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
      process.env.FW_PLATFORM_URL = 'https://env.example.com';

      expect(getPlatformUrl()).toBe('https://env.example.com');
    });

    it('returns default URL when neither credentials nor env var exist', () => {
      (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
      delete process.env.FW_PLATFORM_URL;

      expect(getPlatformUrl()).toBe('https://app.synergenius.pt');
    });
  });

  // ── isLoggedIn ───────────────────────────────────────────────────

  describe('isLoggedIn', () => {
    it('returns true when valid credentials exist', () => {
      const creds = makeCreds();
      (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify(creds));

      expect(isLoggedIn()).toBe(true);
    });

    it('returns false when no credentials file exists', () => {
      (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);

      expect(isLoggedIn()).toBe(false);
    });

    it('returns false when token is expired', () => {
      const creds = makeCreds({ expiresAt: Date.now() - 1000 });
      (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify(creds));

      expect(isLoggedIn()).toBe(false);
    });
  });
});
