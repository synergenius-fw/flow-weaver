/**
 * Tests for device handler discovery from installed pack manifests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'path';

// Mock both fs and glob at the module level for ESM compatibility
vi.mock('glob', () => ({
  glob: vi.fn().mockResolvedValue([]),
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(false),
    readFileSync: vi.fn().mockReturnValue('{}'),
  };
});

import { discoverDeviceHandlers } from '../../src/marketplace/registry';
import { glob } from 'glob';
import { existsSync, readFileSync } from 'fs';

describe('discoverDeviceHandlers', () => {
  beforeEach(() => {
    vi.mocked(glob).mockReset().mockResolvedValue([]);
    vi.mocked(existsSync).mockReset().mockReturnValue(false);
    vi.mocked(readFileSync).mockReset().mockReturnValue('{}');
  });

  it('returns an empty array when no packs are installed', async () => {
    const result = await discoverDeviceHandlers('/tmp/empty-project');
    expect(result).toEqual([]);
    expect(Array.isArray(result)).toBe(true);
  });

  it('returns an empty array when node_modules does not exist', async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    const result = await discoverDeviceHandlers('/tmp/nonexistent-project');
    expect(result).toEqual([]);
  });

  it('returns correct shape when packs have deviceHandlers', async () => {
    const fakeManifest = {
      manifestVersion: 2,
      name: 'flow-weaver-pack-ble',
      version: '1.0.0',
      nodeTypes: [],
      workflows: [],
      patterns: [],
      deviceHandlers: 'dist/device-handlers.js',
    };

    const fakePkgJson = {
      name: 'flow-weaver-pack-ble',
      version: '1.0.0',
    };

    const manifestPath = '/tmp/test-project/node_modules/flow-weaver-pack-ble/flowweaver.manifest.json';
    const pkgDir = path.dirname(manifestPath);

    // listInstalledPackages calls glob twice (two patterns); return match from first only
    vi.mocked(glob)
      .mockResolvedValueOnce([manifestPath])
      .mockResolvedValueOnce([]);
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockImplementation((p: any) => {
      const s = p.toString();
      if (s.endsWith('flowweaver.manifest.json')) return JSON.stringify(fakeManifest);
      if (s.endsWith('package.json')) return JSON.stringify(fakePkgJson);
      throw new Error(`Unexpected read: ${s}`);
    });

    const result = await discoverDeviceHandlers('/tmp/test-project');

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      packageName: 'flow-weaver-pack-ble',
      packagePath: pkgDir,
      entrypoint: path.join(pkgDir, 'dist/device-handlers.js'),
    });

    // Verify the shape has exactly the expected keys
    const keys = Object.keys(result[0]).sort();
    expect(keys).toEqual(['entrypoint', 'packageName', 'packagePath']);
  });

  it('skips packs without deviceHandlers field', async () => {
    const fakeManifest = {
      manifestVersion: 2,
      name: 'flow-weaver-pack-utils',
      version: '1.0.0',
      nodeTypes: [],
      workflows: [],
      patterns: [],
      // no deviceHandlers
    };

    const fakePkgJson = {
      name: 'flow-weaver-pack-utils',
      version: '1.0.0',
    };

    const manifestPath = '/tmp/test-project/node_modules/flow-weaver-pack-utils/flowweaver.manifest.json';

    vi.mocked(glob)
      .mockResolvedValueOnce([manifestPath])
      .mockResolvedValueOnce([]);
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockImplementation((p: any) => {
      const s = p.toString();
      if (s.endsWith('flowweaver.manifest.json')) return JSON.stringify(fakeManifest);
      if (s.endsWith('package.json')) return JSON.stringify(fakePkgJson);
      throw new Error(`Unexpected read: ${s}`);
    });

    const result = await discoverDeviceHandlers('/tmp/test-project');
    expect(result).toHaveLength(0);
  });
});
