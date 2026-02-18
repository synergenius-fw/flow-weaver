import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { AnnotationParser } from '../../src/parser';
import { generateCode } from '../../src/api/generate';

const tmpDir = path.join(os.tmpdir(), `fw-npm-integration-${process.pid}`);

beforeAll(() => fs.mkdirSync(tmpDir, { recursive: true }));
afterAll(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

function writeFile(name: string, content: string) {
  const p = path.join(tmpDir, name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return p;
}

function setupPackage(pkgName: string, pkgJson: object, dtsContent: string) {
  const pkgDir = path.join(tmpDir, 'node_modules', pkgName);
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify(pkgJson));
  fs.writeFileSync(path.join(pkgDir, 'index.d.ts'), dtsContent);
}

describe('npm typed package resolution — full round trip', () => {
  const parser = new AnnotationParser();

  beforeAll(() => {
    parser.clearCache();

    setupPackage('typed-npm-mock', {
      name: 'typed-npm-mock',
      version: '1.0.0',
      types: 'index.d.ts',
    }, `
export declare function formatDate(date: Date, formatStr: string): string;
export declare function addDays(date: Date, amount: number): Date;
export declare function fetchRemote(url: string): Promise<string>;
export declare function multiply(a: number, b: number): number;
    `.trim());
  });

  it('full parse → generate cycle with npm package function', () => {
    const workflowPath = writeFile('workflow-npm-rt.ts', `
      import { formatDate } from 'typed-npm-mock';

      /**
       * @flowWeaver workflow
       * @node fmt formatDate
       * @connect Start.date -> fmt.date
       * @connect Start.formatStr -> fmt.formatStr
       * @connect fmt.result -> Exit.output
       */
      export function formatWorkflow(
        execute: boolean,
        params: { date: Date; formatStr: string }
      ): { onSuccess: boolean; onFailure: boolean; output: string } {
        throw new Error('stub');
      }
    `);

    const parseResult = parser.parse(workflowPath);
    expect(parseResult.errors).toHaveLength(0);
    expect(parseResult.workflows).toHaveLength(1);

    const workflow = parseResult.workflows[0];
    const code = generateCode(workflow) as string;

    // Should import from the package
    expect(code).toContain("import { formatDate } from 'typed-npm-mock';");
    // Should NOT contain declare function (not inlined)
    expect(code).not.toContain('declare function');
  });

  it('async function (Promise return) handled correctly', () => {
    const workflowPath = writeFile('workflow-npm-async.ts', `
      import { fetchRemote } from 'typed-npm-mock';

      /**
       * @flowWeaver workflow
       * @node f fetchRemote
       * @connect Start.url -> f.url
       * @connect f.result -> Exit.output
       */
      export function asyncFetchWorkflow(
        execute: boolean,
        params: { url: string }
      ): { onSuccess: boolean; onFailure: boolean; output: string } {
        throw new Error('stub');
      }
    `);

    const parseResult = parser.parse(workflowPath);
    expect(parseResult.errors).toHaveLength(0);

    const nodeType = parseResult.nodeTypes.find(nt => nt.functionName === 'fetchRemote');
    expect(nodeType).toBeDefined();
    expect(nodeType!.isAsync).toBe(true);

    const workflow = parseResult.workflows[0];
    const code = generateCode(workflow) as string;
    // Async workflow should have async keyword since it uses an async node
    expect(code).toContain('async function');
  });

  it('mixed relative + npm imports in same workflow', () => {
    writeFile('local-node.ts', `
      /**
       * @flowWeaver nodeType
       * @input value - Input
       * @output result - Output
       */
      export function localDouble(
        execute: boolean,
        value: number
      ): { onSuccess: boolean; onFailure: boolean; result: number } {
        return { onSuccess: true, onFailure: false, result: value * 2 };
      }
    `);

    const workflowPath = writeFile('workflow-mixed.ts', `
      import { multiply } from 'typed-npm-mock';
      import { localDouble } from './local-node';

      /**
       * @flowWeaver workflow
       * @node m multiply
       * @node d localDouble
       * @connect Start.a -> m.a
       * @connect Start.b -> m.b
       * @connect m.result -> d.value
       * @connect d.result -> Exit.output
       */
      export function mixedWorkflow(
        execute: boolean,
        params: { a: number; b: number }
      ): { onSuccess: boolean; onFailure: boolean; output: number } {
        throw new Error('stub');
      }
    `);

    const parseResult = parser.parse(workflowPath);
    expect(parseResult.errors).toHaveLength(0);

    const workflow = parseResult.workflows[0];
    const code = generateCode(workflow) as string;

    // Should have both import styles
    expect(code).toContain("from 'typed-npm-mock'");
    expect(code).toContain("from './local-node.generated'");
  });

  it('packages with no types are silently skipped', () => {
    const noTypesDir = path.join(tmpDir, 'node_modules', 'untyped-pkg');
    fs.mkdirSync(noTypesDir, { recursive: true });
    fs.writeFileSync(
      path.join(noTypesDir, 'package.json'),
      JSON.stringify({ name: 'untyped-pkg', version: '1.0.0', main: 'index.js' })
    );

    const workflowPath = writeFile('workflow-untyped.ts', `
      import { something } from 'untyped-pkg';

      /**
       * @flowWeaver workflow
       * @node s something
       * @connect Start.x -> s.x
       * @connect s.result -> Exit.output
       */
      export function untypedWorkflow(
        execute: boolean,
        params: { x: number }
      ): { onSuccess: boolean; onFailure: boolean; output: number } {
        throw new Error('stub');
      }
    `);

    // Should not throw, just produce errors about missing node type
    const parseResult = parser.parse(workflowPath);
    // Parser will produce errors about node type not found, which is expected
    expect(parseResult.workflows).toHaveLength(1);
  });

  it('backward compat: workflows with only relative imports still work', () => {
    writeFile('local-utils.ts', `
      /**
       * @flowWeaver nodeType
       * @input x - Input
       * @output result - Output
       */
      export function increment(
        execute: boolean,
        x: number
      ): { onSuccess: boolean; onFailure: boolean; result: number } {
        return { onSuccess: true, onFailure: false, result: x + 1 };
      }
    `);

    const workflowPath = writeFile('workflow-compat.ts', `
      import { increment } from './local-utils';

      /**
       * @flowWeaver workflow
       * @node inc increment
       * @connect Start.x -> inc.x
       * @connect inc.result -> Exit.output
       */
      export function compatWorkflow(
        execute: boolean,
        params: { x: number }
      ): { onSuccess: boolean; onFailure: boolean; output: number } {
        throw new Error('stub');
      }
    `);

    const parseResult = parser.parse(workflowPath);
    expect(parseResult.errors).toHaveLength(0);
    expect(parseResult.workflows).toHaveLength(1);

    const workflow = parseResult.workflows[0];
    const code = generateCode(workflow) as string;
    expect(code).toContain("from './local-utils.generated'");
    expect(code).not.toContain("'typed-npm-mock'");
  });
});
