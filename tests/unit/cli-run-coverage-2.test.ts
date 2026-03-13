/**
 * Additional coverage tests for src/cli/commands/run.ts
 * Targets lines 464-842: error formatting, streaming onEvent callback,
 * result output (JSON + human-readable), trace summary display,
 * checkpoint/resume integration, and validateMockConfig.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Track mock calls
let mockExecResult: unknown = null;
let mockExecError: unknown = null;
let capturedExecOpts: Record<string, unknown> = {};

const mockControllerResume = vi.fn();
const mockControllerOnPause = vi.fn(() => new Promise(() => {}));
const mockControllerAddBreakpoint = vi.fn();
const mockControllerRemoveBreakpoint = vi.fn();
const mockControllerGetBreakpoints = vi.fn().mockReturnValue([]);
const mockControllerSetVariable = vi.fn();

// Track DebugController constructor calls
const debugControllerCalls: unknown[][] = [];

const mockAgentOnPause = vi.fn(() => new Promise(() => {}));
const mockAgentResume = vi.fn();

vi.mock('../../src/mcp/workflow-executor', () => ({
  executeWorkflowFromFile: vi.fn(async (_fp: string, _p: unknown, opts: Record<string, unknown>) => {
    capturedExecOpts = opts;
    // Fire onEvent if provided
    if (opts.onEvent && typeof opts.onEvent === 'function' && mockExecResult) {
      // Events will be fired via test setup
    }
    if (mockExecError) throw mockExecError;
    return mockExecResult;
  }),
}));

vi.mock('../../src/api/index', () => ({
  parseWorkflow: vi.fn(async () => ({
    errors: [],
    ast: { instances: [{ nodeType: 'proc' }] },
  })),
}));

vi.mock('../../src/api/query', () => ({
  getTopologicalOrder: vi.fn(() => ['p']),
}));

vi.mock('../../src/runtime/checkpoint', () => {
  const mockFindLatest = vi.fn();
  const mockLoad = vi.fn();
  return {
    CheckpointWriter: class MockCheckpointWriter {
      write = vi.fn();
      cleanup = vi.fn();
      constructor() {}
    },
    findLatestCheckpoint: mockFindLatest,
    loadCheckpoint: mockLoad,
  };
});

vi.mock('../../src/friendly-errors', () => ({
  getFriendlyError: vi.fn(() => null),
}));

vi.mock('../../src/cli/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    log: vi.fn(),
    newline: vi.fn(),
    section: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../src/mcp/agent-channel', () => ({
  AgentChannel: class MockAgentChannel {
    onPause = mockAgentOnPause;
    resume = mockAgentResume;
  },
}));

vi.mock('../../src/runtime/debug-controller', () => ({
  DebugController: class MockDebugController {
    resume = mockControllerResume;
    onPause = mockControllerOnPause;
    addBreakpoint = mockControllerAddBreakpoint;
    removeBreakpoint = mockControllerRemoveBreakpoint;
    getBreakpoints = mockControllerGetBreakpoints;
    setVariable = mockControllerSetVariable;
    constructor(...args: unknown[]) {
      debugControllerCalls.push(args);
    }
  },
}));

const TEMP_DIR = path.join(os.tmpdir(), `fw-run-cov2-${process.pid}`);

function writeFixture(name: string, content: string): string {
  const filePath = path.join(TEMP_DIR, name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return filePath;
}

const DUMMY_SOURCE = 'export function dummy() {}';

function makeResult(overrides: Record<string, unknown> = {}) {
  return {
    result: { answer: 42 },
    functionName: 'testWf',
    executionTime: 100,
    trace: [],
    ...overrides,
  };
}

beforeEach(() => {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
  vi.clearAllMocks();
  mockExecResult = makeResult();
  mockExecError = null;
  capturedExecOpts = {};
  debugControllerCalls.length = 0;
  mockAgentOnPause.mockImplementation(() => new Promise(() => {}));
  mockControllerOnPause.mockImplementation(() => new Promise(() => {}));
});

afterEach(() => {
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
});

// Helper to get the mocked logger
async function getLogger() {
  const mod = await import('../../src/cli/utils/logger');
  return mod.logger as unknown as Record<string, ReturnType<typeof vi.fn>>;
}

async function getFriendlyErrorMock() {
  const mod = await import('../../src/friendly-errors');
  return mod.getFriendlyError as unknown as ReturnType<typeof vi.fn>;
}

async function getExecutorMock() {
  const mod = await import('../../src/mcp/workflow-executor');
  return mod.executeWorkflowFromFile as unknown as ReturnType<typeof vi.fn>;
}

async function getCheckpointMocks() {
  const mod = await import('../../src/runtime/checkpoint');
  return {
    findLatestCheckpoint: mod.findLatestCheckpoint as unknown as ReturnType<typeof vi.fn>,
    loadCheckpoint: mod.loadCheckpoint as unknown as ReturnType<typeof vi.fn>,
  };
}

async function getParseWorkflowMock() {
  const mod = await import('../../src/api/index');
  return mod.parseWorkflow as unknown as ReturnType<typeof vi.fn>;
}

describe('runCommand error formatting (lines 439-484)', () => {
  it('should format structured validation errors with friendly messages', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('err-structured.ts', DUMMY_SOURCE);
    const logger = await getLogger();
    const friendlyMock = await getFriendlyErrorMock();

    const structuredError = Object.assign(
      new Error('Validation failed'),
      {
        errors: [
          { code: 'MISSING_CONNECTION', message: 'Node "a" has no connection' },
          { code: 'UNKNOWN_CODE', message: 'Something weird' },
        ],
      }
    );

    mockExecError = structuredError;
    friendlyMock
      .mockReturnValueOnce({ title: 'Missing Connection', explanation: 'Node a is not connected', fix: 'Add a connection', code: 'MISSING_CONNECTION' })
      .mockReturnValueOnce(null);

    const origExitCode = process.exitCode;
    await runCommand(filePath, {});

    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Workflow execution failed'));
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Missing Connection'));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('How to fix'));
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Something weird'));
    expect(process.exitCode).toBe(1);
    process.exitCode = origExitCode;
  });

  it('should format error with .code property using friendly errors', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('err-code.ts', DUMMY_SOURCE);
    const logger = await getLogger();
    const friendlyMock = await getFriendlyErrorMock();

    mockExecError = Object.assign(new Error('Bad type'), { code: 'TYPE_MISMATCH' });
    friendlyMock.mockReturnValueOnce({
      title: 'Type Mismatch',
      explanation: 'Types do not match',
      fix: 'Check port types',
      code: 'TYPE_MISMATCH',
    });

    const origExitCode = process.exitCode;
    await runCommand(filePath, {});
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Type Mismatch'));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('How to fix'));
    process.exitCode = origExitCode;
  });

  it('should format error with .code but no friendly match', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('err-code-nofriendly.ts', DUMMY_SOURCE);
    const logger = await getLogger();

    mockExecError = Object.assign(new Error('Unknown problem'), { code: 'WEIRD_CODE' });

    const origExitCode = process.exitCode;
    await runCommand(filePath, {});
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Unknown problem'));
    process.exitCode = origExitCode;
  });

  it('should output JSON error for execution failures in --json mode', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('err-json.ts', DUMMY_SOURCE);

    mockExecError = new Error('boom');

    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const origExitCode = process.exitCode;

    await runCommand(filePath, { json: true });

    const jsonCalls = writeSpy.mock.calls.filter(
      (c) => typeof c[0] === 'string' && c[0].includes('"success"')
    );
    expect(jsonCalls.length).toBeGreaterThanOrEqual(1);
    const parsed = JSON.parse(jsonCalls[0][0] as string);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain('boom');

    writeSpy.mockRestore();
    process.exitCode = origExitCode;
  });

  it('should handle plain error without .code or .errors', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('err-plain.ts', DUMMY_SOURCE);
    const logger = await getLogger();

    mockExecError = new Error('plain failure');

    const origExitCode = process.exitCode;
    await runCommand(filePath, {});
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('plain failure'));
    process.exitCode = origExitCode;
  });
});

describe('streaming onEvent callback (lines 271-296)', () => {
  it('should log STATUS_CHANGED RUNNING events during streaming', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('stream-events.ts', DUMMY_SOURCE);
    const logger = await getLogger();
    const execMock = await getExecutorMock();

    execMock.mockImplementationOnce(async (_fp: string, _p: unknown, opts: Record<string, unknown>) => {
      const onEvent = opts.onEvent as (e: unknown) => void;
      if (onEvent) {
        onEvent({ type: 'STATUS_CHANGED', timestamp: 1000, data: { id: 'nodeA', status: 'RUNNING' } });
        onEvent({ type: 'STATUS_CHANGED', timestamp: 1050, data: { id: 'nodeA', status: 'SUCCEEDED' } });
        onEvent({ type: 'VARIABLE_SET', timestamp: 1060, data: { nodeId: 'nodeA', name: 'output' } });
        // Edge cases: missing fields
        onEvent({ type: 'STATUS_CHANGED', timestamp: 1070, data: {} });
        onEvent({ type: 'VARIABLE_SET', timestamp: 1080, data: {} });
      }
      return makeResult();
    });

    await runCommand(filePath, { stream: true });

    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('nodeA: → RUNNING'));
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('nodeA: → SUCCEEDED'));
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('[VARIABLE_SET] nodeA.output'));
  });

  it('should not create onEvent callback when json mode is set with stream', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('stream-json.ts', DUMMY_SOURCE);
    const execMock = await getExecutorMock();

    let capturedOnEvent: unknown = 'not-set';
    execMock.mockImplementationOnce(async (_fp: string, _p: unknown, opts: Record<string, unknown>) => {
      capturedOnEvent = opts.onEvent;
      return makeResult();
    });

    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await runCommand(filePath, { stream: true, json: true });
    expect(capturedOnEvent).toBeUndefined();
    writeSpy.mockRestore();
  });

  it('should show duration for non-RUNNING status when start time exists', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('stream-duration.ts', DUMMY_SOURCE);
    const logger = await getLogger();
    const execMock = await getExecutorMock();

    execMock.mockImplementationOnce(async (_fp: string, _p: unknown, opts: Record<string, unknown>) => {
      const onEvent = opts.onEvent as (e: unknown) => void;
      if (onEvent) {
        onEvent({ type: 'STATUS_CHANGED', timestamp: 1000, data: { id: 'nodeB', status: 'RUNNING' } });
        onEvent({ type: 'STATUS_CHANGED', timestamp: 1200, data: { id: 'nodeB', status: 'SUCCEEDED' } });
        // Node with no start time (no RUNNING event first)
        onEvent({ type: 'STATUS_CHANGED', timestamp: 1300, data: { id: 'nodeC', status: 'FAILED' } });
      }
      return makeResult();
    });

    await runCommand(filePath, { stream: true });

    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('(200ms)'));
    // nodeC has no start time, so no duration
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('nodeC: → FAILED'));
  });
});

describe('successful result output (lines 397-437)', () => {
  it('should output JSON result for successful --json run', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('result-json.ts', DUMMY_SOURCE);

    mockExecResult = makeResult({
      trace: [{ type: 'STATUS_CHANGED', timestamp: 1, data: { id: 'n1' } }],
    });

    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await runCommand(filePath, { json: true });

    const jsonCalls = writeSpy.mock.calls.filter(
      (c) => typeof c[0] === 'string' && c[0].includes('"success"')
    );
    expect(jsonCalls.length).toBe(1);
    const parsed = JSON.parse(jsonCalls[0][0] as string);
    expect(parsed.success).toBe(true);
    expect(parsed.workflow).toBe('testWf');
    expect(parsed.executionTime).toBe(100);
    expect(parsed.result).toEqual({ answer: 42 });
    expect(parsed.traceCount).toBe(1);

    writeSpy.mockRestore();
  });

  it('should display human-readable output with trace summary when --trace is set', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('result-trace.ts', DUMMY_SOURCE);
    const logger = await getLogger();

    const traceEvents = [
      { type: 'STATUS_CHANGED', timestamp: 1, data: { id: 'n1' } },
      { type: 'STATUS_CHANGED', timestamp: 2, data: { id: 'n2' } },
      { type: 'VARIABLE_SET', timestamp: 3, data: { nodeId: 'n1', name: 'x' } },
      { type: 'STATUS_CHANGED', timestamp: 4, data: { id: 'n3' } },
      { type: 'STATUS_CHANGED', timestamp: 5, data: { id: 'n4' } },
      { type: 'STATUS_CHANGED', timestamp: 6, data: { id: 'n5' } },
      { type: 'STATUS_CHANGED', timestamp: 7, data: { id: 'n6' } },
      { type: 'OTHER', timestamp: 8, data: {} },
    ];

    mockExecResult = makeResult({ trace: traceEvents });

    await runCommand(filePath, { trace: true });

    expect(logger.success).toHaveBeenCalledWith(expect.stringContaining('completed in 100ms'));
    expect(logger.section).toHaveBeenCalledWith('Result');
    expect(logger.section).toHaveBeenCalledWith('Trace');
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('8 events captured'));
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('and 2 more events'));
  });

  it('should not show trace section when --stream is set (already printed live)', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('result-stream-no-trace.ts', DUMMY_SOURCE);
    const logger = await getLogger();
    const execMock = await getExecutorMock();

    execMock.mockImplementationOnce(async () =>
      makeResult({ trace: [{ type: 'STATUS_CHANGED', timestamp: 1, data: { id: 'n1' } }] })
    );

    await runCommand(filePath, { trace: true, stream: true });

    const sectionCalls = logger.section.mock.calls.map((c: unknown[]) => c[0]);
    expect(sectionCalls).not.toContain('Trace');
  });

  it('should show "Running with mock data" when mocks are provided', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('result-mocks.ts', DUMMY_SOURCE);
    const logger = await getLogger();

    await runCommand(filePath, { mocks: '{"fast": true}' });

    expect(logger.info).toHaveBeenCalledWith('Running with mock data');
  });

  it('should not show trace section when trace is empty', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('result-empty-trace.ts', DUMMY_SOURCE);
    const logger = await getLogger();

    mockExecResult = makeResult({ trace: [] });

    await runCommand(filePath, { trace: true });

    expect(logger.success).toHaveBeenCalled();
    const sectionCalls = logger.section.mock.calls.map((c: unknown[]) => c[0]);
    expect(sectionCalls).toContain('Result');
    expect(sectionCalls).not.toContain('Trace');
  });

  it('should not show trace section when trace is undefined', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('result-no-trace.ts', DUMMY_SOURCE);
    const logger = await getLogger();

    mockExecResult = makeResult({ trace: undefined });

    await runCommand(filePath, { trace: true });

    expect(logger.success).toHaveBeenCalled();
    const sectionCalls = logger.section.mock.calls.map((c: unknown[]) => c[0]);
    expect(sectionCalls).not.toContain('Trace');
  });

  it('should show <= 5 trace events without "more" message', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('result-few-trace.ts', DUMMY_SOURCE);
    const logger = await getLogger();

    const traceEvents = [
      { type: 'STATUS_CHANGED', timestamp: 1, data: { id: 'n1' } },
      { type: 'STATUS_CHANGED', timestamp: 2, data: { id: 'n2' } },
    ];

    mockExecResult = makeResult({ trace: traceEvents });

    await runCommand(filePath, { trace: true });

    expect(logger.section).toHaveBeenCalledWith('Trace');
    const moreCalls = logger.log.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('more events')
    );
    expect(moreCalls.length).toBe(0);
  });
});

describe('checkpoint and resume (lines 168-220)', () => {
  it('should resume from checkpoint with specific path', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('resume-path.ts', DUMMY_SOURCE);
    const logger = await getLogger();
    const { loadCheckpoint } = await getCheckpointMocks();

    loadCheckpoint.mockReturnValueOnce({
      data: {
        params: { x: 10 },
        workflowName: 'testWf',
        executionOrder: ['a', 'b', 'c'],
        completedNodes: ['a', 'b'],
      },
      stale: false,
      rerunNodes: [],
      skipNodes: new Map([['a', { out: 1 }], ['b', { out: 2 }]]),
    });

    await runCommand(filePath, { resume: '/some/checkpoint.json' });

    expect(loadCheckpoint).toHaveBeenCalledWith('/some/checkpoint.json', filePath);
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Resuming from checkpoint'));
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Skipping 2 completed nodes'));
  });

  it('should resume with stale warning and rerun nodes', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('resume-stale.ts', DUMMY_SOURCE);
    const logger = await getLogger();
    const { loadCheckpoint } = await getCheckpointMocks();

    loadCheckpoint.mockReturnValueOnce({
      data: {
        params: { x: 10 },
        workflowName: 'testWf',
        executionOrder: ['a', 'b', 'c'],
        completedNodes: ['a', 'b'],
      },
      stale: true,
      rerunNodes: ['b'],
      skipNodes: new Map([['a', { out: 1 }]]),
    });

    await runCommand(filePath, { resume: '/some/checkpoint.json' });

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Workflow file has changed'));
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Re-running 1 nodes'));
  });

  it('should throw when no checkpoint found for auto-detect resume', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('resume-none.ts', DUMMY_SOURCE);
    const logger = await getLogger();
    const { findLatestCheckpoint } = await getCheckpointMocks();

    findLatestCheckpoint.mockReturnValueOnce(null);

    const origExitCode = process.exitCode;
    await runCommand(filePath, { resume: true });
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('No checkpoint file found'));
    process.exitCode = origExitCode;
  });

  it('should set up debug controller for --checkpoint mode', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('checkpoint-mode.ts', DUMMY_SOURCE);

    await runCommand(filePath, { checkpoint: true });

    expect(debugControllerCalls.length).toBeGreaterThan(0);
  });

  it('should auto-continue on debug_paused in non-interactive checkpoint mode', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('checkpoint-autocontinue.ts', DUMMY_SOURCE);
    const execMock = await getExecutorMock();

    // The race loop: first iteration debug pauses, second iteration exec completes
    let pauseResolve!: (v: unknown) => void;
    mockControllerOnPause.mockImplementationOnce(() => new Promise((r) => { pauseResolve = r; }));

    const result = makeResult();
    let execResolve!: (v: unknown) => void;
    execMock.mockReturnValueOnce(new Promise((r) => { execResolve = r; }));

    const runPromise = runCommand(filePath, { checkpoint: true });

    // Wait a tick then trigger the debug pause
    await new Promise((r) => setTimeout(r, 10));
    pauseResolve({
      currentNodeId: 'a', phase: 'before', completedNodes: [],
      executionOrder: ['a'], position: 0, variables: {}, breakpoints: [],
    });

    // Wait for auto-continue
    await new Promise((r) => setTimeout(r, 10));
    expect(mockControllerResume).toHaveBeenCalledWith({ type: 'continue' });

    // Now resolve execution
    execResolve(result);
    await runPromise;
  });

  it('should include resume info in JSON output', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('resume-json.ts', DUMMY_SOURCE);
    const { loadCheckpoint } = await getCheckpointMocks();

    loadCheckpoint.mockReturnValueOnce({
      data: {
        params: {},
        workflowName: 'testWf',
        executionOrder: ['a'],
        completedNodes: ['a'],
      },
      stale: false,
      rerunNodes: ['a'],
      skipNodes: new Map(),
    });

    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await runCommand(filePath, { json: true, resume: '/ckpt.json' });

    const jsonCalls = writeSpy.mock.calls.filter(
      (c) => typeof c[0] === 'string' && c[0].includes('"success"')
    );
    expect(jsonCalls.length).toBeGreaterThanOrEqual(1);
    const parsed = JSON.parse(jsonCalls[0][0] as string);
    expect(parsed.success).toBe(true);
    expect(parsed.resumedFrom).toBe('/ckpt.json');
    expect(parsed.rerunNodes).toEqual(['a']);

    writeSpy.mockRestore();
  });

  it('should use checkpoint params when no params provided', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('resume-params.ts', DUMMY_SOURCE);
    const { loadCheckpoint } = await getCheckpointMocks();
    const execMock = await getExecutorMock();

    loadCheckpoint.mockReturnValueOnce({
      data: {
        params: { fromCheckpoint: true },
        workflowName: 'testWf',
        executionOrder: ['a'],
        completedNodes: [],
      },
      stale: false,
      rerunNodes: [],
      skipNodes: new Map(),
    });

    let capturedParams: unknown;
    execMock.mockImplementationOnce(async (_fp: string, p: unknown) => {
      capturedParams = p;
      return makeResult();
    });

    await runCommand(filePath, { resume: '/ckpt.json' });

    expect(capturedParams).toEqual({ fromCheckpoint: true });
  });
});

describe('debug controller parse fallback (lines 236-247)', () => {
  it('should use empty execution order when parsing fails', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('debug-parse-fail.ts', DUMMY_SOURCE);
    const parseMock = await getParseWorkflowMock();

    parseMock.mockResolvedValueOnce({
      errors: [{ code: 'ERR', message: 'parse failed' }],
      ast: null,
    });

    await runCommand(filePath, { checkpoint: true });

    expect(debugControllerCalls.length).toBeGreaterThan(0);
    expect(debugControllerCalls[0][0]).toEqual(expect.objectContaining({
      executionOrder: [],
    }));
  });
});

describe('production mode (lines 226-229)', () => {
  it('should pass production=true and not include trace by default', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('production.ts', DUMMY_SOURCE);
    const execMock = await getExecutorMock();

    let opts: Record<string, unknown> = {};
    execMock.mockImplementationOnce(async (_fp: string, _p: unknown, o: Record<string, unknown>) => {
      opts = o;
      return makeResult();
    });

    await runCommand(filePath, { production: true });

    expect(opts.production).toBe(true);
    expect(opts.includeTrace).toBe(false);
  });

  it('should include trace when --stream is set even in production mode', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('production-stream.ts', DUMMY_SOURCE);
    const execMock = await getExecutorMock();

    let opts: Record<string, unknown> = {};
    execMock.mockImplementationOnce(async (_fp: string, _p: unknown, o: Record<string, unknown>) => {
      opts = o;
      return makeResult();
    });

    await runCommand(filePath, { production: true, stream: true });

    expect(opts.includeTrace).toBe(true);
  });
});

describe('timeout handling (lines 154-166)', () => {
  it('should clear timeout after successful execution', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('timeout-clear.ts', DUMMY_SOURCE);
    const logger = await getLogger();

    await runCommand(filePath, { timeout: 999999 });

    expect(logger.success).toHaveBeenCalled();
  });
});

describe('displayPath helper (lines 22-28)', () => {
  it('should show relative path when shorter', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = path.join(process.cwd(), 'nonexistent-test-file.ts');
    await expect(runCommand(filePath, {})).rejects.toThrow('nonexistent-test-file.ts');
  });
});

describe('runCommand outer json error handler (lines 85-97)', () => {
  it('should catch errors from runCommandInner and output JSON', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const origExitCode = process.exitCode;

    await runCommand('/tmp/nonexistent-json-outer-catch.ts', { json: true });

    const jsonCall = consoleSpy.mock.calls.find(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes('"success"')
    );
    expect(jsonCall).toBeDefined();
    const parsed = JSON.parse(jsonCall![0] as string);
    expect(parsed.success).toBe(false);

    consoleSpy.mockRestore();
    process.exitCode = origExitCode;
  });
});

describe('validateMockConfig (lines 487-528)', () => {
  it('should warn for mock section referencing unused node type', async () => {
    const { validateMockConfig } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('validate-unused.ts', DUMMY_SOURCE);
    const logger = await getLogger();
    const parseMock = await getParseWorkflowMock();

    parseMock.mockResolvedValueOnce({
      errors: [],
      ast: { instances: [{ nodeType: 'delay' }] },
    });

    await validateMockConfig(
      { events: { myEvent: { payload: {} } } } as any,
      filePath,
    );

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('has "events" entries but workflow has no waitForEvent nodes')
    );
  });

  it('should not warn when mock section matches workflow node types', async () => {
    const { validateMockConfig } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('validate-match.ts', DUMMY_SOURCE);
    const logger = await getLogger();
    const parseMock = await getParseWorkflowMock();

    parseMock.mockResolvedValueOnce({
      errors: [],
      ast: { instances: [{ nodeType: 'waitForEvent' }] },
    });

    await validateMockConfig(
      { events: { myEvent: { payload: {} } } } as any,
      filePath,
    );

    const warnCalls = logger.warn.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('but workflow has no')
    );
    expect(warnCalls.length).toBe(0);
  });

  it('should check invocations and agents mock sections', async () => {
    const { validateMockConfig } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('validate-all-sections.ts', DUMMY_SOURCE);
    const logger = await getLogger();
    const parseMock = await getParseWorkflowMock();

    parseMock.mockResolvedValueOnce({
      errors: [],
      ast: { instances: [{ nodeType: 'delay' }] },
    });

    await validateMockConfig(
      {
        invocations: { wf1: { result: {} } },
        agents: { agent1: { response: {} } },
      } as any,
      filePath,
    );

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('has "invocations" entries but workflow has no invokeWorkflow nodes')
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('has "agents" entries but workflow has no waitForAgent nodes')
    );
  });

  it('should skip validation when ast has no instances', async () => {
    const { validateMockConfig } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('validate-no-instances.ts', DUMMY_SOURCE);
    const parseMock = await getParseWorkflowMock();

    parseMock.mockResolvedValueOnce({
      errors: [],
      ast: { instances: undefined },
    });

    await validateMockConfig({ events: { e: {} } } as any, filePath);
    // Should not throw
  });

  it('should warn on unknown top-level keys', async () => {
    const { validateMockConfig } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('validate-unknown-keys.ts', DUMMY_SOURCE);
    const logger = await getLogger();
    const parseMock = await getParseWorkflowMock();

    parseMock.mockResolvedValueOnce({
      errors: [],
      ast: { instances: [] },
    });

    await validateMockConfig(
      { unknownKey: 'value', anotherBad: 123 } as any,
      filePath,
    );

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('unknown key "unknownKey"'));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('unknown key "anotherBad"'));
  });

  it('should handle parse errors gracefully', async () => {
    const { validateMockConfig } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('validate-parse-error.ts', DUMMY_SOURCE);
    const parseMock = await getParseWorkflowMock();

    parseMock.mockRejectedValueOnce(new Error('parse failed'));

    // Should not throw
    await validateMockConfig({ events: { e: {} } } as any, filePath);
  });

  it('should return early when parse has errors', async () => {
    const { validateMockConfig } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('validate-has-errors.ts', DUMMY_SOURCE);
    const logger = await getLogger();
    const parseMock = await getParseWorkflowMock();

    parseMock.mockResolvedValueOnce({
      errors: [{ code: 'ERR', message: 'bad' }],
      ast: { instances: [] },
    });

    await validateMockConfig(
      { events: { myEvent: {} } } as any,
      filePath,
    );

    // Should NOT warn about unused mock sections because parse had errors
    const warnCalls = logger.warn.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('but workflow has no')
    );
    expect(warnCalls.length).toBe(0);
  });
});
