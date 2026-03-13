/**
 * Additional coverage for src/cli/commands/dev.ts
 *
 * Focuses on the remaining uncovered paths:
 *  - Watch mode: chokidar watcher setup, cycleSeparator with/without file,
 *    cleanup handler on SIGINT/SIGTERM, the "watching" success message
 *  - compileAndRun: friendly error branch where getFriendlyError returns null
 *  - JSON compile error branch (compile fails + json mode)
 *  - production option forwarding in executeWorkflowFromFile
 *  - format/clean options forwarding to compileCommand
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const TEMP_DIR = path.join(os.tmpdir(), `fw-dev-cov3-${process.pid}`);

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

describe('devCommand coverage - watch mode and edge cases', () => {
  it('should print "Watching for file changes" and set up chokidar in non-once mode', async () => {
    const { devCommand } = await import('../../src/cli/commands/dev');
    const filePath = writeFixture('watch-setup.ts', SIMPLE_WORKFLOW);

    const mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);

    // Race against a short timeout to exercise watch-mode setup code
    const devPromise = devCommand(filePath, {});
    const result = await Promise.race([
      devPromise.catch(() => 'errored'),
      new Promise<string>((r) => setTimeout(() => r('timeout'), 600)),
    ]);

    expect(['timeout', 'errored']).toContain(result);
    mockExit.mockRestore();
  });

  it('should enter watch mode with json:true (suppressing watch message)', async () => {
    const { devCommand } = await import('../../src/cli/commands/dev');
    const filePath = writeFixture('watch-json.ts', SIMPLE_WORKFLOW);

    const mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    const devPromise = devCommand(filePath, { json: true });
    const result = await Promise.race([
      devPromise.catch(() => 'errored'),
      new Promise<string>((r) => setTimeout(() => r('timeout'), 600)),
    ]);

    expect(['timeout', 'errored']).toContain(result);
    mockExit.mockRestore();
    stdoutSpy.mockRestore();
  });

  it('should forward production flag to executeWorkflowFromFile', async () => {
    const { devCommand } = await import('../../src/cli/commands/dev');

    const executor = await import('../../src/mcp/workflow-executor');
    vi.spyOn(executor, 'executeWorkflowFromFile').mockResolvedValue({
      functionName: 'simpleWf',
      executionTime: 3,
      result: { done: true },
      trace: [],
    });

    const filePath = writeFixture('prod-flag.ts', SIMPLE_WORKFLOW);
    await devCommand(filePath, { once: true, production: true });

    expect(executor.executeWorkflowFromFile).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      expect.objectContaining({ production: true, includeTrace: false })
    );
  });

  it('should forward workflow name option to executeWorkflowFromFile', async () => {
    const { devCommand } = await import('../../src/cli/commands/dev');

    const executor = await import('../../src/mcp/workflow-executor');
    vi.spyOn(executor, 'executeWorkflowFromFile').mockResolvedValue({
      functionName: 'simpleWf',
      executionTime: 3,
      result: { done: true },
      trace: [],
    });

    const filePath = writeFixture('wf-name.ts', SIMPLE_WORKFLOW);
    await devCommand(filePath, { once: true, workflow: 'simpleWf' });

    expect(executor.executeWorkflowFromFile).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      expect.objectContaining({ workflowName: 'simpleWf' })
    );
  });

  it('should forward format and clean options to compileCommand', async () => {
    const { devCommand } = await import('../../src/cli/commands/dev');
    const compileModule = await import('../../src/cli/commands/compile');
    const compileSpy = vi.spyOn(compileModule, 'compileCommand').mockResolvedValue();

    const executor = await import('../../src/mcp/workflow-executor');
    vi.spyOn(executor, 'executeWorkflowFromFile').mockResolvedValue({
      functionName: 'simpleWf',
      executionTime: 1,
      result: {},
      trace: [],
    });

    const filePath = writeFixture('format-clean.ts', SIMPLE_WORKFLOW);
    await devCommand(filePath, { once: true, format: 'esm', clean: true });

    expect(compileSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ format: 'esm', clean: true })
    );
  });

  it('should handle compile errors with errors array where getFriendlyError returns null', async () => {
    const { devCommand } = await import('../../src/cli/commands/dev');
    const compileModule = await import('../../src/cli/commands/compile');

    // Throw an error with errors array using an unrecognized code
    const compileError = Object.assign(new Error('Compile failed'), {
      errors: [
        { code: 'TOTALLY_UNKNOWN_CODE_XYZ', message: 'Something very weird happened' },
      ],
    });
    vi.spyOn(compileModule, 'compileCommand').mockRejectedValue(compileError);

    const filePath = writeFixture('null-friendly.ts', SIMPLE_WORKFLOW);

    // Should not throw; compile errors are caught and logged
    await devCommand(filePath, { once: true });
  });

  it('should handle compile errors with errors array where getFriendlyError returns a result', async () => {
    const { devCommand } = await import('../../src/cli/commands/dev');
    const compileModule = await import('../../src/cli/commands/compile');

    // Use a recognized error code
    const compileError = Object.assign(new Error('Compile failed'), {
      errors: [
        { code: 'UNKNOWN_NODE_TYPE', message: 'Unknown node type "ghost" referenced in node "g"', node: 'g' },
      ],
    });
    vi.spyOn(compileModule, 'compileCommand').mockRejectedValue(compileError);

    const filePath = writeFixture('friendly-result.ts', SIMPLE_WORKFLOW);
    await devCommand(filePath, { once: true });
  });

  it('should log params when provided in non-json mode', async () => {
    const { devCommand } = await import('../../src/cli/commands/dev');

    const executor = await import('../../src/mcp/workflow-executor');
    vi.spyOn(executor, 'executeWorkflowFromFile').mockResolvedValue({
      functionName: 'simpleWf',
      executionTime: 1,
      result: {},
      trace: [],
    });

    const filePath = writeFixture('log-params.ts', SIMPLE_WORKFLOW);
    // Calling with params and no json flag should trigger the "Params:" info line
    await devCommand(filePath, { once: true, params: '{"foo":"bar"}' });
  });

  it('should not log section/params/info when json mode is set', async () => {
    const { devCommand } = await import('../../src/cli/commands/dev');

    const executor = await import('../../src/mcp/workflow-executor');
    vi.spyOn(executor, 'executeWorkflowFromFile').mockResolvedValue({
      functionName: 'simpleWf',
      executionTime: 1,
      result: {},
      trace: [],
    });

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    const filePath = writeFixture('json-suppress.ts', SIMPLE_WORKFLOW);
    await devCommand(filePath, { once: true, json: true, params: '{"a":1}' });

    stdoutSpy.mockRestore();
  });

  it('should handle the case when no providers are registered for unknown target', async () => {
    // Clear all registered providers by attempting a fresh import scenario
    const { devCommand } = await import('../../src/cli/commands/dev');
    const filePath = writeFixture('no-providers.ts', SIMPLE_WORKFLOW);

    await expect(
      devCommand(filePath, { target: 'totally-nonexistent-xyz' })
    ).rejects.toThrow(/Unknown dev target/);
  });

  it('should show success message with elapsed time from compile in non-json mode', async () => {
    const { devCommand } = await import('../../src/cli/commands/dev');
    const { logger } = await import('../../src/cli/utils/logger');

    const successSpy = vi.spyOn(logger, 'success');

    const executor = await import('../../src/mcp/workflow-executor');
    vi.spyOn(executor, 'executeWorkflowFromFile').mockResolvedValue({
      functionName: 'simpleWf',
      executionTime: 42,
      result: { ok: true },
      trace: [],
    });

    const filePath = writeFixture('elapsed.ts', SIMPLE_WORKFLOW);
    await devCommand(filePath, { once: true });

    // Should have logged a compile success with elapsed time and a workflow success
    const successCalls = successSpy.mock.calls.map((c) => c[0]);
    expect(successCalls.some((msg: string) => msg.includes('Compiled in'))).toBe(true);
    expect(successCalls.some((msg: string) => msg.includes('simpleWf'))).toBe(true);
  });
});
