import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { AnnotationParser } from '../../src/parser';

const tmpDir = path.join(os.tmpdir(), `fw-npm-pkg-${process.pid}`);

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

describe('parser npm package type resolution', () => {
  const parser = new AnnotationParser();

  beforeAll(() => {
    parser.clearCache();
  });

  it('named imports from typed npm package produce inferred expression node types', () => {
    setupPackage('test-utils', `
      export declare function formatName(first: string, last: string): string;
    `);
    const workflowPath = writeFile('wf-npm-1.ts', `
      import { formatName } from 'test-utils';

      /**
       * @flowWeaver workflow
       * @node fmt formatName
       * @connect Start.first -> fmt.first
       * @connect Start.last -> fmt.last
       * @connect fmt.result -> Exit.output
       */
      export function nameWorkflow(
        execute: boolean,
        params: { first: string; last: string }
      ): { onSuccess: boolean; onFailure: boolean; output: string } {
        throw new Error('stub');
      }
    `);

    const result = parser.parse(workflowPath);
    expect(result.errors).toHaveLength(0);

    const nodeType = result.nodeTypes.find(nt => nt.functionName === 'formatName');
    expect(nodeType).toBeDefined();
    expect(nodeType!.expression).toBe(true);
    expect(nodeType!.inferred).toBe(true);
  });

  it('importSource is set to the package specifier', () => {
    setupPackage('my-lib', `
      export declare function doWork(input: number): number;
    `);
    const workflowPath = writeFile('wf-npm-2.ts', `
      import { doWork } from 'my-lib';

      /**
       * @flowWeaver workflow
       * @node w doWork
       * @connect Start.input -> w.input
       * @connect w.result -> Exit.output
       */
      export function workWorkflow(
        execute: boolean,
        params: { input: number }
      ): { onSuccess: boolean; onFailure: boolean; output: number } {
        throw new Error('stub');
      }
    `);

    const result = parser.parse(workflowPath);
    const nodeType = result.nodeTypes.find(nt => nt.functionName === 'doWork');
    expect(nodeType).toBeDefined();
    expect(nodeType!.importSource).toBe('my-lib');
  });

  it('input ports match .d.ts parameters, output ports match return type', () => {
    setupPackage('port-pkg', `
      export declare function calculate(a: number, b: string): { sum: number; label: string };
    `);
    const workflowPath = writeFile('wf-npm-3.ts', `
      import { calculate } from 'port-pkg';

      /**
       * @flowWeaver workflow
       * @node calc calculate
       * @connect Start.a -> calc.a
       * @connect Start.b -> calc.b
       * @connect calc.sum -> Exit.sum
       */
      export function calcWorkflow(
        execute: boolean,
        params: { a: number; b: string }
      ): { onSuccess: boolean; onFailure: boolean; sum: number } {
        throw new Error('stub');
      }
    `);

    const result = parser.parse(workflowPath);
    const nodeType = result.nodeTypes.find(nt => nt.functionName === 'calculate');
    expect(nodeType).toBeDefined();

    // Input ports (excluding execute)
    expect(nodeType!.inputs.a).toBeDefined();
    expect(nodeType!.inputs.a.dataType).toBe('NUMBER');
    expect(nodeType!.inputs.b).toBeDefined();
    expect(nodeType!.inputs.b.dataType).toBe('STRING');

    // Output ports (excluding onSuccess/onFailure)
    expect(nodeType!.outputs.sum).toBeDefined();
    expect(nodeType!.outputs.sum.dataType).toBe('NUMBER');
    expect(nodeType!.outputs.label).toBeDefined();
    expect(nodeType!.outputs.label.dataType).toBe('STRING');
  });

  it('only named imports are resolved (skip default/namespace)', () => {
    setupPackage('mixed-exports', `
      export declare function namedFn(x: number): number;
      declare const _default: { helper: () => void };
      export default _default;
    `);
    const workflowPath = writeFile('wf-npm-4.ts', `
      import defaultExport from 'mixed-exports';
      import { namedFn } from 'mixed-exports';

      /**
       * @flowWeaver workflow
       * @node n namedFn
       * @connect Start.x -> n.x
       * @connect n.result -> Exit.output
       */
      export function mixedWorkflow(
        execute: boolean,
        params: { x: number }
      ): { onSuccess: boolean; onFailure: boolean; output: number } {
        throw new Error('stub');
      }
    `);

    const result = parser.parse(workflowPath);
    const nodeType = result.nodeTypes.find(nt => nt.functionName === 'namedFn');
    expect(nodeType).toBeDefined();
    // Default import should not produce a node type
    const defaultNode = result.nodeTypes.find(nt => nt.functionName === 'defaultExport');
    expect(defaultNode).toBeUndefined();
  });

  it('packages with no .d.ts are silently skipped (no error)', () => {
    const noTypesPkgDir = path.join(tmpDir, 'node_modules', 'no-types-pkg');
    fs.mkdirSync(noTypesPkgDir, { recursive: true });
    fs.writeFileSync(
      path.join(noTypesPkgDir, 'package.json'),
      JSON.stringify({ name: 'no-types-pkg', version: '1.0.0', main: 'index.js' })
    );

    const workflowPath = writeFile('wf-npm-5.ts', `
      import { something } from 'no-types-pkg';

      /**
       * @flowWeaver workflow
       * @node s something
       * @connect Start.x -> s.x
       * @connect s.result -> Exit.output
       */
      export function skipWorkflow(
        execute: boolean,
        params: { x: number }
      ): { onSuccess: boolean; onFailure: boolean; output: number } {
        throw new Error('stub');
      }
    `);

    const result = parser.parse(workflowPath);
    // Should produce errors about node type not found, but NOT throw
    expect(result.nodeTypes.find(nt => nt.functionName === 'something')).toBeUndefined();
    // The parser should have produced a "node type not found" error, which is expected
    // since we can't resolve the types — but no exception was thrown
  });

  it('existing relative import behavior is unchanged (regression)', () => {
    writeFile('utils-local.ts', `
      /**
       * @flowWeaver nodeType
       * @input value - Input value
       * @output result - Doubled value
       */
      export function localDouble(
        execute: boolean,
        value: number
      ): { onSuccess: boolean; onFailure: boolean; result: number } {
        return { onSuccess: true, onFailure: false, result: value * 2 };
      }
    `);
    const workflowPath = writeFile('wf-npm-6.ts', `
      import { localDouble } from './utils-local';

      /**
       * @flowWeaver workflow
       * @node d localDouble
       * @connect Start.value -> d.value
       * @connect d.result -> Exit.output
       */
      export function localWorkflow(
        execute: boolean,
        params: { value: number }
      ): { onSuccess: boolean; onFailure: boolean; output: number } {
        throw new Error('stub');
      }
    `);

    const result = parser.parse(workflowPath);
    expect(result.errors).toHaveLength(0);
    const nodeType = result.nodeTypes.find(nt => nt.functionName === 'localDouble');
    expect(nodeType).toBeDefined();
    // Relative imports should NOT have importSource
    expect(nodeType!.importSource).toBeUndefined();
  });

  it('multiple functions from same package, only import the referenced ones', () => {
    setupPackage('multi-fn', `
      export declare function fnA(x: number): number;
      export declare function fnB(x: string): string;
      export declare function fnC(x: boolean): boolean;
    `);
    const workflowPath = writeFile('wf-npm-7.ts', `
      import { fnA, fnC } from 'multi-fn';

      /**
       * @flowWeaver workflow
       * @node a fnA
       * @node c fnC
       * @connect Start.x -> a.x
       * @connect a.result -> Exit.num
       * @connect Start.flag -> c.x
       * @connect c.result -> Exit.flag
       */
      export function multiWorkflow(
        execute: boolean,
        params: { x: number; flag: boolean }
      ): { onSuccess: boolean; onFailure: boolean; num: number; flag: boolean } {
        throw new Error('stub');
      }
    `);

    const result = parser.parse(workflowPath);
    expect(result.errors).toHaveLength(0);

    const fnA = result.nodeTypes.find(nt => nt.functionName === 'fnA');
    const fnC = result.nodeTypes.find(nt => nt.functionName === 'fnC');
    const fnB = result.nodeTypes.find(nt => nt.functionName === 'fnB');

    expect(fnA).toBeDefined();
    expect(fnC).toBeDefined();
    // fnB was not in the import statement, so should not be included
    expect(fnB).toBeUndefined();
  });

  it('functionText is undefined for npm package nodes (prevent inlining)', () => {
    setupPackage('no-inline-pkg', `
      export declare function noInline(x: number): number;
    `);
    const workflowPath = writeFile('wf-npm-8.ts', `
      import { noInline } from 'no-inline-pkg';

      /**
       * @flowWeaver workflow
       * @node n noInline
       * @connect Start.x -> n.x
       * @connect n.result -> Exit.output
       */
      export function noInlineWorkflow(
        execute: boolean,
        params: { x: number }
      ): { onSuccess: boolean; onFailure: boolean; output: number } {
        throw new Error('stub');
      }
    `);

    const result = parser.parse(workflowPath);
    const nodeType = result.nodeTypes.find(nt => nt.functionName === 'noInline');
    expect(nodeType).toBeDefined();
    expect(nodeType!.functionText).toBeUndefined();
  });
});
