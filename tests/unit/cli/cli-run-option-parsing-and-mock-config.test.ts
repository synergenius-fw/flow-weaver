/**
 * Tests for src/cli/commands/run.ts
 * Targets: runCommand error handling, validateMockConfig, stream callbacks,
 * JSON output paths, and production mode.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { captureConsole, type ConsoleCapture } from '../../helpers/console-capture';

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

/** What a command printed, through the logger (console) and to stdout directly, and the exit code it set. */
async function captured(run: () => Promise<void>): Promise<{ out: string; exitCode: number | string | undefined }> {
  const lines: string[] = [];
  const keep = (...a: unknown[]) => { lines.push(a.map(String).join(' ')); };
  const spies = [
    vi.spyOn(console, 'log').mockImplementation(keep),
    vi.spyOn(console, 'error').mockImplementation(keep),
    vi.spyOn(console, 'warn').mockImplementation(keep),
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => { lines.push(String(chunk)); return true; }),
  ];
  const before = process.exitCode;
  process.exitCode = undefined;
  try {
    await run();
    return { out: lines.join('\n'), exitCode: process.exitCode };
  } finally {
    process.exitCode = before;
    for (const s of spies) s.mockRestore();
  }
}

describe('runCommand', () => {
  const load = async () => (await import('../../../src/cli/commands/run')).runCommand;

  it('throws for a file that does not exist', async () => {
    const runCommand = await load();
    await expect(runCommand('/tmp/nonexistent-file-abc123.ts', {})).rejects.toThrow(/File not found/);
  });

  it('names the flag or file when --params or --mocks cannot be read', async () => {
    const runCommand = await load();
    const filePath = writeFixture('flags.ts', SIMPLE_WORKFLOW);
    await expect(runCommand(filePath, { params: 'not valid json{' })).rejects.toThrow(/Invalid JSON in --params/);
    await expect(runCommand(filePath, { paramsFile: '/tmp/nonexistent-params-xyz.json' })).rejects.toThrow(/Params file not found/);
    await expect(runCommand(filePath, { paramsFile: writeFixture('bad-params.json', 'not json content') })).rejects.toThrow(/Failed to parse params file/);
    await expect(runCommand(filePath, { mocks: '{invalid json' })).rejects.toThrow(/Invalid JSON in --mocks/);
    await expect(runCommand(filePath, { mocksFile: '/tmp/nonexistent-mocks-xyz.json' })).rejects.toThrow(/Mocks file not found/);
    await expect(runCommand(filePath, { mocksFile: writeFixture('bad-mocks.json', 'this is not json') })).rejects.toThrow(/Failed to parse mocks file/);
  });

  it('refuses --params that is JSON but not an object', async () => {
    const runCommand = await load();
    const filePath = writeFixture('params-list.ts', SIMPLE_WORKFLOW);
    await expect(runCommand(filePath, { params: '[1, 2]', workflow: 'simpleWf' })).rejects.toThrow('--params must be a JSON object');
  });

  it('reports a failure as JSON on stdout with --json, and exits 1', async () => {
    const runCommand = await load();
    const { out, exitCode } = await captured(() => runCommand('/tmp/nonexistent-json-test.ts', { json: true }));
    expect(JSON.parse(out)).toEqual({ success: false, error: expect.stringContaining('File not found') });
    expect(exitCode).toBe(1);
  });

  it('prints the result as JSON with --json', async () => {
    const runCommand = await load();
    const filePath = writeFixture('run-json.ts', SIMPLE_WORKFLOW);
    const { out, exitCode } = await captured(() => runCommand(filePath, { json: true, workflow: 'simpleWf' }));
    expect(JSON.parse(out)).toMatchObject({ success: true, workflow: 'simpleWf', result: { onSuccess: true } });
    expect(exitCode).toBeUndefined();
  });

  it('streams each step as it changes with --stream', async () => {
    const runCommand = await load();
    const filePath = writeFixture('run-stream.ts', SIMPLE_WORKFLOW);
    const { out } = await captured(() => runCommand(filePath, { stream: true, workflow: 'simpleWf' }));
    expect(out).toContain('[STATUS_CHANGED] p: → RUNNING');
    expect(out).toContain('Workflow "simpleWf" completed');
  });

  it('runs with --params, --params-file and in production mode', async () => {
    const runCommand = await load();
    const filePath = writeFixture('run-params.ts', SIMPLE_WORKFLOW);
    for (const options of [{ params: '{"execute": true}' }, { paramsFile: writeFixture('good-params.json', '{"execute": true}') }, { production: true }]) {
      const { out, exitCode } = await captured(() => runCommand(filePath, { workflow: 'simpleWf', ...options }));
      expect(out, JSON.stringify(options)).toContain('Workflow "simpleWf" completed');
      expect(exitCode).toBeUndefined();
    }
  });

  it('summarises the trace with --trace', async () => {
    const runCommand = await load();
    const filePath = writeFixture('run-trace.ts', SIMPLE_WORKFLOW);
    const { out } = await captured(() => runCommand(filePath, { trace: true, workflow: 'simpleWf' }));
    expect(out).toMatch(/\d+ events captured/);
  });

  it('says it is running with mocks, from a file or inline', async () => {
    const runCommand = await load();
    const filePath = writeFixture('run-mocks.ts', SIMPLE_WORKFLOW);
    for (const options of [{ mocksFile: writeFixture('good-mocks.json', '{"fast": true}') }, { mocks: '{"fast": true}' }]) {
      const { out } = await captured(() => runCommand(filePath, { workflow: 'simpleWf', ...options }));
      expect(out).toContain('Running with mock data');
      expect(out).toContain('Workflow "simpleWf" completed');
    }
  });

  it('reports a workflow that throws, and exits 1 without throwing itself', async () => {
    const runCommand = await load();
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
    const { out, exitCode } = await captured(() => runCommand(filePath, { workflow: 'failWf' }));
    expect(out).toContain('Workflow execution failed');
    expect(out).toContain('intentional failure');
    expect(exitCode).toBe(1);
  });
});

