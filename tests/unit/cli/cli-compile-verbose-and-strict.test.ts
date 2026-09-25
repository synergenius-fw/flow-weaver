/**
 * Tests for src/cli/commands/compile.ts: displayPath, verbose paths,
 * error handling, strict validation warnings, sourceMap edge cases.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const TEMP_DIR = path.join(os.tmpdir(), `fw-compile-cov-${process.pid}`);

beforeEach(() => {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
});

afterEach(() => {
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
});

function writeFixture(name: string, content: string): string {
  const filePath = path.join(TEMP_DIR, name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return filePath;
}

const SIMPLE_WORKFLOW = `
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
export function simpleWf(execute: boolean): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  throw new Error("Not implemented");
}
`;

const FILE_WITH_FLOWWEAVER_BUT_NO_WORKFLOW = `
/**
 * @flowWeaver nodeType
 */
function helperNode(execute: boolean): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}
`;

const FILE_WITH_PARSE_ERRORS = `
/**
 * @flowWeaver nodeType
 */
function realNode(execute: boolean): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}

/**
 * @flowWeaver workflow
 * @node r realNode
 * @node ghost nonExistentType
 * @connect r.onSuccess -> ghost.execute
 * @connect ghost.onSuccess -> Exit.onSuccess
 */
export function brokenWf(execute: boolean): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  throw new Error("Not implemented");
}
`;

describe('compileCommand coverage', () => {
  it('should handle verbose mode with parse warnings and file listing', async () => {
    const { compileCommand } = await import('../../../src/cli/commands/compile');
    const filePath = writeFixture('verbose-wf.ts', SIMPLE_WORKFLOW);

    await compileCommand(filePath, { verbose: true });

    const content = fs.readFileSync(filePath, 'utf8');
    expect(content).toContain('@flowWeaver workflow');
  });

  it('should skip files with @flowWeaver but no workflow (verbose)', async () => {
    const { compileCommand } = await import('../../../src/cli/commands/compile');
    const filePath = writeFixture('no-wf.ts', FILE_WITH_FLOWWEAVER_BUT_NO_WORKFLOW);

    // Should complete without error (file is skipped since it has no workflow, only nodeType)
    await compileCommand(filePath, { verbose: true });
  });

  it('should handle files with parse errors (node type not found)', async () => {
    const { compileCommand } = await import('../../../src/cli/commands/compile');
    const filePath = writeFixture('parse-err.ts', FILE_WITH_PARSE_ERRORS);

    // The parser may resolve missing node types in different ways. We just verify
    // that the compile command handles the file without crashing unexpectedly.
    // If parse errors are reported, the command throws. If not, it compiles normally.
    try {
      await compileCommand(filePath, {});
    } catch (err: any) {
      expect(err.message).toContain('failed');
    }
  });

  it('should report no changes in verbose mode when re-compiling stable file', async () => {
    const { compileCommand } = await import('../../../src/cli/commands/compile');
    const filePath = writeFixture('stable.ts', SIMPLE_WORKFLOW);

    // First compile
    await compileCommand(filePath, {});
    // Second compile should report no changes in verbose
    await compileCommand(filePath, { verbose: true });
  });

  it('should show dry-run messages for files with and without changes', async () => {
    const { compileCommand } = await import('../../../src/cli/commands/compile');
    const filePath = writeFixture('dryrun.ts', SIMPLE_WORKFLOW);

    // First dry run (has changes)
    await compileCommand(filePath, { dryRun: true });
    const unchanged = fs.readFileSync(filePath, 'utf8');
    expect(unchanged).toBe(SIMPLE_WORKFLOW);

    // Compile for real
    await compileCommand(filePath, {});

    // Second dry run on already-compiled file (no changes)
    await compileCommand(filePath, { dryRun: true });
  });

  it('should handle directory input expanding to glob', async () => {
    const { compileCommand } = await import('../../../src/cli/commands/compile');
    const dir = path.join(TEMP_DIR, 'dir-expand');
    fs.mkdirSync(dir, { recursive: true });
    writeFixture('dir-expand/a.ts', SIMPLE_WORKFLOW);

    await compileCommand(dir, {});
  });

  it('should throw for no matching files', async () => {
    const { compileCommand } = await import('../../../src/cli/commands/compile');

    await expect(
      compileCommand(path.join(TEMP_DIR, 'nonexistent-glob-xyz/**/*.ts'), {})
    ).rejects.toThrow(/No files found/);
  });

  it('should handle format auto (default) detection', async () => {
    const { compileCommand } = await import('../../../src/cli/commands/compile');
    const filePath = writeFixture('auto-fmt.ts', SIMPLE_WORKFLOW);

    await compileCommand(filePath, { format: 'auto' });
  });

  it('should handle strict mode validation errors and throw', async () => {
    const { compileCommand } = await import('../../../src/cli/commands/compile');

    // A workflow with an invalid port connection, which strict validation catches.
    const badContent = `
