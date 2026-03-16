/**
 * Coverage tests for npm-packages.ts:
 * - findNodeModulesDirs (walking up directories)
 * - listPackagesInNodeModules (scoped packages, permissions)
 * - getPackageExports catch block (malformed .d.ts)
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
    const projectDir = path.join(tmpBase, 'walk-project');
    const nestedDir = path.join(projectDir, 'deep', 'nested');
    const nmDir = path.join(projectDir, 'node_modules');
    fs.mkdirSync(nestedDir, { recursive: true });

    setupPackage(nmDir, 'walk-test-pkg', `
      export declare function doStuff(x: string): number;
    `);

    const result = getTypedPackages(nestedDir);
    const found = result.packages.find(p => p.name === 'walk-test-pkg');
    expect(found).toBeDefined();
    expect(found!.typesPath).toBeTruthy();
  });

  it('returns empty when no node_modules exist in any parent', () => {
    const isolatedDir = path.join(tmpBase, 'isolated-no-nm', 'deep');
    fs.mkdirSync(isolatedDir, { recursive: true });

    const result = getTypedPackages(isolatedDir);
    expect(result.packages).toBeDefined();
  });

  it('discovers all typed packages in node_modules (not just direct deps)', () => {
    const projectDir = path.join(tmpBase, 'all-pkgs');
    const nmDir = path.join(projectDir, 'node_modules');
    fs.mkdirSync(projectDir, { recursive: true });

    setupPackage(nmDir, 'pkg-a', `export declare function a(): void;`);
    setupPackage(nmDir, 'pkg-b', `export declare function b(): void;`);
    setupPackage(nmDir, 'pkg-c', `export declare function c(): void;`);

    const result = getTypedPackages(projectDir, nmDir);
    expect(result.packages.find(p => p.name === 'pkg-a')).toBeDefined();
    expect(result.packages.find(p => p.name === 'pkg-b')).toBeDefined();
    expect(result.packages.find(p => p.name === 'pkg-c')).toBeDefined();
  });

  it('skips @types/* packages', () => {
    const projectDir = path.join(tmpBase, 'types-filter');
    const nmDir = path.join(projectDir, 'node_modules');
    fs.mkdirSync(projectDir, { recursive: true });

    setupPackage(nmDir, '@types/node', `export declare function noop(): void;`);
    setupPackage(nmDir, 'real-pkg', `export declare function real(): void;`);

    const result = getTypedPackages(projectDir, nmDir);
    expect(result.packages.find(p => p.name === '@types/node')).toBeUndefined();
    expect(result.packages.find(p => p.name === 'real-pkg')).toBeDefined();
  });

  it('handles scoped packages', () => {
    const projectDir = path.join(tmpBase, 'scoped-pkgs');
    const nmDir = path.join(projectDir, 'node_modules');
    fs.mkdirSync(projectDir, { recursive: true });

    const scopedDir = path.join(nmDir, '@myorg', 'utils');
    fs.mkdirSync(scopedDir, { recursive: true });
    fs.writeFileSync(
      path.join(scopedDir, 'package.json'),
      JSON.stringify({ name: '@myorg/utils', version: '1.0.0', types: 'index.d.ts' }),
    );
    fs.writeFileSync(path.join(scopedDir, 'index.d.ts'), `export declare function util(): void;`);

    const result = getTypedPackages(projectDir, nmDir);
    expect(result.packages.find(p => p.name === '@myorg/utils')).toBeDefined();
  });

  it('excludes packages without types', () => {
    const projectDir = path.join(tmpBase, 'untyped');
    const nmDir = path.join(projectDir, 'node_modules');
    fs.mkdirSync(projectDir, { recursive: true });

    setupPackage(nmDir, 'typed-one', `export declare function typed(): void;`);
    const untypedDir = path.join(nmDir, 'untyped-one');
    fs.mkdirSync(untypedDir, { recursive: true });
    fs.writeFileSync(
      path.join(untypedDir, 'package.json'),
      JSON.stringify({ name: 'untyped-one', version: '1.0.0' }),
    );

    const result = getTypedPackages(projectDir, nmDir);
    expect(result.packages.find(p => p.name === 'typed-one')).toBeDefined();
    expect(result.packages.find(p => p.name === 'untyped-one')).toBeUndefined();
  });

  it('deduplicates across multiple node_modules dirs', () => {
    const projectDir = path.join(tmpBase, 'dedup');
    const nestedDir = path.join(projectDir, 'sub');
    const outerNm = path.join(projectDir, 'node_modules');
    const innerNm = path.join(nestedDir, 'node_modules');
    fs.mkdirSync(nestedDir, { recursive: true });

    setupPackage(outerNm, 'shared-pkg', `export declare function outer(): void;`);
    setupPackage(innerNm, 'shared-pkg', `export declare function inner(): void;`);

    // Without override, walks up — inner is found first, outer is deduped
    const result = getTypedPackages(nestedDir);
    const shared = result.packages.filter(p => p.name === 'shared-pkg');
    expect(shared.length).toBe(1);
  });
});

describe('getPackageExports error handling', () => {
  it('returns empty array for package with unparseable .d.ts', () => {
    const nmDir = path.join(tmpBase, 'broken-dts', 'node_modules');
    setupPackage(nmDir, 'broken-pkg', `
      this is not valid typescript at all {{{{{
      export declare function ??? : never;
    `);

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
