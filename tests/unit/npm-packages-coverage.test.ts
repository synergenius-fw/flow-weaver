/**
 * Coverage tests for npm-packages.ts:
 * - readDirectDependencies (reads package.json walking up directories)
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

function writeProjectPackageJson(dir: string, deps: Record<string, string>) {
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'test-project', dependencies: deps }),
  );
}

describe('readDirectDependencies via getTypedPackages', () => {
  it('reads dependencies from package.json and resolves typed packages', () => {
    const projectDir = path.join(tmpBase, 'walk-project');
    const nestedDir = path.join(projectDir, 'deep', 'nested');
    const nmDir = path.join(projectDir, 'node_modules');
    fs.mkdirSync(nestedDir, { recursive: true });

    setupPackage(nmDir, 'walk-test-pkg', `
      export declare function doStuff(x: string): number;
    `);
    writeProjectPackageJson(projectDir, { 'walk-test-pkg': '*' });

    const result = getTypedPackages(nestedDir);
    const found = result.packages.find(p => p.name === 'walk-test-pkg');
    expect(found).toBeDefined();
    expect(found!.typesPath).toBeTruthy();
  });

  it('excludes transitive deps not in package.json dependencies', () => {
    const projectDir = path.join(tmpBase, 'transitive-test');
    const nmDir = path.join(projectDir, 'node_modules');
    fs.mkdirSync(projectDir, { recursive: true });

    setupPackage(nmDir, 'direct-dep', `export declare function direct(): void;`);
    setupPackage(nmDir, 'transitive-dep', `export declare function transitive(): void;`);
    writeProjectPackageJson(projectDir, { 'direct-dep': '*' });

    const result = getTypedPackages(projectDir);
    expect(result.packages.find(p => p.name === 'direct-dep')).toBeDefined();
    expect(result.packages.find(p => p.name === 'transitive-dep')).toBeUndefined();
  });

  it('returns empty when no package.json exists in any parent', () => {
    const isolatedDir = path.join(tmpBase, 'isolated-no-pkg', 'deep');
    fs.mkdirSync(isolatedDir, { recursive: true });

    const result = getTypedPackages(isolatedDir);
    expect(result.packages).toEqual([]);
  });

  it('skips @types/* packages from dependencies', () => {
    const projectDir = path.join(tmpBase, 'types-filter');
    const nmDir = path.join(projectDir, 'node_modules');
    fs.mkdirSync(projectDir, { recursive: true });

    setupPackage(nmDir, '@types/node', `export declare function noop(): void;`);
    setupPackage(nmDir, 'real-pkg', `export declare function real(): void;`);
    writeProjectPackageJson(projectDir, { '@types/node': '*', 'real-pkg': '*' });

    const result = getTypedPackages(projectDir);
    expect(result.packages.find(p => p.name === '@types/node')).toBeUndefined();
    expect(result.packages.find(p => p.name === 'real-pkg')).toBeDefined();
  });

  it('walks up to parent directory to find package.json', () => {
    const projectDir = path.join(tmpBase, 'parent-walk');
    const nestedDir = path.join(projectDir, 'src', 'deep', 'nested');
    const nmDir = path.join(projectDir, 'node_modules');
    fs.mkdirSync(nestedDir, { recursive: true });

    setupPackage(nmDir, 'parent-pkg', `export declare function parentFn(): void;`);
    writeProjectPackageJson(projectDir, { 'parent-pkg': '*' });

    // Call from deeply nested dir — should still find package.json at projectDir
    const result = getTypedPackages(nestedDir);
    expect(result.packages.find(p => p.name === 'parent-pkg')).toBeDefined();
  });

  it('returns empty when package.json has no dependencies field', () => {
    const projectDir = path.join(tmpBase, 'no-deps-field');
    const nmDir = path.join(projectDir, 'node_modules');
    fs.mkdirSync(projectDir, { recursive: true });

    setupPackage(nmDir, 'some-pkg', `export declare function someFn(): void;`);
    // package.json with only devDependencies, no dependencies
    fs.writeFileSync(
      path.join(projectDir, 'package.json'),
      JSON.stringify({ name: 'test', devDependencies: { 'some-pkg': '*' } }),
    );

    const result = getTypedPackages(projectDir);
    expect(result.packages).toEqual([]);
  });

  it('skips malformed package.json and keeps walking up', () => {
    const parentDir = path.join(tmpBase, 'malformed-walk');
    const childDir = path.join(parentDir, 'child');
    const nmDir = path.join(parentDir, 'node_modules');
    fs.mkdirSync(childDir, { recursive: true });

    setupPackage(nmDir, 'found-pkg', `export declare function found(): void;`);
    // Good package.json at parent level
    writeProjectPackageJson(parentDir, { 'found-pkg': '*' });
    // Malformed package.json at child level — should be skipped
    fs.writeFileSync(path.join(childDir, 'package.json'), '{ broken json !!!');

    const result = getTypedPackages(childDir);
    expect(result.packages.find(p => p.name === 'found-pkg')).toBeDefined();
  });

  it('excludes deps listed in package.json that have no types', () => {
    const projectDir = path.join(tmpBase, 'untyped-dep');
    const nmDir = path.join(projectDir, 'node_modules');
    fs.mkdirSync(projectDir, { recursive: true });

    // Package with types
    setupPackage(nmDir, 'typed-one', `export declare function typed(): void;`);
    // Package without types — just a package.json, no .d.ts
    const untypedDir = path.join(nmDir, 'untyped-one');
    fs.mkdirSync(untypedDir, { recursive: true });
    fs.writeFileSync(
      path.join(untypedDir, 'package.json'),
      JSON.stringify({ name: 'untyped-one', version: '1.0.0' }),
    );

    writeProjectPackageJson(projectDir, { 'typed-one': '*', 'untyped-one': '*' });

    const result = getTypedPackages(projectDir);
    expect(result.packages.find(p => p.name === 'typed-one')).toBeDefined();
    expect(result.packages.find(p => p.name === 'untyped-one')).toBeUndefined();
  });

  it('handles scoped packages in dependencies', () => {
    const projectDir = path.join(tmpBase, 'scoped-deps');
    const nmDir = path.join(projectDir, 'node_modules');
    fs.mkdirSync(projectDir, { recursive: true });

    // Create scoped package
    const scopedDir = path.join(nmDir, '@myorg', 'utils');
    fs.mkdirSync(scopedDir, { recursive: true });
    fs.writeFileSync(
      path.join(scopedDir, 'package.json'),
      JSON.stringify({ name: '@myorg/utils', version: '1.0.0', types: 'index.d.ts' }),
    );
    fs.writeFileSync(path.join(scopedDir, 'index.d.ts'), `export declare function util(): void;`);

    writeProjectPackageJson(projectDir, { '@myorg/utils': '*' });

    const result = getTypedPackages(projectDir);
    expect(result.packages.find(p => p.name === '@myorg/utils')).toBeDefined();
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
