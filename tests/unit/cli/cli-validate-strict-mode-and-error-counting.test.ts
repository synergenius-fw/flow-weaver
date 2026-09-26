/**
 * Tests for src/cli/commands/validate.ts: how errors and warnings are counted
 * and reported, in text and JSON mode, with and without --strict.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { validateCommand } from '../../../src/cli/commands/validate';
import { captureConsole, type ConsoleCapture } from '../../helpers/console-capture';

const TEMP_DIR = path.join(os.tmpdir(), `fw-validate-cov2-${process.pid}`);

let out: ConsoleCapture;

beforeEach(() => {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
  out = captureConsole();
});

afterEach(() => {
  out.restore();
  process.exitCode = undefined;
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
});

function writeFixture(name: string, content: string): string {
  const filePath = path.join(TEMP_DIR, name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return filePath;
}

function lastJson(): any {
  const lines = out.of('log').split('\n');
  // The JSON summary is pretty-printed, so it spans several lines: take from
  // the last line that opens an object.
  const start = lines.lastIndexOf('{');
  return JSON.parse((start >= 0 ? lines.slice(start) : lines.slice(-1)).join('\n'));
}

// Valid, but with one warning: nothing is connected from Start.
const VALID_WORKFLOW = `
/**
 * @flowWeaver nodeType
 */
function proc(execute: boolean): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}

/**
 * @flowWeaver workflow
 * @node p proc
 * @connect p.onSuccess -> Exit.onSuccess
 */
export function validWf(execute: boolean): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  throw new Error("Not implemented");
}
`;

// A string output wired into a number input: a lossy coercion, a warning by
// default and an error under --strict.
const COERCION_WORKFLOW = `
/**
 * @flowWeaver nodeType
 * @input value
 * @output out
 */
function nodeA(execute: boolean, value: string): { onSuccess: boolean; onFailure: boolean; out: string } {
  return { onSuccess: true, onFailure: false, out: value };
}

/**
 * @flowWeaver nodeType
 * @input data
 * @output result
 */
function nodeB(execute: boolean, data: number): { onSuccess: boolean; onFailure: boolean; result: number } {
  return { onSuccess: true, onFailure: false, result: data };
}

/**
 * @flowWeaver workflow
 * @node a nodeA
 * @node b nodeB
 * @connect Start.execute -> a.execute
 * @connect Start.value -> a.value
 * @connect a.onSuccess -> b.execute
 * @connect a.out -> b.data
 * @connect b.onSuccess -> Exit.onSuccess
 * @connect b.result -> Exit.result
 */
export function coerceWf(execute: boolean, params: { value: string }): Promise<{ onSuccess: boolean; onFailure: boolean; result: number }> {
  throw new Error("Not implemented");
}
`;

// References a node type that does not exist.
const UNKNOWN_NODE_WORKFLOW = `
/**
 * @flowWeaver nodeType
 */
function realNode(execute: boolean): { onSuccess: boolean } {
  return { onSuccess: true };
}

/**
 * @flowWeaver workflow
 * @node r realNode
 * @node g ghostNode
 * @connect r.onSuccess -> g.execute
 * @connect g.onSuccess -> Exit.onSuccess
 */
