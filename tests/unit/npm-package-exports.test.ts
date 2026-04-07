/**
 * Tests for getPackageExports: extracting callable exports from npm packages.
 *
 * Most real packages don't use bare `function foo()` declarations.
 * They use declare const, re-exports, classes, namespaces, etc.
 * getPackageExports must handle all of these.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getPackageExports } from '../../src/npm-packages';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('getPackageExports', () => {
  let tmpDir: string;
  let nodeModulesDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-npm-exports-'));
    nodeModulesDir = path.join(tmpDir, 'node_modules');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function createPackage(name: string, dtsContent: string) {
    const pkgDir = path.join(nodeModulesDir, name);
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(
      path.join(pkgDir, 'package.json'),
      JSON.stringify({ name, types: './index.d.ts' }),
    );
    fs.writeFileSync(path.join(pkgDir, 'index.d.ts'), dtsContent);
  }

  function createPackageWithSubmodule(
    name: string,
    entryDts: string,
    submodules: Record<string, string>,
  ) {
    const pkgDir = path.join(nodeModulesDir, name);
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(
      path.join(pkgDir, 'package.json'),
      JSON.stringify({ name, types: './index.d.ts' }),
    );
    fs.writeFileSync(path.join(pkgDir, 'index.d.ts'), entryDts);
    for (const [subPath, content] of Object.entries(submodules)) {
      const fullPath = path.join(pkgDir, subPath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content);
    }
  }

  // === Pattern: declare function (already works) ===

  it('extracts declare function exports', () => {
    createPackage(
      'test-declare-fn',
      `export declare function greet(name: string): string;
export declare function shout(text: string): string;`,
    );

    const exports = getPackageExports('test-declare-fn', tmpDir);
    expect(exports.length).toBe(2);
    expect(exports.map((e) => e.function)).toContain('greet');
    expect(exports.map((e) => e.function)).toContain('shout');
  });

  // === Pattern: declare const with function type (hono style) ===

  it('extracts declare const with arrow function type', () => {
    createPackage(
      'test-const-fn',
      `export declare const serve: (options: { port: number }) => void;
export declare const createServer: (config: { host: string }) => object;`,
    );

    const exports = getPackageExports('test-const-fn', tmpDir);
    expect(exports.length).toBe(2);
    expect(exports.map((e) => e.function)).toContain('serve');
    expect(exports.map((e) => e.function)).toContain('createServer');
  });

  it('extracts declare const with function keyword type', () => {
    createPackage(
      'test-const-fn-kw',
      `export declare const parse: {
  (input: string): object;
  (input: string, options: object): object;
};`,
    );

    const exports = getPackageExports('test-const-fn-kw', tmpDir);
    expect(exports.length).toBeGreaterThanOrEqual(1);
    expect(exports[0].function).toBe('parse');
  });

  // === Pattern: re-exports from submodules ===

  it('follows named re-exports from submodules', () => {
    createPackageWithSubmodule(
      'test-reexport',
      `export { serve, createServer } from './server.js';`,
      {
        'server.d.ts': `export declare function serve(opts: object): void;
export declare function createServer(opts: object): object;`,
      },
    );

    const exports = getPackageExports('test-reexport', tmpDir);
    expect(exports.length).toBe(2);
    expect(exports.map((e) => e.function)).toContain('serve');
    expect(exports.map((e) => e.function)).toContain('createServer');
  });

  it('follows star re-exports from submodules', () => {
    createPackageWithSubmodule(
      'test-star-reexport',
      `export * from './utils.js';`,
      {
        'utils.d.ts': `export declare function debounce(fn: Function, ms: number): Function;
export declare function throttle(fn: Function, ms: number): Function;`,
      },
    );

    const exports = getPackageExports('test-star-reexport', tmpDir);
    expect(exports.length).toBe(2);
    expect(exports.map((e) => e.function)).toContain('debounce');
    expect(exports.map((e) => e.function)).toContain('throttle');
  });

  // === Pattern: mixed exports ===

  it('extracts functions but skips types and interfaces', () => {
    createPackage(
      'test-mixed',
      `export declare function parse(input: string): object;
export interface ParseOptions { strict: boolean; }
export type Parser = (input: string) => object;
export declare const VERSION: string;`,
    );

    const exports = getPackageExports('test-mixed', tmpDir);
    // Should only include the callable function, not types/interfaces/non-callable consts
    expect(exports.length).toBe(1);
    expect(exports[0].function).toBe('parse');
  });

  it('skips non-callable const exports', () => {
    createPackage(
      'test-nonf',
      `export declare const VERSION: string;
export declare const MAX_SIZE: number;
export declare const transform: (input: string) => string;`,
    );

    const exports = getPackageExports('test-nonf', tmpDir);
    // Only transform is callable
    expect(exports.length).toBe(1);
    expect(exports[0].function).toBe('transform');
  });

  // === Pattern: async functions ===

  it('detects async functions', () => {
    createPackage(
      'test-async',
      `export declare function fetchData(url: string): Promise<object>;`,
    );

    const exports = getPackageExports('test-async', tmpDir);
    expect(exports.length).toBe(1);
    expect(exports[0].synchronicity).toBe('ASYNC');
  });

  it('detects sync functions', () => {
    createPackage(
      'test-sync',
      `export declare function parseJSON(input: string): object;`,
    );

    const exports = getPackageExports('test-sync', tmpDir);
    expect(exports.length).toBe(1);
    expect(exports[0].synchronicity).toBe('SYNC');
  });

  // === Pattern: ports (input/output) ===

  it('creates input ports from function parameters', () => {
    createPackage(
      'test-ports',
      `export declare function transform(input: string, options: { mode: string }): { result: string };`,
    );

    const exports = getPackageExports('test-ports', tmpDir);
    expect(exports.length).toBe(1);

    const inputPorts = exports[0].ports.filter((p) => p.direction === 'INPUT');
    expect(inputPorts.some((p) => p.name === 'input' || p.name === 'execute')).toBe(true);
  });

  it('creates output ports from return type', () => {
    createPackage(
      'test-output',
      `export declare function compute(x: number): { result: number; error: string };`,
    );

    const exports = getPackageExports('test-output', tmpDir);
    expect(exports.length).toBe(1);

    const outputPorts = exports[0].ports.filter((p) => p.direction === 'OUTPUT');
    expect(outputPorts.length).toBeGreaterThan(0);
  });

  // === Edge cases ===

  it('returns empty for non-existent package', () => {
    const exports = getPackageExports('nonexistent-pkg', tmpDir);
    expect(exports).toEqual([]);
  });

  it('returns empty for package with no callable exports', () => {
    createPackage(
      'test-types-only',
      `export interface Foo { bar: string; }
export type Baz = { qux: number };`,
    );

    const exports = getPackageExports('test-types-only', tmpDir);
    expect(exports).toEqual([]);
  });

  it('handles package with empty .d.ts', () => {
    createPackage('test-empty', '');

    const exports = getPackageExports('test-empty', tmpDir);
    expect(exports).toEqual([]);
  });

  it('sets importSource to package name', () => {
    createPackage(
      'my-cool-pkg',
      `export declare function doStuff(): void;`,
    );

    const exports = getPackageExports('my-cool-pkg', tmpDir);
    expect(exports.length).toBe(1);
    expect(exports[0].importSource).toBe('my-cool-pkg');
  });

  it('sets category to NPM Packages', () => {
    createPackage(
      'test-cat',
      `export declare function foo(): void;`,
    );

    const exports = getPackageExports('test-cat', tmpDir);
    expect(exports[0].category).toBe('NPM Packages');
  });

  it('handles scoped package names', () => {
    const scopeDir = path.join(nodeModulesDir, '@myorg');
    fs.mkdirSync(scopeDir, { recursive: true });
    const pkgDir = path.join(scopeDir, 'utils');
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(
      path.join(pkgDir, 'package.json'),
      JSON.stringify({ name: '@myorg/utils', types: './index.d.ts' }),
    );
    fs.writeFileSync(
      path.join(pkgDir, 'index.d.ts'),
      `export declare function helper(x: string): string;`,
    );

    const exports = getPackageExports('@myorg/utils', tmpDir);
    expect(exports.length).toBe(1);
    expect(exports[0].importSource).toBe('@myorg/utils');
  });

  it('deduplicates exports with same function name', () => {
    createPackage(
      'test-dedup',
      `export declare function foo(): void;
export declare function foo(x: string): string;`,
    );

    const exports = getPackageExports('test-dedup', tmpDir);
    // Should not have duplicate foo entries
    const fooExports = exports.filter((e) => e.function === 'foo');
    expect(fooExports.length).toBe(1);
  });
});
