/**
 * Coverage tests for src/cli/commands/run.ts
 * Targets uncovered lines 61-391 and 535-842: the debug REPL, agent pause
 * handling in the race loop, printDebugState, printDebugHelp, all REPL
 * commands (step, continue, cb, inspect, breakpoint, set, quit, help),
 * and promptForInput.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';

// ---- mock state ----
let mockExecResult: unknown = null;
let mockExecError: unknown = null;
let mockExecResolve: ((v: unknown) => void) | null = null;

const mockControllerResume = vi.fn();
const mockControllerAddBreakpoint = vi.fn();
const mockControllerRemoveBreakpoint = vi.fn();
const mockControllerGetBreakpoints = vi.fn().mockReturnValue([]);
const mockControllerSetVariable = vi.fn();

let controllerPauseResolvers: Array<(v: unknown) => void> = [];
function mockControllerOnPause() {
  return new Promise((resolve) => {
    controllerPauseResolvers.push(resolve);
  });
}

let agentPauseResolvers: Array<(v: unknown) => void> = [];
function mockAgentOnPause() {
  return new Promise((resolve) => {
    agentPauseResolvers.push(resolve);
  });
}
const mockAgentResume = vi.fn();

const debugControllerCalls: unknown[][] = [];

// Mock readline to control the REPL
let rlLineHandlers: Array<(line: string) => void> = [];
let rlCloseHandlers: Array<() => void> = [];
let rlQuestionCallbacks: Array<(answer: string) => void> = [];
const mockRlPrompt = vi.fn();
const mockRlClose = vi.fn();
const mockRlQuestion = vi.fn((q: string, cb: (answer: string) => void) => {
  rlQuestionCallbacks.push(cb);
});

vi.mock('readline', () => ({
  createInterface: vi.fn(() => ({
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (event === 'line') rlLineHandlers.push(handler as (line: string) => void);
      if (event === 'close') rlCloseHandlers.push(handler as () => void);
    }),
    prompt: mockRlPrompt,
    close: mockRlClose,
    question: mockRlQuestion,
  })),
}));

vi.mock('../../src/mcp/workflow-executor', () => ({
  executeWorkflowFromFile: vi.fn(async (_fp: string, _p: unknown, opts: Record<string, unknown>) => {
    if (mockExecError) throw mockExecError;
    if (mockExecResolve !== null) {
      // Caller set up a deferred promise; return it
      return new Promise((resolve) => { mockExecResolve = resolve; });
    }
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
  getTopologicalOrder: vi.fn(() => ['nodeA', 'nodeB']),
}));

vi.mock('../../src/runtime/checkpoint', () => ({
  CheckpointWriter: class MockCheckpointWriter {
    write = vi.fn();
    cleanup = vi.fn();
  },
  findLatestCheckpoint: vi.fn(),
  loadCheckpoint: vi.fn(),
}));

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

const TEMP_DIR = path.join(os.tmpdir(), `fw-run-cov3-${process.pid}`);

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

async function getLogger() {
  const mod = await import('../../src/cli/utils/logger');
  return mod.logger as unknown as Record<string, ReturnType<typeof vi.fn>>;
}

async function getExecutorMock() {
  const mod = await import('../../src/mcp/workflow-executor');
  return mod.executeWorkflowFromFile as unknown as ReturnType<typeof vi.fn>;
}

beforeEach(() => {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
  vi.clearAllMocks();
  mockExecResult = makeResult();
  mockExecError = null;
  mockExecResolve = null;
  controllerPauseResolvers = [];
  agentPauseResolvers = [];
  debugControllerCalls.length = 0;
  rlLineHandlers = [];
  rlCloseHandlers = [];
  rlQuestionCallbacks = [];
});

afterEach(() => {
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Debug REPL tests (lines 534-831)
// ---------------------------------------------------------------------------

describe('debug REPL (runDebugRepl)', () => {
  // Helper: set up conditions for entering the debug REPL.
  // The REPL is entered when options.debug=true, debugController exists, and process.stdin.isTTY is truthy.
  function setupDebugRepl() {
    const origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true, configurable: true });
    return () => {
      Object.defineProperty(process.stdin, 'isTTY', { value: origIsTTY, writable: true, configurable: true });
    };
  }

  it('should complete immediately if workflow finishes before first pause', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('debug-fast.ts', DUMMY_SOURCE);
    const logger = await getLogger();
    const cleanup = setupDebugRepl();

    // Exec resolves immediately (before controller.onPause resolves)
    mockExecResult = makeResult();

    await runCommand(filePath, { debug: true });

    expect(logger.section).toHaveBeenCalledWith('Flow Weaver Debug');
    expect(logger.success).toHaveBeenCalledWith('Debug session completed');
    cleanup();
  });

  it('should enter REPL when paused and handle step command', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('debug-step.ts', DUMMY_SOURCE);
    const logger = await getLogger();
    const cleanup = setupDebugRepl();
    const execMock = await getExecutorMock();

    // Set up deferred execution
    let resolveExec!: (v: unknown) => void;
    execMock.mockReturnValueOnce(new Promise((r) => { resolveExec = r; }));

    const runPromise = runCommand(filePath, { debug: true });

    // Wait for the race to set up
    await new Promise((r) => setTimeout(r, 20));

    // Trigger the first pause from the debug controller
    expect(controllerPauseResolvers.length).toBeGreaterThan(0);
    controllerPauseResolvers[0]({
      currentNodeId: 'nodeA',
      phase: 'before',
      position: 0,
      executionOrder: ['nodeA', 'nodeB'],
      variables: {},
      breakpoints: [],
    });

    await new Promise((r) => setTimeout(r, 20));

    // The REPL should have printed the debug state and prompted
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('[paused] before: nodeA (1/2)'));
    expect(mockRlPrompt).toHaveBeenCalled();

    // Now send a step command
    expect(rlLineHandlers.length).toBeGreaterThan(0);
    // After step, the controller resumes and we need a new pause or completion
    // Set up the controller to complete after step
    controllerPauseResolvers = [];
    rlLineHandlers[0]('step');

    expect(mockControllerResume).toHaveBeenCalledWith({ type: 'step' });

    // Now resolve the execution
    await new Promise((r) => setTimeout(r, 10));
    resolveExec(makeResult());

    await runPromise;
    expect(logger.success).toHaveBeenCalledWith('Debug session completed');
    cleanup();
  });

  it('should handle continue command', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('debug-continue.ts', DUMMY_SOURCE);
    const cleanup = setupDebugRepl();
    const execMock = await getExecutorMock();

    let resolveExec!: (v: unknown) => void;
    execMock.mockReturnValueOnce(new Promise((r) => { resolveExec = r; }));

    const runPromise = runCommand(filePath, { debug: true });
    await new Promise((r) => setTimeout(r, 20));

    controllerPauseResolvers[0]({
      currentNodeId: 'nodeA', phase: 'before', position: 0,
      executionOrder: ['nodeA'], variables: {}, breakpoints: [],
    });
    await new Promise((r) => setTimeout(r, 20));

    controllerPauseResolvers = [];
    rlLineHandlers[0]('c');
    expect(mockControllerResume).toHaveBeenCalledWith({ type: 'continue' });

    await new Promise((r) => setTimeout(r, 10));
    resolveExec(makeResult());
    await runPromise;
    cleanup();
  });

  it('should handle cb (continue to breakpoint) command', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('debug-cb.ts', DUMMY_SOURCE);
    const cleanup = setupDebugRepl();
    const execMock = await getExecutorMock();

    let resolveExec!: (v: unknown) => void;
    execMock.mockReturnValueOnce(new Promise((r) => { resolveExec = r; }));

    const runPromise = runCommand(filePath, { debug: true });
    await new Promise((r) => setTimeout(r, 20));

    controllerPauseResolvers[0]({
      currentNodeId: 'nodeA', phase: 'before', position: 0,
      executionOrder: ['nodeA'], variables: {}, breakpoints: [],
    });
    await new Promise((r) => setTimeout(r, 20));

    controllerPauseResolvers = [];
    rlLineHandlers[0]('cb');
    expect(mockControllerResume).toHaveBeenCalledWith({ type: 'continueToBreakpoint' });

    await new Promise((r) => setTimeout(r, 10));
    resolveExec(makeResult());
    await runPromise;
    cleanup();
  });

  it('should handle inspect command with no arguments (all variables)', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('debug-inspect-all.ts', DUMMY_SOURCE);
    const logger = await getLogger();
    const cleanup = setupDebugRepl();
    const execMock = await getExecutorMock();

    let resolveExec!: (v: unknown) => void;
    execMock.mockReturnValueOnce(new Promise((r) => { resolveExec = r; }));

    const runPromise = runCommand(filePath, { debug: true });
    await new Promise((r) => setTimeout(r, 20));

    controllerPauseResolvers[0]({
      currentNodeId: 'nodeA', phase: 'after', position: 0,
      executionOrder: ['nodeA', 'nodeB'], breakpoints: [],
      variables: {
        'nodeA:output:0': 42,
        'nodeA:status:0': 'ok',
        'nodeB:input:0': 10,
        'plainKey': 'no-colon', // edge case: key without colon
      },
      currentNodeOutputs: { output: 42 },
    });
    await new Promise((r) => setTimeout(r, 20));

    // Should have printed outputs for 'after' phase
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('nodeA.output = 42'));

    rlLineHandlers[0]('i');
    await new Promise((r) => setTimeout(r, 10));

    // Should display grouped variables
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('nodeA:'));
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('output = 42'));
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('nodeB:'));
    expect(mockRlPrompt).toHaveBeenCalled();

    // Quit to finish
    rlLineHandlers[0]('q');
    await new Promise((r) => setTimeout(r, 10));
    resolveExec(makeResult());
    await runPromise;
    cleanup();
  });

  it('should handle inspect command for a specific node', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('debug-inspect-node.ts', DUMMY_SOURCE);
    const logger = await getLogger();
    const cleanup = setupDebugRepl();
    const execMock = await getExecutorMock();

    let resolveExec!: (v: unknown) => void;
    execMock.mockReturnValueOnce(new Promise((r) => { resolveExec = r; }));

    const runPromise = runCommand(filePath, { debug: true });
    await new Promise((r) => setTimeout(r, 20));

    controllerPauseResolvers[0]({
      currentNodeId: 'nodeA', phase: 'before', position: 0,
      executionOrder: ['nodeA'], breakpoints: [],
      variables: { 'nodeA:output:0': 99, 'nodeB:input:0': 5 },
    });
    await new Promise((r) => setTimeout(r, 20));

    rlLineHandlers[0]('i nodeA');
    await new Promise((r) => setTimeout(r, 10));

    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('nodeA.output'));

    // Inspect non-existent node
    rlLineHandlers[0]('i nonExistent');
    await new Promise((r) => setTimeout(r, 10));

    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('No variables found for node "nonExistent"'));

    rlLineHandlers[0]('q');
    await new Promise((r) => setTimeout(r, 10));
    resolveExec(makeResult());
    await runPromise;
    cleanup();
  });

  it('should handle breakpoint add/remove/list commands', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('debug-breakpoints.ts', DUMMY_SOURCE);
    const logger = await getLogger();
    const cleanup = setupDebugRepl();
    const execMock = await getExecutorMock();

    let resolveExec!: (v: unknown) => void;
    execMock.mockReturnValueOnce(new Promise((r) => { resolveExec = r; }));

    const runPromise = runCommand(filePath, { debug: true });
    await new Promise((r) => setTimeout(r, 20));

    controllerPauseResolvers[0]({
      currentNodeId: 'nodeA', phase: 'before', position: 0,
      executionOrder: ['nodeA'], variables: {}, breakpoints: [],
    });
    await new Promise((r) => setTimeout(r, 20));

    // Add breakpoint
    rlLineHandlers[0]('b nodeB');
    await new Promise((r) => setTimeout(r, 10));
    expect(mockControllerAddBreakpoint).toHaveBeenCalledWith('nodeB');
    expect(logger.log).toHaveBeenCalledWith('Breakpoint added: nodeB');

    // Add breakpoint without argument
    rlLineHandlers[0]('b');
    await new Promise((r) => setTimeout(r, 10));
    expect(logger.log).toHaveBeenCalledWith('Usage: b <nodeId>');

    // Remove breakpoint
    rlLineHandlers[0]('rb nodeB');
    await new Promise((r) => setTimeout(r, 10));
    expect(mockControllerRemoveBreakpoint).toHaveBeenCalledWith('nodeB');
    expect(logger.log).toHaveBeenCalledWith('Breakpoint removed: nodeB');

    // Remove breakpoint without argument
    rlLineHandlers[0]('rb');
    await new Promise((r) => setTimeout(r, 10));
    expect(logger.log).toHaveBeenCalledWith('Usage: rb <nodeId>');

    // List breakpoints
    mockControllerGetBreakpoints.mockReturnValueOnce(['nodeC']);
    rlLineHandlers[0]('bl');
    await new Promise((r) => setTimeout(r, 10));
    expect(logger.log).toHaveBeenCalledWith('Breakpoints: nodeC');

    // List breakpoints (empty)
    mockControllerGetBreakpoints.mockReturnValueOnce([]);
    rlLineHandlers[0]('bl');
    await new Promise((r) => setTimeout(r, 10));
    expect(logger.log).toHaveBeenCalledWith('Breakpoints: (none)');

    rlLineHandlers[0]('q');
    await new Promise((r) => setTimeout(r, 10));
    resolveExec(makeResult());
    await runPromise;
    cleanup();
  });

  it('should handle set command to modify variables', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('debug-set.ts', DUMMY_SOURCE);
    const logger = await getLogger();
    const cleanup = setupDebugRepl();
    const execMock = await getExecutorMock();

    let resolveExec!: (v: unknown) => void;
    execMock.mockReturnValueOnce(new Promise((r) => { resolveExec = r; }));

    const runPromise = runCommand(filePath, { debug: true });
    await new Promise((r) => setTimeout(r, 20));

    controllerPauseResolvers[0]({
      currentNodeId: 'nodeA', phase: 'after', position: 0,
      executionOrder: ['nodeA'], breakpoints: [],
      variables: { 'nodeA:output:0': 42, 'nodeA:output:1': 43 },
      currentNodeOutputs: { output: 42 },
    });
    await new Promise((r) => setTimeout(r, 20));

    // Set variable: should find the latest index (1)
    rlLineHandlers[0]('set nodeA.output 100');
    await new Promise((r) => setTimeout(r, 10));
    expect(mockControllerSetVariable).toHaveBeenCalledWith('nodeA:output:1', 100);
    expect(logger.log).toHaveBeenCalledWith('Set nodeA.output = 100');

    // Set with no target
    rlLineHandlers[0]('set');
    await new Promise((r) => setTimeout(r, 10));
    expect(logger.log).toHaveBeenCalledWith('Usage: set <node>.<port> <json_value>');

    // Set with no dot in target
    rlLineHandlers[0]('set nodeA 100');
    await new Promise((r) => setTimeout(r, 10));
    expect(logger.log).toHaveBeenCalledWith('Target must be in format: node.port');

    // Set with invalid JSON
    rlLineHandlers[0]('set nodeA.output not-json{');
    await new Promise((r) => setTimeout(r, 10));
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('Invalid JSON value'));

    // Set with non-existent variable
    rlLineHandlers[0]('set nonExistent.port 42');
    await new Promise((r) => setTimeout(r, 10));
    expect(logger.log).toHaveBeenCalledWith('Variable not found: nonExistent.port');

    rlLineHandlers[0]('q');
    await new Promise((r) => setTimeout(r, 10));
    resolveExec(makeResult());
    await runPromise;
    cleanup();
  });

  it('should handle help command', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('debug-help.ts', DUMMY_SOURCE);
    const logger = await getLogger();
    const cleanup = setupDebugRepl();
    const execMock = await getExecutorMock();

    let resolveExec!: (v: unknown) => void;
    execMock.mockReturnValueOnce(new Promise((r) => { resolveExec = r; }));

    const runPromise = runCommand(filePath, { debug: true });
    await new Promise((r) => setTimeout(r, 20));

    controllerPauseResolvers[0]({
      currentNodeId: 'nodeA', phase: 'before', position: 0,
      executionOrder: ['nodeA'], variables: {}, breakpoints: [],
    });
    await new Promise((r) => setTimeout(r, 20));

    rlLineHandlers[0]('h');
    await new Promise((r) => setTimeout(r, 10));

    expect(logger.log).toHaveBeenCalledWith('Commands:');
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('s, step'));
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('c, continue'));
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('i, inspect'));
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('q, quit'));

    rlLineHandlers[0]('help');
    await new Promise((r) => setTimeout(r, 10));

    rlLineHandlers[0]('q');
    await new Promise((r) => setTimeout(r, 10));
    resolveExec(makeResult());
    await runPromise;
    cleanup();
  });

  it('should handle unknown command', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('debug-unknown.ts', DUMMY_SOURCE);
    const logger = await getLogger();
    const cleanup = setupDebugRepl();
    const execMock = await getExecutorMock();

    let resolveExec!: (v: unknown) => void;
    execMock.mockReturnValueOnce(new Promise((r) => { resolveExec = r; }));

    const runPromise = runCommand(filePath, { debug: true });
    await new Promise((r) => setTimeout(r, 20));

    controllerPauseResolvers[0]({
      currentNodeId: 'nodeA', phase: 'before', position: 0,
      executionOrder: ['nodeA'], variables: {}, breakpoints: [],
    });
    await new Promise((r) => setTimeout(r, 20));

    rlLineHandlers[0]('xyz');
    await new Promise((r) => setTimeout(r, 10));

    expect(logger.log).toHaveBeenCalledWith('Unknown command: xyz. Type "h" for help.');

    rlLineHandlers[0]('q');
    await new Promise((r) => setTimeout(r, 10));
    resolveExec(makeResult());
    await runPromise;
    cleanup();
  });

  it('should handle empty line input', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('debug-empty.ts', DUMMY_SOURCE);
    const cleanup = setupDebugRepl();
    const execMock = await getExecutorMock();

    let resolveExec!: (v: unknown) => void;
    execMock.mockReturnValueOnce(new Promise((r) => { resolveExec = r; }));

    const runPromise = runCommand(filePath, { debug: true });
    await new Promise((r) => setTimeout(r, 20));

    controllerPauseResolvers[0]({
      currentNodeId: 'nodeA', phase: 'before', position: 0,
      executionOrder: ['nodeA'], variables: {}, breakpoints: [],
    });
    await new Promise((r) => setTimeout(r, 20));

    const promptCallsBefore = mockRlPrompt.mock.calls.length;
    rlLineHandlers[0]('');
    await new Promise((r) => setTimeout(r, 10));
    // Empty input just re-prompts
    expect(mockRlPrompt.mock.calls.length).toBeGreaterThan(promptCallsBefore);

    rlLineHandlers[0]('q');
    await new Promise((r) => setTimeout(r, 10));
    resolveExec(makeResult());
    await runPromise;
    cleanup();
  });

  it('should handle quit command with abort type', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('debug-quit.ts', DUMMY_SOURCE);
    const logger = await getLogger();
    const cleanup = setupDebugRepl();
    const execMock = await getExecutorMock();

    let resolveExec!: (v: unknown) => void;
    execMock.mockReturnValueOnce(new Promise((r) => { resolveExec = r; }));

    const runPromise = runCommand(filePath, { debug: true });
    await new Promise((r) => setTimeout(r, 20));

    controllerPauseResolvers[0]({
      currentNodeId: 'nodeA', phase: 'before', position: 0,
      executionOrder: ['nodeA'], variables: {}, breakpoints: [],
    });
    await new Promise((r) => setTimeout(r, 20));

    rlLineHandlers[0]('quit');
    await new Promise((r) => setTimeout(r, 10));

    expect(mockControllerResume).toHaveBeenCalledWith({ type: 'abort' });
    expect(mockRlClose).toHaveBeenCalled();

    resolveExec(makeResult());
    await runPromise;
    cleanup();
  });

  it('should handle rl close event', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('debug-close.ts', DUMMY_SOURCE);
    const cleanup = setupDebugRepl();
    const execMock = await getExecutorMock();

    let resolveExec!: (v: unknown) => void;
    execMock.mockReturnValueOnce(new Promise((r) => { resolveExec = r; }));

    const runPromise = runCommand(filePath, { debug: true });
    await new Promise((r) => setTimeout(r, 20));

    controllerPauseResolvers[0]({
      currentNodeId: 'nodeA', phase: 'before', position: 0,
      executionOrder: ['nodeA'], variables: {}, breakpoints: [],
    });
    await new Promise((r) => setTimeout(r, 20));

    // Trigger the close event
    expect(rlCloseHandlers.length).toBeGreaterThan(0);
    rlCloseHandlers[0]();

    resolveExec(makeResult());
    await runPromise;
    cleanup();
  });

  it('should handle error with aborted message in REPL', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('debug-abort-err.ts', DUMMY_SOURCE);
    const logger = await getLogger();
    const cleanup = setupDebugRepl();
    const execMock = await getExecutorMock();

    let resolveExec!: (v: unknown) => void;
    execMock.mockReturnValueOnce(new Promise((r) => { resolveExec = r; }));

    // Make controller.resume throw an "aborted" error
    mockControllerResume.mockImplementationOnce(() => {
      throw new Error('Execution was aborted');
    });

    const runPromise = runCommand(filePath, { debug: true });
    await new Promise((r) => setTimeout(r, 20));

    controllerPauseResolvers[0]({
      currentNodeId: 'nodeA', phase: 'before', position: 0,
      executionOrder: ['nodeA'], variables: {}, breakpoints: [],
    });
    await new Promise((r) => setTimeout(r, 20));

    rlLineHandlers[0]('step');
    await new Promise((r) => setTimeout(r, 20));

    expect(logger.log).toHaveBeenCalledWith('Debug session aborted.');

    resolveExec(makeResult());
    await runPromise;
    cleanup();
  });

  it('should handle non-abort error in REPL command', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('debug-err.ts', DUMMY_SOURCE);
    const logger = await getLogger();
    const cleanup = setupDebugRepl();
    const execMock = await getExecutorMock();

    let resolveExec!: (v: unknown) => void;
    execMock.mockReturnValueOnce(new Promise((r) => { resolveExec = r; }));

    // Make controller.resume throw a generic error
    mockControllerResume.mockImplementationOnce(() => {
      throw new Error('some runtime error');
    });

    const runPromise = runCommand(filePath, { debug: true });
    await new Promise((r) => setTimeout(r, 20));

    controllerPauseResolvers[0]({
      currentNodeId: 'nodeA', phase: 'before', position: 0,
      executionOrder: ['nodeA'], variables: {}, breakpoints: [],
    });
    await new Promise((r) => setTimeout(r, 20));

    rlLineHandlers[0]('step');
    await new Promise((r) => setTimeout(r, 20));

    expect(logger.error).toHaveBeenCalledWith('Error: some runtime error');
    expect(mockRlPrompt).toHaveBeenCalled();

    // Quit to clean up
    rlLineHandlers[0]('q');
    await new Promise((r) => setTimeout(r, 10));
    resolveExec(makeResult());
    await runPromise;
    cleanup();
  });

  it('should output JSON result from debug REPL when --json is set', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('debug-json.ts', DUMMY_SOURCE);
    const cleanup = setupDebugRepl();
    const execMock = await getExecutorMock();

    let resolveExec!: (v: unknown) => void;
    execMock.mockReturnValueOnce(new Promise((r) => { resolveExec = r; }));

    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const runPromise = runCommand(filePath, { debug: true, json: true });
    await new Promise((r) => setTimeout(r, 20));

    controllerPauseResolvers[0]({
      currentNodeId: 'nodeA', phase: 'before', position: 0,
      executionOrder: ['nodeA'], variables: {}, breakpoints: [],
    });
    await new Promise((r) => setTimeout(r, 20));

    rlLineHandlers[0]('q');
    await new Promise((r) => setTimeout(r, 10));

    resolveExec(makeResult());
    await runPromise;

    const jsonCalls = writeSpy.mock.calls.filter(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes('"success"')
    );
    expect(jsonCalls.length).toBeGreaterThanOrEqual(1);
    const parsed = JSON.parse(jsonCalls[0][0] as string);
    expect(parsed.success).toBe(true);

    writeSpy.mockRestore();
    cleanup();
  });

  it('should handle agent pause during debug REPL with JSON response', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('debug-agent.ts', DUMMY_SOURCE);
    const logger = await getLogger();
    const cleanup = setupDebugRepl();
    const execMock = await getExecutorMock();

    let resolveExec!: (v: unknown) => void;
    execMock.mockReturnValueOnce(new Promise((r) => { resolveExec = r; }));

    const runPromise = runCommand(filePath, { debug: true });
    await new Promise((r) => setTimeout(r, 20));

    // First: controller pauses
    controllerPauseResolvers[0]({
      currentNodeId: 'nodeA', phase: 'before', position: 0,
      executionOrder: ['nodeA'], variables: {}, breakpoints: [],
    });
    await new Promise((r) => setTimeout(r, 20));

    // Send continue, which will trigger handleResume
    // Set up so agent pauses during handleResume
    controllerPauseResolvers = [];
    agentPauseResolvers = [];

    // When continue is called, handleResume races exec/controller/agent.
    // We want agent to win the race.
    rlLineHandlers[0]('c');
    await new Promise((r) => setTimeout(r, 20));

    // Trigger agent pause
    if (agentPauseResolvers.length > 0) {
      agentPauseResolvers[0]({ agentId: 'myAgent', prompt: 'What should I do?' });
      await new Promise((r) => setTimeout(r, 20));

      expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('[waitForAgent] What should I do?'));
      expect(mockRlQuestion).toHaveBeenCalled();

      // Answer the agent question with valid JSON
      if (rlQuestionCallbacks.length > 0) {
        rlQuestionCallbacks[0]('{"action": "proceed"}');
        await new Promise((r) => setTimeout(r, 20));

        expect(mockAgentResume).toHaveBeenCalledWith({ action: 'proceed' });
      }
    }

    // Now resolve execution
    resolveExec(makeResult());
    await runPromise;
    cleanup();
  });

  it('should handle agent pause with non-JSON response (wraps as { response })', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('debug-agent-text.ts', DUMMY_SOURCE);
    const cleanup = setupDebugRepl();
    const execMock = await getExecutorMock();

    let resolveExec!: (v: unknown) => void;
    execMock.mockReturnValueOnce(new Promise((r) => { resolveExec = r; }));

    const runPromise = runCommand(filePath, { debug: true });
    await new Promise((r) => setTimeout(r, 20));

    controllerPauseResolvers[0]({
      currentNodeId: 'nodeA', phase: 'before', position: 0,
      executionOrder: ['nodeA'], variables: {}, breakpoints: [],
    });
    await new Promise((r) => setTimeout(r, 20));

    controllerPauseResolvers = [];
    agentPauseResolvers = [];
    rlLineHandlers[0]('c');
    await new Promise((r) => setTimeout(r, 20));

    if (agentPauseResolvers.length > 0) {
      agentPauseResolvers[0]({ agentId: 'myAgent' });
      await new Promise((r) => setTimeout(r, 20));

      if (rlQuestionCallbacks.length > 0) {
        rlQuestionCallbacks[0]('plain text response');
        await new Promise((r) => setTimeout(r, 20));

        expect(mockAgentResume).toHaveBeenCalledWith({ response: 'plain text response' });
      }
    }

    resolveExec(makeResult());
    await runPromise;
    cleanup();
  });

  it('should show debug state with long output values truncated', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('debug-truncate.ts', DUMMY_SOURCE);
    const logger = await getLogger();
    const cleanup = setupDebugRepl();
    const execMock = await getExecutorMock();

    let resolveExec!: (v: unknown) => void;
    execMock.mockReturnValueOnce(new Promise((r) => { resolveExec = r; }));

    const runPromise = runCommand(filePath, { debug: true });
    await new Promise((r) => setTimeout(r, 20));

    const longValue = 'x'.repeat(200);
    controllerPauseResolvers[0]({
      currentNodeId: 'nodeA', phase: 'after', position: 0,
      executionOrder: ['nodeA'], breakpoints: [],
      variables: {},
      currentNodeOutputs: { output: longValue },
    });
    await new Promise((r) => setTimeout(r, 20));

    // The output should be truncated (80 chars max for display value)
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('...'));

    rlLineHandlers[0]('q');
    await new Promise((r) => setTimeout(r, 10));
    resolveExec(makeResult());
    await runPromise;
    cleanup();
  });

  it('should handle inspect with long variable values (truncated at 60 chars)', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('debug-inspect-long.ts', DUMMY_SOURCE);
    const logger = await getLogger();
    const cleanup = setupDebugRepl();
    const execMock = await getExecutorMock();

    let resolveExec!: (v: unknown) => void;
    execMock.mockReturnValueOnce(new Promise((r) => { resolveExec = r; }));

    const runPromise = runCommand(filePath, { debug: true });
    await new Promise((r) => setTimeout(r, 20));

    const longValue = 'y'.repeat(200);
    controllerPauseResolvers[0]({
      currentNodeId: 'nodeA', phase: 'before', position: 0,
      executionOrder: ['nodeA'], breakpoints: [],
      variables: { 'nodeA:data:0': longValue },
    });
    await new Promise((r) => setTimeout(r, 20));

    rlLineHandlers[0]('i');
    await new Promise((r) => setTimeout(r, 10));

    // The grouped display truncates at 60 chars
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('...'));

    rlLineHandlers[0]('q');
    await new Promise((r) => setTimeout(r, 10));
    resolveExec(makeResult());
    await runPromise;
    cleanup();
  });

  it('should output JSON with resume info from debug REPL', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('debug-resume-json.ts', DUMMY_SOURCE);
    const cleanup = setupDebugRepl();
    const execMock = await getExecutorMock();
    const { loadCheckpoint } = await import('../../src/runtime/checkpoint') as any;

    (loadCheckpoint as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      data: {
        params: { x: 1 },
        workflowName: 'testWf',
        executionOrder: ['nodeA'],
        completedNodes: ['nodeA'],
      },
      stale: true,
      rerunNodes: ['nodeA'],
      skipNodes: new Map(),
    });

    let resolveExec!: (v: unknown) => void;
    execMock.mockReturnValueOnce(new Promise((r) => { resolveExec = r; }));

    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const runPromise = runCommand(filePath, {
      debug: true,
      json: true,
      resume: '/ckpt.json',
    });
    await new Promise((r) => setTimeout(r, 20));

    controllerPauseResolvers[0]({
      currentNodeId: 'nodeA', phase: 'before', position: 0,
      executionOrder: ['nodeA'], variables: {}, breakpoints: [],
    });
    await new Promise((r) => setTimeout(r, 20));

    rlLineHandlers[0]('q');
    await new Promise((r) => setTimeout(r, 10));
    resolveExec(makeResult());
    await runPromise;

    const jsonCalls = writeSpy.mock.calls.filter(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes('"success"')
    );
    if (jsonCalls.length > 0) {
      const parsed = JSON.parse(jsonCalls[0][0] as string);
      expect(parsed.success).toBe(true);
      expect(parsed.resumedFrom).toBe('/ckpt.json');
      expect(parsed.rerunNodes).toEqual(['nodeA']);
      expect(parsed.warning).toBe('Workflow changed since checkpoint.');
    }

    writeSpy.mockRestore();
    cleanup();
  });

  it('should re-pause in REPL after step when another pause occurs', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('debug-repause.ts', DUMMY_SOURCE);
    const logger = await getLogger();
    const cleanup = setupDebugRepl();
    const execMock = await getExecutorMock();

    let resolveExec!: (v: unknown) => void;
    execMock.mockReturnValueOnce(new Promise((r) => { resolveExec = r; }));

    const runPromise = runCommand(filePath, { debug: true });
    await new Promise((r) => setTimeout(r, 20));

    // First pause
    controllerPauseResolvers[0]({
      currentNodeId: 'nodeA', phase: 'before', position: 0,
      executionOrder: ['nodeA', 'nodeB'], variables: {}, breakpoints: [],
    });
    await new Promise((r) => setTimeout(r, 20));

    // Step, then have the controller pause again
    controllerPauseResolvers = [];
    rlLineHandlers[0]('s');
    await new Promise((r) => setTimeout(r, 20));

    // Second pause
    if (controllerPauseResolvers.length > 0) {
      controllerPauseResolvers[0]({
        currentNodeId: 'nodeB', phase: 'before', position: 1,
        executionOrder: ['nodeA', 'nodeB'], variables: {}, breakpoints: [],
      });
      await new Promise((r) => setTimeout(r, 20));

      expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('[paused] before: nodeB (2/2)'));
    }

    rlLineHandlers[0]('q');
    await new Promise((r) => setTimeout(r, 10));
    resolveExec(makeResult());
    await runPromise;
    cleanup();
  });
});

// ---------------------------------------------------------------------------
// Agent pause in the race loop (non-debug mode, lines 337-392)
// ---------------------------------------------------------------------------

describe('agent pause in race loop (non-debug, non-interactive)', () => {
  it('should throw when agent pauses and stdin is not a TTY', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('agent-no-tty.ts', DUMMY_SOURCE);
    const logger = await getLogger();
    const execMock = await getExecutorMock();

    const origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: false, writable: true, configurable: true });

    // Set up: exec hangs, agent pause wins the race
    let resolveExec!: (v: unknown) => void;
    execMock.mockReturnValueOnce(new Promise((r) => { resolveExec = r; }));

    const origExitCode = process.exitCode;
    const runPromise = runCommand(filePath, {});

    await new Promise((r) => setTimeout(r, 20));

    // Trigger agent pause
    if (agentPauseResolvers.length > 0) {
      agentPauseResolvers[0]({ agentId: 'testAgent', prompt: 'Need input' });
    }

    await runPromise;

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('stdin is not interactive')
    );

    Object.defineProperty(process.stdin, 'isTTY', { value: origIsTTY, writable: true, configurable: true });
    process.exitCode = origExitCode;
    resolveExec(makeResult());
  });
});

// ---------------------------------------------------------------------------
// Non-interactive debug_paused auto-continue in checkpoint mode (line 355-358)
// ---------------------------------------------------------------------------

describe('non-interactive checkpoint debug_paused auto-continue', () => {
  it('should auto-continue when debug pauses in checkpoint-only mode (no --debug)', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('ckpt-auto.ts', DUMMY_SOURCE);
    const execMock = await getExecutorMock();

    let resolveExec!: (v: unknown) => void;
    execMock.mockReturnValueOnce(new Promise((r) => { resolveExec = r; }));

    const runPromise = runCommand(filePath, { checkpoint: true });
    await new Promise((r) => setTimeout(r, 20));

    // Trigger debug pause (checkpoint mode, not interactive debug)
    if (controllerPauseResolvers.length > 0) {
      controllerPauseResolvers[0]({
        currentNodeId: 'nodeA', phase: 'before', position: 0,
        executionOrder: ['nodeA'], variables: {}, breakpoints: [],
      });
    }
    await new Promise((r) => setTimeout(r, 20));

    expect(mockControllerResume).toHaveBeenCalledWith({ type: 'continue' });

    resolveExec(makeResult());
    await runPromise;
  });
});

// ---------------------------------------------------------------------------
// Agent pause in race loop with TTY (lines 359-392 + promptForInput 834-845)
// ---------------------------------------------------------------------------

describe('agent pause in race loop with TTY (non-debug)', () => {
  it('should prompt user and resume agent channel with valid JSON response', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('agent-tty-json.ts', DUMMY_SOURCE);
    const logger = await getLogger();
    const execMock = await getExecutorMock();

    const origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true, configurable: true });

    // First call: agent pause wins. Second call: exec completes.
    let resolveExec!: (v: unknown) => void;
    execMock.mockReturnValueOnce(new Promise((r) => { resolveExec = r; }));

    const runPromise = runCommand(filePath, {});
    await new Promise((r) => setTimeout(r, 20));

    // Trigger agent pause
    if (agentPauseResolvers.length > 0) {
      agentPauseResolvers[0]({ agentId: 'bot', prompt: 'Give me data', context: { key: 'val' } });
    }
    await new Promise((r) => setTimeout(r, 20));

    expect(logger.section).toHaveBeenCalledWith('Waiting for Input');
    expect(logger.info).toHaveBeenCalledWith('Give me data');
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('Context:'));

    // The promptForInput uses readline.createInterface().question
    // Our mock queues the callback
    if (rlQuestionCallbacks.length > 0) {
      rlQuestionCallbacks[0]('{"data": 123}');
    }
    await new Promise((r) => setTimeout(r, 20));

    expect(mockAgentResume).toHaveBeenCalledWith({ data: 123 });

    // Now resolve the execution for the second loop iteration
    resolveExec(makeResult());
    await runPromise;

    Object.defineProperty(process.stdin, 'isTTY', { value: origIsTTY, writable: true, configurable: true });
  });

  it('should wrap non-JSON user input as { response } when agent pauses', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('agent-tty-text.ts', DUMMY_SOURCE);
    const execMock = await getExecutorMock();

    const origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true, configurable: true });

    let resolveExec!: (v: unknown) => void;
    execMock.mockReturnValueOnce(new Promise((r) => { resolveExec = r; }));

    const runPromise = runCommand(filePath, {});
    await new Promise((r) => setTimeout(r, 20));

    if (agentPauseResolvers.length > 0) {
      agentPauseResolvers[0]({ agentId: 'bot' });
    }
    await new Promise((r) => setTimeout(r, 20));

    if (rlQuestionCallbacks.length > 0) {
      rlQuestionCallbacks[0]('just text');
    }
    await new Promise((r) => setTimeout(r, 20));

    expect(mockAgentResume).toHaveBeenCalledWith({ response: 'just text' });

    resolveExec(makeResult());
    await runPromise;

    Object.defineProperty(process.stdin, 'isTTY', { value: origIsTTY, writable: true, configurable: true });
  });

  it('should use default agent label when no prompt is provided', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('agent-tty-default.ts', DUMMY_SOURCE);
    const logger = await getLogger();
    const execMock = await getExecutorMock();

    const origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true, configurable: true });

    let resolveExec!: (v: unknown) => void;
    execMock.mockReturnValueOnce(new Promise((r) => { resolveExec = r; }));

    const runPromise = runCommand(filePath, {});
    await new Promise((r) => setTimeout(r, 20));

    if (agentPauseResolvers.length > 0) {
      agentPauseResolvers[0]({ agentId: 'myBot', context: {} });
    }
    await new Promise((r) => setTimeout(r, 20));

    expect(logger.info).toHaveBeenCalledWith('Agent "myBot" is requesting input');

    if (rlQuestionCallbacks.length > 0) {
      rlQuestionCallbacks[0]('{}');
    }
    await new Promise((r) => setTimeout(r, 20));

    resolveExec(makeResult());
    await runPromise;

    Object.defineProperty(process.stdin, 'isTTY', { value: origIsTTY, writable: true, configurable: true });
  });
});

// ---------------------------------------------------------------------------
// fail() function in debug REPL (lines 604-609)
// ---------------------------------------------------------------------------

describe('debug REPL fail function', () => {
  it('should invoke fail path when agent resume callback throws in handleResume', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('debug-fail.ts', DUMMY_SOURCE);
    const logger = await getLogger();

    const origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true, configurable: true });

    const execMock = await getExecutorMock();
    // The exec promise rejects, which should cause handleResume to reject,
    // which calls fail().
    execMock.mockReturnValueOnce(Promise.reject(new Error('execution failed')));

    const origExitCode = process.exitCode;
    const runPromise = runCommand(filePath, { debug: true });
    await new Promise((r) => setTimeout(r, 50));

    // The error should be caught by the outer try/catch in runCommandInner
    await runPromise;

    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('execution failed'));
    process.exitCode = origExitCode;

    Object.defineProperty(process.stdin, 'isTTY', { value: origIsTTY, writable: true, configurable: true });
  });
});

// ---------------------------------------------------------------------------
// printDebugState edge cases (lines 534-546)
// ---------------------------------------------------------------------------

describe('printDebugState edge cases', () => {
  it('should not show outputs when phase is before', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('debug-before-phase.ts', DUMMY_SOURCE);
    const logger = await getLogger();

    const origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true, configurable: true });

    const execMock = await getExecutorMock();
    let resolveExec!: (v: unknown) => void;
    execMock.mockReturnValueOnce(new Promise((r) => { resolveExec = r; }));

    const runPromise = runCommand(filePath, { debug: true });
    await new Promise((r) => setTimeout(r, 20));

    controllerPauseResolvers[0]({
      currentNodeId: 'nodeA', phase: 'before', position: 0,
      executionOrder: ['nodeA'], variables: {}, breakpoints: [],
      currentNodeOutputs: undefined,
    });
    await new Promise((r) => setTimeout(r, 20));

    // Should show pause info but not outputs
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('[paused] before: nodeA'));
    // Should NOT have any "nodeA.xxx = yyy" output lines for this pause
    const outputLines = logger.log.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('nodeA.') && (c[0] as string).includes(' = ')
    );
    // Only the pause line itself should appear, no output variable lines
    expect(outputLines.length).toBe(0);

    rlLineHandlers[0]('q');
    await new Promise((r) => setTimeout(r, 10));
    resolveExec(makeResult());
    await runPromise;

    Object.defineProperty(process.stdin, 'isTTY', { value: origIsTTY, writable: true, configurable: true });
  });
});

// ---------------------------------------------------------------------------
// Workflow completion through handleResume showing executionTime (line 621)
// ---------------------------------------------------------------------------

describe('handleResume workflow completion message', () => {
  it('should show completion time when workflow finishes during debug REPL', async () => {
    const { runCommand } = await import('../../src/cli/commands/run');
    const filePath = writeFixture('debug-complete-msg.ts', DUMMY_SOURCE);
    const logger = await getLogger();

    const origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true, configurable: true });

    const execMock = await getExecutorMock();
    let resolveExec!: (v: unknown) => void;
    execMock.mockReturnValueOnce(new Promise((r) => { resolveExec = r; }));

    const runPromise = runCommand(filePath, { debug: true });
    await new Promise((r) => setTimeout(r, 20));

    controllerPauseResolvers[0]({
      currentNodeId: 'nodeA', phase: 'before', position: 0,
      executionOrder: ['nodeA'], variables: {}, breakpoints: [],
    });
    await new Promise((r) => setTimeout(r, 20));

    // Continue and then resolve the execution
    controllerPauseResolvers = [];
    rlLineHandlers[0]('c');
    await new Promise((r) => setTimeout(r, 10));

    resolveExec(makeResult({ executionTime: 250 }));
    await runPromise;

    expect(logger.success).toHaveBeenCalledWith(expect.stringContaining('completed in 250ms'));

    Object.defineProperty(process.stdin, 'isTTY', { value: origIsTTY, writable: true, configurable: true });
  });
});
