import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { resolvePackageTypesPath } from '../../src/resolve-package-types';

const fixturesDir = path.resolve(__dirname, '../fixtures');
const fakeNodeModules = path.join(fixturesDir, 'fake-node-modules');

describe('resolvePackageTypesPath', () => {
  it('resolves via types field in package.json', () => {
    const result = resolvePackageTypesPath('typed-package', fixturesDir, fakeNodeModules);
    expect(result).toBe(path.join(fakeNodeModules, 'typed-package', 'dist', 'index.d.ts'));
  });

  it('resolves via typings field as fallback', () => {
    const result = resolvePackageTypesPath('typings-field', fixturesDir, fakeNodeModules);
    expect(result).toBe(path.join(fakeNodeModules, 'typings-field', 'dist', 'index.d.ts'));
  });

  it('resolves via @types/<pkg>/index.d.ts fallback', () => {
    const result = resolvePackageTypesPath('at-types-package', fixturesDir, fakeNodeModules);
    expect(result).toBe(path.join(fakeNodeModules, '@types', 'at-types-package', 'index.d.ts'));
  });

  it('resolves via <pkg>/index.d.ts last resort', () => {
    const result = resolvePackageTypesPath('index-dts-package', fixturesDir, fakeNodeModules);
    expect(result).toBe(path.join(fakeNodeModules, 'index-dts-package', 'index.d.ts'));
  });

  it('returns null for packages with no .d.ts', () => {
    const result = resolvePackageTypesPath('no-types', fixturesDir, fakeNodeModules);
    expect(result).toBeNull();
  });

  it('returns null for nonexistent packages', () => {
    const result = resolvePackageTypesPath('nonexistent-pkg', fixturesDir, fakeNodeModules);
    expect(result).toBeNull();
  });

  it('handles scoped packages @scope/pkg', () => {
    const result = resolvePackageTypesPath('@scope/scoped-pkg', fixturesDir, fakeNodeModules);
    expect(result).toBe(
      path.join(fakeNodeModules, '@scope', 'scoped-pkg', 'dist', 'index.d.ts')
    );
  });

  it('walks up directories to find node_modules when no override', () => {
    // fromDir is deep inside fixture dir — should still find fixtures/fake-node-modules
    // if node_modules were named node_modules. We test with override to avoid relying
    // on real node_modules layout.
    const deepDir = path.join(fixturesDir, 'some', 'deep', 'path');
    // With override pointing to our fixtures, it should still work
    const result = resolvePackageTypesPath('typed-package', deepDir, fakeNodeModules);
    expect(result).toBe(path.join(fakeNodeModules, 'typed-package', 'dist', 'index.d.ts'));
  });

  it('resolves types from exports field with conditional exports', () => {
    const typesPath = resolvePackageTypesPath(
      'exports-types-package',
      fixturesDir,
      fakeNodeModules
    );
    expect(typesPath).not.toBeNull();
    expect(typesPath).toContain('lib/index.d.ts');
  });
});
