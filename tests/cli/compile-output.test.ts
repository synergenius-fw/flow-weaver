/**
 * TDD tests for compile --output (-o) option.
 *
 * The -o flag should write compiled output to a specified file or directory
 * instead of modifying the source file in-place.
 *
 * Behaviors:
 *   -o file.ts       → write to file.ts (single input only)
 *   -o somedir/      → write compiled files into somedir/ preserving filenames
 *   -o somedir       → (existing directory) same as above
 *   no -o            → in-place (current behavior)
 *   -o file.ts with multiple inputs → error (ambiguous)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const WORKFLOW_SOURCE = `
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
export function outputTestWorkflow(execute: boolean): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  throw new Error("Not implemented");
}
`;

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-compile-output-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('compile --output (-o)', () => {
  it('writes compiled output to the specified file instead of in-place', async () => {
    const { compileCommand } = await import('../../src/cli/commands/compile');

    const inputFile = path.join(tmpDir, 'workflow.ts');
    const outputFile = path.join(tmpDir, 'compiled.ts');
    fs.writeFileSync(inputFile, WORKFLOW_SOURCE);
    const originalContent = fs.readFileSync(inputFile, 'utf8');

    await compileCommand(inputFile, { output: outputFile });

    // Source file should be unchanged
    expect(fs.readFileSync(inputFile, 'utf8')).toBe(originalContent);
    // Output file should exist and contain compiled code
    expect(fs.existsSync(outputFile)).toBe(true);
    const compiled = fs.readFileSync(outputFile, 'utf8');
    expect(compiled).toContain('GeneratedExecutionContext');
    expect(compiled).toContain('outputTestWorkflow');
  });

  it('writes to a directory, preserving the original filename', async () => {
    const { compileCommand } = await import('../../src/cli/commands/compile');

    const inputFile = path.join(tmpDir, 'my-workflow.ts');
    const outputDir = path.join(tmpDir, 'output');
    fs.mkdirSync(outputDir);
    fs.writeFileSync(inputFile, WORKFLOW_SOURCE);
    const originalContent = fs.readFileSync(inputFile, 'utf8');

    await compileCommand(inputFile, { output: outputDir });

    // Source file should be unchanged
    expect(fs.readFileSync(inputFile, 'utf8')).toBe(originalContent);
    // Output should be in the directory with the same filename
    const outputFile = path.join(outputDir, 'my-workflow.ts');
    expect(fs.existsSync(outputFile)).toBe(true);
    const compiled = fs.readFileSync(outputFile, 'utf8');
    expect(compiled).toContain('GeneratedExecutionContext');
  });

  it('creates the output directory if it does not exist (path ends with /)', async () => {
    const { compileCommand } = await import('../../src/cli/commands/compile');

    const inputFile = path.join(tmpDir, 'workflow.ts');
    const outputDir = path.join(tmpDir, 'new-output-dir');
    fs.writeFileSync(inputFile, WORKFLOW_SOURCE);

    // Pass with trailing slash to signal directory intent
    await compileCommand(inputFile, { output: outputDir + '/' });

    const outputFile = path.join(outputDir, 'workflow.ts');
    expect(fs.existsSync(outputFile)).toBe(true);
    const compiled = fs.readFileSync(outputFile, 'utf8');
    expect(compiled).toContain('GeneratedExecutionContext');
  });

  it('writes multiple files to output directory when input is a glob/directory', async () => {
    const { compileCommand } = await import('../../src/cli/commands/compile');

    const inputDir = path.join(tmpDir, 'src');
    const outputDir = path.join(tmpDir, 'dist');
    fs.mkdirSync(inputDir);
    fs.mkdirSync(outputDir);

    // Create two workflow files
    const source1 = WORKFLOW_SOURCE.replace(/outputTestWorkflow/g, 'workflowOne');
    const source2 = WORKFLOW_SOURCE.replace(/outputTestWorkflow/g, 'workflowTwo');
    fs.writeFileSync(path.join(inputDir, 'one.ts'), source1);
    fs.writeFileSync(path.join(inputDir, 'two.ts'), source2);

    await compileCommand(inputDir, { output: outputDir });

    // Both files should be in the output directory
    expect(fs.existsSync(path.join(outputDir, 'one.ts'))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, 'two.ts'))).toBe(true);
    // Source files should be unchanged
    expect(fs.readFileSync(path.join(inputDir, 'one.ts'), 'utf8')).toBe(source1);
    expect(fs.readFileSync(path.join(inputDir, 'two.ts'), 'utf8')).toBe(source2);
  });

  it('errors when -o points to a file but multiple inputs are provided', async () => {
    const { compileCommand } = await import('../../src/cli/commands/compile');

    const inputDir = path.join(tmpDir, 'src');
    fs.mkdirSync(inputDir);

    const source1 = WORKFLOW_SOURCE.replace(/outputTestWorkflow/g, 'workflowOne');
    const source2 = WORKFLOW_SOURCE.replace(/outputTestWorkflow/g, 'workflowTwo');
    fs.writeFileSync(path.join(inputDir, 'one.ts'), source1);
    fs.writeFileSync(path.join(inputDir, 'two.ts'), source2);

    // Output is a file, not a directory (ambiguous with multiple inputs)
    const outputFile = path.join(tmpDir, 'single-output.ts');

    await expect(
      compileCommand(inputDir, { output: outputFile })
    ).rejects.toThrow(/directory|multiple/i);
  });

  it('does not modify source files when --output is set (even on error)', async () => {
    const { compileCommand } = await import('../../src/cli/commands/compile');

    const inputFile = path.join(tmpDir, 'workflow.ts');
    const outputFile = path.join(tmpDir, 'out.ts');
    fs.writeFileSync(inputFile, WORKFLOW_SOURCE);
    const originalContent = fs.readFileSync(inputFile, 'utf8');

    await compileCommand(inputFile, { output: outputFile });

    // Source must never be modified when -o is set
    expect(fs.readFileSync(inputFile, 'utf8')).toBe(originalContent);
  });

  it('--output works with --dry-run (no files written anywhere)', async () => {
    const { compileCommand } = await import('../../src/cli/commands/compile');

    const inputFile = path.join(tmpDir, 'workflow.ts');
    const outputFile = path.join(tmpDir, 'out.ts');
    fs.writeFileSync(inputFile, WORKFLOW_SOURCE);
    const originalContent = fs.readFileSync(inputFile, 'utf8');

    await compileCommand(inputFile, { output: outputFile, dryRun: true });

    // Neither source nor output should be written
    expect(fs.readFileSync(inputFile, 'utf8')).toBe(originalContent);
    expect(fs.existsSync(outputFile)).toBe(false);
  });

  it('--output works with --source-map', async () => {
    const { compileCommand } = await import('../../src/cli/commands/compile');

    const inputFile = path.join(tmpDir, 'workflow.ts');
    const outputFile = path.join(tmpDir, 'compiled.ts');
    fs.writeFileSync(inputFile, WORKFLOW_SOURCE);

    await compileCommand(inputFile, { output: outputFile, sourceMap: true });

    expect(fs.existsSync(outputFile)).toBe(true);
    // Source map should be next to the output file, not the source file
    expect(fs.existsSync(outputFile + '.map')).toBe(true);
    // Source file should NOT have a source map
    expect(fs.existsSync(inputFile + '.map')).toBe(false);
  });

  it('without --output, compiles in-place as before', async () => {
    const { compileCommand } = await import('../../src/cli/commands/compile');

    const inputFile = path.join(tmpDir, 'workflow.ts');
    fs.writeFileSync(inputFile, WORKFLOW_SOURCE);

    await compileCommand(inputFile, {});

    // File should be modified in-place
    const compiled = fs.readFileSync(inputFile, 'utf8');
    expect(compiled).toContain('GeneratedExecutionContext');
    expect(compiled).not.toBe(WORKFLOW_SOURCE);
  });
});
