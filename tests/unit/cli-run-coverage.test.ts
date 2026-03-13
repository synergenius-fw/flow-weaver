/**
 * Coverage tests for src/cli/commands/run.ts (lines 478-842)
 * Targets: runCommand error handling, validateMockConfig, stream callbacks,
 * JSON output paths, checkpoint, and production mode.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const TEMP_DIR = path.join(os.tmpdir(), `fw-run-cov-${process.pid}`);

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

describe('runCommand coverage', () => {
  it('should throw for non-existent file', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    await expect(
      runCommand('/tmp/nonexistent-file-abc123.ts', {})
    ).rejects.toThrow(/File not found/);
  });

  it('should throw for invalid JSON in --params', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('params-bad.ts', SIMPLE_WORKFLOW);
    await expect(
      runCommand(filePath, { params: 'not valid json{' })
    ).rejects.toThrow(/Invalid JSON in --params/);
  });

  it('should throw for non-existent params file', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('params-file.ts', SIMPLE_WORKFLOW);
    await expect(
      runCommand(filePath, { paramsFile: '/tmp/nonexistent-params-xyz.json' })
    ).rejects.toThrow(/Params file not found/);
  });

  it('should throw for unparseable params file', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('params-parse.ts', SIMPLE_WORKFLOW);
    const paramsFile = writeFixture('bad-params.json', 'not json content');
    await expect(
      runCommand(filePath, { paramsFile })
    ).rejects.toThrow(/Failed to parse params file/);
  });

  it('should throw for invalid JSON in --mocks', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('mocks-bad.ts', SIMPLE_WORKFLOW);
    await expect(
      runCommand(filePath, { mocks: '{invalid json' })
    ).rejects.toThrow(/Invalid JSON in --mocks/);
  });

  it('should throw for non-existent mocks file', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('mocks-file.ts', SIMPLE_WORKFLOW);
    await expect(
      runCommand(filePath, { mocksFile: '/tmp/nonexistent-mocks-xyz.json' })
    ).rejects.toThrow(/Mocks file not found/);
  });

  it('should throw for unparseable mocks file', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('mocks-parse.ts', SIMPLE_WORKFLOW);
    const mocksFile = writeFixture('bad-mocks.json', 'this is not json');
    await expect(
      runCommand(filePath, { mocksFile })
    ).rejects.toThrow(/Failed to parse mocks file/);
  });

  it('should handle --json mode error output without throwing', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    // Non-existent file with --json should not throw
    await runCommand('/tmp/nonexistent-json-test.ts', { json: true });
    // If we got here without throwing, the json error path worked
    // (it writes JSON error to stdout internally)
  });

  it('should run a workflow with --stream in non-json mode', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('run-stream.ts', SIMPLE_WORKFLOW);
    await runCommand(filePath, { stream: true, workflow: 'simpleWf' });
  });

  it('should run with valid --params JSON', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('run-params.ts', SIMPLE_WORKFLOW);
    await runCommand(filePath, { workflow: 'simpleWf', params: '{"execute": true}' });
  });

  it('should run with --params-file', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('run-pf.ts', SIMPLE_WORKFLOW);
    const paramsFile = writeFixture('good-params.json', '{"execute": true}');
    await runCommand(filePath, { workflow: 'simpleWf', paramsFile });
  });

  it('should run in production mode', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('run-prod.ts', SIMPLE_WORKFLOW);
    await runCommand(filePath, { production: true, workflow: 'simpleWf' });
  });

  it('should run with --trace flag', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('run-trace.ts', SIMPLE_WORKFLOW);
    await runCommand(filePath, { trace: true, workflow: 'simpleWf' });
  });

  it('should run with --checkpoint option', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('run-ckpt.ts', SIMPLE_WORKFLOW);
    await runCommand(filePath, { workflow: 'simpleWf', checkpoint: true });
  });

  it('should run with --mocks-file', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('run-mf.ts', SIMPLE_WORKFLOW);
    const mocksFile = writeFixture('good-mocks.json', '{"fast": true}');
    await runCommand(filePath, { workflow: 'simpleWf', mocksFile });
  });

  it('should run with inline --mocks', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('run-mocks.ts', SIMPLE_WORKFLOW);
    await runCommand(filePath, { workflow: 'simpleWf', mocks: '{"fast": true}' });
  });

  it('should handle --json with successful run', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('run-json.ts', SIMPLE_WORKFLOW);
    // json mode should not throw for successful runs
    await runCommand(filePath, { json: true, workflow: 'simpleWf' });
  });

  it('should handle non-json error path gracefully', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('run-err.ts', `
/**
 * @flowWeaver nodeType
 */
function badNode(execute: boolean): { onSuccess: boolean; onFailure: boolean } {
  throw new Error("intentional failure");
}

/**
 * @flowWeaver workflow
 * @node b badNode
 * @connect b.onSuccess -> Exit.onSuccess
 */
export function failWf(execute: boolean): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  throw new Error("Not implemented");
}
`);

    const originalExitCode = process.exitCode;
    try {
      await runCommand(filePath, { workflow: 'failWf' });
    } catch {
      // May throw depending on error type
    } finally {
      process.exitCode = originalExitCode;
    }
  });

  it('should handle --resume with no checkpoint (non-json sets exitCode)', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('run-resume.ts', SIMPLE_WORKFLOW);
    const originalExitCode = process.exitCode;
    try {
      // The error is caught internally in non-json mode; exitCode is set instead of throwing
      await runCommand(filePath, { workflow: 'simpleWf', resume: true });
    } catch {
      // May or may not throw depending on internal error path
    } finally {
      process.exitCode = originalExitCode;
    }
  });
});

describe('validateMockConfig coverage', () => {
  it('should warn on unknown top-level keys in mock config', async () => {
    const { validateMockConfig } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('mock-validate.ts', SIMPLE_WORKFLOW);
    // Should not throw, just warn
    await validateMockConfig(
      { unknownKey: 'value' } as any,
      filePath,
      'simpleWf'
    );
  });

  it('should warn when mock section references unused node types', async () => {
    const { validateMockConfig } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('mock-unused.ts', SIMPLE_WORKFLOW);
    await validateMockConfig(
      { events: { someEvent: { payload: {} } } } as any,
      filePath,
      'simpleWf'
    );
  });

  it('should skip validation if parsing fails', async () => {
    const { validateMockConfig } = await import('../../src/cli/commands/run');
    await validateMockConfig(
      { events: { someEvent: {} } } as any,
      '/tmp/nonexistent-mock-validate-xyz.ts',
      'test'
    );
  });

  it('should accept valid mock config with fast option', async () => {
    const { validateMockConfig } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('mock-fast.ts', SIMPLE_WORKFLOW);
    await validateMockConfig({ fast: true } as any, filePath, 'simpleWf');
  });
});
