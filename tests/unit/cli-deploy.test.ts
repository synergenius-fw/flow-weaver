/**
 * Tests for src/cli/commands/deploy.ts (refactored to use cli-helpers).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockExistsSync = vi.hoisted(() => vi.fn().mockReturnValue(true));
const mockReadFileSync = vi.hoisted(() => vi.fn().mockReturnValue('source code'));

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return { ...actual, existsSync: mockExistsSync, readFileSync: mockReadFileSync };
});

const mockPushWorkflow = vi.fn();
const mockDeploy = vi.fn();
const mockUndeploy = vi.fn();
const mockListDeployments = vi.fn();
const mockGetUsage = vi.fn();

vi.mock('../../src/cli/utils/cli-helpers.js', () => ({
  requireLogin: () => ({
    creds: { token: 'jwt', platformUrl: 'https://fw.ai', email: 'u@t.com', plan: 'pro' },
    client: {
      pushWorkflow: mockPushWorkflow,
      deploy: mockDeploy,
      undeploy: mockUndeploy,
      listDeployments: mockListDeployments,
      getUsage: mockGetUsage,
    },
  }),
  fmt: {
    ok: (m: string) => `✓ ${m}`,
    err: (m: string) => `✗ ${m}`,
    dim: (m: string) => m,
    bold: (m: string) => m,
    yellow: (m: string) => m,
  },
  exitWithError: (err: unknown, fallback: string) => {
    console.error(`✗ ${err instanceof Error ? err.message : fallback}`);
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

describe('deployCommand', () => {
  it('deploys a workflow file', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('source code');
    mockPushWorkflow.mockResolvedValue({ slug: 'test', version: 1 });
    mockDeploy.mockResolvedValue({ slug: 'test', status: 'active' });

    const { deployCommand } = await import('../../src/cli/commands/deploy');
    await deployCommand('test.ts');

    const out = consoleOutput.join('\n');
    expect(out).toContain('Pushed');
    expect(out).toContain('Deployed: test');
    expect(out).toContain('https://fw.ai/run/test');
  });

  it('exits when file not found', async () => {
    mockExistsSync.mockReturnValue(false);

    const { deployCommand } = await import('../../src/cli/commands/deploy');
    await expect(deployCommand('nope.ts')).rejects.toThrow('process.exit');
    expect(consoleErrors.join('\n')).toContain('File not found');
  });

  it('exits on push error', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('src');
    mockPushWorkflow.mockRejectedValue(new Error('Push failed'));

    const { deployCommand } = await import('../../src/cli/commands/deploy');
    await expect(deployCommand('test.ts')).rejects.toThrow('process.exit');
    expect(consoleErrors.join('\n')).toContain('Push failed');
  });
});

describe('undeployCommand', () => {
  it('undeploys a slug', async () => {
    mockUndeploy.mockResolvedValue(undefined);

    const { undeployCommand } = await import('../../src/cli/commands/deploy');
    await undeployCommand('test');

    expect(consoleOutput.join('\n')).toContain('Undeployed: test');
  });

  it('exits on error', async () => {
    mockUndeploy.mockRejectedValue(new Error('fail'));

    const { undeployCommand } = await import('../../src/cli/commands/deploy');
    await expect(undeployCommand('test')).rejects.toThrow('process.exit');
  });
});

describe('cloudStatusCommand', () => {
  it('shows deployments and usage', async () => {
    mockListDeployments.mockResolvedValue([
      { slug: 'wf-1', status: 'active' },
      { slug: 'wf-2', status: 'paused' },
    ]);
    mockGetUsage.mockResolvedValue({ executions: 42, aiCalls: 5, plan: 'pro' });

    const { cloudStatusCommand } = await import('../../src/cli/commands/deploy');
    await cloudStatusCommand();

    const out = consoleOutput.join('\n');
    expect(out).toContain('u@t.com');
    expect(out).toContain('wf-1');
    expect(out).toContain('active');
    expect(out).toContain('42');
    expect(out).toContain('5');
  });

  it('shows no deployments message', async () => {
    mockListDeployments.mockResolvedValue([]);
    mockGetUsage.mockResolvedValue({ executions: 0, aiCalls: 0, plan: 'free' });

    const { cloudStatusCommand } = await import('../../src/cli/commands/deploy');
    await cloudStatusCommand();

    expect(consoleOutput.join('\n')).toContain('No deployments');
  });

  it('handles deployment fetch error gracefully', async () => {
    mockListDeployments.mockRejectedValue(new Error('fail'));
    mockGetUsage.mockResolvedValue({ executions: 0, aiCalls: 0, plan: 'free' });

    const { cloudStatusCommand } = await import('../../src/cli/commands/deploy');
    await cloudStatusCommand();

    expect(consoleOutput.join('\n')).toContain('Could not fetch deployments');
  });

  it('handles usage fetch error gracefully', async () => {
    mockListDeployments.mockResolvedValue([]);
    mockGetUsage.mockRejectedValue(new Error('fail'));

    const { cloudStatusCommand } = await import('../../src/cli/commands/deploy');
    await cloudStatusCommand();

    // Should not crash, just skip usage section
    expect(consoleOutput.join('\n')).toContain('No deployments');
  });
});
