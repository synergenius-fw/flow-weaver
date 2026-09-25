/**
 * Tests for the createTargetRegistry() path that imports and registers
 * export targets from marketplace packs (with exportTargets defined),
 * including a pack whose declared export does not resolve to a class.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../src/marketplace/registry.js', () => ({
  listInstalledPackages: vi.fn(),
}));

import { createTargetRegistry } from '../../../src/deployment/index.js';
import { listInstalledPackages } from '../../../src/marketplace/registry.js';

const mockedList = vi.mocked(listInstalledPackages);

beforeEach(() => {
  mockedList.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
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

  it('skips a target whose exportName is missing from the module, naming the pack and file', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const os = await import('os');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-missing-export-'));
    const modFile = path.join(tmpDir, 'target.mjs');
    fs.writeFileSync(modFile, `export class Other { constructor() { this.name = 'other'; } }`, 'utf8');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    mockedList.mockResolvedValueOnce([
      {
        name: 'flow-weaver-pack-broken',
        version: '1.0.0',
        path: tmpDir,
        manifest: {
          name: 'flow-weaver-pack-broken',
          version: '1.0.0',
          exportTargets: [
            { name: 'broken-target', file: 'target.mjs', exportName: 'MissingTarget' },
            { name: 'good-target', file: 'target.mjs', exportName: 'Other' },
          ],
        },
      },
    ] as any);

    const registry = await createTargetRegistry('/fake/project');

    // The broken one is not registered; the good one from the same pack still is.
    expect(registry.getNames()).toEqual(['good-target']);
    expect(registry.get('broken-target')).toBeUndefined();
    expect((registry.get('good-target') as any).name).toBe('other');

    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0][0]);
    expect(message).toContain('broken-target');
    expect(message).toContain('flow-weaver-pack-broken');
    expect(message).toContain(modFile);
    expect(message).toContain('MissingTarget');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('skips a target whose export is not a class or function', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const os = await import('os');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-non-callable-export-'));
    const modFile = path.join(tmpDir, 'target.mjs');
    fs.writeFileSync(modFile, `export const MyTarget = { name: 'not a class' };\nexport default 42;`, 'utf8');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    mockedList.mockResolvedValueOnce([
      {
        name: 'flow-weaver-pack-object',
        version: '1.0.0',
        path: tmpDir,
        manifest: {
          name: 'flow-weaver-pack-object',
          version: '1.0.0',
          exportTargets: [
            { name: 'object-target', file: 'target.mjs', exportName: 'MyTarget' },
            { name: 'number-default', file: 'target.mjs' },
          ],
        },
      },
    ] as any);

    const registry = await createTargetRegistry('/fake/project');

    expect(registry.getNames()).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(String(warn.mock.calls[0][0])).toContain('object-target');
    expect(String(warn.mock.calls[1][0])).toContain('number-default');
    expect(String(warn.mock.calls[1][0])).toContain('default export');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty registry when no projectDir is given', async () => {
    const registry = await createTargetRegistry();
    expect(registry.getNames()).toEqual([]);
    expect(mockedList).not.toHaveBeenCalled();
  });
});