export function brokenWf(execute: boolean): Promise<{ onSuccess: boolean }> {
  throw new Error("Not implemented");
}
`;

describe('validateCommand error counting and reporting', () => {
  it('should count a file whose workflow cannot be loaded as an error (non-json)', async () => {
    const filePath = writeFixture('missing-wf.ts', VALID_WORKFLOW);

    await expect(validateCommand(filePath, { workflowName: 'noSuchWorkflow' })).rejects.toThrow(
      'Validation failed with 1 error',
    );

    const stderr = out.of('error');
    expect(stderr).toContain('Parse errors in missing-wf.ts');
    expect(stderr).toContain('Workflow "noSuchWorkflow" not found');
    expect(out.of('log')).toContain('0 valid, 1 error');
  });

  it('should count a file whose workflow cannot be loaded as an error (json mode)', async () => {
    const filePath = writeFixture('missing-wf-json.ts', VALID_WORKFLOW);

    await validateCommand(filePath, { json: true, workflowName: 'noSuchWorkflow' });

    const parsed = lastJson();
    expect(parsed.valid).toBe(false);
    expect(parsed.totalErrors).toBe(1);
    expect(parsed.validFiles).toBe(0);
    expect(parsed.results[0].errors[0].message).toContain('Workflow "noSuchWorkflow" not found');
    expect(process.exitCode).toBe(1);
  });

  it('should display warnings-only summary when there are warnings but no errors', async () => {
    const filePath = writeFixture('warn-only.ts', VALID_WORKFLOW);

    await expect(validateCommand(filePath, { verbose: true, quiet: false })).resolves.toBeUndefined();

    expect(out.of('warn')).toContain('Warnings in warn-only.ts');
    expect(out.of('log')).toMatch(/1 valid, 1 warning in /);
  });

  it('should output a JSON error when the input pattern cannot be searched in json mode', async () => {
    // A NUL byte makes the file search itself throw, which only the outer
    // catch handles.
    await validateCommand(path.join(TEMP_DIR, 'a\0b', '*.ts'), { json: true });

    expect(JSON.parse(out.of('log'))).toEqual({ error: expect.stringContaining('null bytes') });
    expect(process.exitCode).toBe(1);
  });

  it('should output JSON error when no files match the pattern in json mode', async () => {
    await validateCommand(path.join(TEMP_DIR, 'nonexistent-xyz/**/*.ts'), { json: true });

    const parsed = JSON.parse(out.of('log'));
    expect(parsed.error).toContain('No files found');
    expect(process.exitCode).toBe(1);
  });

  it('should throw when no files match the pattern without json mode', async () => {
    await expect(
      validateCommand(path.join(TEMP_DIR, 'nonexistent-abc/**/*.ts'), {})
    ).rejects.toThrow(/No files found/);
  });

  it('should produce valid JSON summary for valid workflow in json mode', async () => {
    const filePath = writeFixture('json-valid.ts', VALID_WORKFLOW);

    await validateCommand(filePath, { json: true });

    const parsed = lastJson();
    expect(parsed.valid).toBe(true);
    expect(parsed.totalErrors).toBe(0);
    expect(parsed.totalWarnings).toBe(1);
    expect(process.exitCode).toBeUndefined();
  });

  it('should report a lossy type coercion as a warning when not strict', async () => {
    const filePath = writeFixture('type-warn.ts', COERCION_WORKFLOW);

    await expect(validateCommand(filePath, { strict: false })).resolves.toBeUndefined();

    expect(out.of('warn')).toContain('Lossy Type Conversion');
    expect(out.of('error')).toBe('');
    expect(out.of('log')).toMatch(/1 valid, 1 warning in /);
  });

  it('should treat type coercion as errors in strict mode', async () => {
    const filePath = writeFixture('strict-warn.ts', COERCION_WORKFLOW);

    await expect(validateCommand(filePath, { strict: true })).rejects.toThrow('Validation failed with 1 error');

    expect(out.of('error')).toContain('Type Incompatible');
    expect(out.of('warn')).not.toContain('Lossy Type Conversion');
  });

  it('should report type coercion as an error code in strict json mode', async () => {
    const filePath = writeFixture('strict-json.ts', COERCION_WORKFLOW);

    await validateCommand(filePath, { strict: true, json: true });

    const parsed = lastJson();
    expect(parsed.valid).toBe(false);
    expect(parsed.results[0].errors.map((e: { code: string }) => e.code)).toEqual(['TYPE_INCOMPATIBLE']);
    expect(process.exitCode).toBe(1);
  });

  it('should suppress warnings in quiet mode', async () => {
    const filePath = writeFixture('quiet.ts', VALID_WORKFLOW);

    await validateCommand(filePath, { quiet: true, verbose: false });

    expect(out.of('warn')).toBe('');
    // The summary still counts the warning it did not print.
    expect(out.of('log')).toMatch(/1 valid, 1 warning in /);
  });

  it('should expand directory input to glob pattern', async () => {
    const dir = path.join(TEMP_DIR, 'dir-expand');
    writeFixture('dir-expand/a.ts', VALID_WORKFLOW);
    writeFixture('dir-expand/nested/b.ts', VALID_WORKFLOW);

    await validateCommand(dir, { verbose: true });

    const stdout = out.of('log', 'info');
    expect(stdout).toContain('Found 2 file(s)');
    expect(stdout).toContain('a.ts is valid');
    expect(stdout).toContain('b.ts is valid');
  });

  it('should report an unknown node type as a validation error', async () => {
    const filePath = writeFixture('unknown-node.ts', UNKNOWN_NODE_WORKFLOW);

    await expect(validateCommand(filePath, { verbose: true })).rejects.toThrow('Validation failed with 1 error');

    expect(out.of('error')).toContain('Validation errors in unknown-node.ts');
    expect(out.of('error')).toContain("Node type 'ghostNode' doesn't exist");
  });

  it('should report an unknown node type in json mode', async () => {
    const filePath = writeFixture('unknown-node-json.ts', UNKNOWN_NODE_WORKFLOW);

    await validateCommand(filePath, { json: true });

    const parsed = lastJson();
    expect(parsed.valid).toBe(false);
    expect(parsed.totalErrors).toBe(1);
    expect(parsed.results[0].errors[0]).toMatchObject({ code: 'UNKNOWN_NODE_TYPE', nodeId: 'g' });
    expect(process.exitCode).toBe(1);
  });
});
