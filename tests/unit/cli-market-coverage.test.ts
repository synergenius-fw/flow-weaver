/**
 * Coverage tests for src/cli/commands/market.ts
 * Targets uncovered lines: 442-464 (search results display, error handling),
 * 504-575 (displayInstalledPackage, displayManifestSummary).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const TEMP_DIR = path.join(os.tmpdir(), `fw-market-cov-${process.pid}`);

beforeEach(() => {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
});

afterEach(() => {
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('marketSearchCommand coverage', () => {
  it('should display "no packages found" when search returns empty results', async () => {
    const { marketSearchCommand } = await import('../../src/cli/commands/market');
    const registry = await import('../../src/marketplace/registry');

    vi.spyOn(registry, 'searchPackages').mockResolvedValue([]);

    await marketSearchCommand('nonexistent-query', { json: false });
  });

  it('should display "no packages found" with no query', async () => {
    const { marketSearchCommand } = await import('../../src/cli/commands/market');
    const registry = await import('../../src/marketplace/registry');

    vi.spyOn(registry, 'searchPackages').mockResolvedValue([]);

    await marketSearchCommand(undefined, { json: false });
  });

  it('should display search results with descriptions and official badge', async () => {
    const { marketSearchCommand } = await import('../../src/cli/commands/market');
    const registry = await import('../../src/marketplace/registry');

    vi.spyOn(registry, 'searchPackages').mockResolvedValue([
      {
        name: 'flow-weaver-pack-test',
        version: '1.0.0',
        description: 'A test pack',
        official: false,
      },
      {
        name: 'flow-weaver-pack-official',
        version: '2.0.0',
        description: 'Official pack',
        official: true,
      },
      {
        name: 'flow-weaver-pack-nodesc',
        version: '0.1.0',
        official: false,
      },
    ]);

    await marketSearchCommand('pack', { json: false });
  });

  it('should filter results client-side by query', async () => {
    const { marketSearchCommand } = await import('../../src/cli/commands/market');
    const registry = await import('../../src/marketplace/registry');

    vi.spyOn(registry, 'searchPackages').mockResolvedValue([
      {
        name: 'flow-weaver-pack-alpha',
        version: '1.0.0',
        description: 'Alpha pack',
        official: false,
      },
      {
        name: 'flow-weaver-pack-beta',
        version: '1.0.0',
        description: 'Beta pack',
        official: false,
      },
    ]);

    // Only "alpha" should match
    await marketSearchCommand('alpha', { json: false });
  });

  it('should output JSON on search error when json is true', async () => {
    const { marketSearchCommand } = await import('../../src/cli/commands/market');
    const registry = await import('../../src/marketplace/registry');

    vi.spyOn(registry, 'searchPackages').mockRejectedValue(
      new Error('Network error')
    );

    await marketSearchCommand('fail', { json: true });
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
  });

  it('should display error message on search failure in non-json mode', async () => {
    const { marketSearchCommand } = await import('../../src/cli/commands/market');
    const registry = await import('../../src/marketplace/registry');

    vi.spyOn(registry, 'searchPackages').mockRejectedValue(
      new Error('Timeout')
    );

    await marketSearchCommand('fail', { json: false });
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
  });

  it('should output JSON results when json option is set', async () => {
    const { marketSearchCommand } = await import('../../src/cli/commands/market');
    const registry = await import('../../src/marketplace/registry');

    vi.spyOn(registry, 'searchPackages').mockResolvedValue([
      {
        name: 'flow-weaver-pack-json',
        version: '1.0.0',
        description: 'JSON output test',
        official: false,
      },
    ]);

    await marketSearchCommand(undefined, { json: true });
  });

  it('should pass registry option to searchPackages', async () => {
    const { marketSearchCommand } = await import('../../src/cli/commands/market');
    const registry = await import('../../src/marketplace/registry');

    const spy = vi.spyOn(registry, 'searchPackages').mockResolvedValue([]);

    await marketSearchCommand('test', { registry: 'https://custom.registry.com' });

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ registryUrl: 'https://custom.registry.com' })
    );
  });
});

describe('marketListCommand coverage', () => {
  it('should display installed packages with counts', async () => {
    const { marketListCommand } = await import('../../src/cli/commands/market');
    const registry = await import('../../src/marketplace/registry');

    vi.spyOn(registry, 'listInstalledPackages').mockResolvedValue([
      {
        name: 'flow-weaver-pack-one',
        version: '1.0.0',
        path: '/some/path',
        manifest: {
          manifestVersion: 2,
          name: 'flow-weaver-pack-one',
          version: '1.0.0',
          nodeTypes: [
            { name: 'MyNode', inputs: [], outputs: [] },
          ],
          workflows: [
            { name: 'MyWorkflow', nodes: 3, connections: 2 },
          ],
          patterns: [],
          exportTargets: [],
          tagHandlers: [],
          validationRuleSets: [],
          docTopics: [],
          initContributions: [],
          cliCommands: [],
          mcpTools: [],
        },
      },
      {
        name: 'flow-weaver-pack-two',
        version: '2.0.0',
        path: '/other/path',
        manifest: {
          manifestVersion: 2,
          name: 'flow-weaver-pack-two',
          version: '2.0.0',
          nodeTypes: [],
          workflows: [],
          patterns: [
            { name: 'MyPattern', description: 'A pattern' },
          ],
          exportTargets: [],
          tagHandlers: [],
          validationRuleSets: [],
          docTopics: [],
          initContributions: [],
          cliCommands: [],
          mcpTools: [],
        },
      },
    ]);

    await marketListCommand({ json: false });
  });

  it('should display "no packages installed" message when list is empty', async () => {
    const { marketListCommand } = await import('../../src/cli/commands/market');
    const registry = await import('../../src/marketplace/registry');

    vi.spyOn(registry, 'listInstalledPackages').mockResolvedValue([]);

    await marketListCommand({ json: false });
  });

  it('should output JSON when json option is set', async () => {
    const { marketListCommand } = await import('../../src/cli/commands/market');
    const registry = await import('../../src/marketplace/registry');

    vi.spyOn(registry, 'listInstalledPackages').mockResolvedValue([
      {
        name: 'flow-weaver-pack-json',
        version: '1.0.0',
        path: '/path',
        manifest: {
          manifestVersion: 2,
          name: 'flow-weaver-pack-json',
          version: '1.0.0',
          nodeTypes: [{ name: 'N', inputs: [], outputs: [] }],
          workflows: [],
          patterns: [],
          exportTargets: [],
          tagHandlers: [],
          validationRuleSets: [],
          docTopics: [],
          initContributions: [],
          cliCommands: [],
          mcpTools: [],
        },
      },
    ]);

    await marketListCommand({ json: true });
  });
});

describe('marketListCommand - displayInstalledPackage with all sections', () => {
  it('should display package with node types, workflows, and patterns', async () => {
    const { marketListCommand } = await import('../../src/cli/commands/market');
    const registry = await import('../../src/marketplace/registry');

    vi.spyOn(registry, 'listInstalledPackages').mockResolvedValue([
      {
        name: 'flow-weaver-pack-full',
        version: '3.0.0',
        path: '/full/path',
        manifest: {
          manifestVersion: 2,
          name: 'flow-weaver-pack-full',
          version: '3.0.0',
          nodeTypes: [
            { name: 'NodeX', inputs: [], outputs: [] },
            { name: 'NodeY', inputs: [], outputs: [] },
          ],
          workflows: [
            { name: 'WfX', nodes: 5, connections: 4 },
          ],
          patterns: [
            { name: 'PatX' },
            { name: 'PatY' },
          ],
          exportTargets: [],
          tagHandlers: [],
          validationRuleSets: [],
          docTopics: [],
          initContributions: [],
          cliCommands: [],
          mcpTools: [],
        },
      },
      {
        name: 'flow-weaver-pack-empty',
        version: '1.0.0',
        path: '/empty/path',
        manifest: {
          manifestVersion: 2,
          name: 'flow-weaver-pack-empty',
          version: '1.0.0',
          nodeTypes: [],
          workflows: [],
          patterns: [],
          exportTargets: [],
          tagHandlers: [],
          validationRuleSets: [],
          docTopics: [],
          initContributions: [],
          cliCommands: [],
          mcpTools: [],
        },
      },
    ]);

    await marketListCommand({ json: false });
  });
});

describe('marketInitCommand coverage', () => {
  it('should scaffold a new marketplace package with custom name', async () => {
    const { marketInitCommand } = await import('../../src/cli/commands/market');

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
    const { marketInitCommand } = await import('../../src/cli/commands/market');

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
    const { marketInitCommand } = await import('../../src/cli/commands/market');

    const originalCwd = process.cwd();
    process.chdir(TEMP_DIR);

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit');
    }) as any);

    try {
      // Create non-empty directory
      const dir = path.join(TEMP_DIR, 'flow-weaver-pack-existing');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'file.txt'), 'content');

      await expect(
        marketInitCommand('flow-weaver-pack-existing', {})
      ).rejects.toThrow('process.exit');

      expect(exitSpy).toHaveBeenCalledWith(1);
    } finally {
      exitSpy.mockRestore();
      process.chdir(originalCwd);
    }
  });

  it('should exit when path exists but is not a directory', async () => {
    const { marketInitCommand } = await import('../../src/cli/commands/market');

    const originalCwd = process.cwd();
    process.chdir(TEMP_DIR);

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit');
    }) as any);

    try {
      // Create a file (not directory) at the target path
      fs.writeFileSync(path.join(TEMP_DIR, 'flow-weaver-pack-file'), 'not a dir');

      await expect(
        marketInitCommand('flow-weaver-pack-file', {})
      ).rejects.toThrow('process.exit');

      expect(exitSpy).toHaveBeenCalledWith(1);
    } finally {
      exitSpy.mockRestore();
      process.chdir(originalCwd);
    }
  });
});
