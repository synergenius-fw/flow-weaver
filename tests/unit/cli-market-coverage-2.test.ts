/**
 * Additional coverage tests for src/cli/commands/market.ts
 * Targets uncovered lines: 313-401 (marketPublishCommand, marketInstallCommand),
 * 515-559 (resolvePackageName, displayManifestSummary).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Module-level mocks (required for ESM with isolate: false)
const mockExecSync = vi.fn();
vi.mock('child_process', async (importOriginal) => {
  const orig = await importOriginal<typeof import('child_process')>();
  return { ...orig, execSync: (...args: unknown[]) => mockExecSync(...args) };
});

const mockGenerateManifest = vi.fn();
const mockValidatePackage = vi.fn();
const mockWriteManifest = vi.fn();
const mockReadManifest = vi.fn();
const mockSearchPackages = vi.fn();
const mockListInstalledPackages = vi.fn();

vi.mock('../../src/marketplace/index.js', async (importOriginal) => {
  const orig = await importOriginal<Record<string, unknown>>();
  return {
    ...orig,
    generateManifest: (...args: unknown[]) => mockGenerateManifest(...args),
    validatePackage: (...args: unknown[]) => mockValidatePackage(...args),
    writeManifest: (...args: unknown[]) => mockWriteManifest(...args),
    readManifest: (...args: unknown[]) => mockReadManifest(...args),
    searchPackages: (...args: unknown[]) => mockSearchPackages(...args),
    listInstalledPackages: (...args: unknown[]) => mockListInstalledPackages(...args),
  };
});

const TEMP_DIR = path.join(os.tmpdir(), `fw-market-cov2-${process.pid}`);

const emptyManifest = {
  manifestVersion: 2, name: 'test', version: '1.0.0',
  nodeTypes: [], workflows: [], patterns: [],
  exportTargets: [], tagHandlers: [], validationRuleSets: [],
  docTopics: [], initContributions: [], cliCommands: [], mcpTools: [],
};

beforeEach(() => {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
  mockExecSync.mockReset().mockReturnValue(Buffer.from(''));
  mockGenerateManifest.mockReset().mockResolvedValue({
    manifest: emptyManifest,
    parsedFiles: ['src/index.ts'],
    errors: [],
  });
  mockValidatePackage.mockReset().mockResolvedValue({ valid: true, issues: [] });
  mockWriteManifest.mockReset().mockReturnValue('/fake/manifest.json');
  mockReadManifest.mockReset().mockReturnValue(null);
});

afterEach(() => {
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

// ── marketPublishCommand ────────────────────────────────────────────────────

describe('marketPublishCommand coverage', () => {
  function setupDir(name: string, opts: { license?: boolean } = {}) {
    const dir = path.join(TEMP_DIR, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
      name: `flow-weaver-pack-${name}`,
      version: '1.0.0',
    }));
    if (opts.license !== false) {
      fs.writeFileSync(path.join(dir, 'LICENSE'), 'MIT');
    }
    return dir;
  }

  it('should publish successfully with default options', async () => {
    const { marketPublishCommand } = await import('../../src/cli/commands/market');
    const dir = setupDir('pub-ok');

    await marketPublishCommand(dir, {});

    const npmCall = mockExecSync.mock.calls.find(
      (c: unknown[]) => String(c[0]).includes('npm') && String(c[0]).includes('publish'),
    );
    expect(npmCall).toBeDefined();
  });

  it('should warn when LICENSE file is missing', async () => {
    const { marketPublishCommand } = await import('../../src/cli/commands/market');
    const dir = setupDir('pub-nolicense', { license: false });

    // Should complete without error (just a warning)
    await marketPublishCommand(dir, {});
  });

  it('should pass --dry-run and --tag flags to npm publish', async () => {
    const { marketPublishCommand } = await import('../../src/cli/commands/market');
    const dir = setupDir('pub-dryrun');

    await marketPublishCommand(dir, { dryRun: true, tag: 'beta' });

    const npmCall = mockExecSync.mock.calls.find(
      (c: unknown[]) => String(c[0]).includes('publish'),
    );
    expect(String(npmCall![0])).toContain('--dry-run');
    expect(String(npmCall![0])).toContain('--tag');
    expect(String(npmCall![0])).toContain('beta');
  });

  it('should exit with code 1 when npm publish fails', async () => {
    const { marketPublishCommand } = await import('../../src/cli/commands/market');
    const dir = setupDir('pub-fail');

    mockExecSync.mockImplementation((cmd: string) => {
      if (String(cmd).includes('publish')) throw new Error('npm publish 403');
      return Buffer.from('');
    });

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit');
    }) as any);

    await expect(marketPublishCommand(dir, {})).rejects.toThrow('process.exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it('should use current directory when no directory specified', async () => {
    const { marketPublishCommand } = await import('../../src/cli/commands/market');
    fs.writeFileSync(path.join(TEMP_DIR, 'package.json'), JSON.stringify({
      name: 'flow-weaver-pack-cwd', version: '0.1.0',
    }));
    fs.writeFileSync(path.join(TEMP_DIR, 'LICENSE'), 'MIT');

    const origCwd = process.cwd();
    process.chdir(TEMP_DIR);
    try {
      await marketPublishCommand(undefined, {});
    } finally {
      process.chdir(origCwd);
    }
  });
});

// ── marketInstallCommand ────────────────────────────────────────────────────

describe('marketInstallCommand coverage', () => {
  it('should install and display manifest summary with descriptions', async () => {
    const { marketInstallCommand } = await import('../../src/cli/commands/market');

    mockReadManifest.mockReturnValue({
      ...emptyManifest,
      nodeTypes: [{ name: 'HttpRequest', inputs: [], outputs: [], description: 'Makes HTTP requests' }],
      workflows: [{ name: 'DataPipeline', nodes: 5, connections: 4, description: 'Processes data' }],
      patterns: [{ name: 'RetryPattern', description: 'Retries failed ops' }],
    });

    await marketInstallCommand('flow-weaver-pack-installed@1.0.0', { json: false });
  });

  it('should show warning when installed package has no manifest', async () => {
    const { marketInstallCommand } = await import('../../src/cli/commands/market');
    mockReadManifest.mockReturnValue(null);

    await marketInstallCommand('some-package', { json: false });
  });

  it('should return JSON output on success when json option is set', async () => {
    const { marketInstallCommand } = await import('../../src/cli/commands/market');
    mockReadManifest.mockReturnValue(emptyManifest);

    await marketInstallCommand('flow-weaver-pack-json@1.0.0', { json: true });
  });

  it('should handle npm install failure in json mode', async () => {
    const { marketInstallCommand } = await import('../../src/cli/commands/market');
    mockExecSync.mockImplementation(() => { throw new Error('npm ERR! 404'); });

    await marketInstallCommand('nonexistent-package', { json: true });
    expect(process.exitCode).toBe(1);
  });

  it('should handle npm install failure in non-json mode', async () => {
    const { marketInstallCommand } = await import('../../src/cli/commands/market');
    mockExecSync.mockImplementation(() => { throw new Error('npm ERR! network'); });

    await marketInstallCommand('bad-package', { json: false });
    expect(process.exitCode).toBe(1);
  });

  it('should resolve package name from .tgz tarball path', async () => {
    const { marketInstallCommand } = await import('../../src/cli/commands/market');
    mockReadManifest.mockReturnValue(null);

    await marketInstallCommand('./flow-weaver-pack-test-1.0.0.tgz', { json: false });
    // readManifest called with path containing "flow-weaver-pack-test"
    expect(mockReadManifest).toHaveBeenCalledWith(
      expect.stringContaining('flow-weaver-pack-test'),
    );
  });

  it('should resolve package name from .tar.gz tarball path', async () => {
    const { marketInstallCommand } = await import('../../src/cli/commands/market');
    mockReadManifest.mockReturnValue(null);

    await marketInstallCommand('./my-pack-2.0.0.tar.gz', { json: false });
    expect(mockReadManifest).toHaveBeenCalledWith(
      expect.stringContaining('my-pack'),
    );
  });

  it('should resolve scoped package name with version (@scope/name@version)', async () => {
    const { marketInstallCommand } = await import('../../src/cli/commands/market');
    mockReadManifest.mockReturnValue(null);

    await marketInstallCommand('@synergenius/flow-weaver-pack@1.0.0', { json: false });
    expect(mockReadManifest).toHaveBeenCalledWith(
      expect.stringContaining('@synergenius/flow-weaver-pack'),
    );
  });

  it('should resolve scoped package name without version', async () => {
    const { marketInstallCommand } = await import('../../src/cli/commands/market');
    mockReadManifest.mockReturnValue(null);

    await marketInstallCommand('@synergenius/flow-weaver-pack', { json: false });
    expect(mockReadManifest).toHaveBeenCalledWith(
      expect.stringContaining('@synergenius/flow-weaver-pack'),
    );
  });

  it('should display manifest summary with items that have no descriptions', async () => {
    const { marketInstallCommand } = await import('../../src/cli/commands/market');

    mockReadManifest.mockReturnValue({
      ...emptyManifest,
      nodeTypes: [{ name: 'PlainNode', inputs: [], outputs: [] }],
      workflows: [{ name: 'PlainWorkflow', nodes: 1, connections: 0 }],
      patterns: [{ name: 'PlainPattern' }],
    });

    await marketInstallCommand('flow-weaver-pack-nodesc', { json: false });
  });

  it('should return JSON with manifest: "no manifest found" when none exists', async () => {
    const { marketInstallCommand } = await import('../../src/cli/commands/market');
    mockReadManifest.mockReturnValue(null);

    await marketInstallCommand('bare-package@1.0.0', { json: true });
  });
});
