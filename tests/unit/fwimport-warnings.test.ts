import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { AnnotationParser } from '../../src/parser';

const tmpDir = path.join(os.tmpdir(), `fw-fwimport-warn-${process.pid}`);

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

describe('@fwImport warning diagnostics', () => {
  let parser: AnnotationParser;

  beforeAll(() => {
    parser = new AnnotationParser();
  });

  it('warns when package has no .d.ts type declarations', () => {
    // Package with no types field and no .d.ts file
    const pkgDir = path.join(tmpDir, 'node_modules', 'no-dts-pkg');
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(
      path.join(pkgDir, 'package.json'),
      JSON.stringify({ name: 'no-dts-pkg', version: '1.0.0', main: 'index.js' })
    );

    parser.clearCache();
    const workflowPath = writeFile('wf-warn-no-dts.ts', `
      /**
       * @flowWeaver workflow
       * @fwImport npm/no-dts-pkg/doStuff doStuff from "no-dts-pkg"
       * @node n npm/no-dts-pkg/doStuff
       * @connect Start.x -> n.x
       * @connect n.result -> Exit.output
       */
      export function noDtsWorkflow(
        execute: boolean,
        params: { x: number }
      ): { onSuccess: boolean; onFailure: boolean; output: number } {
        throw new Error('stub');
      }
    `);

    const result = parser.parse(workflowPath);
    const warning = result.warnings.find(w => w.includes('type declarations'));
    expect(warning).toBeDefined();
    expect(warning).toContain('no-dts-pkg');
  });

  it('warns when function name is not found in package .d.ts', () => {
    setupPackage('has-types-pkg', `
      export declare function existingFunc(x: number): number;
    `);

    parser.clearCache();
    const workflowPath = writeFile('wf-warn-missing-fn.ts', `
      /**
       * @flowWeaver workflow
       * @fwImport npm/has-types-pkg/missingFunc missingFunc from "has-types-pkg"
       * @node n npm/has-types-pkg/missingFunc
       * @connect Start.x -> n.x
       * @connect n.result -> Exit.output
       */
      export function missingFnWorkflow(
        execute: boolean,
        params: { x: number }
      ): { onSuccess: boolean; onFailure: boolean; output: number } {
        throw new Error('stub');
      }
    `);

    const result = parser.parse(workflowPath);
    const warning = result.warnings.find(w => w.includes('missingFunc'));
    expect(warning).toBeDefined();
    expect(warning).toContain('has-types-pkg');
  });

  it('warns when resolved import has zero data ports (suggesting local wrapper)', () => {
    // When a package has no .d.ts, the resolver returns a stub node type with
    // only result: ANY and no real data inputs. The post-resolution check detects
    // this stub pattern and emits a "Could not infer ports" warning suggesting
    // to wrap it in a local function instead.
    const pkgDir = path.join(tmpDir, 'node_modules', 'zero-ports-pkg');
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(
      path.join(pkgDir, 'package.json'),
      JSON.stringify({ name: 'zero-ports-pkg', version: '1.0.0', main: 'index.js' })
    );

    parser.clearCache();
    const workflowPath = writeFile('wf-warn-zero-ports.ts', `
      /**
       * @flowWeaver workflow
       * @fwImport npm/zero-ports-pkg/noPortsFunc noPortsFunc from "zero-ports-pkg"
       * @node n npm/zero-ports-pkg/noPortsFunc
       * @connect n.result -> Exit.output
       */
      export function zeroPortsWorkflow(
        execute: boolean
      ): { onSuccess: boolean; onFailure: boolean; output: string } {
        throw new Error('stub');
      }
    `);

    const result = parser.parse(workflowPath);
    const warning = result.warnings.find(w => w.includes('Could not infer ports'));
    expect(warning).toBeDefined();
    expect(warning).toContain('noPortsFunc');
    expect(warning).toContain('zero-ports-pkg');
    expect(warning).toContain('local function');
  });

  it('does NOT warn when @fwImport resolves correctly with data ports (regression)', () => {
    setupPackage('good-pkg', `
      export declare function goodFunc(a: number, b: string): { sum: number; label: string };
    `);

    parser.clearCache();
    const workflowPath = writeFile('wf-no-warn.ts', `
      /**
       * @flowWeaver workflow
       * @fwImport npm/good-pkg/goodFunc goodFunc from "good-pkg"
       * @node g npm/good-pkg/goodFunc
       * @connect Start.a -> g.a
       * @connect Start.b -> g.b
       * @connect g.sum -> Exit.sum
       */
      export function goodWorkflow(
        execute: boolean,
        params: { a: number; b: string }
      ): { onSuccess: boolean; onFailure: boolean; sum: number } {
        throw new Error('stub');
      }
    `);

    const result = parser.parse(workflowPath);
    // Should have no @fwImport-related warnings
    const fwImportWarnings = result.warnings.filter(
      w => w.includes('type declarations') || w.includes('Could not infer ports')
    );
    expect(fwImportWarnings).toHaveLength(0);
  });

  it('does NOT warn for void-returning functions (zero output ports is legitimate)', () => {
    setupPackage('void-pkg', `
      export declare function fireAndForget(url: string): void;
    `);

    parser.clearCache();
    const workflowPath = writeFile('wf-void-no-warn.ts', `
      /**
       * @flowWeaver workflow
       * @fwImport npm/void-pkg/fireAndForget fireAndForget from "void-pkg"
       * @node f npm/void-pkg/fireAndForget
       * @connect Start.url -> f.url
       * @connect f.onSuccess -> Exit.execute
       */
      export function voidWorkflow(
        execute: boolean,
        params: { url: string }
      ): { onSuccess: boolean; onFailure: boolean } {
        throw new Error('stub');
      }
    `);

    const result = parser.parse(workflowPath);
    const inferWarnings = result.warnings.filter(w => w.includes('Could not infer ports'));
    expect(inferWarnings).toHaveLength(0);
  });
});
