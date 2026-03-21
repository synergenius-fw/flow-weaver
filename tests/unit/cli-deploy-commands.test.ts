import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock credentials module
vi.mock('../../src/cli/config/credentials.js', () => ({
  loadCredentials: vi.fn(),
}));

// Mock platform-client module
const mockPushWorkflow = vi.fn();
const mockDeploy = vi.fn();
const mockUndeploy = vi.fn();
const mockListDeployments = vi.fn();
const mockGetUsage = vi.fn();

vi.mock('../../src/cli/config/platform-client.js', () => {
  return {
    PlatformClient: vi.fn().mockImplementation(function (this: any) {
      this.pushWorkflow = mockPushWorkflow;
      this.deploy = mockDeploy;
      this.undeploy = mockUndeploy;
      this.listDeployments = mockListDeployments;
      this.getUsage = mockGetUsage;
    }),
  };
});

// Mock node:fs
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});

import { deployCommand, undeployCommand, cloudStatusCommand } from '../../src/cli/commands/deploy.js';
import { loadCredentials } from '../../src/cli/config/credentials.js';
import * as fs from 'node:fs';

const fakeCreds = {
  token: 'test-token',
  email: 'deploy@test.com',
  plan: 'pro' as const,
  platformUrl: 'https://app.synergenius.pt',
  expiresAt: Date.now() + 86400000,
};

describe('deploy commands', () => {
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
    process.exit = vi.fn((code?: number) => {
      exitCode = code as number;
      throw new Error(`process.exit(${code})`);
    }) as never;

    vi.clearAllMocks();
  });

  afterEach(() => {
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    process.exit = originalProcessExit;
  });

  describe('deployCommand', () => {
    it('fails if not logged in', async () => {
      vi.mocked(loadCredentials).mockReturnValue(null);

      await expect(deployCommand('workflow.ts')).rejects.toThrow('process.exit');
      expect(exitCode).toBe(1);
      expect(errorOutput.some(l => l.includes('Not logged in'))).toBe(true);
    });

    it('fails if file not found', async () => {
      vi.mocked(loadCredentials).mockReturnValue(fakeCreds);
      vi.mocked(fs.existsSync).mockReturnValue(false);

      await expect(deployCommand('missing.ts')).rejects.toThrow('process.exit');
      expect(exitCode).toBe(1);
      expect(errorOutput.some(l => l.includes('File not found'))).toBe(true);
    });

    it('pushes source and deploys', async () => {
      vi.mocked(loadCredentials).mockReturnValue(fakeCreds);
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('workflow source code');

      mockPushWorkflow.mockResolvedValue({ slug: 'my-workflow', version: 3 });
      mockDeploy.mockResolvedValue({ slug: 'my-workflow', status: 'active' });

      await deployCommand('my-workflow.ts');

      expect(mockPushWorkflow).toHaveBeenCalledWith('my-workflow', 'workflow source code');
      expect(mockDeploy).toHaveBeenCalledWith('my-workflow');
    });

    it('shows deployed URL on success', async () => {
      vi.mocked(loadCredentials).mockReturnValue(fakeCreds);
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('source');

      mockPushWorkflow.mockResolvedValue({ slug: 'test-wf', version: 1 });
      mockDeploy.mockResolvedValue({ slug: 'test-wf', status: 'active' });

      await deployCommand('test-wf.ts');

      expect(logOutput.some(l => l.includes('Deployed: test-wf'))).toBe(true);
      expect(logOutput.some(l => l.includes('/run/test-wf'))).toBe(true);
    });

    it('shows error on push failure', async () => {
      vi.mocked(loadCredentials).mockReturnValue(fakeCreds);
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('source');

      mockPushWorkflow.mockRejectedValue(new Error('Push failed: 500'));

      await expect(deployCommand('fail.ts')).rejects.toThrow('process.exit');
      expect(exitCode).toBe(1);
      expect(errorOutput.some(l => l.includes('Push failed: 500'))).toBe(true);
    });
  });

  describe('undeployCommand', () => {
    it('calls client.undeploy', async () => {
      vi.mocked(loadCredentials).mockReturnValue(fakeCreds);
      mockUndeploy.mockResolvedValue(undefined);

      await undeployCommand('my-slug');

      expect(mockUndeploy).toHaveBeenCalledWith('my-slug');
      expect(logOutput.some(l => l.includes('Undeployed: my-slug'))).toBe(true);
    });

    it('fails if not logged in', async () => {
      vi.mocked(loadCredentials).mockReturnValue(null);

      await expect(undeployCommand('my-slug')).rejects.toThrow('process.exit');
      expect(exitCode).toBe(1);
      expect(errorOutput.some(l => l.includes('Not logged in'))).toBe(true);
    });
  });

  describe('cloudStatusCommand', () => {
    it('shows deployments when logged in', async () => {
      vi.mocked(loadCredentials).mockReturnValue(fakeCreds);
      mockListDeployments.mockResolvedValue([
        { slug: 'wf-one', status: 'active' },
        { slug: 'wf-two', status: 'stopped' },
      ]);
      mockGetUsage.mockResolvedValue({ executions: 42, aiCalls: 10, plan: 'pro' });

      await cloudStatusCommand();

      expect(logOutput.some(l => l.includes('deploy@test.com'))).toBe(true);
      expect(logOutput.some(l => l.includes('wf-one'))).toBe(true);
      expect(logOutput.some(l => l.includes('wf-two'))).toBe(true);
    });

    it('shows "not logged in" when no credentials', async () => {
      vi.mocked(loadCredentials).mockReturnValue(null);

      await cloudStatusCommand();

      expect(logOutput.some(l => l.includes('Not logged in'))).toBe(true);
    });

    it('handles empty deployments', async () => {
      vi.mocked(loadCredentials).mockReturnValue(fakeCreds);
      mockListDeployments.mockResolvedValue([]);
      mockGetUsage.mockResolvedValue({ executions: 0, aiCalls: 0, plan: 'pro' });

      await cloudStatusCommand();

      expect(logOutput.some(l => l.includes('No deployments'))).toBe(true);
    });
  });
});
