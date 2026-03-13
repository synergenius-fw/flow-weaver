/**
 * Additional coverage for src/deployment/index.ts lines 124-133:
 * the createTargetRegistry() path that actually imports and registers
 * export targets from marketplace packs (with exportTargets defined).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/marketplace/registry.js', () => ({
  listInstalledPackages: vi.fn(),
}));

import { createTargetRegistry } from '../../src/deployment/index.js';
import { listInstalledPackages } from '../../src/marketplace/registry.js';
import { BaseExportTarget, ExportTargetRegistry } from '../../src/deployment/targets/base.js';

const mockedList = vi.mocked(listInstalledPackages);

beforeEach(() => {
  mockedList.mockReset();
});

describe('createTargetRegistry - export target discovery', () => {
  it('imports and registers a target with named export', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const os = await import('os');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-named-export-'));
    const modFile = path.join(tmpDir, 'target.mjs');

    fs.writeFileSync(
      modFile,
      `export class MyTarget { constructor() { this.name = 'named'; } }`,
      'utf8',
    );

    mockedList.mockResolvedValueOnce([
      {
        name: 'flow-weaver-pack-named',
        version: '1.0.0',
        path: tmpDir,
        manifest: {
          name: 'flow-weaver-pack-named',
          version: '1.0.0',
          exportTargets: [
            { name: 'named-target', file: 'target.mjs', exportName: 'MyTarget' },
          ],
        },
      },
    ] as any);

    const registry = await createTargetRegistry('/fake/project');
    expect(registry.getNames()).toContain('named-target');
    const target = registry.get('named-target');
    expect((target as any).name).toBe('named');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('imports default export when exportName is not specified', async () => {
    // Create a temporary module that has a default export
    const fs = await import('fs');
    const path = await import('path');
    const os = await import('os');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-target-test-'));
    const modFile = path.join(tmpDir, 'target.mjs');

    fs.writeFileSync(
      modFile,
      `export default class TestTarget { constructor() { this.name = 'test'; } }`,
      'utf8',
    );

    mockedList.mockResolvedValueOnce([
      {
        name: 'flow-weaver-pack-default',
        version: '1.0.0',
        path: tmpDir,
        manifest: {
          name: 'flow-weaver-pack-default',
          version: '1.0.0',
          exportTargets: [
            { name: 'default-target', file: 'target.mjs' },
          ],
        },
      },
    ] as any);

    const registry = await createTargetRegistry('/fake/project');
    expect(registry.getNames()).toContain('default-target');
    // Instantiate the lazy factory to verify it works
    const target = registry.get('default-target');
    expect(target).toBeDefined();
    expect((target as any).name).toBe('test');

    // Clean up
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty registry when no projectDir is given', async () => {
    const registry = await createTargetRegistry();
    expect(registry.getNames()).toEqual([]);
    expect(mockedList).not.toHaveBeenCalled();
  });
});