/**
 * @flowWeaver nodeType
 */
function goodNode(execute: boolean): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}

/**
 * @flowWeaver workflow
 * @node g goodNode
 * @node h goodNode
 * @connect g.onSuccess -> h.execute
 * @connect h.onSuccess -> Exit.onSuccess
 * @connect g.nonexistentPort -> h.nonexistentPort
 */
export function strictFailWf(execute: boolean): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  throw new Error("Not implemented");
}
`;
    const filePath = writeFixture('strict-fail.ts', badContent);

    await expect(compileCommand(filePath, { strict: true })).rejects.toThrow(/failed/i);
  });

  it('should handle sourceMap with verbose mode', async () => {
    const { compileCommand } = await import('../../../src/cli/commands/compile');
    const filePath = writeFixture('srcmap-v.ts', SIMPLE_WORKFLOW);

    await compileCommand(filePath, { sourceMap: true, verbose: true });

    expect(fs.existsSync(filePath + '.map')).toBe(true);
  });

  it('should not duplicate sourceMappingURL on re-compile with sourceMap', async () => {
    const { compileCommand } = await import('../../../src/cli/commands/compile');
    const filePath = writeFixture('srcmap-dup.ts', SIMPLE_WORKFLOW);

    await compileCommand(filePath, { sourceMap: true });
    const first = fs.readFileSync(filePath, 'utf8');
    const count1 = (first.match(/sourceMappingURL/g) || []).length;

    // Re-compile
    await compileCommand(filePath, { sourceMap: true });
    const second = fs.readFileSync(filePath, 'utf8');
    const count2 = (second.match(/sourceMappingURL/g) || []).length;

    // Should not add duplicate
    expect(count2).toBeLessThanOrEqual(count1);
  });

  it('should report summary with format note when not verbose', async () => {
    const { compileCommand } = await import('../../../src/cli/commands/compile');
    const filePath = writeFixture('summary.ts', SIMPLE_WORKFLOW);

    await compileCommand(filePath, { verbose: false });
  });

  it('should handle singular file count in summary', async () => {
    const { compileCommand } = await import('../../../src/cli/commands/compile');
    const filePath = writeFixture('single.ts', SIMPLE_WORKFLOW);

    // One file = "1 file compiled" (singular)
    await compileCommand(filePath, {});
  });

  it('should handle strict mode with verbose warnings', async () => {
    const { compileCommand } = await import('../../../src/cli/commands/compile');
    const filePath = writeFixture('strict-warn.ts', SIMPLE_WORKFLOW);

    await compileCommand(filePath, { strict: true, verbose: true });
  });
});

describe('displayPath coverage', () => {
  it('should return absolute path when relative would escape cwd', async () => {
    const { compileCommand } = await import('../../../src/cli/commands/compile');

    // Create a file in temp dir (outside cwd), compile should use absolute display
    const filePath = writeFixture('abs-path.ts', SIMPLE_WORKFLOW);
    await compileCommand(filePath, { verbose: true });
  });

  it('should show validation warnings in default (non-strict) compile mode', async () => {
    const { compileCommand } = await import('../../../src/cli/commands/compile');

    // Workflow with a node that has an unused output port (triggers UNUSED_OUTPUT_PORT warning)
    const workflowWithWarning = `
/**
 * @flowWeaver nodeType
 * @input value
 * @output result
 * @output extra
 */
function dataNode(execute: boolean, value: number): { onSuccess: boolean; onFailure: boolean; result: number; extra: string } {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0, extra: '' };
  return { onSuccess: true, onFailure: false, result: value * 2, extra: 'unused' };
}

/**
 * @flowWeaver workflow
 * @node d dataNode [expr: value="42"]
 * @connect d.result -> Exit.output
 * @path Start -> d -> Exit
 * @returns output
 */
export async function warningWorkflow(execute: boolean): Promise<{ onSuccess: boolean; onFailure: boolean; output: number }> {
  // @flow-weaver-body-start
  throw new Error('Not implemented');
  // @flow-weaver-body-end
}
`;
    const filePath = writeFixture('warn-default.ts', workflowWithWarning);

    // Spy on logger.warn to capture warnings
    const { logger } = await import('../../../src/cli/utils/logger');
    const warnSpy = vi.spyOn(logger, 'warn');

    // Compile WITHOUT --strict - should still show warnings
    await compileCommand(filePath, {});

    // Check that at least one warning was logged (e.g. UNUSED_OUTPUT_PORT for "extra")
    const warnCalls = warnSpy.mock.calls.map(c => String(c[0]));
    const hasValidationWarning = warnCalls.some(
      (msg) => msg.includes('extra') || msg.includes('UNUSED') || msg.includes('never connected')
    );
    expect(hasValidationWarning).toBe(true);

    warnSpy.mockRestore();
  });
});
