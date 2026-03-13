/**
 * Coverage tests for src/cli/commands/run.ts
 * Targets uncovered lines 478-842+: error handling branches, mock validation,
 * JSON output paths, resume/checkpoint flows, stream events, debug helpers.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ---------------------------------------------------------------------------
// Mocks - declared before any imports that reference them
// ---------------------------------------------------------------------------

const mockExecuteWorkflowFromFile = vi.fn();
vi.mock('../../src/mcp/workflow-executor.js', () => ({
  executeWorkflowFromFile: (...args: unknown[]) => mockExecuteWorkflowFromFile(...args),
}));

vi.mock('../../src/mcp/agent-channel.js', () => ({
  AgentChannel: vi.fn().mockImplementation(() => ({
    onPause: () => new Promise(() => {}), // never resolves
    resume: vi.fn(),
  })),
}));

const mockParseWorkflow = vi.fn();
vi.mock('../../src/api/index.js', () => ({
  parseWorkflow: (...args: unknown[]) => mockParseWorkflow(...args),
}));

vi.mock('../../src/api/query.js', () => ({
  getTopologicalOrder: vi.fn().mockReturnValue(['node1', 'node2']),
}));

vi.mock('../../src/runtime/debug-controller.js', () => ({
  DebugController: vi.fn().mockImplementation(() => ({
    onPause: () => new Promise(() => {}),
    resume: vi.fn(),
    addBreakpoint: vi.fn(),
    removeBreakpoint: vi.fn(),
    getBreakpoints: vi.fn().mockReturnValue([]),
    setVariable: vi.fn(),
  })),
}));

vi.mock('../../src/runtime/checkpoint.js', () => ({
  CheckpointWriter: vi.fn().mockImplementation(() => ({})),
  loadCheckpoint: vi.fn(),
  findLatestCheckpoint: vi.fn(),
}));

const mockGetFriendlyError = vi.fn().mockReturnValue(null);
vi.mock('../../src/friendly-errors.js', () => ({
  getFriendlyError: (...args: unknown[]) => mockGetFriendlyError(...args),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEMP_DIR = path.join(os.tmpdir(), `fw-run-cov-${process.pid}`);

function writeFixture(name: string, content: string): string {
  const filePath = path.join(TEMP_DIR, name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return filePath;
}

function makeResult(overrides: Partial<{
  result: unknown;
  functionName: string;
  executionTime: number;
  trace: unknown[];
}> = {}) {
  return {
    result: { answer: 42 },
    functionName: 'testWf',
    executionTime: 123,
    trace: [],
    ...overrides,
  };
}

let stdoutSpy: ReturnType<typeof vi.spyOn>;
let logSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
  mockExecuteWorkflowFromFile.mockClear();
  mockParseWorkflow.mockClear();
  mockGetFriendlyError.mockClear();
  mockGetFriendlyError.mockReturnValue(null);
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  process.exitCode = undefined;
});

afterEach(() => {
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runCommand - input validation', () => {
  it('should throw when file does not exist', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    await expect(
      runCommand('/nonexistent/file.ts', {})
    ).rejects.toThrow(/File not found/);
  });

  it('should output JSON error when file not found in json mode', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    await runCommand('/nonexistent/file.ts', { json: true });
    expect(process.exitCode).toBe(1);
    const output = stdoutSpy.mock.calls.map(c => c[0]).join('');
    expect(output).toContain('"success": false');
  });

  it('should throw on invalid JSON in --params', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('p1.ts', '// wf');
    await expect(
      runCommand(filePath, { params: 'not-json' })
    ).rejects.toThrow(/Invalid JSON in --params/);
  });

  it('should throw when params file not found', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('p2.ts', '// wf');
    await expect(
      runCommand(filePath, { paramsFile: '/nonexistent/params.json' })
    ).rejects.toThrow(/Params file not found/);
  });

  it('should throw when params file has invalid JSON', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('p3.ts', '// wf');
    const paramsFile = writeFixture('bad.json', 'not json');
    await expect(
      runCommand(filePath, { paramsFile })
    ).rejects.toThrow(/Failed to parse params file/);
  });

  it('should throw on invalid JSON in --mocks', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('m1.ts', '// wf');
    await expect(
      runCommand(filePath, { mocks: 'bad-json' })
    ).rejects.toThrow(/Invalid JSON in --mocks/);
  });

  it('should throw when mocks file not found', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('m2.ts', '// wf');
    await expect(
      runCommand(filePath, { mocksFile: '/nonexistent/mocks.json' })
    ).rejects.toThrow(/Mocks file not found/);
  });

  it('should throw when mocks file has invalid JSON', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('m3.ts', '// wf');
    const mocksFile = writeFixture('bad-mocks.json', '{broken');
    await expect(
      runCommand(filePath, { mocksFile })
    ).rejects.toThrow(/Failed to parse mocks file/);
  });
});

describe('runCommand - successful execution', () => {
  it('should parse valid params from --params', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('ok1.ts', '// wf');
    mockExecuteWorkflowFromFile.mockResolvedValue(makeResult());

    await runCommand(filePath, { params: '{"x": 1}', production: true });

    expect(mockExecuteWorkflowFromFile).toHaveBeenCalledWith(
      expect.any(String),
      { x: 1 },
      expect.any(Object)
    );
  });

  it('should parse valid params from --params-file', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('ok2.ts', '// wf');
    const paramsFile = writeFixture('good.json', '{"y": 2}');
    mockExecuteWorkflowFromFile.mockResolvedValue(makeResult());

    await runCommand(filePath, { paramsFile, production: true });

    expect(mockExecuteWorkflowFromFile).toHaveBeenCalledWith(
      expect.any(String),
      { y: 2 },
      expect.any(Object)
    );
  });

  it('should parse valid mocks from --mocks-file', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('ok3.ts', '// wf');
    const mocksFile = writeFixture('ok-mocks.json', '{"fast": true}');
    mockExecuteWorkflowFromFile.mockResolvedValue(makeResult());

    await runCommand(filePath, { mocksFile, production: true, json: true });

    expect(mockExecuteWorkflowFromFile).toHaveBeenCalledWith(
      expect.any(String),
      {},
      expect.objectContaining({ mocks: { fast: true } })
    );
  });

  it('should output human-readable result', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('hr.ts', '// wf');
    mockExecuteWorkflowFromFile.mockResolvedValue(makeResult());

    await runCommand(filePath, { production: true });

    const allLogs = logSpy.mock.calls.map(c => String(c[0] ?? '')).join('\n');
    expect(allLogs).toContain('testWf');
  });

  it('should output JSON result in json mode', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('jr.ts', '// wf');
    mockExecuteWorkflowFromFile.mockResolvedValue(makeResult());

    await runCommand(filePath, { json: true, production: true });

    const output = stdoutSpy.mock.calls.map(c => c[0]).join('');
    const parsed = JSON.parse(output);
    expect(parsed.success).toBe(true);
    expect(parsed.result).toEqual({ answer: 42 });
    expect(parsed.workflow).toBe('testWf');
  });

  it('should include trace count in JSON output when trace is included', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('tr.ts', '// wf');
    const trace = [
      { type: 'STATUS_CHANGED', timestamp: 1000, data: { id: 'n1', status: 'RUNNING' } },
      { type: 'STATUS_CHANGED', timestamp: 1050, data: { id: 'n1', status: 'COMPLETED' } },
    ];
    mockExecuteWorkflowFromFile.mockResolvedValue(makeResult({ trace }));

    await runCommand(filePath, { json: true, trace: true });

    const output = stdoutSpy.mock.calls.map(c => c[0]).join('');
    const parsed = JSON.parse(output);
    expect(parsed.traceCount).toBe(2);
  });

  it('should display trace summary with more-events indicator', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('trs.ts', '// wf');
    const trace = Array.from({ length: 8 }, (_, i) => ({
      type: 'STATUS_CHANGED',
      timestamp: 1000 + i * 10,
      data: { id: `node${i}`, nodeId: `node${i}`, status: 'COMPLETED' },
    }));
    mockExecuteWorkflowFromFile.mockResolvedValue(makeResult({ trace }));

    await runCommand(filePath, { trace: true });

    const allLogs = logSpy.mock.calls.map(c => String(c[0] ?? '')).join('\n');
    expect(allLogs).toContain('events captured');
    expect(allLogs).toContain('more events');
  });

  it('should pass workflow name to executor', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('wn.ts', '// wf');
    mockExecuteWorkflowFromFile.mockResolvedValue(makeResult());

    await runCommand(filePath, { workflow: 'myWorkflow', production: true });

    expect(mockExecuteWorkflowFromFile).toHaveBeenCalledWith(
      expect.any(String),
      {},
      expect.objectContaining({ workflowName: 'myWorkflow' })
    );
  });

  it('should set production flag and disable trace', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('prod.ts', '// wf');
    mockExecuteWorkflowFromFile.mockResolvedValue(makeResult());

    await runCommand(filePath, { production: true });

    expect(mockExecuteWorkflowFromFile).toHaveBeenCalledWith(
      expect.any(String),
      {},
      expect.objectContaining({ production: true, includeTrace: false })
    );
  });

  it('should include trace in production mode with --trace', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('prodt.ts', '// wf');
    mockExecuteWorkflowFromFile.mockResolvedValue(makeResult());

    await runCommand(filePath, { production: true, trace: true });

    expect(mockExecuteWorkflowFromFile).toHaveBeenCalledWith(
      expect.any(String),
      {},
      expect.objectContaining({ includeTrace: true })
    );
  });

  it('should log mock info in non-json mode with mocks', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('mi.ts', '// wf');
    mockExecuteWorkflowFromFile.mockResolvedValue(makeResult());

    await runCommand(filePath, { mocks: '{"fast": true}', production: true });

    const allLogs = logSpy.mock.calls.map(c => String(c[0] ?? '')).join('\n');
    expect(allLogs).toContain('mock');
  });

  it('should not show trace summary when --stream is also set', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('snt.ts', '// wf');
    const trace = [{ type: 'STATUS_CHANGED', timestamp: 1000, data: { id: 'n1' } }];
    mockExecuteWorkflowFromFile.mockResolvedValue(makeResult({ trace }));

    await runCommand(filePath, { stream: true, trace: true });

    const allLogs = logSpy.mock.calls.map(c => String(c[0] ?? '')).join('\n');
    expect(allLogs).not.toContain('events captured');
  });
});

describe('runCommand - stream events', () => {
  it('should fire onEvent for STATUS_CHANGED and VARIABLE_SET', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('se.ts', '// wf');

    mockExecuteWorkflowFromFile.mockImplementation(
      async (_file: string, _params: unknown, opts: { onEvent?: (e: unknown) => void }) => {
        const onEvent = opts.onEvent;
        if (onEvent) {
          onEvent({ type: 'STATUS_CHANGED', timestamp: 1000, data: { id: 'n1', status: 'RUNNING' } });
          onEvent({ type: 'STATUS_CHANGED', timestamp: 1050, data: { id: 'n1', status: 'COMPLETED' } });
          onEvent({ type: 'VARIABLE_SET', timestamp: 1060, data: { nodeId: 'n1', name: 'output' } });
          // Edge: missing fields
          onEvent({ type: 'STATUS_CHANGED', timestamp: 1070, data: {} });
          onEvent({ type: 'VARIABLE_SET', timestamp: 1080, data: {} });
        }
        return makeResult();
      }
    );

    await runCommand(filePath, { stream: true });

    const allLogs = logSpy.mock.calls.map(c => String(c[0] ?? '')).join('\n');
    expect(allLogs).toContain('RUNNING');
    expect(allLogs).toContain('COMPLETED');
    expect(allLogs).toContain('VARIABLE_SET');
  });

  it('should not attach onEvent in json+stream mode', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('nse.ts', '// wf');

    mockExecuteWorkflowFromFile.mockImplementation(
      async (_file: string, _params: unknown, opts: { onEvent?: unknown }) => {
        expect(opts.onEvent).toBeUndefined();
        return makeResult();
      }
    );

    await runCommand(filePath, { stream: true, json: true, production: true });
  });
});

describe('runCommand - error handling', () => {
  it('should handle structured validation errors', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('e1.ts', '// wf');
    const err = Object.assign(new Error('Validation failed'), {
      errors: [{ code: 'UNKNOWN', message: 'Some issue' }],
    });
    mockExecuteWorkflowFromFile.mockRejectedValue(err);

    await runCommand(filePath, { production: true });
    expect(process.exitCode).toBe(1);
  });

  it('should handle error with code property', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('e2.ts', '// wf');
    const err = Object.assign(new Error('Something failed'), { code: 'E001' });
    mockExecuteWorkflowFromFile.mockRejectedValue(err);

    await runCommand(filePath, { production: true });
    expect(process.exitCode).toBe(1);
  });

  it('should output JSON error on execution failure', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('e3.ts', '// wf');
    mockExecuteWorkflowFromFile.mockRejectedValue(new Error('Boom'));

    await runCommand(filePath, { json: true, production: true });

    expect(process.exitCode).toBe(1);
    const output = stdoutSpy.mock.calls.map(c => c[0]).join('');
    const parsed = JSON.parse(output);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toBe('Boom');
  });

  it('should display friendly error for coded error', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    mockGetFriendlyError.mockReturnValueOnce({
      title: 'Friendly Title',
      explanation: 'Friendly explanation',
      fix: 'Do this to fix it',
    });
    const filePath = writeFixture('e4.ts', '// wf');
    const err = Object.assign(new Error('raw'), { code: 'FRIENDLY' });
    mockExecuteWorkflowFromFile.mockRejectedValue(err);

    await runCommand(filePath, { production: true });
    expect(process.exitCode).toBe(1);
    const allErrors = errorSpy.mock.calls.map(c => String(c[0])).join('\n');
    expect(allErrors).toContain('Friendly Title');
  });

  it('should display friendly error for structured errors', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    mockGetFriendlyError.mockReturnValueOnce({
      title: 'Friendly Title',
      explanation: 'Friendly explanation',
      fix: 'Fix it',
    });
    const filePath = writeFixture('e5.ts', '// wf');
    const err = Object.assign(new Error('fail'), {
      errors: [{ code: 'F1', message: 'msg' }],
    });
    mockExecuteWorkflowFromFile.mockRejectedValue(err);

    await runCommand(filePath, { production: true });
    expect(process.exitCode).toBe(1);
  });

  it('should handle non-Error thrown values', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('e6.ts', '// wf');
    mockExecuteWorkflowFromFile.mockRejectedValue('string error');

    await runCommand(filePath, { production: true });
    expect(process.exitCode).toBe(1);
  });

  it('should handle JSON error with structured errors', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('e7.ts', '// wf');
    const err = Object.assign(new Error('Multi error'), {
      errors: [{ code: 'E1', message: 'err1' }, { code: 'E2', message: 'err2' }],
    });
    mockExecuteWorkflowFromFile.mockRejectedValue(err);

    await runCommand(filePath, { json: true, production: true });

    expect(process.exitCode).toBe(1);
    const output = stdoutSpy.mock.calls.map(c => c[0]).join('');
    const parsed = JSON.parse(output);
    expect(parsed.success).toBe(false);
  });
});

describe('runCommand - resume', () => {
  it('should throw when no checkpoint found (auto-detect)', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const { findLatestCheckpoint } = await import('../../src/runtime/checkpoint.js');
    (findLatestCheckpoint as ReturnType<typeof vi.fn>).mockReturnValue(null);
    const filePath = writeFixture('r1.ts', '// wf');

    await expect(
      runCommand(filePath, { resume: true })
    ).rejects.toThrow(/No checkpoint file found/);
  });

  it('should resume from checkpoint and use checkpoint params', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const { findLatestCheckpoint, loadCheckpoint } = await import('../../src/runtime/checkpoint.js');
    (findLatestCheckpoint as ReturnType<typeof vi.fn>).mockReturnValue('/tmp/ckpt.json');
    (loadCheckpoint as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        params: { fromCheckpoint: true },
        workflowName: 'resumedWf',
        completedNodes: ['a', 'b', 'c'],
        executionOrder: ['a', 'b', 'c', 'd'],
      },
      stale: false,
      rerunNodes: ['c'],
      skipNodes: new Map([['a', { out: 1 }], ['b', { out: 2 }]]),
    });
    mockExecuteWorkflowFromFile.mockResolvedValue(makeResult());

    const filePath = writeFixture('r2.ts', '// wf');
    await runCommand(filePath, { resume: true, production: true });

    expect(mockExecuteWorkflowFromFile).toHaveBeenCalledWith(
      expect.any(String),
      { fromCheckpoint: true },
      expect.any(Object)
    );
  });

  it('should resume from explicit checkpoint path and warn on stale', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const { loadCheckpoint } = await import('../../src/runtime/checkpoint.js');
    (loadCheckpoint as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        params: {},
        workflowName: 'wf',
        completedNodes: ['a'],
        executionOrder: ['a', 'b'],
      },
      stale: true,
      rerunNodes: [],
      skipNodes: new Map([['a', {}]]),
    });
    mockExecuteWorkflowFromFile.mockResolvedValue(makeResult());

    const filePath = writeFixture('r3.ts', '// wf');
    // resume with string path
    await runCommand(filePath, { resume: '/tmp/explicit.json' as unknown as boolean, production: true });

    const allWarns = warnSpy.mock.calls.map(c => String(c[0])).join('\n');
    expect(allWarns).toContain('changed since checkpoint');
  });

  it('should include resume metadata in JSON output', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const { findLatestCheckpoint, loadCheckpoint } = await import('../../src/runtime/checkpoint.js');
    (findLatestCheckpoint as ReturnType<typeof vi.fn>).mockReturnValue('/tmp/ckpt-json.json');
    (loadCheckpoint as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        params: { x: 1 },
        workflowName: 'jsonResumeWf',
        completedNodes: ['a', 'b'],
        executionOrder: ['a', 'b', 'c'],
      },
      stale: false,
      rerunNodes: ['b'],
      skipNodes: new Map([['a', {}]]),
    });
    mockExecuteWorkflowFromFile.mockResolvedValue(makeResult());

    const filePath = writeFixture('r4.ts', '// wf');
    await runCommand(filePath, { resume: true, json: true, production: true });

    const output = stdoutSpy.mock.calls.map(c => c[0]).join('');
    const parsed = JSON.parse(output);
    expect(parsed.resumedFrom).toBe('/tmp/ckpt-json.json');
    expect(parsed.rerunNodes).toEqual(['b']);
  });

  it('should prefer user-provided params over checkpoint params', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const { findLatestCheckpoint, loadCheckpoint } = await import('../../src/runtime/checkpoint.js');
    (findLatestCheckpoint as ReturnType<typeof vi.fn>).mockReturnValue('/tmp/ckpt2.json');
    (loadCheckpoint as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        params: { fromCheckpoint: true },
        workflowName: 'wf',
        completedNodes: [],
        executionOrder: ['a'],
      },
      stale: false,
      rerunNodes: [],
      skipNodes: new Map(),
    });
    mockExecuteWorkflowFromFile.mockResolvedValue(makeResult());

    const filePath = writeFixture('r5.ts', '// wf');
    await runCommand(filePath, { resume: true, params: '{"userParam": 99}', production: true });

    expect(mockExecuteWorkflowFromFile).toHaveBeenCalledWith(
      expect.any(String),
      { userParam: 99 },
      expect.any(Object)
    );
  });

  it('should log resume info with rerun nodes', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const { findLatestCheckpoint, loadCheckpoint } = await import('../../src/runtime/checkpoint.js');
    (findLatestCheckpoint as ReturnType<typeof vi.fn>).mockReturnValue('/tmp/ckpt-info.json');
    (loadCheckpoint as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        params: {},
        workflowName: 'wf',
        completedNodes: ['a', 'b'],
        executionOrder: ['a', 'b', 'c'],
      },
      stale: false,
      rerunNodes: ['b'],
      skipNodes: new Map([['a', {}]]),
    });
    mockExecuteWorkflowFromFile.mockResolvedValue(makeResult());

    const filePath = writeFixture('r6.ts', '// wf');
    await runCommand(filePath, { resume: true, production: true });

    const allLogs = logSpy.mock.calls.map(c => String(c[0] ?? '')).join('\n');
    expect(allLogs).toContain('Resuming from checkpoint');
    expect(allLogs).toContain('Re-running 1 nodes');
  });
});

describe('runCommand - debug/checkpoint setup', () => {
  it('should set up debug controller when --checkpoint is set', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    mockParseWorkflow.mockResolvedValue({ errors: [], ast: { instances: [] } });
    mockExecuteWorkflowFromFile.mockResolvedValue(makeResult());

    const filePath = writeFixture('dc1.ts', '// wf');
    await runCommand(filePath, { checkpoint: true, production: true });

    const { DebugController } = await import('../../src/runtime/debug-controller.js');
    expect(DebugController).toHaveBeenCalled();
  });

  it('should set up debug controller when --debug is set (non-TTY)', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    mockParseWorkflow.mockResolvedValue({ errors: [], ast: { instances: [] } });
    mockExecuteWorkflowFromFile.mockResolvedValue(makeResult());

    const origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });

    const filePath = writeFixture('dc2.ts', '// wf');
    await runCommand(filePath, { debug: true, production: true });

    Object.defineProperty(process.stdin, 'isTTY', { value: origIsTTY, configurable: true });
  });

  it('should handle parse errors when setting up debug controller', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    mockParseWorkflow.mockResolvedValue({ errors: [{ message: 'parse error' }], ast: null });
    mockExecuteWorkflowFromFile.mockResolvedValue(makeResult());

    const filePath = writeFixture('dc3.ts', '// wf');
    await runCommand(filePath, { checkpoint: true, production: true });
  });
});

describe('validateMockConfig', () => {
  it('should warn on unknown mock keys', async () => {
    const { validateMockConfig } = await import('../../src/cli/commands/run');
    mockParseWorkflow.mockResolvedValue({ errors: [], ast: { instances: [] } });

    const filePath = writeFixture('vm1.ts', '// wf');
    await validateMockConfig({ typo_key: true } as never, filePath, undefined);

    const allWarns = warnSpy.mock.calls.map(c => String(c[0])).join('\n');
    expect(allWarns).toContain('unknown key');
  });

  it('should warn when events mock has entries but workflow lacks waitForEvent nodes', async () => {
    const { validateMockConfig } = await import('../../src/cli/commands/run');
    mockParseWorkflow.mockResolvedValue({
      errors: [],
      ast: { instances: [{ nodeType: 'delay' }] },
    });

    const filePath = writeFixture('vm2.ts', '// wf');
    await validateMockConfig(
      { events: { someEvent: { data: {} } } } as never,
      filePath,
      undefined
    );

    const allWarns = warnSpy.mock.calls.map(c => String(c[0])).join('\n');
    expect(allWarns).toContain('no waitForEvent nodes');
  });

  it('should not warn when mock section matches workflow node types', async () => {
    const { validateMockConfig } = await import('../../src/cli/commands/run');
    mockParseWorkflow.mockResolvedValue({
      errors: [],
      ast: { instances: [{ nodeType: 'waitForEvent' }] },
    });

    warnSpy.mockClear();
    const filePath = writeFixture('vm3.ts', '// wf');
    await validateMockConfig(
      { events: { someEvent: { data: {} } } } as never,
      filePath,
      undefined
    );

    const allWarns = warnSpy.mock.calls.map(c => String(c[0])).join('\n');
    expect(allWarns).not.toContain('no waitForEvent nodes');
  });

  it('should skip validation when parse fails', async () => {
    const { validateMockConfig } = await import('../../src/cli/commands/run');
    mockParseWorkflow.mockRejectedValue(new Error('parse crash'));

    const filePath = writeFixture('vm4.ts', '// wf');
    await validateMockConfig({ events: {} } as never, filePath, undefined);
  });

  it('should skip validation when parse has errors', async () => {
    const { validateMockConfig } = await import('../../src/cli/commands/run');
    mockParseWorkflow.mockResolvedValue({ errors: [{ message: 'err' }], ast: null });

    const filePath = writeFixture('vm5.ts', '// wf');
    await validateMockConfig({ events: {} } as never, filePath, undefined);
  });

  it('should warn for invocations mock with no invokeWorkflow nodes', async () => {
    const { validateMockConfig } = await import('../../src/cli/commands/run');
    mockParseWorkflow.mockResolvedValue({
      errors: [],
      ast: { instances: [{ nodeType: 'delay' }] },
    });

    const filePath = writeFixture('vm6.ts', '// wf');
    await validateMockConfig(
      { invocations: { someWf: { result: {} } } } as never,
      filePath,
      undefined
    );

    const allWarns = warnSpy.mock.calls.map(c => String(c[0])).join('\n');
    expect(allWarns).toContain('no invokeWorkflow nodes');
  });

  it('should warn for agents mock with no waitForAgent nodes', async () => {
    const { validateMockConfig } = await import('../../src/cli/commands/run');
    mockParseWorkflow.mockResolvedValue({
      errors: [],
      ast: { instances: [{ nodeType: 'delay' }] },
    });

    const filePath = writeFixture('vm7.ts', '// wf');
    await validateMockConfig(
      { agents: { someAgent: { response: {} } } } as never,
      filePath,
      undefined
    );

    const allWarns = warnSpy.mock.calls.map(c => String(c[0])).join('\n');
    expect(allWarns).toContain('no waitForAgent nodes');
  });

  it('should skip when ast has no instances', async () => {
    const { validateMockConfig } = await import('../../src/cli/commands/run');
    mockParseWorkflow.mockResolvedValue({
      errors: [],
      ast: { instances: undefined },
    });

    const filePath = writeFixture('vm8.ts', '// wf');
    // Should not throw
    await validateMockConfig({ events: { e: {} } } as never, filePath, undefined);
  });
});

describe('runCommand - timeout', () => {
  it('should set up and clear timeout after execution', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('to.ts', '// wf');
    mockExecuteWorkflowFromFile.mockResolvedValue(makeResult());

    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

    await runCommand(filePath, { timeout: 30000, production: true });

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 30000);
    expect(clearTimeoutSpy).toHaveBeenCalled();
  });
});
