/**
 * Tests for src/cli/commands/market.ts
 * Tests: 442-464 (search results display, error handling),
 * 504-575 (displayInstalledPackage, displayManifestSummary).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type {
  TInstalledPackage,
  TManifestNodeType,
  TManifestWorkflow,
  TMarketplaceManifest,
  TMarketplacePackageInfo,
} from '../../../src/marketplace/types';
import { captureConsole } from '../../helpers/console-capture';

type SearchHit = TMarketplacePackageInfo & { registry: string };

const TEMP_DIR = path.join(os.tmpdir(), `fw-market-cov-${process.pid}`);

beforeEach(() => {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
});

afterEach(() => {
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

function manifest(name: string, parts: Partial<TMarketplaceManifest> = {}): TMarketplaceManifest {
  return { manifestVersion: 2, name, version: '1.0.0', nodeTypes: [], workflows: [], ...parts };
}

function installed(name: string, version: string, parts: Partial<TMarketplaceManifest> = {}): TInstalledPackage {
  return { name, version, path: `/pkgs/${name}`, manifest: manifest(name, { version, ...parts }) };
}

const nodeType = (name: string) => ({ name, inputs: {}, outputs: {} }) as unknown as TManifestNodeType;
const workflow = (name: string) => ({ name }) as unknown as TManifestWorkflow;

describe('marketSearchCommand coverage', () => {
  it('should display "no packages found" when search returns empty results', async () => {
    const { marketSearchCommand } = await import('../../../src/cli/commands/market');
    const registry = await import('../../../src/marketplace/registry');
    vi.spyOn(registry, 'searchAllRegistries').mockResolvedValue({ results: [], searched: [] });
    const out = captureConsole();

    await marketSearchCommand('nonexistent-query', { json: false });

    expect(out.text()).toContain('No packages matching "nonexistent-query"');
    expect(process.exitCode).toBeUndefined();
  });

  it('should display "no packages found" with no query', async () => {
    const { marketSearchCommand } = await import('../../../src/cli/commands/market');
    const registry = await import('../../../src/marketplace/registry');
    vi.spyOn(registry, 'searchAllRegistries').mockResolvedValue({ results: [], searched: [] });
    const out = captureConsole();

    await marketSearchCommand(undefined, { json: false });

    expect(out.text()).toContain('No packages found');
    expect(out.text()).not.toContain('No packages matching');
  });

  it('should display search results with descriptions and official badge', async () => {
    const { marketSearchCommand } = await import('../../../src/cli/commands/market');
    const registry = await import('../../../src/marketplace/registry');
    vi.spyOn(registry, 'searchAllRegistries').mockResolvedValue({ searched: [], results: [
      { name: 'flow-weaver-pack-test', version: '1.0.0', description: 'A test pack', official: false },
      { name: 'flow-weaver-pack-official', version: '2.0.0', description: 'Official pack', official: true },
      { name: 'flow-weaver-pack-nodesc', version: '0.1.0', official: false },
    ] as SearchHit[] });
    const out = captureConsole();

    await marketSearchCommand('pack', { json: false });

    const text = out.text();
    expect(text).toContain('flow-weaver-pack-test@1.0.0\n');
    expect(text).toContain('    A test pack');
    expect(text).toContain('flow-weaver-pack-official@2.0.0 [official]');
    expect(text).toContain('flow-weaver-pack-nodesc@0.1.0');
    expect(text).toContain('3 package(s) found');
  });

  it('should filter results client-side by query', async () => {
    const { marketSearchCommand } = await import('../../../src/cli/commands/market');
    const registry = await import('../../../src/marketplace/registry');
    vi.spyOn(registry, 'searchAllRegistries').mockResolvedValue({ searched: [], results: [
      { name: 'flow-weaver-pack-alpha', version: '1.0.0', description: 'Alpha pack', official: false },
      { name: 'flow-weaver-pack-beta', version: '1.0.0', description: 'Beta pack', official: false },
    ] as SearchHit[] });
    const out = captureConsole();

    await marketSearchCommand('alpha', { json: false });

    expect(out.text()).toContain('flow-weaver-pack-alpha@1.0.0');
    expect(out.text()).not.toContain('flow-weaver-pack-beta');
    expect(out.text()).toContain('1 package(s) found');
  });

  it('should output JSON on search error when json is true', async () => {
    const { marketSearchCommand } = await import('../../../src/cli/commands/market');
    const registry = await import('../../../src/marketplace/registry');
    vi.spyOn(registry, 'searchAllRegistries').mockRejectedValue(new Error('Network error'));
    const out = captureConsole();

    await marketSearchCommand('fail', { json: true });

    expect(JSON.parse(out.text())).toEqual({ error: 'Network error' });
    expect(process.exitCode).toBe(1);
  });

  it('should display error message on search failure in non-json mode', async () => {
    const { marketSearchCommand } = await import('../../../src/cli/commands/market');
    const registry = await import('../../../src/marketplace/registry');
    vi.spyOn(registry, 'searchAllRegistries').mockRejectedValue(new Error('Timeout'));
    const out = captureConsole();

    await marketSearchCommand('fail', { json: false });

    expect(out.of('error')).toContain('Search failed: Timeout');
    expect(process.exitCode).toBe(1);
  });

  it('should output JSON results when json option is set', async () => {
    const { marketSearchCommand } = await import('../../../src/cli/commands/market');
    const registry = await import('../../../src/marketplace/registry');
    const hits = [
      { name: 'flow-weaver-pack-json', version: '1.0.0', description: 'JSON output test', official: false },
    ] as SearchHit[];
    vi.spyOn(registry, 'searchAllRegistries').mockResolvedValue({ searched: [], results: hits });
    const out = captureConsole();

    await marketSearchCommand(undefined, { json: true });

    // JSON mode prints the results and nothing else.
    expect(JSON.parse(out.text())).toEqual(hits);
  });

  it('should pass registry option to searchPackages', async () => {
    const { marketSearchCommand } = await import('../../../src/cli/commands/market');
    const registry = await import('../../../src/marketplace/registry');

    const spy = vi.spyOn(registry, 'searchPackages').mockResolvedValue([]);

    await marketSearchCommand('test', { registry: 'https://custom.registry.com' });

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ registryUrl: 'https://custom.registry.com' })
    );
  });
});

describe('marketListCommand coverage', () => {
  it('should display installed packages with counts', async () => {
    const { marketListCommand } = await import('../../../src/cli/commands/market');
    const registry = await import('../../../src/marketplace/registry');
    vi.spyOn(registry, 'listInstalledPackages').mockResolvedValue([
      installed('flow-weaver-pack-one', '1.0.0', { nodeTypes: [nodeType('MyNode')], workflows: [workflow('MyWorkflow')] }),
      installed('flow-weaver-pack-two', '2.0.0'),
    ]);
    const out = captureConsole();

    await marketListCommand({ json: false });

    const text = out.text();
    expect(text).toContain('flow-weaver-pack-one@1.0.0\n    1 node type(s), 1 workflow(s)');
    // A package with nothing to count gets no counts line.
    expect(text).toContain('flow-weaver-pack-two@2.0.0\n\n');
    expect(text).toContain('2 package(s) installed');
  });

  it('should display "no packages installed" message when list is empty', async () => {
    const { marketListCommand } = await import('../../../src/cli/commands/market');
    const registry = await import('../../../src/marketplace/registry');
    vi.spyOn(registry, 'listInstalledPackages').mockResolvedValue([]);
    const out = captureConsole();

    await marketListCommand({ json: false });

    expect(out.text()).toContain('No marketplace packages installed');
    expect(out.text()).toContain('fw market search');
  });

  it('should output JSON when json option is set', async () => {
    const { marketListCommand } = await import('../../../src/cli/commands/market');
    const registry = await import('../../../src/marketplace/registry');
    vi.spyOn(registry, 'listInstalledPackages').mockResolvedValue([
      installed('flow-weaver-pack-json', '1.0.0', { nodeTypes: [nodeType('N')] }),
    ]);
    const out = captureConsole();

    await marketListCommand({ json: true });

    expect(JSON.parse(out.text())).toEqual([
      { name: 'flow-weaver-pack-json', version: '1.0.0', nodeTypes: 1, workflows: 0 },
    ]);
  });
});

describe('marketListCommand - displayInstalledPackage with all sections', () => {
  it('should display package with node type and workflow counts', async () => {
    const { marketListCommand } = await import('../../../src/cli/commands/market');
    const registry = await import('../../../src/marketplace/registry');
    vi.spyOn(registry, 'listInstalledPackages').mockResolvedValue([
      installed('flow-weaver-pack-full', '3.0.0', {
        nodeTypes: [nodeType('NodeX'), nodeType('NodeY')],
        workflows: [workflow('WfX')],
      }),
      installed('flow-weaver-pack-nodes', '1.0.0', { nodeTypes: [nodeType('Only')] }),
    ]);
    const out = captureConsole();

    await marketListCommand({ json: false });

    const text = out.text();
    expect(text).toContain('flow-weaver-pack-full@3.0.0\n    2 node type(s), 1 workflow(s)');
    expect(text).toContain('flow-weaver-pack-nodes@1.0.0\n    1 node type(s)\n');
  });
});

describe('marketInitCommand coverage', () => {
  it('should scaffold a new marketplace package with custom name', async () => {
    const { marketInitCommand } = await import('../../../src/cli/commands/market');

    const originalCwd = process.cwd();
    process.chdir(TEMP_DIR);

    try {
      await marketInitCommand('flow-weaver-pack-mytest', {
        description: 'Test description',
        author: 'Test Author',
      });

      const targetDir = path.join(TEMP_DIR, 'flow-weaver-pack-mytest');
      expect(fs.existsSync(path.join(targetDir, 'package.json'))).toBe(true);
      expect(fs.existsSync(path.join(targetDir, 'tsconfig.json'))).toBe(true);
      expect(fs.existsSync(path.join(targetDir, 'src', 'node-types', 'sample.ts'))).toBe(true);

      const pkg = JSON.parse(fs.readFileSync(path.join(targetDir, 'package.json'), 'utf-8'));
      expect(pkg.description).toBe('Test description');
      expect(pkg.author).toBe('Test Author');
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('should auto-prefix name with flow-weaver-pack-', async () => {
    const { marketInitCommand } = await import('../../../src/cli/commands/market');

    const originalCwd = process.cwd();
    process.chdir(TEMP_DIR);

    try {
      await marketInitCommand('mypack', {});

      const targetDir = path.join(TEMP_DIR, 'flow-weaver-pack-mypack');
      expect(fs.existsSync(targetDir)).toBe(true);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('should exit when directory exists and is not empty', async () => {
    const { marketInitCommand } = await import('../../../src/cli/commands/market');

    const originalCwd = process.cwd();
    process.chdir(TEMP_DIR);

    try {
      // Create non-empty directory
      const dir = path.join(TEMP_DIR, 'flow-weaver-pack-existing');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'file.txt'), 'content');

      await expect(
        marketInitCommand('flow-weaver-pack-existing', {})
      ).rejects.toThrow(/already exists.*not empty/);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('should exit when path exists but is not a directory', async () => {
    const { marketInitCommand } = await import('../../../src/cli/commands/market');

    const originalCwd = process.cwd();
    process.chdir(TEMP_DIR);

    try {
      // Create a file (not directory) at the target path
      fs.writeFileSync(path.join(TEMP_DIR, 'flow-weaver-pack-file'), 'not a dir');

      await expect(
        marketInitCommand('flow-weaver-pack-file', {})
      ).rejects.toThrow(/not a directory/);
    } finally {
      process.chdir(originalCwd);
    }
  });
});
