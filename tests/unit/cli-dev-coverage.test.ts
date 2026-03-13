/**
 * Coverage tests for src/cli/commands/dev.ts
 * Targets uncovered lines: 169-174 (dev mode registry delegation),
 * 198-235 (watch mode setup with chokidar, cleanup handlers).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

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
    const { devCommand } = await import('../../src/cli/commands/dev');

    await expect(
      devCommand('/nonexistent/file.ts', { once: true })
    ).rejects.toThrow(/File not found/);
  });

  it('should delegate to a registered dev mode provider when target matches', async () => {
    const { devCommand } = await import('../../src/cli/commands/dev');
    const { devModeRegistry } = await import('../../src/generator/dev-mode-registry');

    const runFn = vi.fn().mockResolvedValue(undefined);
    devModeRegistry.register({ name: 'test-dev-target', run: runFn });

    const filePath = writeFixture('dev-target.ts', SIMPLE_WORKFLOW);

    await devCommand(filePath, { target: 'test-dev-target', once: true });

    expect(runFn).toHaveBeenCalledWith(
      path.resolve(filePath),
      expect.objectContaining({ target: 'test-dev-target', once: true })
    );
  });

  it('should throw for unknown dev target with no providers registered', async () => {
    const { devCommand } = await import('../../src/cli/commands/dev');

    const filePath = writeFixture('dev-unknown.ts', SIMPLE_WORKFLOW);

    await expect(
      devCommand(filePath, { target: 'nonexistent-target', once: true })
    ).rejects.toThrow(/Unknown dev target/);
  });

  it('should throw for unknown dev target and list available providers', async () => {
    const { devCommand } = await import('../../src/cli/commands/dev');
    const { devModeRegistry } = await import('../../src/generator/dev-mode-registry');

    devModeRegistry.register({
      name: 'available-target',
      run: vi.fn().mockResolvedValue(undefined),
    });

    const filePath = writeFixture('dev-avail.ts', SIMPLE_WORKFLOW);

    await expect(
      devCommand(filePath, { target: 'wrong-target', once: true })
    ).rejects.toThrow(/Available.*available-target/);
  });

  it('should parse --params JSON and run once', async () => {
    const { devCommand } = await import('../../src/cli/commands/dev');

    // Mock executeWorkflowFromFile to avoid actually running
    const executor = await import('../../src/mcp/workflow-executor');
    vi.spyOn(executor, 'executeWorkflowFromFile').mockResolvedValue({
      functionName: 'simpleWf',
      executionTime: 10,
      result: { onSuccess: true },
      trace: [],
    });

    const filePath = writeFixture('dev-params.ts', SIMPLE_WORKFLOW);

    await devCommand(filePath, {
      params: '{"key": "value"}',
      once: true,
    });

    expect(executor.executeWorkflowFromFile).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ key: 'value' }),
      expect.any(Object)
    );
  });

  it('should throw on invalid --params JSON', async () => {
    const { devCommand } = await import('../../src/cli/commands/dev');

    const filePath = writeFixture('dev-bad-params.ts', SIMPLE_WORKFLOW);

    await expect(
      devCommand(filePath, { params: 'not-json', once: true })
    ).rejects.toThrow(/Invalid JSON in --params/);
  });

  it('should load params from --params-file', async () => {
    const { devCommand } = await import('../../src/cli/commands/dev');

    const executor = await import('../../src/mcp/workflow-executor');
    vi.spyOn(executor, 'executeWorkflowFromFile').mockResolvedValue({
      functionName: 'simpleWf',
      executionTime: 5,
      result: { ok: true },
      trace: [],
    });

    const paramsFile = writeFixture('params.json', '{"fromFile": true}');
    const filePath = writeFixture('dev-pfile.ts', SIMPLE_WORKFLOW);

    await devCommand(filePath, { paramsFile, once: true });

    expect(executor.executeWorkflowFromFile).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ fromFile: true }),
      expect.any(Object)
    );
  });

  it('should throw when --params-file does not exist', async () => {
    const { devCommand } = await import('../../src/cli/commands/dev');

    const filePath = writeFixture('dev-missing-pfile.ts', SIMPLE_WORKFLOW);

    await expect(
      devCommand(filePath, {
        paramsFile: '/nonexistent/params.json',
        once: true,
      })
    ).rejects.toThrow(/Params file not found/);
  });

  it('should throw when --params-file contains invalid JSON', async () => {
    const { devCommand } = await import('../../src/cli/commands/dev');

    const paramsFile = writeFixture('bad-params.json', '{broken');
    const filePath = writeFixture('dev-bad-pfile.ts', SIMPLE_WORKFLOW);

    await expect(
      devCommand(filePath, { paramsFile, once: true })
    ).rejects.toThrow(/Failed to parse params file/);
  });

  it('should handle compile errors gracefully in once mode', async () => {
    const { devCommand } = await import('../../src/cli/commands/dev');

    // Mock compileCommand to throw with errors array
    const compileModule = await import('../../src/cli/commands/compile');
    const compileError = Object.assign(new Error('Compilation failed'), {
      errors: [{ code: 'UNKNOWN_NODE', message: 'Node not found', node: 'x' }],
    });
    vi.spyOn(compileModule, 'compileCommand').mockRejectedValue(compileError);

    const filePath = writeFixture('dev-compile-err.ts', SIMPLE_WORKFLOW);

    // Should not throw; compile errors are caught and logged
    await devCommand(filePath, { once: true });
  });

  it('should handle compile errors without errors array', async () => {
    const { devCommand } = await import('../../src/cli/commands/dev');

    const compileModule = await import('../../src/cli/commands/compile');
    vi.spyOn(compileModule, 'compileCommand').mockRejectedValue(new Error('Generic compile failure'));

    const filePath = writeFixture('dev-generic-err.ts', SIMPLE_WORKFLOW);

    await devCommand(filePath, { once: true });
  });

  it('should output JSON on successful run when json option is set', async () => {
    const { devCommand } = await import('../../src/cli/commands/dev');

    const executor = await import('../../src/mcp/workflow-executor');
    vi.spyOn(executor, 'executeWorkflowFromFile').mockResolvedValue({
      functionName: 'simpleWf',
      executionTime: 7,
      result: { done: true },
      trace: [],
    });

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    const filePath = writeFixture('dev-json.ts', SIMPLE_WORKFLOW);

    await devCommand(filePath, { json: true, once: true });

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join('');
    expect(output).toContain('"success": true');
    expect(output).toContain('"workflow": "simpleWf"');

    stdoutSpy.mockRestore();
  });

  it('should output JSON on run failure when json option is set', async () => {
    const { devCommand } = await import('../../src/cli/commands/dev');

    const executor = await import('../../src/mcp/workflow-executor');
    vi.spyOn(executor, 'executeWorkflowFromFile').mockRejectedValue(
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
    const { devCommand } = await import('../../src/cli/commands/dev');

    const executor = await import('../../src/mcp/workflow-executor');
    vi.spyOn(executor, 'executeWorkflowFromFile').mockRejectedValue(
      new Error('Execution error')
    );

    const filePath = writeFixture('dev-run-err.ts', SIMPLE_WORKFLOW);

    // Should not throw; run errors are caught and logged
    await devCommand(filePath, { once: true });
  });
});
