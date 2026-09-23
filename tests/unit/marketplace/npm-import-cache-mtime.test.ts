import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { AnnotationParser } from '../../../src/parser';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Tests that the parser's importCache invalidates for @fwImport npm packages
 * when the .d.ts file changes (resolveNpmImportAnnotation mtime check).
 *
 * This covers the cache access point in resolveNpmImportAnnotation which
 * previously had NO mtime validation, so stale node types could be returned
 * if a package's .d.ts changed mid-session.
 */

const FIXTURES_DIR = path.join(os.tmpdir(), 'fw-test-npm-import-cache-mtime');
const NODE_MODULES_DIR = path.join(FIXTURES_DIR, 'node_modules');
const FAKE_PKG = 'fake-fw-pkg';
const FAKE_PKG_DIR = path.join(NODE_MODULES_DIR, FAKE_PKG);

function writeDts(ports: string[]): void {
  const inputs = ports.map((p) => `${p}: string`).join(', ');
  const dtsContent = `/**
 * @flowWeaver nodeType
 * @label FakeNode
${ports.map((p, i) => ` * @input ${p} [order:${i}] - ${p}`).join('\n')}
 * @output result [order:0] - Result
 */
export declare function fakeNode(execute: boolean, ${inputs}): { result: string };
`;
  fs.writeFileSync(path.join(FAKE_PKG_DIR, 'index.d.ts'), dtsContent, 'utf-8');
}

function writePkgJson(): void {
  fs.writeFileSync(
    path.join(FAKE_PKG_DIR, 'package.json'),
    JSON.stringify({ name: FAKE_PKG, version: '1.0.0', types: 'index.d.ts' }),
    'utf-8',
  );
}

function writeWorkflow(ports: string[]): string {
  const connectLines = ports.map((p) => ` * @connect Start.${p} -> myNode.${p}`).join('\n');
  const paramLines = ports.map((p, i) => ` * @param ${p} [order:${i}] - ${p}`).join('\n');
  const content = `/**
 * @flowWeaver workflow
 * @name testNpmImport
 * @fwImport myNode:fakeNode from "${FAKE_PKG}"
 * @connect Start.execute -> myNode.execute
${connectLines}
 * @connect myNode.result -> Exit.result
${paramLines}
 * @returns result [order:0] - Result
 */
export function testNpmImport() {}
`;
  const filePath = path.join(FIXTURES_DIR, 'wf-npm-import.ts');
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

function bumpMtime(filePath: string, offsetMs = 2000): void {
  const now = new Date();
  fs.utimesSync(filePath, now, new Date(now.getTime() + offsetMs));
}

describe('npm @fwImport cache mtime invalidation', () => {
  let parser: AnnotationParser;

  beforeAll(() => {
    fs.mkdirSync(FAKE_PKG_DIR, { recursive: true });
    writePkgJson();
  });

  afterAll(() => {
    fs.rmSync(FIXTURES_DIR, { recursive: true, force: true });
  });

  beforeEach(() => {
    parser = new AnnotationParser();
  });

  it('detects updated .d.ts ports on second parse (mtime changed)', () => {
    // Step 1: Create fake package with 'input' port only
    writeDts(['input']);
    const wfPath = writeWorkflow(['input']);

    const result1 = parser.parse(wfPath);
    // Should parse without errors for 'input' port
    const portErrors1 = (result1.errors ?? []).filter((e: unknown) =>
      typeof e === 'string' ? e.includes('input') : (e as { message?: string }).message?.includes('input'),
    );
    expect(portErrors1).toHaveLength(0);

    // Step 2: Update .d.ts to add 'extra' port, bump mtime
    writeDts(['input', 'extra']);
    bumpMtime(path.join(FAKE_PKG_DIR, 'index.d.ts'));

    // Update workflow to use the new port
    const wfPath2 = writeWorkflow(['input', 'extra']);
    bumpMtime(wfPath2);

    // Step 3: Parse again with SAME parser — should see 'extra' (cache invalidated by mtime)
    const result2 = parser.parse(wfPath2);
    const portErrors2 = (result2.errors ?? []).filter((e: unknown) =>
      typeof e === 'string' ? e.includes('extra') : (e as { message?: string }).message?.includes('extra'),
    );
    expect(portErrors2).toHaveLength(0);
  });

  it('serves cached result when .d.ts has not changed (mtime identical)', () => {
    writeDts(['alpha']);
    const wfPath = writeWorkflow(['alpha']);

    // Parse twice — second should use cache (same mtime)
    const result1 = parser.parse(wfPath);
    const result2 = parser.parse(wfPath);

    expect(result1.errors).toHaveLength(0);
    expect(result2.errors).toHaveLength(0);
  });

  it('invalidates cache when .d.ts is deleted and recreated with different ports', () => {
    writeDts(['portA']);
    const wfPath = writeWorkflow(['portA']);

    const result1 = parser.parse(wfPath);
    expect(result1.errors).toHaveLength(0);

    // Delete and recreate with different port
    fs.unlinkSync(path.join(FAKE_PKG_DIR, 'index.d.ts'));
    writeDts(['portB']);
    bumpMtime(path.join(FAKE_PKG_DIR, 'index.d.ts'));

    const wfPath2 = writeWorkflow(['portB']);
    bumpMtime(wfPath2);

    const result2 = parser.parse(wfPath2);
    const portErrors = (result2.errors ?? []).filter((e: unknown) =>
      typeof e === 'string' ? e.includes('portB') : (e as { message?: string }).message?.includes('portB'),
    );
    expect(portErrors).toHaveLength(0);
  });
});
