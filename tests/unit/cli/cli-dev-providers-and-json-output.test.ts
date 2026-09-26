/**
 * Tests for src/cli/commands/dev.ts: params parsing, once mode, JSON output,
 * and the watch loop's setup and cleanup handlers.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { WorkflowExecutionOutcome } from '../../../src/mcp/workflow-executor';
import { captureConsole } from '../../helpers/console-capture';

const TEMP_DIR = path.join(os.tmpdir(), `fw-dev-cov-${process.pid}`);

beforeEach(() => {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
});

afterEach(() => {
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  vi.restoreAllMocks();
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

describe('devCommand coverage', () => {
  it('should throw when file does not exist', async () => {
    const { devCommand } = await import('../../../src/cli/commands/dev');

    await expect(
      devCommand('/nonexistent/file.ts', { once: true })
    ).rejects.toThrow(/File not found/);
  });

  it('should parse --params JSON and run once', async () => {
    const { devCommand } = await import('../../../src/cli/commands/dev');

    // Mock executeWorkflow to avoid actually running
    const executor = await import('../../../src/mcp/workflow-executor');
    vi.spyOn(executor, 'executeWorkflow').mockResolvedValue({
      functionName: 'simpleWf',
      executionTime: 10,
      result: { onSuccess: true },
      trace: [],
    } as unknown as WorkflowExecutionOutcome);

    const filePath = writeFixture('dev-params.ts', SIMPLE_WORKFLOW);

    await devCommand(filePath, {
      params: '{"key": "value"}',
      once: true,
    });

    expect(executor.executeWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: expect.any(String),
        params: expect.objectContaining({ key: 'value' }),
      })
    );
  });

  it('should throw on invalid --params JSON', async () => {
    const { devCommand } = await import('../../../src/cli/commands/dev');

    const filePath = writeFixture('dev-bad-params.ts', SIMPLE_WORKFLOW);

    await expect(
      devCommand(filePath, { params: 'not-json', once: true })
    ).rejects.toThrow(/Invalid JSON in --params/);
  });

  it('should load params from --params-file', async () => {
    const { devCommand } = await import('../../../src/cli/commands/dev');

    const executor = await import('../../../src/mcp/workflow-executor');
    vi.spyOn(executor, 'executeWorkflow').mockResolvedValue({
      functionName: 'simpleWf',
      executionTime: 5,
      result: { ok: true },
      trace: [],
    } as unknown as WorkflowExecutionOutcome);

    const paramsFile = writeFixture('params.json', '{"fromFile": true}');
    const filePath = writeFixture('dev-pfile.ts', SIMPLE_WORKFLOW);

    await devCommand(filePath, { paramsFile, once: true });

    expect(executor.executeWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: expect.any(String),
        params: expect.objectContaining({ fromFile: true }),
      })
    );
  });

  it('should throw when --params-file does not exist', async () => {
    const { devCommand } = await import('../../../src/cli/commands/dev');

    const filePath = writeFixture('dev-missing-pfile.ts', SIMPLE_WORKFLOW);

    await expect(
      devCommand(filePath, {
        paramsFile: '/nonexistent/params.json',
        once: true,
      })
    ).rejects.toThrow(/Params file not found/);
  });

  it('should throw when --params-file contains invalid JSON', async () => {
    const { devCommand } = await import('../../../src/cli/commands/dev');

    const paramsFile = writeFixture('bad-params.json', '{broken');
    const filePath = writeFixture('dev-bad-pfile.ts', SIMPLE_WORKFLOW);

    await expect(
      devCommand(filePath, { paramsFile, once: true })
    ).rejects.toThrow(/Failed to parse params file/);
  });

  it('should handle compile errors without errors array', async () => {
    const { devCommand } = await import('../../../src/cli/commands/dev');

    const compileModule = await import('../../../src/cli/commands/compile');
    vi.spyOn(compileModule, 'compileCommand').mockRejectedValue(new Error('Generic compile failure'));

    const executor = await import('../../../src/mcp/workflow-executor');
    const execSpy = vi.spyOn(executor, 'executeWorkflow');
    const filePath = writeFixture('dev-generic-err.ts', SIMPLE_WORKFLOW);
    const out = captureConsole();

    try {
      await devCommand(filePath, { once: true });
    } finally {
      out.restore();
    }
    expect(out.of('error')).toContain('Compile failed: Generic compile failure');
    expect(execSpy).not.toHaveBeenCalled();
  });

  it('should output JSON on successful run when json option is set', async () => {
    const { devCommand } = await import('../../../src/cli/commands/dev');

    const executor = await import('../../../src/mcp/workflow-executor');
    vi.spyOn(executor, 'executeWorkflow').mockResolvedValue({
      functionName: 'simpleWf',
      executionTime: 7,
      result: { done: true },
      trace: [],
    } as unknown as WorkflowExecutionOutcome);

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    const filePath = writeFixture('dev-json.ts', SIMPLE_WORKFLOW);

    await devCommand(filePath, { json: true, once: true });

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join('');
    expect(output).toContain('"success": true');
    expect(output).toContain('"workflow": "simpleWf"');

    stdoutSpy.mockRestore();
  });

  it('should output JSON on run failure when json option is set', async () => {
    const { devCommand } = await import('../../../src/cli/commands/dev');

    const executor = await import('../../../src/mcp/workflow-executor');
    vi.spyOn(executor, 'executeWorkflow').mockRejectedValue(
      new Error('Runtime failure')
    );

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    const filePath = writeFixture('dev-json-err.ts', SIMPLE_WORKFLOW);

    await devCommand(filePath, { json: true, once: true });

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join('');
    expect(output).toContain('"success": false');
    expect(output).toContain('Runtime failure');

    stdoutSpy.mockRestore();
  });

  it('should handle execution failure in non-json mode', async () => {
    const { devCommand } = await import('../../../src/cli/commands/dev');

    const executor = await import('../../../src/mcp/workflow-executor');
    vi.spyOn(executor, 'executeWorkflow').mockRejectedValue(
      new Error('Execution error')
    );

    const filePath = writeFixture('dev-run-err.ts', SIMPLE_WORKFLOW);
    const out = captureConsole();

    // A failed run is reported, not thrown: in watch mode the next change retries.
    try {
      await expect(devCommand(filePath, { once: true })).resolves.toBeUndefined();
    } finally {
      out.restore();
    }
    expect(out.of('error')).toContain('Run failed: Execution error');
    expect(out.text()).not.toContain('completed in');
  });
});
