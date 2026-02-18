import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { AnnotationParser } from '../../src/parser';

const tmpDir = path.join(os.tmpdir(), `fw-async-detect-${process.pid}`);

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

describe('isAsync detection for Promise return types', () => {
  const parser = new AnnotationParser();

  beforeAll(() => {
    parser.clearCache();
  });

  it('declare function with Promise return → isAsync: true', () => {
    setupPackage('async-pkg', `
      export declare function fetchData(url: string): Promise<string>;
    `);
    const workflowPath = writeFile('wf-async-1.ts', `
      import { fetchData } from 'async-pkg';

      /**
       * @flowWeaver workflow
       * @node f fetchData
       * @connect Start.url -> f.url
       * @connect f.result -> Exit.output
       */
      export function asyncWorkflow(
        execute: boolean,
        params: { url: string }
      ): { onSuccess: boolean; onFailure: boolean; output: string } {
        throw new Error('stub');
      }
    `);

    const result = parser.parse(workflowPath);
    const nodeType = result.nodeTypes.find(nt => nt.functionName === 'fetchData');
    expect(nodeType).toBeDefined();
    expect(nodeType!.isAsync).toBe(true);
  });

  it('async function → isAsync: true (existing behavior)', () => {
    const workflowPath = writeFile('wf-async-2.ts', `
      async function fetchLocal(url: string): Promise<string> {
        return 'data';
      }

      /**
       * @flowWeaver workflow
       * @node f fetchLocal
       * @connect Start.url -> f.url
       * @connect f.result -> Exit.output
       */
      export function localAsyncWorkflow(
        execute: boolean,
        params: { url: string }
      ): { onSuccess: boolean; onFailure: boolean; output: string } {
        throw new Error('stub');
      }
    `);

    const result = parser.parse(workflowPath);
    const nodeType = result.nodeTypes.find(nt => nt.functionName === 'fetchLocal');
    expect(nodeType).toBeDefined();
    expect(nodeType!.isAsync).toBe(true);
  });

  it('declare function with non-Promise return → isAsync: false', () => {
    setupPackage('sync-pkg', `
      export declare function formatDate(date: Date): string;
    `);
    const workflowPath = writeFile('wf-async-3.ts', `
      import { formatDate } from 'sync-pkg';

      /**
       * @flowWeaver workflow
       * @node f formatDate
       * @connect Start.date -> f.date
       * @connect f.result -> Exit.output
       */
      export function syncWorkflow(
        execute: boolean,
        params: { date: Date }
      ): { onSuccess: boolean; onFailure: boolean; output: string } {
        throw new Error('stub');
      }
    `);

    const result = parser.parse(workflowPath);
    const nodeType = result.nodeTypes.find(nt => nt.functionName === 'formatDate');
    expect(nodeType).toBeDefined();
    expect(nodeType!.isAsync).toBe(false);
  });
});
