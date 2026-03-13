/**
 * Additional coverage tests for src/cli/commands/strip.ts
 * Targets uncovered branches: directory expansion, verbose skip/success logging,
 * process.exit(1) for no files, output directory creation.
 */

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { stripCommand } from '../../src/cli/commands/strip';
import { MARKERS } from '../../src/api/generate-in-place';

const TEMP_DIR = path.join(os.tmpdir(), `fw-strip-cov-${process.pid}`);

beforeAll(() => fs.mkdirSync(TEMP_DIR, { recursive: true }));
afterAll(() => fs.rmSync(TEMP_DIR, { recursive: true, force: true }));

let origLog: typeof console.log;
let origError: typeof console.error;
let origWarn: typeof console.warn;
let origExit: typeof process.exit;
const logs: string[] = [];
const errors: string[] = [];

beforeEach(() => {
  logs.length = 0;
  errors.length = 0;
  origLog = console.log;
  origError = console.error;
  origWarn = console.warn;
  origExit = process.exit;
  console.log = (...args: unknown[]) => logs.push(args.map(String).join(' '));
  console.error = (...args: unknown[]) => errors.push(args.map(String).join(' '));
  console.warn = vi.fn();
  process.exit = vi.fn() as never;
  process.exitCode = undefined;
});

afterEach(() => {
  console.log = origLog;
  console.error = origError;
  console.warn = origWarn;
  process.exit = origExit;
  process.exitCode = undefined;
});

function writeFixture(name: string, content: string): string {
  const filePath = path.join(TEMP_DIR, name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return filePath;
}

const COMPILED_FILE = `\
import { something } from 'somewhere';

${MARKERS.RUNTIME_START}
import { GeneratedExecutionContext } from '@synergenius/flow-weaver/runtime';
${MARKERS.RUNTIME_END}

/**
 * @flowWeaver nodeType
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
  return { onSuccess: true, onFailure: false, result: 42 };
  ${MARKERS.BODY_END}
}
`;

const NO_MARKERS_FILE = `\
export async function myNodeType(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, result: value + 1 };
}
`;

describe('stripCommand verbose logging', () => {
  it('should log skipped files when verbose is true', async () => {
    const filePath = writeFixture('verbose-skip.ts', NO_MARKERS_FILE);

    await stripCommand(filePath, { verbose: true });

    const allOutput = logs.join(' ');
    expect(allOutput).toContain('Skipped');
  });

  it('should log success when verbose is true and file is stripped', async () => {
    const filePath = writeFixture('verbose-strip.ts', COMPILED_FILE);

    await stripCommand(filePath, { verbose: true });

    const allOutput = logs.join(' ');
    expect(allOutput).toContain('Stripped');
  });
});

describe('stripCommand directory expansion', () => {
  it('should expand directory input to all .ts files', async () => {
    const dir = path.join(TEMP_DIR, 'dir-expand');
    fs.mkdirSync(dir, { recursive: true });
    writeFixture('dir-expand/a.ts', COMPILED_FILE);
    writeFixture('dir-expand/b.ts', NO_MARKERS_FILE);

    await stripCommand(dir, {});

    const a = fs.readFileSync(path.join(TEMP_DIR, 'dir-expand/a.ts'), 'utf-8');
    expect(a).not.toContain(MARKERS.BODY_START);

    const b = fs.readFileSync(path.join(TEMP_DIR, 'dir-expand/b.ts'), 'utf-8');
    expect(b).toBe(NO_MARKERS_FILE);
  });
});

describe('stripCommand no files found', () => {
  it('should call process.exit(1) when no files match pattern', async () => {
    await stripCommand(path.join(TEMP_DIR, 'nonexistent-xyz/**/*.ts'), {});

    expect(process.exit).toHaveBeenCalledWith(1);
  });
});

describe('stripCommand dry-run logging', () => {
  it('should log what would be stripped in dry-run', async () => {
    const filePath = writeFixture('dryrun-log.ts', COMPILED_FILE);

    await stripCommand(filePath, { dryRun: true });

    const allOutput = logs.join(' ');
    expect(allOutput).toContain('Would strip');
    // File should be unchanged
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain(MARKERS.BODY_START);
  });
});

describe('stripCommand output directory', () => {
  it('should create output directory and write stripped files there', async () => {
    const filePath = writeFixture('output-src.ts', COMPILED_FILE);
    const outputDir = path.join(TEMP_DIR, 'output-dest-cov');

    await stripCommand(filePath, { output: outputDir });

    // Original should be unchanged
    const original = fs.readFileSync(filePath, 'utf-8');
    expect(original).toContain(MARKERS.BODY_START);

    // Output file should exist and be stripped
    const outputFile = path.join(outputDir, 'output-src.ts');
    expect(fs.existsSync(outputFile)).toBe(true);
    const stripped = fs.readFileSync(outputFile, 'utf-8');
    expect(stripped).not.toContain(MARKERS.BODY_START);
    expect(stripped).toContain("throw new Error('Not implemented')");
  });
});

describe('stripCommand summary formatting', () => {
  it('should show singular form for 1 file', async () => {
    const filePath = writeFixture('singular.ts', COMPILED_FILE);

    await stripCommand(filePath, {});

    const allOutput = logs.join(' ');
    expect(allOutput).toContain('1 file stripped');
  });

  it('should show plural form for multiple files', async () => {
    const dir = path.join(TEMP_DIR, 'plural-dir');
    fs.mkdirSync(dir, { recursive: true });
    writeFixture('plural-dir/a.ts', COMPILED_FILE);
    writeFixture('plural-dir/b.ts', COMPILED_FILE);

    await stripCommand(path.join(dir, '*.ts'), {});

    const allOutput = logs.join(' ');
    expect(allOutput).toContain('2 files stripped');
  });

  it('should show dry-run verb in summary', async () => {
    const filePath = writeFixture('dryrun-summary.ts', COMPILED_FILE);

    await stripCommand(filePath, { dryRun: true });

    const allOutput = logs.join(' ');
    expect(allOutput).toContain('would be stripped');
  });

  it('should show skipped count in summary', async () => {
    const filePath = writeFixture('skip-summary.ts', NO_MARKERS_FILE);

    await stripCommand(filePath, {});

    const allOutput = logs.join(' ');
    expect(allOutput).toContain('1 skipped');
  });
});

describe('stripCommand mixed files with verbose', () => {
  it('should log both stripped and skipped files when verbose', async () => {
    const dir = path.join(TEMP_DIR, 'mixed-verbose');
    fs.mkdirSync(dir, { recursive: true });
    writeFixture('mixed-verbose/compiled.ts', COMPILED_FILE);
    writeFixture('mixed-verbose/plain.ts', NO_MARKERS_FILE);

    await stripCommand(path.join(dir, '*.ts'), { verbose: true });

    const allOutput = logs.join(' ');
    expect(allOutput).toContain('Stripped');
    expect(allOutput).toContain('Skipped');
  });
});
