import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { getTypedPackages, getPackageExports } from '../../src/npm-packages';

const fixturesDir = path.resolve(__dirname, '../fixtures');
const fakeNodeModules = path.join(fixturesDir, 'fake-node-modules');

describe('getTypedPackages', () => {
  it('returns only packages with .d.ts files', () => {
    const result = getTypedPackages(fixturesDir, fakeNodeModules);

    // Should include typed-package (has types field)
    const typedPkg = result.packages.find((p) => p.name === 'typed-package');
    expect(typedPkg).toBeDefined();
    expect(typedPkg?.typesPath).toContain('index.d.ts');

    // Should include typings-field (has typings field)
    const typingsPkg = result.packages.find((p) => p.name === 'typings-field');
    expect(typingsPkg).toBeDefined();
    expect(typingsPkg?.typesPath).toContain('index.d.ts');

    // Should include index-dts-package (has index.d.ts fallback)
    const indexDtsPkg = result.packages.find((p) => p.name === 'index-dts-package');
    expect(indexDtsPkg).toBeDefined();
    expect(indexDtsPkg?.typesPath).toContain('index.d.ts');

    // Should NOT include no-types (has no .d.ts)
    const noTypesPkg = result.packages.find((p) => p.name === 'no-types');
    expect(noTypesPkg).toBeUndefined();
  });

  it('excludes @types/* packages', () => {
    const result = getTypedPackages(fixturesDir, fakeNodeModules);

    // @types packages should be excluded from the list
    const atTypesPkgs = result.packages.filter((p) => p.name.startsWith('@types/'));
    expect(atTypesPkgs.length).toBe(0);
  });

  it('handles scoped packages', () => {
    const result = getTypedPackages(fixturesDir, fakeNodeModules);

    // Should include @scope/scoped-pkg
    const scopedPkg = result.packages.find((p) => p.name === '@scope/scoped-pkg');
    expect(scopedPkg).toBeDefined();
    expect(scopedPkg?.typesPath).toContain('index.d.ts');
  });

  it('returns empty array for directory with no typed packages', () => {
    // Use a non-existent or empty node_modules path
    const emptyDir = path.join(fixturesDir, 'non-existent');
    const result = getTypedPackages(emptyDir, emptyDir);

    expect(result.packages).toEqual([]);
  });
});

describe('getPackageExports', () => {
  it('returns TNodeType[] with ports from .d.ts', () => {
    const nodeTypes = getPackageExports('typed-package', fixturesDir, fakeNodeModules);

    // Should find the format function
    const formatFn = nodeTypes.find((nt) => nt.function === 'format');
    expect(formatFn).toBeDefined();
    expect(formatFn?.variant).toBe('FUNCTION');
    expect(formatFn?.category).toBe('NPM Packages');

    // Check input ports - should have date and formatStr
    const inputPorts = formatFn?.ports.filter((p) => p.direction === 'INPUT');
    expect(inputPorts?.length).toBeGreaterThanOrEqual(2);

    const datePort = inputPorts?.find((p) => p.name === 'date');
    expect(datePort).toBeDefined();
    expect(datePort?.type).toBe('OBJECT'); // Date is an object

    const formatStrPort = inputPorts?.find((p) => p.name === 'formatStr');
    expect(formatStrPort).toBeDefined();
    expect(formatStrPort?.type).toBe('STRING');

    // Check output ports - should have result (string return)
    const outputPorts = formatFn?.ports.filter((p) => p.direction === 'OUTPUT');
    const resultPort = outputPorts?.find((p) => p.name === 'result');
    expect(resultPort).toBeDefined();
    expect(resultPort?.type).toBe('STRING');
  });

  it('sets importSource field correctly', () => {
    const nodeTypes = getPackageExports('typed-package', fixturesDir, fakeNodeModules);

    for (const nt of nodeTypes) {
      expect(nt.importSource).toBe('typed-package');
    }
  });

  it('detects async from Promise return types', () => {
    // typed-npm-mock has fetchRemote which returns Promise<string>
    const typedNpmMockModules = path.join(fixturesDir, 'typed-npm-mock-modules');
    const nodeTypes = getPackageExports('typed-npm-mock', fixturesDir, typedNpmMockModules);

    const fetchRemoteFn = nodeTypes.find((nt) => nt.function === 'fetchRemote');
    expect(fetchRemoteFn).toBeDefined();
    expect(fetchRemoteFn?.synchronicity).toBe('ASYNC');

    // multiply should be sync
    const multiplyFn = nodeTypes.find((nt) => nt.function === 'multiply');
    expect(multiplyFn).toBeDefined();
    expect(multiplyFn?.synchronicity).toBe('SYNC');
  });

  it('returns empty array for untyped package', () => {
    const nodeTypes = getPackageExports('no-types', fixturesDir, fakeNodeModules);
    expect(nodeTypes).toEqual([]);
  });

  it('returns empty array for nonexistent package', () => {
    const nodeTypes = getPackageExports('nonexistent-pkg', fixturesDir, fakeNodeModules);
    expect(nodeTypes).toEqual([]);
  });

  it('generates correct node type name format', () => {
    const nodeTypes = getPackageExports('typed-package', fixturesDir, fakeNodeModules);

    const formatFn = nodeTypes.find((nt) => nt.function === 'format');
    expect(formatFn?.name).toBe('npm/typed-package/format');
  });

  it('includes mandatory execute, onSuccess, and onFailure ports', () => {
    const nodeTypes = getPackageExports('typed-package', fixturesDir, fakeNodeModules);

    for (const nt of nodeTypes) {
      const inputPorts = nt.ports.filter((p) => p.direction === 'INPUT');
      const outputPorts = nt.ports.filter((p) => p.direction === 'OUTPUT');

      // Should have execute input
      const executePort = inputPorts.find((p) => p.name === 'execute');
      expect(executePort).toBeDefined();
      expect(executePort?.type).toBe('STEP');

      // Should have onSuccess output
      const onSuccessPort = outputPorts.find((p) => p.name === 'onSuccess');
      expect(onSuccessPort).toBeDefined();
      expect(onSuccessPort?.type).toBe('STEP');

      // Should have onFailure output
      const onFailurePort = outputPorts.find((p) => p.name === 'onFailure');
      expect(onFailurePort).toBeDefined();
      expect(onFailurePort?.type).toBe('STEP');
    }
  });

  it('generates description from package and function name', () => {
    const nodeTypes = getPackageExports('typed-package', fixturesDir, fakeNodeModules);

    const formatFn = nodeTypes.find((nt) => nt.function === 'format');
    expect(formatFn?.description).toContain('format');
    expect(formatFn?.description).toContain('typed-package');
  });
});
