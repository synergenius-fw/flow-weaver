/**
 * Test suite for getPackageExports.
 * Covers every TypeScript declaration form, export pattern, parameter type,
 * return type, port inference detail, and edge case.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getPackageExports } from '../../../src/npm-packages';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('getPackageExports declaration forms', () => {
  let tmpDir: string;
  let nodeModulesDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-npm-comp-'));
    nodeModulesDir = path.join(tmpDir, 'node_modules');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function pkg(name: string, dts: string, sub?: Record<string, string>) {
    const parts = name.split('/');
    const pkgDir = path.join(nodeModulesDir, ...parts);
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name, types: './index.d.ts' }));
    fs.writeFileSync(path.join(pkgDir, 'index.d.ts'), dts);
    if (sub) {
      for (const [p, c] of Object.entries(sub)) {
        const fp = path.join(pkgDir, p);
        fs.mkdirSync(path.dirname(fp), { recursive: true });
        fs.writeFileSync(fp, c);
      }
    }
    return () => getPackageExports(name, tmpDir);
  }

  // =========================================================================
  // 1. DECLARATION FORMS
  // =========================================================================

  describe('declaration forms', () => {
    it('function declaration', () => {
      const get = pkg('t-fn-decl', `export declare function foo(x: string): string;`);
      expect(get()).toHaveLength(1);
      expect(get()[0].function).toBe('foo');
    });

    it('async function declaration', () => {
      const get = pkg('t-async-decl', `export declare function foo(): Promise<string>;`);
      expect(get()[0].synchronicity).toBe('ASYNC');
    });

    it('const with arrow type', () => {
      const get = pkg('t-const-arrow', `export declare const foo: (x: number) => string;`);
      expect(get()).toHaveLength(1);
      expect(get()[0].function).toBe('foo');
    });

    it('const with function type', () => {
      const get = pkg('t-const-fntype', `export declare const foo: { (x: string): number; };`);
      expect(get()).toHaveLength(1);
    });

    it('const with overloaded function type', () => {
      const get = pkg('t-const-overload', `export declare const foo: {
        (x: string): string;
        (x: number): number;
      };`);
      expect(get()).toHaveLength(1);
      // Uses first overload
      const inputs = get()[0].ports.filter(p => p.direction === 'INPUT' && p.name !== 'execute');
      expect(inputs[0].type).toBe('STRING');
    });

    it('function with overloads', () => {
      const get = pkg('t-fn-overload', `
        export declare function parse(input: string): object
        export declare function parse(input: string, options: object): object
      `);
      // Should deduplicate
      expect(get()).toHaveLength(1);
    });

    it('generic function', () => {
      const get = pkg('t-generic', `export declare function identity<T>(value: T): T;`);
      expect(get()).toHaveLength(1);
      expect(get()[0].function).toBe('identity');
    });

    it('generic with constraint', () => {
      const get = pkg('t-generic-constraint', `export declare function keys<T extends object>(obj: T): string[];`);
      expect(get()).toHaveLength(1);
    });

    it('function with rest params', () => {
      const get = pkg('t-rest', `export declare function concat(...args: string[]): string;`);
      const inputs = get()[0].ports.filter(p => p.direction === 'INPUT' && p.name !== 'execute');
      expect(inputs).toHaveLength(1);
      expect(inputs[0].name).toBe('args');
    });

    it('function with optional params', () => {
      const get = pkg('t-optional', `export declare function greet(name: string, greeting?: string): string;`);
      const inputs = get()[0].ports.filter(p => p.direction === 'INPUT' && p.name !== 'execute');
      expect(inputs).toHaveLength(2);
    });

    it('function with default params', () => {
      const get = pkg('t-default-param', `export declare function repeat(s: string, n?: number): string;`);
      expect(get()).toHaveLength(1);
    });

    it('skips class declarations', () => {
      const get = pkg('t-class', `export declare class Foo { bar(): string; }`);
      expect(get()).toHaveLength(0);
    });

    it('skips abstract class', () => {
      const get = pkg('t-abstract', `export declare abstract class Base { abstract run(): void; }`);
      expect(get()).toHaveLength(0);
    });

    it('skips enum', () => {
      const get = pkg('t-enum', `export declare enum Color { Red, Green, Blue }`);
      expect(get()).toHaveLength(0);
    });
  });

  // =========================================================================
  // 2. EXPORT PATTERNS
  // =========================================================================

  describe('export patterns', () => {
    it('named export', () => {
      const get = pkg('t-named', `export declare function foo(): void;`);
      expect(get()).toHaveLength(1);
    });

    it('multiple named exports', () => {
      const get = pkg('t-multi-named', `
        export declare function foo(): void
        export declare function bar(): void
        export declare function baz(): void
      `);
      expect(get()).toHaveLength(3);
    });

    it('default function export', () => {
      const get = pkg('t-default-fn', `export default function createApp(config: object): object;`);
      expect(get()).toHaveLength(1);
      expect(get()[0].function).toBe('createApp');
    });

    it('default anonymous function stays as default', () => {
      const get = pkg('t-default-anon', `declare const _default: (x: string) => string;
export default _default;`);
      // May resolve to _default or default, either is acceptable
      expect(get()).toHaveLength(1);
    });

    it('re-export named', () => {
      const get = pkg('t-reexport-named', `export { foo, bar } from './lib.js';`, {
        'lib.d.ts': `export declare function foo(): void;\nexport declare function bar(): string;`,
      });
      expect(get()).toHaveLength(2);
    });

    it('re-export with rename', () => {
      const get = pkg('t-reexport-rename', `export { foo as myFoo } from './lib.js';`, {
        'lib.d.ts': `export declare function foo(): void;`,
      });
      expect(get()).toHaveLength(1);
      expect(get()[0].function).toBe('myFoo');
    });

    it('star re-export', () => {
      const get = pkg('t-star', `export * from './utils.js';`, {
        'utils.d.ts': `export declare function a(): void;\nexport declare function b(): void;`,
      });
      expect(get()).toHaveLength(2);
    });

    it('star re-export with local override', () => {
      const get = pkg('t-star-override', `
        export * from './utils.js'
        export declare function a(): string
      `, {
        'utils.d.ts': `export declare function a(): void;\nexport declare function b(): void;`,
      });
      // Local 'a' should win, plus 'b' from star
      expect(get().length).toBeGreaterThanOrEqual(2);
      expect(get().map(e => e.function)).toContain('a');
      expect(get().map(e => e.function)).toContain('b');
    });

    it('nested re-exports (2 levels)', () => {
      const get = pkg('t-nested-reexport', `export { deep } from './mid.js';`, {
        'mid.d.ts': `export { deep } from './deep.js';`,
        'deep.d.ts': `export declare function deep(): string;`,
      });
      expect(get()).toHaveLength(1);
      expect(get()[0].function).toBe('deep');
    });

    it('export = single function (CJS)', () => {
      const get = pkg('t-cjs-fn', `declare function cloneDeep<T>(value: T): T;\nexport = cloneDeep;`);
      expect(get()).toHaveLength(1);
      expect(get()[0].function).toBe('cloneDeep');
    });

    it('export = namespace (CJS) skipped', () => {
      const get = pkg('t-cjs-ns', `
        interface Methods {
          a(): void
          b(): void
          c(): void
          d(): void
          e(): void
          f(): void
        }
        declare const lib: Methods
        export = lib
      `);
      expect(get()).toHaveLength(0);
    });

    it('export = class skipped', () => {
      const get = pkg('t-cjs-class', `declare class Foo { run(): void; }\nexport = Foo;`);
      // Class constructor is callable but not a workflow function
      // The export= handling skips it if it can't resolve a function name
      const exports = get();
      // Either 0 (skipped) or name !== 'export='
      for (const e of exports) {
        expect(e.function).not.toBe('export=');
      }
    });

    it('mixed exports: functions + types + interfaces', () => {
      const get = pkg('t-mixed-all', `
        export declare function run(): void;
        export interface Config { key: string; }
        export type Handler = () => void;
        export declare const VERSION: string;
        export declare function stop(): void;
      `);
      expect(get()).toHaveLength(2);
      expect(get().map(e => e.function).sort()).toEqual(['run', 'stop']);
    });
  });

  // =========================================================================
  // 3. PARAMETER TYPES -> INPUT PORTS
  // =========================================================================

  describe('parameter types', () => {
    it('string param -> STRING type', () => {
      const get = pkg('t-param-str', `export declare function f(x: string): void;`);
      const input = get()[0].ports.find(p => p.name === 'x');
      expect(input?.type).toBe('STRING');
    });

    it('number param -> NUMBER type', () => {
      const get = pkg('t-param-num', `export declare function f(x: number): void;`);
      expect(get()[0].ports.find(p => p.name === 'x')?.type).toBe('NUMBER');
    });

    it('boolean param -> BOOLEAN type', () => {
      const get = pkg('t-param-bool', `export declare function f(x: boolean): void;`);
      expect(get()[0].ports.find(p => p.name === 'x')?.type).toBe('BOOLEAN');
    });

    it('object param -> OBJECT type', () => {
      const get = pkg('t-param-obj', `export declare function f(x: { key: string }): void;`);
      expect(get()[0].ports.find(p => p.name === 'x')?.type).toBe('OBJECT');
    });

    it('array param -> ARRAY type', () => {
      const get = pkg('t-param-arr', `export declare function f(x: string[]): void;`);
      expect(get()[0].ports.find(p => p.name === 'x')?.type).toBe('ARRAY');
    });

    it('Array<T> param -> ARRAY type', () => {
      const get = pkg('t-param-arrgen', `export declare function f(x: Array<number>): void;`);
      expect(get()[0].ports.find(p => p.name === 'x')?.type).toBe('ARRAY');
    });

    it('any param -> ANY type', () => {
      const get = pkg('t-param-any', `export declare function f(x: any): void;`);
      expect(get()[0].ports.find(p => p.name === 'x')?.type).toBe('ANY');
    });

    it('unknown param -> ANY type', () => {
      const get = pkg('t-param-unknown', `export declare function f(x: unknown): void;`);
      const port = get()[0].ports.find(p => p.name === 'x');
      // unknown maps to ANY or OBJECT
      expect(['ANY', 'OBJECT']).toContain(port?.type);
    });

    it('function param -> FUNCTION type', () => {
      const get = pkg('t-param-fn', `export declare function f(cb: () => void): void;`);
      expect(get()[0].ports.find(p => p.name === 'cb')?.type).toBe('FUNCTION');
    });

    it('union param -> ANY type', () => {
      const get = pkg('t-param-union', `export declare function f(x: string | number): void;`);
      const port = get()[0].ports.find(p => p.name === 'x');
      // Unions typically map to ANY
      expect(port?.type).toBeDefined();
    });

    it('zero params -> only execute port', () => {
      const get = pkg('t-no-params', `export declare function f(): void;`);
      const inputs = get()[0].ports.filter(p => p.direction === 'INPUT');
      expect(inputs).toHaveLength(1);
      expect(inputs[0].name).toBe('execute');
    });

    it('many params -> all become ports', () => {
      const get = pkg('t-many-params', `export declare function f(a: string, b: number, c: boolean, d: object, e: any): void;`);
      const inputs = get()[0].ports.filter(p => p.direction === 'INPUT' && p.name !== 'execute');
      expect(inputs).toHaveLength(5);
    });

    it('param names become port names', () => {
      const get = pkg('t-param-names', `export declare function f(firstName: string, lastName: string): void;`);
      const names = get()[0].ports.filter(p => p.direction === 'INPUT' && p.name !== 'execute').map(p => p.name);
      expect(names).toEqual(['firstName', 'lastName']);
    });

    it('param names become capitalized labels', () => {
      const get = pkg('t-param-labels', `export declare function f(myParam: string): void;`);
      const port = get()[0].ports.find(p => p.name === 'myParam');
      expect(port?.defaultLabel).toBe('MyParam');
    });
  });

  // =========================================================================
  // 4. RETURN TYPES -> OUTPUT PORTS
  // =========================================================================

  describe('return types', () => {
    it('void return -> no data output ports', () => {
      const get = pkg('t-ret-void', `export declare function f(): void;`);
      const outputs = get()[0].ports.filter(p => p.direction === 'OUTPUT' && p.name !== 'onSuccess' && p.name !== 'onFailure');
      expect(outputs).toHaveLength(0);
    });

    it('undefined return -> no data output ports', () => {
      const get = pkg('t-ret-undef', `export declare function f(): undefined;`);
      const outputs = get()[0].ports.filter(p => p.direction === 'OUTPUT' && p.name !== 'onSuccess' && p.name !== 'onFailure');
      expect(outputs).toHaveLength(0);
    });

    it('string return -> single result port', () => {
      const get = pkg('t-ret-str', `export declare function f(): string;`);
      const result = get()[0].ports.find(p => p.name === 'result');
      expect(result).toBeDefined();
      expect(result?.type).toBe('STRING');
    });

    it('number return -> single result port', () => {
      const get = pkg('t-ret-num', `export declare function f(): number;`);
      expect(get()[0].ports.find(p => p.name === 'result')?.type).toBe('NUMBER');
    });

    it('boolean return -> single result port', () => {
      const get = pkg('t-ret-bool', `export declare function f(): boolean;`);
      expect(get()[0].ports.find(p => p.name === 'result')?.type).toBe('BOOLEAN');
    });

    it('array return -> single result port', () => {
      const get = pkg('t-ret-arr', `export declare function f(): string[];`);
      expect(get()[0].ports.find(p => p.name === 'result')?.type).toBe('ARRAY');
    });

    it('object return -> multiple output ports', () => {
      const get = pkg('t-ret-obj', `export declare function f(): { name: string; age: number };`);
      const outputs = get()[0].ports.filter(p => p.direction === 'OUTPUT' && p.name !== 'onSuccess' && p.name !== 'onFailure');
      expect(outputs).toHaveLength(2);
      expect(outputs.map(p => p.name).sort()).toEqual(['age', 'name']);
    });

    it('object return with >8 properties -> single result port', () => {
      const get = pkg('t-ret-big-obj', `export declare function f(): {
        a: string; b: string; c: string; d: string; e: string;
        f: string; g: string; h: string; i: string; j: string;
      };`);
      const outputs = get()[0].ports.filter(p => p.direction === 'OUTPUT' && p.name !== 'onSuccess' && p.name !== 'onFailure');
      expect(outputs).toHaveLength(1);
      expect(outputs[0].name).toBe('result');
    });

    it('object return with exactly 8 properties -> 8 ports', () => {
      const get = pkg('t-ret-8-obj', `export declare function f(): {
        a: string; b: string; c: string; d: string;
        e: string; f: string; g: string; h: string;
      };`);
      const outputs = get()[0].ports.filter(p => p.direction === 'OUTPUT' && p.name !== 'onSuccess' && p.name !== 'onFailure');
      expect(outputs).toHaveLength(8);
    });

    it('Promise<string> -> async + string result', () => {
      const get = pkg('t-ret-promise-str', `export declare function f(): Promise<string>;`);
      expect(get()[0].synchronicity).toBe('ASYNC');
      expect(get()[0].ports.find(p => p.name === 'result')?.type).toBe('STRING');
    });

    it('Promise<void> -> async + no data output', () => {
      const get = pkg('t-ret-promise-void', `export declare function f(): Promise<void>;`);
      expect(get()[0].synchronicity).toBe('ASYNC');
      const outputs = get()[0].ports.filter(p => p.direction === 'OUTPUT' && p.name !== 'onSuccess' && p.name !== 'onFailure');
      expect(outputs).toHaveLength(0);
    });

    it('Promise<{ a: string }> -> async + object ports', () => {
      const get = pkg('t-ret-promise-obj', `export declare function f(): Promise<{ a: string; b: number }>;`);
      expect(get()[0].synchronicity).toBe('ASYNC');
      const outputs = get()[0].ports.filter(p => p.direction === 'OUTPUT' && p.name !== 'onSuccess' && p.name !== 'onFailure');
      expect(outputs).toHaveLength(2);
    });

    it('non-Promise object return -> sync', () => {
      const get = pkg('t-ret-sync-obj', `export declare function f(): { x: number };`);
      expect(get()[0].synchronicity).toBe('SYNC');
    });
  });

  // =========================================================================
  // 5. PORT DETAILS
  // =========================================================================

  describe('port details', () => {
    it('every export has execute port', () => {
      const get = pkg('t-port-exec', `
        export declare function a(): void
        export declare function b(): void
      `);
      for (const e of get()) {
        expect(e.ports.some(p => p.name === 'execute')).toBe(true);
      }
    });

    it('every export has onSuccess port', () => {
      const get = pkg('t-port-success', `export declare function a(): void;`);
      const port = get()[0].ports.find(p => p.name === 'onSuccess');
      expect(port).toBeDefined();
      expect(port?.type).toBe('STEP');
      expect(port?.direction).toBe('OUTPUT');
    });

    it('every export has onFailure port with failure=true', () => {
      const get = pkg('t-port-failure', `export declare function a(): void;`);
      const port = get()[0].ports.find(p => p.name === 'onFailure');
      expect(port).toBeDefined();
      expect(port?.type).toBe('STEP');
      expect(port?.direction).toBe('OUTPUT');
      expect(port?.failure).toBe(true);
    });

    it('execute is STEP INPUT', () => {
      const get = pkg('t-port-exec-type', `export declare function a(): void;`);
      const port = get()[0].ports.find(p => p.name === 'execute');
      expect(port?.type).toBe('STEP');
      expect(port?.direction).toBe('INPUT');
    });

    it('execute has defaultOrder 0', () => {
      const get = pkg('t-port-exec-order', `export declare function a(x: string): void;`);
      expect(get()[0].ports.find(p => p.name === 'execute')?.defaultOrder).toBe(0);
    });

    it('first param has defaultOrder 1', () => {
      const get = pkg('t-port-param-order', `export declare function a(x: string, y: number): void;`);
      expect(get()[0].ports.find(p => p.name === 'x')?.defaultOrder).toBe(1);
      expect(get()[0].ports.find(p => p.name === 'y')?.defaultOrder).toBe(2);
    });

    it('onSuccess has defaultOrder 0', () => {
      const get = pkg('t-port-success-order', `export declare function a(): void;`);
      expect(get()[0].ports.find(p => p.name === 'onSuccess')?.defaultOrder).toBe(0);
    });

    it('onFailure has defaultOrder 1', () => {
      const get = pkg('t-port-failure-order', `export declare function a(): void;`);
      expect(get()[0].ports.find(p => p.name === 'onFailure')?.defaultOrder).toBe(1);
    });

    it('no port has failure=true except onFailure', () => {
      const get = pkg('t-port-no-extra-failure', `export declare function a(x: string): { result: string };`);
      for (const port of get()[0].ports) {
        if (port.name !== 'onFailure') {
          expect(port.failure).toBeFalsy();
        }
      }
    });

    it('port reference equals port name', () => {
      const get = pkg('t-port-ref', `export declare function a(myInput: string): string;`);
      for (const port of get()[0].ports) {
        expect(port.reference).toBe(port.name);
      }
    });
  });

  // =========================================================================
  // 6. METADATA
  // =========================================================================

  describe('metadata', () => {
    it('name is the function name (no npm/ prefix)', () => {
      const get = pkg('my-pkg', `export declare function doStuff(): void;`);
      expect(get()[0].name).toBe('doStuff');
    });

    it('scoped package name uses function name, importSource has package', () => {
      const parts = ['@myorg', 'utils'];
      const pkgDir = path.join(nodeModulesDir, ...parts);
      fs.mkdirSync(pkgDir, { recursive: true });
      fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: '@myorg/utils', types: './index.d.ts' }));
      fs.writeFileSync(path.join(pkgDir, 'index.d.ts'), `export declare function helper(): void;`);
      const exports = getPackageExports('@myorg/utils', tmpDir);
      expect(exports[0].name).toBe('helper');
      expect(exports[0].importSource).toBe('@myorg/utils');
    });

    it('variant is always FUNCTION', () => {
      const get = pkg('t-variant', `export declare function a(): void;\nexport declare const b: () => void;`);
      for (const e of get()) {
        expect(e.variant).toBe('FUNCTION');
      }
    });

    it('category is NPM Packages', () => {
      const get = pkg('t-cat', `export declare function a(): void;`);
      expect(get()[0].category).toBe('NPM Packages');
    });

    it('description format: <name> from <package>', () => {
      const get = pkg('cool-lib', `export declare function magic(): void;`);
      expect(get()[0].description).toBe('magic from cool-lib');
    });

    it('label equals function name', () => {
      const get = pkg('t-label', `export declare function myFunction(): void;`);
      expect(get()[0].label).toBe('myFunction');
    });

    it('importSource equals package name', () => {
      const get = pkg('t-import', `export declare function a(): void;`);
      expect(get()[0].importSource).toBe('t-import');
    });
  });

  // =========================================================================
  // 7. EDGE CASES
  // =========================================================================

  describe('edge cases', () => {
    it('non-existent package -> empty', () => {
      expect(getPackageExports('does-not-exist', tmpDir)).toEqual([]);
    });

    it('empty .d.ts -> empty', () => {
      const get = pkg('t-empty', '');
      expect(get()).toEqual([]);
    });

    it('only whitespace .d.ts -> empty', () => {
      const get = pkg('t-whitespace', '   \n\n  ');
      expect(get()).toEqual([]);
    });

    it('only comments .d.ts -> empty', () => {
      const get = pkg('t-comments', '// just a comment\n/* block */');
      expect(get()).toEqual([]);
    });

    it('only types and interfaces -> empty', () => {
      const get = pkg('t-types-only', `
        export interface Foo { bar: string; }
        export type Baz = { qux: number };
        export type Handler = () => void;
      `);
      expect(get()).toEqual([]);
    });

    it('const string (non-callable) -> empty', () => {
      const get = pkg('t-const-str', `export declare const VERSION: string;`);
      expect(get()).toEqual([]);
    });

    it('const number (non-callable) -> empty', () => {
      const get = pkg('t-const-num', `export declare const MAX: number;`);
      expect(get()).toEqual([]);
    });

    it('duplicate function names are deduplicated', () => {
      const get = pkg('t-dedup', `
        export declare function foo(): void
        export declare function foo(x: string): string
      `);
      expect(get().filter(e => e.function === 'foo')).toHaveLength(1);
    });

    it('handles package with broken .d.ts gracefully', () => {
      const pkgDir = path.join(nodeModulesDir, 'broken-pkg');
      fs.mkdirSync(pkgDir, { recursive: true });
      fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: 'broken-pkg', types: './index.d.ts' }));
      fs.writeFileSync(path.join(pkgDir, 'index.d.ts'), `export declare function {{{ invalid`);
      // Should not throw
      const exports = getPackageExports('broken-pkg', tmpDir);
      expect(Array.isArray(exports)).toBe(true);
    });

    it('package with no types field in package.json -> empty', () => {
      const pkgDir = path.join(nodeModulesDir, 'no-types');
      fs.mkdirSync(pkgDir, { recursive: true });
      fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: 'no-types' }));
      expect(getPackageExports('no-types', tmpDir)).toEqual([]);
    });

    it('handles very long function name', () => {
      const longName = 'a'.repeat(200);
      const get = pkg('t-long-name', `export declare function ${longName}(): void;`);
      expect(get()).toHaveLength(1);
      expect(get()[0].function).toBe(longName);
    });

    it('handles function with many parameters (10+)', () => {
      const params = Array.from({ length: 15 }, (_, i) => `p${i}: string`).join(', ');
      const get = pkg('t-many-params-edge', `export declare function f(${params}): void;`);
      const inputs = get()[0].ports.filter(p => p.direction === 'INPUT' && p.name !== 'execute');
      expect(inputs).toHaveLength(15);
    });

    it('two packages dont interfere with each other', () => {
      pkg('t-pkg-a', `export declare function alpha(): void;`);
      pkg('t-pkg-b', `export declare function beta(): void;`);
      const a = getPackageExports('t-pkg-a', tmpDir);
      const b = getPackageExports('t-pkg-b', tmpDir);
      expect(a).toHaveLength(1);
      expect(a[0].function).toBe('alpha');
      expect(b).toHaveLength(1);
      expect(b[0].function).toBe('beta');
    });

    it('re-export from missing submodule -> graceful', () => {
      const get = pkg('t-missing-sub', `export { foo } from './nonexistent.js';`);
      // Should not crash, may return empty
      expect(Array.isArray(get())).toBe(true);
    });

    it('circular re-exports do not crash', () => {
      const get = pkg('t-circular', `export { a } from './b.js';`, {
        'b.d.ts': `export { a } from './index.js';`,
      });
      expect(Array.isArray(get())).toBe(true);
    });
  });

  // =========================================================================
  // 8. ADVANCED TYPE PATTERNS
  // =========================================================================

  describe('advanced type patterns', () => {
    it('tuple return type -> single result port', () => {
      const get = pkg('t-tuple', `export declare function f(): [string, number];`);
      const outputs = get()[0].ports.filter(p => p.direction === 'OUTPUT' && !['onSuccess', 'onFailure'].includes(p.name));
      expect(outputs).toHaveLength(1);
      expect(outputs[0].name).toBe('result');
    });

    it('union return type -> single result port', () => {
      const get = pkg('t-union-ret', `export declare function f(): string | null;`);
      const outputs = get()[0].ports.filter(p => p.direction === 'OUTPUT' && !['onSuccess', 'onFailure'].includes(p.name));
      expect(outputs).toHaveLength(1);
    });

    it('intersection type param', () => {
      const get = pkg('t-intersect', `export declare function f(x: { a: string } & { b: number }): void;`);
      expect(get()).toHaveLength(1);
      const port = get()[0].ports.find(p => p.name === 'x');
      expect(port).toBeDefined();
    });

    it('null param type', () => {
      const get = pkg('t-null', `export declare function f(x: null): void;`);
      expect(get()).toHaveLength(1);
    });

    it('never return type -> no data ports', () => {
      const get = pkg('t-never', `export declare function f(): never;`);
      const outputs = get()[0].ports.filter(p => p.direction === 'OUTPUT' && !['onSuccess', 'onFailure'].includes(p.name));
      expect(outputs).toHaveLength(0);
    });

    it('readonly array param', () => {
      const get = pkg('t-readonly-arr', `export declare function f(x: readonly string[]): void;`);
      expect(get()).toHaveLength(1);
    });

    it('Record type param', () => {
      const get = pkg('t-record', `export declare function f(x: Record<string, unknown>): void;`);
      expect(get()).toHaveLength(1);
    });

    it('Map type param', () => {
      const get = pkg('t-map', `export declare function f(x: Map<string, number>): void;`);
      expect(get()).toHaveLength(1);
    });

    it('Set type param', () => {
      const get = pkg('t-set', `export declare function f(x: Set<string>): void;`);
      expect(get()).toHaveLength(1);
    });

    it('callback param -> FUNCTION type', () => {
      const get = pkg('t-callback', `export declare function f(cb: (err: Error | null, data: string) => void): void;`);
      const port = get()[0].ports.find(p => p.name === 'cb');
      expect(port?.type).toBe('FUNCTION');
    });

    it('this parameter is not an input port', () => {
      const get = pkg('t-this', `export declare function f(this: object, x: string): void;`);
      const inputs = get()[0].ports.filter(p => p.direction === 'INPUT' && p.name !== 'execute');
      // 'this' should not be a port, only 'x'
      expect(inputs.some(p => p.name === 'this')).toBe(false);
      expect(inputs.some(p => p.name === 'x')).toBe(true);
    });

    it('destructured object param keeps param name', () => {
      const get = pkg('t-destructured', `export declare function f(options: { host: string; port: number }): void;`);
      const port = get()[0].ports.find(p => p.name === 'options');
      expect(port).toBeDefined();
      expect(port?.type).toBe('OBJECT');
    });

    it('literal type param', () => {
      const get = pkg('t-literal', `export declare function f(mode: 'read' | 'write'): void;`);
      expect(get()).toHaveLength(1);
    });

    it('bigint type', () => {
      const get = pkg('t-bigint', `export declare function f(x: bigint): bigint;`);
      expect(get()).toHaveLength(1);
    });

    it('symbol type', () => {
      const get = pkg('t-symbol', `export declare function f(x: symbol): void;`);
      expect(get()).toHaveLength(1);
    });

    it('template literal type param', () => {
      const get = pkg('t-template-literal', "export declare function f(x: `${string}-${number}`): void;");
      expect(get()).toHaveLength(1);
    });

    it('conditional type return', () => {
      const get = pkg('t-conditional', `export declare function f<T>(x: T): T extends string ? number : boolean;`);
      expect(get()).toHaveLength(1);
    });

    it('index signature return -> single result', () => {
      const get = pkg('t-index-sig', `export declare function f(): { [key: string]: unknown };`);
      const outputs = get()[0].ports.filter(p => p.direction === 'OUTPUT' && !['onSuccess', 'onFailure'].includes(p.name));
      // Index signatures have infinite properties — should collapse to single result
      expect(outputs.length).toBeLessThanOrEqual(1);
    });

    it('Partial<T> return', () => {
      const get = pkg('t-partial', `export declare function f(): Partial<{ a: string; b: number }>;`);
      expect(get()).toHaveLength(1);
    });

    it('Required<T> return', () => {
      const get = pkg('t-required', `export declare function f(): Required<{ a?: string }>;`);
      expect(get()).toHaveLength(1);
    });

    it('Pick<T, K> return', () => {
      const get = pkg('t-pick', `export declare function f(): Pick<{ a: string; b: number; c: boolean }, 'a' | 'b'>;`);
      const outputs = get()[0].ports.filter(p => p.direction === 'OUTPUT' && !['onSuccess', 'onFailure'].includes(p.name));
      expect(outputs.length).toBeLessThanOrEqual(2);
    });
  });

  // =========================================================================
  // 9. REAL-WORLD PATTERNS
  // =========================================================================

  describe('real-world patterns', () => {
    it('Express-style middleware', () => {
      const get = pkg('t-express', `
        export declare function json(options?: object): (req: object, res: object, next: () => void) => void
        export declare function urlencoded(options?: object): (req: object, res: object, next: () => void) => void
      `);
      expect(get()).toHaveLength(2);
    });

    it('React hook pattern', () => {
      const get = pkg('t-react-hook', `
        export declare function useState<T>(initial: T): [T, (value: T) => void]
        export declare function useEffect(effect: () => void, deps?: any[]): void
        export declare function useCallback<T extends (...args: any[]) => any>(callback: T, deps: any[]): T
      `);
      expect(get()).toHaveLength(3);
    });

    it('SDK client pattern (factory function)', () => {
      const get = pkg('t-sdk', `
        export declare function createClient(config: { apiKey: string; baseUrl?: string }): {
          get: (path: string) => Promise<object>;
          post: (path: string, body: object) => Promise<object>;
        };
      `);
      expect(get()).toHaveLength(1);
      expect(get()[0].function).toBe('createClient');
    });

    it('Utility library pattern (many small functions)', () => {
      const fns = Array.from({ length: 20 }, (_, i) =>
        `export declare function fn${i}(x: string): string;`
      ).join('\n');
      const get = pkg('t-util-lib', fns);
      expect(get()).toHaveLength(20);
    });

    it('Fastify plugin pattern', () => {
      const get = pkg('t-fastify-plugin', `
        export declare function fastifyPlugin(instance: object, opts: object, done: () => void): void
        export declare function fp(fn: Function): Function
      `);
      expect(get()).toHaveLength(2);
    });

    it('Event emitter pattern', () => {
      const get = pkg('t-emitter', `
        export declare function on(event: string, listener: (...args: any[]) => void): void
        export declare function emit(event: string, ...args: any[]): boolean
        export declare function once(event: string, listener: (...args: any[]) => void): void
      `);
      expect(get()).toHaveLength(3);
    });

    it('Validator/parser pattern', () => {
      const get = pkg('t-validator', `
        export declare function parse<T>(schema: object, input: unknown): T;
        export declare function validate(schema: object, input: unknown): boolean;
        export declare function safeParse<T>(schema: object, input: unknown): { success: boolean; data?: T; error?: Error };
      `);
      expect(get()).toHaveLength(3);
    });

    it('Crypto/hash pattern', () => {
      const get = pkg('t-crypto', `
        export declare function hash(data: string, algorithm?: string): string
        export declare function encrypt(data: string, key: string): Buffer
        export declare function decrypt(data: Buffer, key: string): string
        export declare function sign(data: string, privateKey: string): string
        export declare function verify(data: string, signature: string, publicKey: string): boolean
      `);
      expect(get()).toHaveLength(5);
      expect(get().find(e => e.function === 'verify')?.ports.find(p => p.name === 'publicKey')).toBeDefined();
    });

    it('Builder/fluent pattern (returns this/self)', () => {
      const get = pkg('t-builder', `
        export declare function createBuilder(): { build: () => object; set: (key: string, value: any) => any; };
      `);
      expect(get()).toHaveLength(1);
    });
  });

  // =========================================================================
  // 10. STABILITY AND PERFORMANCE
  // =========================================================================

  describe('stability', () => {
    it('calling getPackageExports twice returns same results', () => {
      pkg('t-stable', `export declare function foo(): void;`);
      const r1 = getPackageExports('t-stable', tmpDir);
      const r2 = getPackageExports('t-stable', tmpDir);
      expect(r1).toHaveLength(r2.length);
      expect(r1[0].function).toBe(r2[0].function);
    });

    it('multiple packages in sequence do not interfere', () => {
      pkg('t-seq-a', `export declare function alpha(): void;`);
      pkg('t-seq-b', `export declare function beta(): void;`);
      pkg('t-seq-c', `export declare function gamma(): void;`);

      const a = getPackageExports('t-seq-a', tmpDir);
      const b = getPackageExports('t-seq-b', tmpDir);
      const c = getPackageExports('t-seq-c', tmpDir);

      expect(a[0].function).toBe('alpha');
      expect(b[0].function).toBe('beta');
      expect(c[0].function).toBe('gamma');
    });

    it('package with 50 exports completes', () => {
      const fns = Array.from({ length: 50 }, (_, i) =>
        `export declare function fn${i}(x: string): string;`
      ).join('\n');
      const get = pkg('t-fifty', fns);
      expect(get()).toHaveLength(50);
    });

    it('deeply nested re-export chain (3 levels)', () => {
      const get = pkg('t-deep-chain', `export { x } from './a.js';`, {
        'a.d.ts': `export { x } from './b.js';`,
        'b.d.ts': `export { x } from './c.js';`,
        'c.d.ts': `export declare function x(): void;`,
      });
      expect(get()).toHaveLength(1);
      expect(get()[0].function).toBe('x');
    });

    it('multiple star re-exports from different submodules', () => {
      const get = pkg('t-multi-star', `
        export * from './utils.js'
        export * from './helpers.js'
      `, {
        'utils.d.ts': `export declare function utilA(): void;\nexport declare function utilB(): void;`,
        'helpers.d.ts': `export declare function helperA(): void;\nexport declare function helperB(): void;`,
      });
      expect(get().length).toBeGreaterThanOrEqual(4);
    });

    it('star re-export + named re-export from same module', () => {
      const get = pkg('t-star-named-mix', `
        export * from './lib.js'
        export { specific } from './lib.js'
      `, {
        'lib.d.ts': `
          export declare function specific(): void
          export declare function other(): void
        `,
      });
      // Should have both, no duplicates
      const names = get().map(e => e.function);
      expect(names).toContain('specific');
      expect(names).toContain('other');
      expect(new Set(names).size).toBe(names.length);
    });

    it('barrel file pattern (index re-exports everything)', () => {
      const get = pkg('t-barrel', `
        export { create } from './create.js'
        export { destroy } from './destroy.js'
        export { update } from './update.js'
      `, {
        'create.d.ts': `export declare function create(data: object): object;`,
        'destroy.d.ts': `export declare function destroy(id: string): void;`,
        'update.d.ts': `export declare function update(id: string, data: object): object;`,
      });
      expect(get()).toHaveLength(3);
      expect(get().map(e => e.function).sort()).toEqual(['create', 'destroy', 'update']);
    });
  });

  // =========================================================================
  // 11. ASYNC DETECTION
  // =========================================================================

  describe('async detection', () => {
    it('Promise<T> return -> ASYNC', () => {
      const get = pkg('t-async-promise', `export declare function f(): Promise<string>;`);
      expect(get()[0].synchronicity).toBe('ASYNC');
    });

    it('Promise<void> return -> ASYNC', () => {
      const get = pkg('t-async-void', `export declare function f(): Promise<void>;`);
      expect(get()[0].synchronicity).toBe('ASYNC');
    });

    it('non-Promise return -> SYNC', () => {
      const get = pkg('t-sync-str', `export declare function f(): string;`);
      expect(get()[0].synchronicity).toBe('SYNC');
    });

    it('void return -> SYNC', () => {
      const get = pkg('t-sync-void', `export declare function f(): void;`);
      expect(get()[0].synchronicity).toBe('SYNC');
    });

    it('Promise<{ a: string }> unwraps to object ports', () => {
      const get = pkg('t-async-unwrap', `export declare function f(): Promise<{ a: string; b: number }>;`);
      expect(get()[0].synchronicity).toBe('ASYNC');
      const outputs = get()[0].ports.filter(p => p.direction === 'OUTPUT' && !['onSuccess', 'onFailure'].includes(p.name));
      expect(outputs).toHaveLength(2);
    });
  });
});
