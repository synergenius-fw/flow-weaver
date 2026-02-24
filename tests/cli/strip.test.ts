import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { stripCommand } from '../../src/cli/commands/strip';
import { MARKERS } from '../../src/api/generate-in-place';

const TEMP_DIR = path.join(os.tmpdir(), `flow-weaver-strip-${process.pid}`);

beforeAll(() => fs.mkdirSync(TEMP_DIR, { recursive: true }));
afterAll(() => fs.rmSync(TEMP_DIR, { recursive: true, force: true }));

function makeCompiledFile(name: string, content: string): string {
  const filePath = path.join(TEMP_DIR, name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return filePath;
}

const SINGLE_WORKFLOW = `\
import { something } from 'somewhere';

${MARKERS.RUNTIME_START}
// DO NOT EDIT
import { GeneratedExecutionContext } from '@synergenius/flow-weaver/runtime';
${MARKERS.RUNTIME_END}

/**
 * @flowWeaver nodeType
 * @input value - number
 * @output doubled - number
 */
export async function doubleIt(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, doubled: value * 2 };
}

/**
 * @flowWeaver workflow
 * @node d doubleIt
 */
export async function myWorkflow(execute: boolean, params: { n: number }) {
  ${MARKERS.BODY_START}
  const ctx = new GeneratedExecutionContext(true);
  // ... generated execution code ...
  return { onSuccess: true, onFailure: false, result: 42 };
  ${MARKERS.BODY_END}
}
`;

const MULTI_WORKFLOW = `\
${MARKERS.RUNTIME_START}
import { GeneratedExecutionContext } from '@synergenius/flow-weaver/runtime';
${MARKERS.RUNTIME_END}

export async function workflow1(execute: boolean, params: {}) {
  ${MARKERS.BODY_START}
  // body 1
  ${MARKERS.BODY_END}
}

export async function workflow2(execute: boolean, params: {}) {
  ${MARKERS.BODY_START}
  // body 2
  ${MARKERS.BODY_END}
}
`;

const NO_MARKERS = `\
export async function myNodeType(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, result: value + 1 };
}
`;

describe('strip command', () => {
  it('strips runtime and body from a single-workflow file', async () => {
    const filePath = makeCompiledFile('single.ts', SINGLE_WORKFLOW);

    await stripCommand(filePath, {});

    const result = fs.readFileSync(filePath, 'utf-8');
    expect(result).not.toContain(MARKERS.RUNTIME_START);
    expect(result).not.toContain(MARKERS.RUNTIME_END);
    expect(result).not.toContain(MARKERS.BODY_START);
    expect(result).not.toContain(MARKERS.BODY_END);
    expect(result).not.toContain('GeneratedExecutionContext');
    expect(result).toContain("throw new Error('Not implemented')");
    // User code preserved
    expect(result).toContain("import { something } from 'somewhere'");
    expect(result).toContain('doubleIt');
    expect(result).toContain('@flowWeaver workflow');
  });

  it('strips all bodies in a multi-workflow file', async () => {
    const filePath = makeCompiledFile('multi.ts', MULTI_WORKFLOW);

    await stripCommand(filePath, {});

    const result = fs.readFileSync(filePath, 'utf-8');
    expect(result).not.toContain('body 1');
    expect(result).not.toContain('body 2');
    expect(result.match(/throw new Error/g)?.length).toBe(2);
  });

  it('skips files without markers', async () => {
    const filePath = makeCompiledFile('no-markers.ts', NO_MARKERS);

    await stripCommand(filePath, {});

    const result = fs.readFileSync(filePath, 'utf-8');
    expect(result).toBe(NO_MARKERS);
  });

  it('does not write when --dry-run is set', async () => {
    const filePath = makeCompiledFile('dryrun.ts', SINGLE_WORKFLOW);

    await stripCommand(filePath, { dryRun: true });

    const result = fs.readFileSync(filePath, 'utf-8');
    // File should be unchanged
    expect(result).toContain(MARKERS.BODY_START);
    expect(result).toContain(MARKERS.RUNTIME_START);
  });

  it('processes multiple files via glob', async () => {
    makeCompiledFile('glob-dir/a.ts', SINGLE_WORKFLOW);
    makeCompiledFile('glob-dir/b.ts', MULTI_WORKFLOW);
    makeCompiledFile('glob-dir/c.ts', NO_MARKERS);

    const globPattern = path.join(TEMP_DIR, 'glob-dir', '*.ts');
    await stripCommand(globPattern, {});

    const a = fs.readFileSync(path.join(TEMP_DIR, 'glob-dir', 'a.ts'), 'utf-8');
    const b = fs.readFileSync(path.join(TEMP_DIR, 'glob-dir', 'b.ts'), 'utf-8');
    const c = fs.readFileSync(path.join(TEMP_DIR, 'glob-dir', 'c.ts'), 'utf-8');

    expect(a).not.toContain(MARKERS.BODY_START);
    expect(a).toContain("throw new Error('Not implemented')");
    expect(b).not.toContain(MARKERS.BODY_START);
    expect(b.match(/throw new Error/g)?.length).toBe(2);
    // c unchanged
    expect(c).toBe(NO_MARKERS);
  });

  it('writes to output directory when --output is set', async () => {
    const filePath = makeCompiledFile('output-src/workflow.ts', SINGLE_WORKFLOW);
    const outputDir = path.join(TEMP_DIR, 'output-dest');

    await stripCommand(filePath, { output: outputDir });

    // Original unchanged
    const original = fs.readFileSync(filePath, 'utf-8');
    expect(original).toContain(MARKERS.BODY_START);

    // Output file stripped
    const outputFiles = fs.readdirSync(outputDir, { recursive: true }) as string[];
    const tsFiles = outputFiles.filter((f) => f.endsWith('.ts'));
    expect(tsFiles.length).toBeGreaterThan(0);

    const outputContent = fs.readFileSync(path.join(outputDir, tsFiles[0]), 'utf-8');
    expect(outputContent).not.toContain(MARKERS.BODY_START);
    expect(outputContent).toContain("throw new Error('Not implemented')");
  });
});
