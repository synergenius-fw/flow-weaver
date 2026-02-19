/**
 * TDD tests for npm import overload deduplication.
 *
 * Problem: When an npm package exports overloaded function declarations
 * (e.g., `marked(src: string): string` and `marked(src: string, options: MarkedOptions): string`),
 * the parser creates one node type per overload, causing DUPLICATE_NODE_NAME errors.
 *
 * Fix: Add seenNames Set in resolveNpmPackageTypes() and resolveNpmImportAnnotation()
 * to skip duplicate function names (first-wins semantics).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { AnnotationParser } from '../../src/parser';

const tmpDir = path.join(os.tmpdir(), `fw-overload-dedup-${process.pid}`);

beforeAll(() => fs.mkdirSync(tmpDir, { recursive: true }));
afterAll(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

function writeFile(name: string, content: string) {
  const p = path.join(tmpDir, name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return p;
}

function setupPackage(pkgName: string, dtsContent: string) {
  const pkgDir = path.join(tmpDir, 'node_modules', pkgName);
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(
    path.join(pkgDir, 'package.json'),
    JSON.stringify({ name: pkgName, version: '1.0.0', types: 'index.d.ts' })
  );
  fs.writeFileSync(path.join(pkgDir, 'index.d.ts'), dtsContent);
}

describe('npm import overload deduplication', () => {
  const parser = new AnnotationParser();

  beforeAll(() => {
    parser.clearCache();
  });

  it('overloaded function (3 signatures, same name) produces a single node type', () => {
    setupPackage('overloaded-pkg', `
      export declare function render(src: string): string;
      export declare function render(src: string, options: object): string;
      export declare function render(src: string, options: object, callback: Function): void;
    `);

    const workflowPath = writeFile('wf-overload-1.ts', `
      import { render } from 'overloaded-pkg';

      /**
       * @flowWeaver workflow
       * @node r render
       * @connect Start.src -> r.src
       * @connect r.result -> Exit.output
       */
      export function overloadWorkflow(
        execute: boolean,
        params: { src: string }
      ): { onSuccess: boolean; onFailure: boolean; output: string } {
        throw new Error('stub');
      }
    `);

    parser.clearCache();
    const result = parser.parse(workflowPath);

    // Should have exactly 1 node type for 'render', not 3
    const renderTypes = result.nodeTypes.filter(nt => nt.functionName === 'render');
    expect(renderTypes).toHaveLength(1);
    expect(result.errors).toHaveLength(0);
  });

  it('namespace + function with same name produces a single entry', () => {
    setupPackage('ns-plus-fn-pkg', `
      export declare function convert(input: string): number;
      export declare namespace convert {
        function parse(s: string): number;
      }
    `);

    const workflowPath = writeFile('wf-overload-2.ts', `
      import { convert } from 'ns-plus-fn-pkg';

      /**
       * @flowWeaver workflow
       * @node c convert
       * @connect Start.input -> c.input
       * @connect c.result -> Exit.output
       */
      export function nsWorkflow(
        execute: boolean,
        params: { input: string }
      ): { onSuccess: boolean; onFailure: boolean; output: number } {
        throw new Error('stub');
      }
    `);

    parser.clearCache();
    const result = parser.parse(workflowPath);

    const convertTypes = result.nodeTypes.filter(nt => nt.functionName === 'convert');
    expect(convertTypes).toHaveLength(1);
    expect(result.errors).toHaveLength(0);
  });

  it('multiple unique functions are all preserved (no over-filtering)', () => {
    setupPackage('multi-unique-pkg', `
      export declare function alpha(x: number): number;
      export declare function beta(y: string): string;
      export declare function gamma(z: boolean): boolean;
    `);

    const workflowPath = writeFile('wf-overload-3.ts', `
      import { alpha, beta, gamma } from 'multi-unique-pkg';

      /**
       * @flowWeaver workflow
       * @node a alpha
       * @node b beta
       * @node g gamma
       * @connect Start.x -> a.x
       * @connect a.result -> Exit.num
       * @connect Start.y -> b.y
       * @connect b.result -> Exit.str
       * @connect Start.z -> g.z
       * @connect g.result -> Exit.flag
       */
      export function multiWorkflow(
        execute: boolean,
        params: { x: number; y: string; z: boolean }
      ): { onSuccess: boolean; onFailure: boolean; num: number; str: string; flag: boolean } {
        throw new Error('stub');
      }
    `);

    parser.clearCache();
    const result = parser.parse(workflowPath);

    expect(result.nodeTypes.find(nt => nt.functionName === 'alpha')).toBeDefined();
    expect(result.nodeTypes.find(nt => nt.functionName === 'beta')).toBeDefined();
    expect(result.nodeTypes.find(nt => nt.functionName === 'gamma')).toBeDefined();
    expect(result.errors).toHaveLength(0);
  });

  it('first overload signature is the one used (first-wins)', () => {
    setupPackage('first-wins-pkg', `
      export declare function transform(input: string): string;
      export declare function transform(input: string, depth: number): object;
    `);

    const workflowPath = writeFile('wf-overload-4.ts', `
      import { transform } from 'first-wins-pkg';

      /**
       * @flowWeaver workflow
       * @node t transform
       * @connect Start.input -> t.input
       * @connect t.result -> Exit.output
       */
      export function firstWinsWorkflow(
        execute: boolean,
        params: { input: string }
      ): { onSuccess: boolean; onFailure: boolean; output: string } {
        throw new Error('stub');
      }
    `);

    parser.clearCache();
    const result = parser.parse(workflowPath);

    const transformType = result.nodeTypes.find(nt => nt.functionName === 'transform');
    expect(transformType).toBeDefined();
    // First overload has 1 input (input: string) and returns string
    expect(transformType!.inputs.input).toBeDefined();
    expect(transformType!.inputs.input.dataType).toBe('STRING');
    // Should NOT have 'depth' from the second overload
    expect(transformType!.inputs.depth).toBeUndefined();
  });

  it('@fwImport path: overloaded package produces a single node type', () => {
    setupPackage('fwimport-overloaded-pkg', `
      export declare function processData(data: string): string;
      export declare function processData(data: string, opts: object): string;
      export declare function processData(data: string, opts: object, flag: boolean): string;
    `);

    const workflowPath = writeFile('wf-overload-5.ts', `
      /**
       * @flowWeaver workflow
       * @fwImport npm/fwimport-overloaded-pkg/processData processData from "fwimport-overloaded-pkg"
       * @node p npm/fwimport-overloaded-pkg/processData
       * @connect Start.data -> p.data
       * @connect p.result -> Exit.output
       */
      export function fwImportWorkflow(
        execute: boolean,
        params: { data: string }
      ): { onSuccess: boolean; onFailure: boolean; output: string } {
        throw new Error('stub');
      }
    `);

    parser.clearCache();
    const result = parser.parse(workflowPath);

    // @fwImport types end up in the workflow's nodeTypes, not the top-level result
    const workflow = result.workflows[0];
    expect(workflow).toBeDefined();

    // The @fwImport should resolve to a single node type despite overloads in .d.ts
    const processTypes = workflow.nodeTypes.filter(
      nt => nt.functionName === 'processData' || nt.name === 'npm/fwimport-overloaded-pkg/processData'
    );
    expect(processTypes).toHaveLength(1);
  });

  it('cached result after dedup is consistent across multiple parses', () => {
    setupPackage('cache-test-pkg', `
      export declare function cached(a: number): number;
      export declare function cached(a: number, b: number): number;
      export declare function other(x: string): string;
    `);

    const workflowPath = writeFile('wf-overload-6.ts', `
      import { cached, other } from 'cache-test-pkg';

      /**
       * @flowWeaver workflow
       * @node c cached
       * @node o other
       * @connect Start.a -> c.a
       * @connect c.result -> Exit.num
       * @connect Start.x -> o.x
       * @connect o.result -> Exit.str
       */
      export function cacheWorkflow(
        execute: boolean,
        params: { a: number; x: string }
      ): { onSuccess: boolean; onFailure: boolean; num: number; str: string } {
        throw new Error('stub');
      }
    `);

    // First parse
    parser.clearCache();
    const result1 = parser.parse(workflowPath);
    const cached1 = result1.nodeTypes.filter(nt => nt.functionName === 'cached');
    expect(cached1).toHaveLength(1);

    // Second parse (should use cache)
    const result2 = parser.parse(workflowPath);
    const cached2 = result2.nodeTypes.filter(nt => nt.functionName === 'cached');
    expect(cached2).toHaveLength(1);

    // Both should return 'other' too
    expect(result1.nodeTypes.find(nt => nt.functionName === 'other')).toBeDefined();
    expect(result2.nodeTypes.find(nt => nt.functionName === 'other')).toBeDefined();
  });
});
