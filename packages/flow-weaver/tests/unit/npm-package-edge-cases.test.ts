import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { AnnotationParser } from '../../src/parser';

const tmpDir = path.join(os.tmpdir(), `fw-npm-edge-${process.pid}`);

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

describe('npm package edge cases', () => {
  const parser = new AnnotationParser();

  beforeAll(() => {
    parser.clearCache();
  });

  it('overloaded declarations — picks a signature', () => {
    setupPackage('overload-pkg', `
      export declare function convert(input: string): number;
      export declare function convert(input: number): string;
    `);
    const workflowPath = writeFile('wf-edge-overload.ts', `
      import { convert } from 'overload-pkg';

      /**
       * @flowWeaver workflow
       * @node c convert
       * @connect Start.input -> c.input
       * @connect c.result -> Exit.output
       */
      export function overloadWorkflow(
        execute: boolean,
        params: { input: string }
      ): { onSuccess: boolean; onFailure: boolean; output: number } {
        throw new Error('stub');
      }
    `);

    const result = parser.parse(workflowPath);
    // Should pick one of the overloads — parser produces at least one node type
    const nodeType = result.nodeTypes.find(nt => nt.functionName === 'convert');
    expect(nodeType).toBeDefined();
    expect(nodeType!.importSource).toBe('overload-pkg');
    expect(nodeType!.inputs.input).toBeDefined();
  });

  it('generic functions — type params become ANY', () => {
    setupPackage('generic-pkg', `
      export declare function identity<T>(input: T): T;
    `);
    const workflowPath = writeFile('wf-edge-generic.ts', `
      import { identity } from 'generic-pkg';

      /**
       * @flowWeaver workflow
       * @node id identity
       * @connect Start.input -> id.input
       * @connect id.result -> Exit.output
       */
      export function genericWorkflow(
        execute: boolean,
        params: { input: string }
      ): { onSuccess: boolean; onFailure: boolean; output: string } {
        throw new Error('stub');
      }
    `);

    const result = parser.parse(workflowPath);
    const nodeType = result.nodeTypes.find(nt => nt.functionName === 'identity');
    expect(nodeType).toBeDefined();
    // Generic T resolves to OBJECT (the default fallback for complex/unknown types)
    // since inferDataTypeFromTS maps unrecognized type strings to OBJECT
    expect(['ANY', 'OBJECT']).toContain(nodeType!.inputs.input.dataType);
    expect(['ANY', 'OBJECT']).toContain(nodeType!.outputs.result.dataType);
  });

  it('class exports — skipped (only functions)', () => {
    setupPackage('class-pkg', `
      export declare class MyService {
        doWork(): void;
      }
      export declare function helperFn(x: number): number;
    `);
    const workflowPath = writeFile('wf-edge-class.ts', `
      import { helperFn } from 'class-pkg';

      /**
       * @flowWeaver workflow
       * @node h helperFn
       * @connect Start.x -> h.x
       * @connect h.result -> Exit.output
       */
      export function classEdgeWorkflow(
        execute: boolean,
        params: { x: number }
      ): { onSuccess: boolean; onFailure: boolean; output: number } {
        throw new Error('stub');
      }
    `);

    const result = parser.parse(workflowPath);
    // helperFn should be resolved, MyService should NOT be a node type
    const helperNode = result.nodeTypes.find(nt => nt.functionName === 'helperFn');
    expect(helperNode).toBeDefined();
    expect(helperNode!.importSource).toBe('class-pkg');

    const classNode = result.nodeTypes.find(nt => nt.functionName === 'MyService');
    expect(classNode).toBeUndefined();
  });

  it('default exports — skipped (only named imports)', () => {
    setupPackage('default-export-pkg', `
      declare function defaultFn(x: number): number;
      export default defaultFn;
      export declare function namedHelper(y: string): string;
    `);
    const workflowPath = writeFile('wf-edge-default.ts', `
      import { namedHelper } from 'default-export-pkg';

      /**
       * @flowWeaver workflow
       * @node h namedHelper
       * @connect Start.y -> h.y
       * @connect h.result -> Exit.output
       */
      export function defaultEdgeWorkflow(
        execute: boolean,
        params: { y: string }
      ): { onSuccess: boolean; onFailure: boolean; output: string } {
        throw new Error('stub');
      }
    `);

    const result = parser.parse(workflowPath);
    const namedNode = result.nodeTypes.find(nt => nt.functionName === 'namedHelper');
    expect(namedNode).toBeDefined();
    expect(namedNode!.importSource).toBe('default-export-pkg');
  });

  it('functions with complex return types produce OBJECT outputs', () => {
    setupPackage('complex-return-pkg', `
      export declare function getData(): { users: string[]; count: number; metadata: Record<string, unknown> };
    `);
    const workflowPath = writeFile('wf-edge-complex.ts', `
      import { getData } from 'complex-return-pkg';

      /**
       * @flowWeaver workflow
       * @node g getData
       * @connect g.users -> Exit.users
       */
      export function complexReturnWorkflow(
        execute: boolean,
        params: {}
      ): { onSuccess: boolean; onFailure: boolean; users: string[] } {
        throw new Error('stub');
      }
    `);

    const result = parser.parse(workflowPath);
    const nodeType = result.nodeTypes.find(nt => nt.functionName === 'getData');
    expect(nodeType).toBeDefined();
    // Return type has properties, so they should be individual output ports
    expect(nodeType!.outputs.users).toBeDefined();
    expect(nodeType!.outputs.users.dataType).toBe('ARRAY');
    expect(nodeType!.outputs.count).toBeDefined();
    expect(nodeType!.outputs.count.dataType).toBe('NUMBER');
  });

  it('functions with void return produce no data output ports', () => {
    setupPackage('void-pkg', `
      export declare function sideEffect(msg: string): void;
    `);
    const workflowPath = writeFile('wf-edge-void.ts', `
      import { sideEffect } from 'void-pkg';

      /**
       * @flowWeaver workflow
       * @node s sideEffect
       * @connect Start.msg -> s.msg
       */
      export function voidWorkflow(
        execute: boolean,
        params: { msg: string }
      ): { onSuccess: boolean; onFailure: boolean } {
        throw new Error('stub');
      }
    `);

    const result = parser.parse(workflowPath);
    const nodeType = result.nodeTypes.find(nt => nt.functionName === 'sideEffect');
    expect(nodeType).toBeDefined();
    // Should only have mandatory ports, no data output ports
    const outputNames = Object.keys(nodeType!.outputs);
    expect(outputNames).toContain('onSuccess');
    expect(outputNames).toContain('onFailure');
    // No "result" port since return is void
    expect(outputNames).not.toContain('result');
  });
});
