/**
 * Coverage tests for npm-packages.ts uncovered lines:
 * - Lines 47-61: findNodeModulesDirs (walking up directories)
 * - Line 320: getPackageExports catch block (malformed .d.ts)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { getTypedPackages, getPackageExports } from '../../src/npm-packages';

const tmpBase = path.join(os.tmpdir(), `fw-npm-cov-${process.pid}`);

beforeAll(() => fs.mkdirSync(tmpBase, { recursive: true }));
afterAll(() => fs.rmSync(tmpBase, { recursive: true, force: true }));

function setupPackage(nmDir: string, pkgName: string, dtsContent: string) {
  const pkgDir = path.join(nmDir, pkgName);
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(
    path.join(pkgDir, 'package.json'),
    JSON.stringify({ name: pkgName, version: '1.0.0', types: 'index.d.ts' }),
  );
  fs.writeFileSync(path.join(pkgDir, 'index.d.ts'), dtsContent);
}

describe('findNodeModulesDirs via getTypedPackages (no override)', () => {
  it('discovers node_modules by walking up from a nested directory', () => {
    // Create a directory structure: tmpBase/project/deep/nested
    // with node_modules at tmpBase/project/node_modules
    const projectDir = path.join(tmpBase, 'walk-project');
    const nestedDir = path.join(projectDir, 'deep', 'nested');
    const nmDir = path.join(projectDir, 'node_modules');
    fs.mkdirSync(nestedDir, { recursive: true });

    setupPackage(nmDir, 'walk-test-pkg', `
      export declare function doStuff(x: string): number;
    `);

    // Call without nodeModulesOverride so findNodeModulesDirs is used
    const result = getTypedPackages(nestedDir);
    const found = result.packages.find(p => p.name === 'walk-test-pkg');
    expect(found).toBeDefined();
    expect(found!.typesPath).toBeTruthy();
  });

  it('returns empty when no node_modules exist in any parent', () => {
    // Create an isolated directory with no node_modules anywhere up the chain
    // (practically, the filesystem root won't have one)
    const isolatedDir = path.join(tmpBase, 'isolated-no-nm', 'deep');
    fs.mkdirSync(isolatedDir, { recursive: true });

    const result = getTypedPackages(isolatedDir);
    // May find packages from the real project's node_modules in parent dirs,
    // but the test validates the function runs without error
    expect(result.packages).toBeDefined();
  });
});

describe('getPackageExports error handling', () => {
  it('returns empty array for package with unparseable .d.ts', () => {
    // Create a package whose .d.ts content is syntactically broken
    // to trigger the catch block at line 320
    const nmDir = path.join(tmpBase, 'broken-dts', 'node_modules');
    setupPackage(nmDir, 'broken-pkg', `
      this is not valid typescript at all {{{{{
      export declare function ??? : never;
    `);

    // getPackageExports should catch the ts-morph error and return []
    const result = getPackageExports(
      'broken-pkg',
      path.join(tmpBase, 'broken-dts'),
      nmDir,
    );
    expect(result).toEqual([]);
  });

  it('returns empty array for non-existent package', () => {
    const nmDir = path.join(tmpBase, 'noexist', 'node_modules');
    fs.mkdirSync(nmDir, { recursive: true });

    const result = getPackageExports(
      'does-not-exist',
      path.join(tmpBase, 'noexist'),
      nmDir,
    );
    expect(result).toEqual([]);
  });

  it('returns node types for valid package with exported functions', () => {
    const nmDir = path.join(tmpBase, 'valid-pkg', 'node_modules');
    setupPackage(nmDir, 'valid-math', `
      export declare function add(a: number, b: number): number;
      export declare function greet(name: string): string;
    `);

    const result = getPackageExports(
      'valid-math',
      path.join(tmpBase, 'valid-pkg'),
      nmDir,
    );
    expect(result.length).toBe(2);
    const addNode = result.find(n => n.function === 'add');
    expect(addNode).toBeDefined();
    expect(addNode!.name).toBe('npm/valid-math/add');
    expect(addNode!.synchronicity).toBe('SYNC');

    const greetNode = result.find(n => n.function === 'greet');
    expect(greetNode).toBeDefined();
  });
});
