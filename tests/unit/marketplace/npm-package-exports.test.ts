/**
 * Tests for getPackageExports: extracting callable exports from npm packages.
 *
 * Most real packages don't use bare `function foo()` declarations.
 * They use declare const, re-exports, classes, namespaces, etc.
 * getPackageExports must handle all of these.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getPackageExports } from '../../../src/npm-packages';
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
      `export declare function greet(name: string): string
export declare function shout(text: string): string`,
    );

    const exports = getPackageExports('test-declare-fn', tmpDir);
    expect(exports.length).toBe(2);
    expect(exports.map((e) => e.function)).toContain('greet');
    expect(exports.map((e) => e.function)).toContain('shout');
  });

  // === Port ordering and flags ===

  it('sets defaultOrder: execute first, then onSuccess/onFailure, then data', () => {
    createPackage(
      'test-order',
      `export declare function transform(input: string): { result: string };`,
    );

    const exports = getPackageExports('test-order', tmpDir);
    expect(exports.length).toBe(1);

    const ports = exports[0].ports;
    const execute = ports.find((p) => p.name === 'execute');
    const onSuccess = ports.find((p) => p.name === 'onSuccess');
    const onFailure = ports.find((p) => p.name === 'onFailure');
    const result = ports.find((p) => p.name === 'result');

    expect(execute?.defaultOrder).toBe(0);
    expect(onSuccess?.defaultOrder).toBe(0);
    expect(onFailure?.defaultOrder).toBe(1);
    expect(result!.defaultOrder!).toBeGreaterThan(onFailure!.defaultOrder!);
  });

  it('marks onFailure port with failure flag', () => {
    createPackage(
      'test-failure',
      `export declare function parse(input: string): object;`,
    );

    const exports = getPackageExports('test-failure', tmpDir);
    const onFailure = exports[0].ports.find((p) => p.name === 'onFailure');

    expect(onFailure?.failure).toBe(true);
  });

  it('onSuccess does not have failure flag', () => {
    createPackage(
      'test-no-failure',
      `export declare function parse(input: string): object;`,
    );

    const exports = getPackageExports('test-no-failure', tmpDir);
    const onSuccess = exports[0].ports.find((p) => p.name === 'onSuccess');

    expect(onSuccess?.failure).toBeFalsy();
  });

  // === CommonJS export = pattern ===

  it('skips export= when it is a namespace (lodash style)', () => {
    createPackage(
      'test-cjs-namespace',
      `declare const _: LoDashStatic;
interface LoDashStatic {
  chunk<T>(array: T[], size: number): T[][];
  compact<T>(array: T[]): T[];
}
declare namespace _ {
  interface LoDashStatic {}
}
export = _;`,
    );

    const exports = getPackageExports('test-cjs-namespace', tmpDir);
    // Namespace with many methods should not appear as a single "export=" node
    const exportEquals = exports.find((e) => e.function === 'export=');
    expect(exportEquals).toBeUndefined();
  });

  it('includes export= when it is a single function (lodash.clonedeep style)', () => {
    createPackage(
      'test-cjs-fn',
      `declare function cloneDeep<T>(value: T): T
export = cloneDeep`,
    );

    const exports = getPackageExports('test-cjs-fn', tmpDir);
    expect(exports.length).toBe(1);
    // Should use the function name, not "export="
    expect(exports[0].function).toBe('cloneDeep');
    expect(exports[0].label).toBe('cloneDeep');
  });

  it('includes export= when it is a single arrow function', () => {
    createPackage(
      'test-cjs-arrow',
      `declare const debounce: <T extends (...args: any[]) => any>(func: T, wait: number) => T;
export = debounce;`,
    );

    const exports = getPackageExports('test-cjs-arrow', tmpDir);
    expect(exports.length).toBe(1);
    expect(exports[0].function).toBe('debounce');
    expect(exports[0].label).toBe('debounce');
  });

  // === Excessive port capping ===

  it('caps output ports when return type has many properties', () => {
    createPackage(
      'test-many-ports',
      `export declare function getAll(): {
  a: string; b: string; c: string; d: string; e: string;
  f: string; g: string; h: string; i: string; j: string;
  k: string; l: string; m: string; n: string; o: string;
};`,
    );

    const exports = getPackageExports('test-many-ports', tmpDir);
    const outputPorts = exports[0].ports.filter(
      (p) => p.direction === 'OUTPUT' && p.name !== 'onSuccess' && p.name !== 'onFailure',
    );
    // Should cap data output ports at a reasonable limit (e.g. 8)
    // and fall back to a single "result" port instead
    expect(outputPorts.length).toBeLessThanOrEqual(8);
  });

  // === Default export naming ===

  it('uses function name for default export, not "default"', () => {
    createPackage(
      'test-default-fn',
      `export default function createApp(config: object): object;`,
    );

    const exports = getPackageExports('test-default-fn', tmpDir);
    expect(exports.length).toBe(1);
    expect(exports[0].function).not.toBe('default');
    expect(exports[0].function).toBe('createApp');
  });

  it('input ports have sequential defaultOrder starting from 1', () => {
    createPackage(
      'test-input-order',
      `export declare function process(a: string, b: number, c: boolean): void;`,
    );

    const exports = getPackageExports('test-input-order', tmpDir);
    const inputs = exports[0].ports.filter((p) => p.direction === 'INPUT');

    expect(inputs[0].name).toBe('execute');
    expect(inputs[0].defaultOrder).toBe(0);
    expect(inputs[1].name).toBe('a');
    expect(inputs[1].defaultOrder).toBe(1);
    expect(inputs[2].name).toBe('b');
    expect(inputs[2].defaultOrder).toBe(2);
    expect(inputs[3].name).toBe('c');
    expect(inputs[3].defaultOrder).toBe(3);
  });

  it('output ports: control flow first, then data', () => {
    createPackage(
      'test-output-order',
      `export declare function compute(x: number): { alpha: string; beta: number };`,
    );

    const exports = getPackageExports('test-output-order', tmpDir);
    const outputs = exports[0].ports.filter((p) => p.direction === 'OUTPUT');

    // Control flow ports first
    const onSuccess = outputs.find((p) => p.name === 'onSuccess');
    const onFailure = outputs.find((p) => p.name === 'onFailure');
    expect(onSuccess?.defaultOrder).toBe(0);
    expect(onFailure?.defaultOrder).toBe(1);

    // Data ports after
    const alpha = outputs.find((p) => p.name === 'alpha');
    const beta = outputs.find((p) => p.name === 'beta');
    expect(alpha?.defaultOrder).toBe(2);
    expect(beta?.defaultOrder).toBe(3);
  });

  it('failure flag is only on onFailure, not on any other port', () => {
    createPackage(
      'test-failure-only',
      `export declare function run(input: string): { result: string };`,
    );

    const exports = getPackageExports('test-failure-only', tmpDir);
    for (const port of exports[0].ports) {
      if (port.name === 'onFailure') {
        expect(port.failure).toBe(true);
      } else {
        expect(port.failure).toBeFalsy();
      }
    }
  });

  it('port ordering works with declare const function types', () => {
    createPackage(
      'test-const-order',
      `export declare const transform: (input: string, options: object) => { result: string };`,
    );

    const exports = getPackageExports('test-const-order', tmpDir);
    const ports = exports[0].ports;

    const execute = ports.find((p) => p.name === 'execute');
    const input = ports.find((p) => p.name === 'input');
    const options = ports.find((p) => p.name === 'options');
    const onFailure = ports.find((p) => p.name === 'onFailure');

    expect(execute?.defaultOrder).toBe(0);
    expect(input?.defaultOrder).toBe(1);
    expect(options?.defaultOrder).toBe(2);
    expect(onFailure?.defaultOrder).toBe(1);
    expect(onFailure?.failure).toBe(true);
  });

  it('port ordering works with star re-exported functions', () => {
    createPackageWithSubmodule(
      'test-star-order',
      `export * from './lib.js';`,
      {
        'lib.d.ts': `export declare function process(data: string): string;`,
      },
    );

    const exports = getPackageExports('test-star-order', tmpDir);
    expect(exports.length).toBe(1);

    const execute = exports[0].ports.find((p) => p.name === 'execute');
    const data = exports[0].ports.find((p) => p.name === 'data');
    const onSuccess = exports[0].ports.find((p) => p.name === 'onSuccess');
    const onFailure = exports[0].ports.find((p) => p.name === 'onFailure');

    expect(execute?.defaultOrder).toBe(0);
    expect(onSuccess?.defaultOrder).toBe(0);
    expect(onFailure?.defaultOrder).toBe(1);
    expect(data?.defaultOrder).toBe(1); // input data port
    expect(onFailure?.failure).toBe(true);
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
        'server.d.ts': `export declare function serve(opts: object): void
export declare function createServer(opts: object): object`,
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
        'utils.d.ts': `export declare function debounce(fn: Function, ms: number): Function
export declare function throttle(fn: Function, ms: number): Function`,
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

  // === Name must be workflow-annotation safe (no slashes) ===

  it('name must not contain slashes', () => {
    createPackage(
      'my-pkg',
      `export declare function doStuff(): void;`,
    );

    const exports = getPackageExports('my-pkg', tmpDir);
    expect(exports[0].name).not.toContain('/');
  });

  it('name must not start with npm/', () => {
    createPackage(
      'another-pkg',
      `export declare function process(x: string): string;`,
    );

    const exports = getPackageExports('another-pkg', tmpDir);
    expect(exports[0].name).not.toMatch(/^npm\//);
  });

  it('name equals function name for simple package', () => {
    createPackage(
      'simple-pkg',
      `export declare function myFunc(): void;`,
    );

    const exports = getPackageExports('simple-pkg', tmpDir);
    expect(exports[0].name).toBe('myFunc');
  });

  it('name equals function name for scoped package', () => {
    const scopeDir = path.join(nodeModulesDir, '@myorg');
    fs.mkdirSync(scopeDir, { recursive: true });
    const pkgDir = path.join(scopeDir, 'tools');
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(
      path.join(pkgDir, 'package.json'),
      JSON.stringify({ name: '@myorg/tools', types: './index.d.ts' }),
    );
    fs.writeFileSync(
      path.join(pkgDir, 'index.d.ts'),
      `export declare function helper(): void;`,
    );

    const exports = getPackageExports('@myorg/tools', tmpDir);
    expect(exports[0].name).toBe('helper');
  });

  it('name is safe for @node annotation (no special chars except alphanumeric, _, -)', () => {
    createPackage(
      'safe-name-pkg',
      `export declare function my_func_123(): void;`,
    );

    const exports = getPackageExports('safe-name-pkg', tmpDir);
    expect(exports[0].name).toMatch(/^[\w-]+$/);
  });

  it('name for declare const function type has no slashes', () => {
    createPackage(
      'const-fn-name',
      `export declare const serve: (opts: object) => void;`,
    );

    const exports = getPackageExports('const-fn-name', tmpDir);
    expect(exports[0].name).toBe('serve');
  });

  it('name for re-exported function has no slashes', () => {
    createPackageWithSubmodule(
      'reexport-name',
      `export { handler } from './lib.js';`,
      { 'lib.d.ts': `export declare function handler(): void;` },
    );

    const exports = getPackageExports('reexport-name', tmpDir);
    expect(exports[0].name).toBe('handler');
  });

  it('name for star re-exported function has no slashes', () => {
    createPackageWithSubmodule(
      'star-name',
      `export * from './utils.js';`,
      { 'utils.d.ts': `export declare function util(): void;` },
    );

    const exports = getPackageExports('star-name', tmpDir);
    expect(exports[0].name).toBe('util');
  });

  it('name for CJS export= function has no slashes', () => {
    createPackage(
      'cjs-name',
      `declare function cloneDeep<T>(value: T): T;\nexport = cloneDeep;`,
    );

    const exports = getPackageExports('cjs-name', tmpDir);
    expect(exports[0].name).toBe('cloneDeep');
  });

  it('multiple exports all have slash-free names', () => {
    createPackage(
      'multi-name',
      `export declare function alpha(): void
export declare function beta(): void
export declare function gamma(): void`,
    );

    const exports = getPackageExports('multi-name', tmpDir);
    for (const e of exports) {
      expect(e.name).not.toContain('/');
      expect(e.name).toBe(e.function);
    }
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
      `export declare function foo(): void
export declare function foo(x: string): string`,
    );

    const exports = getPackageExports('test-dedup', tmpDir);
    // Should not have duplicate foo entries
    const fooExports = exports.filter((e) => e.function === 'foo');
    expect(fooExports.length).toBe(1);
  });

  // ─── Port ordering: step outputs (onSuccess, onFailure) BEFORE data outputs ───

  it('onSuccess and onFailure have lower defaultOrder than result (simple function)', () => {
    createPackage('test-port-order', `export declare function process(input: string): string;`);
    const exports = getPackageExports('test-port-order', tmpDir);
    const nt = exports.find(e => e.function === 'process')!;
    const result = nt.ports.find(p => p.name === 'result')!;
    const onSuccess = nt.ports.find(p => p.name === 'onSuccess')!;
    const onFailure = nt.ports.find(p => p.name === 'onFailure')!;

    expect(onSuccess.defaultOrder).toBeLessThan(result.defaultOrder);
    expect(onFailure.defaultOrder).toBeLessThan(result.defaultOrder);
    expect(onSuccess.defaultOrder).toBeLessThan(onFailure.defaultOrder);
  });

  it('onSuccess and onFailure have lower defaultOrder than data outputs (object return)', () => {
    createPackage('test-port-order-obj', `export declare function parse(input: string): { host: string; port: number; };`);
    const exports = getPackageExports('test-port-order-obj', tmpDir);
    const nt = exports.find(e => e.function === 'parse')!;
    const host = nt.ports.find(p => p.name === 'host')!;
    const port = nt.ports.find(p => p.name === 'port')!;
    const onSuccess = nt.ports.find(p => p.name === 'onSuccess')!;
    const onFailure = nt.ports.find(p => p.name === 'onFailure')!;

    expect(onSuccess.defaultOrder).toBeLessThan(host.defaultOrder);
    expect(onSuccess.defaultOrder).toBeLessThan(port.defaultOrder);
    expect(onFailure.defaultOrder).toBeLessThan(host.defaultOrder);
    expect(onFailure.defaultOrder).toBeLessThan(port.defaultOrder);
  });

  it('onSuccess and onFailure before result on star re-export', () => {
    createPackageWithSubmodule(
      'test-port-order-star',
      `export * from './lib.js';`,
      { 'lib.d.ts': `export declare function transform(x: number): number;` },
    );
    const exports = getPackageExports('test-port-order-star', tmpDir);
    const nt = exports.find(e => e.function === 'transform')!;
    const result = nt.ports.find(p => p.name === 'result')!;
    const onSuccess = nt.ports.find(p => p.name === 'onSuccess')!;
    const onFailure = nt.ports.find(p => p.name === 'onFailure')!;

    expect(onSuccess.defaultOrder).toBeLessThan(result.defaultOrder);
    expect(onFailure.defaultOrder).toBeLessThan(result.defaultOrder);
  });

  it('execute has lower defaultOrder than all data inputs', () => {
    createPackage('test-input-order', `export declare function calc(a: number, b: number, c: number): number;`);
    const exports = getPackageExports('test-input-order', tmpDir);
    const nt = exports.find(e => e.function === 'calc')!;
    const execute = nt.ports.find(p => p.name === 'execute')!;
    const dataInputs = nt.ports.filter(p => p.direction === 'INPUT' && p.name !== 'execute');

    for (const input of dataInputs) {
      expect(execute.defaultOrder).toBeLessThan(input.defaultOrder);
    }
  });

  it('output ports sort as: onSuccess, onFailure, then data', () => {
    createPackage('test-full-order', `export declare function fetch(url: string): { status: number; body: string; headers: Record<string, string>; };`);
    const exports = getPackageExports('test-full-order', tmpDir);
    const nt = exports.find(e => e.function === 'fetch')!;
    const outputPorts = nt.ports
      .filter(p => p.direction === 'OUTPUT')
      .sort((a, b) => a.defaultOrder - b.defaultOrder);

    expect(outputPorts[0].name).toBe('onSuccess');
    expect(outputPorts[1].name).toBe('onFailure');
    // Data ports come after
    const dataOutputs = outputPorts.filter(p => p.type !== 'STEP');
    for (const dp of dataOutputs) {
      expect(dp.defaultOrder).toBeGreaterThan(outputPorts[1].defaultOrder);
    }
  });

  it('void function: onSuccess before onFailure, no data outputs', () => {
    createPackage('test-void-order', `export declare function log(msg: string): void;`);
    const exports = getPackageExports('test-void-order', tmpDir);
    const nt = exports.find(e => e.function === 'log')!;
    const outputs = nt.ports.filter(p => p.direction === 'OUTPUT');
    expect(outputs).toHaveLength(2);
    const onSuccess = outputs.find(p => p.name === 'onSuccess')!;
    const onFailure = outputs.find(p => p.name === 'onFailure')!;
    expect(onSuccess.defaultOrder).toBeLessThan(onFailure.defaultOrder);
  });

  it('async function: onSuccess and onFailure before result', () => {
    createPackage('test-async-order', `export declare function fetchData(url: string): Promise<string>;`);
    const exports = getPackageExports('test-async-order', tmpDir);
    const nt = exports.find(e => e.function === 'fetchData')!;
    const result = nt.ports.find(p => p.name === 'result')!;
    const onSuccess = nt.ports.find(p => p.name === 'onSuccess')!;
    const onFailure = nt.ports.find(p => p.name === 'onFailure')!;

    expect(onSuccess.defaultOrder).toBeLessThan(result.defaultOrder);
    expect(onFailure.defaultOrder).toBeLessThan(result.defaultOrder);
  });

  it('declare const function: onSuccess and onFailure before result', () => {
    createPackage('test-const-order', `export declare const encode: (data: string) => string;`);
    const exports = getPackageExports('test-const-order', tmpDir);
    const nt = exports.find(e => e.function === 'encode')!;
    const result = nt.ports.find(p => p.name === 'result')!;
    const onSuccess = nt.ports.find(p => p.name === 'onSuccess')!;
    const onFailure = nt.ports.find(p => p.name === 'onFailure')!;

    expect(onSuccess.defaultOrder).toBeLessThan(result.defaultOrder);
    expect(onFailure.defaultOrder).toBeLessThan(result.defaultOrder);
  });

  it('multiple data output props all have higher order than step ports', () => {
    createPackage('test-multi-out-order', `export declare function parse(s: string): { a: string; b: number; c: boolean; d: string[]; };`);
    const exports = getPackageExports('test-multi-out-order', tmpDir);
    const nt = exports.find(e => e.function === 'parse')!;
    const onSuccess = nt.ports.find(p => p.name === 'onSuccess')!;
    const onFailure = nt.ports.find(p => p.name === 'onFailure')!;
    const dataOutputs = nt.ports.filter(p => p.direction === 'OUTPUT' && p.type !== 'STEP');

    expect(dataOutputs.length).toBe(4);
    for (const dp of dataOutputs) {
      expect(dp.defaultOrder).toBeGreaterThan(onSuccess.defaultOrder);
      expect(dp.defaultOrder).toBeGreaterThan(onFailure.defaultOrder);
    }
  });

  it('data output props maintain relative order among themselves', () => {
    createPackage('test-data-relative', `export declare function info(): { x: string; y: number; z: boolean; };`);
    const exports = getPackageExports('test-data-relative', tmpDir);
    const nt = exports.find(e => e.function === 'info')!;
    const x = nt.ports.find(p => p.name === 'x')!;
    const y = nt.ports.find(p => p.name === 'y')!;
    const z = nt.ports.find(p => p.name === 'z')!;

    expect(x.defaultOrder).toBeLessThan(y.defaultOrder);
    expect(y.defaultOrder).toBeLessThan(z.defaultOrder);
  });
});
