import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock credentials module
vi.mock('../../src/cli/config/credentials.js', () => ({
  saveCredentials: vi.fn(),
  loadCredentials: vi.fn(),
  clearCredentials: vi.fn(),
  getPlatformUrl: vi.fn(() => 'https://app.synergenius.pt'),
}));

// Mock platform-client module
const mockGetUser = vi.fn();
vi.mock('../../src/cli/config/platform-client.js', () => {
  return {
    PlatformClient: vi.fn().mockImplementation(function (this: any) {
      this.getUser = mockGetUser;
    }),
  };
});

// Mock readline to avoid interactive prompts
vi.mock('node:readline', () => ({
  createInterface: vi.fn(() => ({
    question: vi.fn((_msg: string, cb: (answer: string) => void) => cb('test-password')),
    close: vi.fn(),
  })),
}));

import { loginCommand, logoutCommand, authStatusCommand } from '../../src/cli/commands/auth.js';
import { saveCredentials, loadCredentials, clearCredentials, getPlatformUrl } from '../../src/cli/config/credentials.js';
import { PlatformClient } from '../../src/cli/config/platform-client.js';

describe('auth commands', () => {
  let logOutput: string[];
  let errorOutput: string[];
  let originalConsoleLog: typeof console.log;
  let originalConsoleError: typeof console.error;
  let originalProcessExit: typeof process.exit;
  let exitCode: number | undefined;

  beforeEach(() => {
    logOutput = [];
    errorOutput = [];
    exitCode = undefined;

    originalConsoleLog = console.log;
    originalConsoleError = console.error;
    originalProcessExit = process.exit;

    console.log = vi.fn((...args: unknown[]) => {
      logOutput.push(args.map(String).join(' '));
    });
    console.error = vi.fn((...args: unknown[]) => {
      errorOutput.push(args.map(String).join(' '));
    });
    // Mock process.exit to throw so we can catch it without actually exiting
    process.exit = vi.fn((code?: number) => {
      exitCode = code as number;
      throw new Error(`process.exit(${code})`);
    }) as never;

    vi.mocked(getPlatformUrl).mockReturnValue('https://app.synergenius.pt');
    vi.clearAllMocks();
  });

  afterEach(() => {
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    process.exit = originalProcessExit;
    vi.restoreAllMocks();
  });

  describe('loginCommand', () => {
    it('checks platform reachability first', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({ ok: true }) // /ready
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ token: 'jwt-tok', user: { id: 'u1', email: 'a@b.com', plan: 'free' } }),
        });
      vi.stubGlobal('fetch', fetchMock);

      await loginCommand({ email: 'a@b.com' });

      expect(fetchMock).toHaveBeenCalledWith('https://app.synergenius.pt/ready');
    });

    it('fails if platform unreachable', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

      await expect(loginCommand({})).rejects.toThrow('process.exit');
      expect(exitCode).toBe(1);
      expect(errorOutput.some(l => l.includes('Cannot connect to platform'))).toBe(true);
    });

    it('with API key: validates key, saves credentials', async () => {
      mockGetUser.mockResolvedValue({ id: 'u1', email: 'key@test.com', plan: 'pro', name: 'Test' });

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true })); // /ready

      await loginCommand({ apiKey: 'fw_test_key_123' });

      expect(mockGetUser).toHaveBeenCalled();
      expect(saveCredentials).toHaveBeenCalledWith(
        expect.objectContaining({
          token: 'fw_test_key_123',
          email: 'key@test.com',
          plan: 'pro',
        }),
      );
      expect(logOutput.some(l => l.includes('key@test.com'))).toBe(true);
    });

    it('with API key: fails on invalid key', async () => {
      mockGetUser.mockRejectedValue(new Error('Auth failed: 401'));

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true })); // /ready

      await expect(loginCommand({ apiKey: 'fw_bad_key' })).rejects.toThrow('process.exit');
      expect(exitCode).toBe(1);
      expect(errorOutput.some(l => l.includes('Invalid API key'))).toBe(true);
    });

    it('with email/password: calls /auth/login, saves JWT', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({ ok: true }) // /ready
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            token: 'jwt-token-abc',
            user: { id: 'u2', email: 'user@test.com', plan: 'business' },
          }),
        });
      vi.stubGlobal('fetch', fetchMock);

      await loginCommand({ email: 'user@test.com' });

      // Second fetch call should be to /auth/login
      expect(fetchMock).toHaveBeenCalledWith(
        'https://app.synergenius.pt/auth/login',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      expect(saveCredentials).toHaveBeenCalledWith(
        expect.objectContaining({
          token: 'jwt-token-abc',
          email: 'user@test.com',
          plan: 'business',
        }),
      );
      expect(logOutput.some(l => l.includes('user@test.com'))).toBe(true);
    });

    it('with email/password: fails on wrong credentials', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({ ok: true }) // /ready
        .mockResolvedValueOnce({
          ok: false,
          json: async () => ({ error: 'Invalid email or password' }),
        });
      vi.stubGlobal('fetch', fetchMock);

      await expect(loginCommand({ email: 'wrong@test.com' })).rejects.toThrow('process.exit');
      expect(exitCode).toBe(1);
      expect(errorOutput.some(l => l.includes('Invalid email or password'))).toBe(true);
    });
  });

  describe('logoutCommand', () => {
    it('clears credentials', async () => {
      await logoutCommand();

      expect(clearCredentials).toHaveBeenCalled();
      expect(logOutput.some(l => l.includes('Logged out'))).toBe(true);
    });
  });

  describe('authStatusCommand', () => {
    it('shows email and plan when logged in', async () => {
      vi.mocked(loadCredentials).mockReturnValue({
        token: 'tok',
        email: 'status@test.com',
        plan: 'pro',
        platformUrl: 'https://app.synergenius.pt',
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      });

      await authStatusCommand();

      expect(logOutput.some(l => l.includes('status@test.com'))).toBe(true);
      expect(logOutput.some(l => l.includes('pro'))).toBe(true);
    });

    it('shows "not logged in" when no credentials', async () => {
      vi.mocked(loadCredentials).mockReturnValue(null);

      await authStatusCommand();

      expect(logOutput.some(l => l.includes('Not logged in'))).toBe(true);
    });
  });
});