describe('validateMockConfig coverage', () => {
  let out: ConsoleCapture;
  beforeEach(() => { out = captureConsole(); });
  afterEach(() => out.restore());

  it('should warn on unknown top-level keys in mock config', async () => {
    const { validateMockConfig } = await import('../../../src/cli/commands/run');
    const filePath = writeFixture('mock-validate.ts', SIMPLE_WORKFLOW);
    // A typo is a warning, not an error.
    await validateMockConfig(
      { unknownKey: 'value' } as any,
      filePath,
      'simpleWf'
    );

    expect(out.of('warn')).toContain('Mock config has unknown key "unknownKey". Valid keys: events, invocations, agents, gates, fast');
  });

  it('should warn when mock section references unused node types', async () => {
    const { validateMockConfig } = await import('../../../src/cli/commands/run');
    const filePath = writeFixture('mock-unused.ts', SIMPLE_WORKFLOW);
    await validateMockConfig(
      { events: { someEvent: { payload: {} } } } as any,
      filePath,
      'simpleWf'
    );

    expect(out.of('warn')).toContain('Mock config has "events" entries but workflow has no waitForEvent nodes');
  });

  it('should skip validation if parsing fails', async () => {
    const { validateMockConfig } = await import('../../../src/cli/commands/run');
    await validateMockConfig(
      { events: { someEvent: {} } } as any,
      '/tmp/nonexistent-mock-validate-xyz.ts',
      'test'
    );

    // Nothing to check the sections against, so nothing is said.
    expect(out.of('warn')).toBe('');
  });

  it('should accept valid mock config with fast option', async () => {
    const { validateMockConfig } = await import('../../../src/cli/commands/run');
    const filePath = writeFixture('mock-fast.ts', SIMPLE_WORKFLOW);
    await validateMockConfig({ fast: true } as any, filePath, 'simpleWf');

    expect(out.of('warn')).toBe('');
  });
});
