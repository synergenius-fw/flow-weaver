/**
 * Tests for src/mcp/tools-debug.ts: fw_debug_step and fw_debug_continue
 * success/error paths with live sessions, and fw_resume_from_checkpoint
 * debug-mode and non-debug completion paths.
 *
 * Mocks executeWorkflow, checkpoint utilities, parseWorkflow, and
 * getTopologicalOrder so we can control execution outcomes without compiling
 * real workflows.
 */

import { DebugController } from '../../../src/runtime/debug-controller';
import {
  storeDebugSession,
  removeDebugSession,
} from '../../../src/mcp/debug-session';
import type { DebugSession } from '../../../src/mcp/debug-session';

// ---------------------------------------------------------------------------
// Mocks - must be before imports that use them
// ---------------------------------------------------------------------------

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    readFileSync: vi.fn().mockReturnValue('fake workflow source'),
  };
});

vi.mock('../../../src/mcp/workflow-executor', () => ({
  executeWorkflow: vi.fn(),
}));

vi.mock('../../../src/runtime/checkpoint', () => {
  class MockCheckpointWriter {
    write = vi.fn();
    cleanup = vi.fn();
  }
  return {
    CheckpointWriter: MockCheckpointWriter,
    loadCheckpoint: vi.fn(),
    findLatestCheckpoint: vi.fn(),
  };
});

vi.mock('../../../src/api/index', () => ({
  parseWorkflow: vi.fn(),
}));

vi.mock('../../../src/api/query', () => ({
  getTopologicalOrder: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createFakeMcpServer() {
  const tools: Record<string, (args: any) => Promise<any>> = {};
  const mcp = {
    tool: (name: string, _desc: string, _schema: any, handler: (args: any) => Promise<any>) => {
      tools[name] = handler;
    },
  };
  return { mcp, tools };
}

function parseToolResult(result: any): any {
  const text = result?.content?.[0]?.text;
  return text ? JSON.parse(text) : null;
}

/**
 * Creates a session whose controller is already in a paused state,
 * so resume() calls will work correctly.
 */
function createPausedSession(
  debugId: string,
  opts?: { executionPromise?: Promise<unknown> }
): DebugSession {
  const controller = new DebugController({
    debug: true,
    checkpoint: false,
    executionOrder: ['nodeA', 'nodeB'],
  });

  const session: DebugSession = {
    debugId,
    filePath: '/fake/workflow.ts',
    controller,
    executionPromise: opts?.executionPromise ?? new Promise(() => {}),
    createdAt: Date.now(),
    tmpFiles: [],
    lastPauseState: {
      currentNodeId: 'nodeA',
      phase: 'before',
      position: 0,
      executionOrder: ['nodeA', 'nodeB'],
      completedNodes: [],
      variables: { 'nodeA:out:0': 'hello' },
      breakpoints: [],
    },
  };

  storeDebugSession(session);
  return session;
}

function makeCheckpointData(overrides?: Record<string, unknown>) {
  return {
    version: 1 as const,
    workflowHash: 'abc',
    workflowName: 'myWf',
    filePath: '/fake/workflow.ts',
    params: { x: 1 },
    timestamp: new Date().toISOString(),
    completedNodes: ['nodeA', 'nodeB'],
    executionOrder: ['nodeA', 'nodeB', 'nodeC'],
    position: 2,
    variables: {},
    executionInfo: {},
    executions: {} as Record<string, unknown>,
    executionCounter: 0,
    nodeExecutionCounts: {} as Record<string, number>,
    unsafeNodes: [] as string[],
    ...overrides,
  } as any;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('tools-debug coverage: step, continue, and resume paths', () => {
  let tools: Record<string, (args: any) => Promise<any>>;

  beforeAll(async () => {
    const { registerDebugTools } = await import('../../../src/mcp/tools-debug');
    const fake = createFakeMcpServer();
    registerDebugTools(fake.mcp as any);
    tools = fake.tools;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // fw_debug_step: session exists, execution completes after resume
  // -----------------------------------------------------------------------

  describe('fw_debug_step with existing session', () => {
    it('should return completed when execution finishes after step', async () => {
      const completionResult = {
        kind: 'completed',
        result: { answer: 42 },
      };
      const execPromise = Promise.resolve(completionResult);
      const session = createPausedSession('step-complete', { executionPromise: execPromise });

      vi.spyOn(session.controller, 'onPause').mockReturnValue(new Promise(() => {}));
      vi.spyOn(session.controller, 'resume').mockImplementation(() => {});

      const result = await tools['fw_debug_step']({ debugId: 'step-complete' });
      const data = parseToolResult(result);

      expect(data.success).toBe(true);
      expect(data.data.status).toBe('completed');
      expect(data.data.result).toEqual({ answer: 42 });
    });

    it('should return paused when controller pauses after step', async () => {
      const session = createPausedSession('step-pause');
      const pauseState = {
        currentNodeId: 'nodeB',
        phase: 'before' as const,
        position: 1,
        executionOrder: ['nodeA', 'nodeB'],
        completedNodes: ['nodeA'],
        variables: { 'nodeA:out:0': 'hello' },
        breakpoints: [],
      };

      vi.spyOn(session.controller, 'onPause').mockResolvedValue(pauseState);
      vi.spyOn(session.controller, 'resume').mockImplementation(() => {});

      const result = await tools['fw_debug_step']({ debugId: 'step-pause' });
      const data = parseToolResult(result);

      expect(data.success).toBe(true);
      expect(data.data.status).toBe('paused');
      expect(data.data.state.currentNodeId).toBe('nodeB');

      removeDebugSession('step-pause');
    });

    it('should return error when execution rejects after step', async () => {
      const execPromise = Promise.reject(new Error('node crashed'));
      const session = createPausedSession('step-error', { executionPromise: execPromise });

      vi.spyOn(session.controller, 'onPause').mockReturnValue(new Promise(() => {}));
      vi.spyOn(session.controller, 'resume').mockImplementation(() => {});

      const result = await tools['fw_debug_step']({ debugId: 'step-error' });
      const data = parseToolResult(result);

      expect(data.success).toBe(false);
      expect(data.error.code).toBe('EXECUTION_ERROR');
      expect(data.error.message).toBe('node crashed');
    });

    it('should handle thrown error in resume call', async () => {
      const session = createPausedSession('step-throw');

      vi.spyOn(session.controller, 'resume').mockImplementation(() => {
        throw new Error('resume exploded');
      });

      const result = await tools['fw_debug_step']({ debugId: 'step-throw' });
      const data = parseToolResult(result);

      expect(data.success).toBe(false);
      expect(data.error.code).toBe('STEP_ERROR');
      expect(data.error.message).toBe('resume exploded');
    });
  });

  // -----------------------------------------------------------------------
  // fw_debug_continue: session exists, various outcomes
  // -----------------------------------------------------------------------

  describe('fw_debug_continue with existing session', () => {
    it('should return completed when execution finishes after continue', async () => {
      const execPromise = Promise.resolve({ kind: 'completed', result: 'done' });
      const session = createPausedSession('cont-complete', { executionPromise: execPromise });

      vi.spyOn(session.controller, 'onPause').mockReturnValue(new Promise(() => {}));
      vi.spyOn(session.controller, 'resume').mockImplementation(() => {});

      const result = await tools['fw_debug_continue']({ debugId: 'cont-complete' });
      const data = parseToolResult(result);

      expect(data.success).toBe(true);
      expect(data.data.status).toBe('completed');
      expect(data.data.result).toBe('done');
    });

    it('should return paused at breakpoint when toBreakpoint is true', async () => {
      const session = createPausedSession('cont-bp');
      const pauseState = {
        currentNodeId: 'nodeB',
        phase: 'before' as const,
        position: 1,
        executionOrder: ['nodeA', 'nodeB'],
        completedNodes: ['nodeA'],
        variables: {},
        breakpoints: ['nodeB'],
      };

      vi.spyOn(session.controller, 'onPause').mockResolvedValue(pauseState);
      vi.spyOn(session.controller, 'resume').mockImplementation(() => {});

      const result = await tools['fw_debug_continue']({
        debugId: 'cont-bp',
        toBreakpoint: true,
      });
      const data = parseToolResult(result);

      expect(data.success).toBe(true);
      expect(data.data.status).toBe('paused');
      expect(data.data.state.currentNodeId).toBe('nodeB');

      removeDebugSession('cont-bp');
    });

    it('should return error when execution rejects after continue', async () => {
      const execPromise = Promise.reject(new Error('workflow failed'));
      const session = createPausedSession('cont-error', { executionPromise: execPromise });

      vi.spyOn(session.controller, 'onPause').mockReturnValue(new Promise(() => {}));
      vi.spyOn(session.controller, 'resume').mockImplementation(() => {});

      const result = await tools['fw_debug_continue']({ debugId: 'cont-error' });
      const data = parseToolResult(result);

      expect(data.success).toBe(false);
      expect(data.error.code).toBe('EXECUTION_ERROR');
      expect(data.error.message).toBe('workflow failed');
    });

    it('should handle thrown error in resume call', async () => {
      const session = createPausedSession('cont-throw');

      vi.spyOn(session.controller, 'resume').mockImplementation(() => {
        throw new Error('continue exploded');
      });

      const result = await tools['fw_debug_continue']({ debugId: 'cont-throw' });
      const data = parseToolResult(result);

      expect(data.success).toBe(false);
      expect(data.error.code).toBe('CONTINUE_ERROR');
      expect(data.error.message).toBe('continue exploded');
    });

    it('should use continue action when toBreakpoint is false', async () => {
      const execPromise = Promise.resolve({ result: 'ok' });
      const session = createPausedSession('cont-no-bp', { executionPromise: execPromise });

      const resumeSpy = vi.spyOn(session.controller, 'resume').mockImplementation(() => {});
      vi.spyOn(session.controller, 'onPause').mockReturnValue(new Promise(() => {}));

      await tools['fw_debug_continue']({ debugId: 'cont-no-bp', toBreakpoint: false });

      expect(resumeSpy).toHaveBeenCalledWith({ type: 'continue' });
    });
  });

  // -----------------------------------------------------------------------
  // fw_debug_workflow: completed and error outcomes (lines 202-219)
  // -----------------------------------------------------------------------

  describe('fw_debug_workflow completed/error paths', () => {
    it('should return completed when workflow finishes immediately', async () => {
      const { parseWorkflow } = await import('../../../src/api/index');
      const { getTopologicalOrder } = await import('../../../src/api/query');
      const { executeWorkflow } = await import('../../../src/mcp/workflow-executor');

      vi.mocked(parseWorkflow).mockResolvedValue({
        ast: {} as any,
        errors: [],
        warnings: [],
        availableWorkflows: [],
        allWorkflows: [],
      });
      vi.mocked(getTopologicalOrder).mockReturnValue(['nodeA']);
      vi.mocked(executeWorkflow).mockResolvedValue({
        kind: 'completed',
        result: 'instant',
        functionName: 'test',
        executionTime: 0,
      });

      // Mock onPause to never resolve so the completed promise wins the race
      vi.spyOn(DebugController.prototype, 'onPause').mockReturnValue(new Promise(() => {}));

      const result = await tools['fw_debug_workflow']({
        filePath: '/fake/workflow.ts',
        params: {},
      });
      const data = parseToolResult(result);

      expect(data.success).toBe(true);
      expect(data.data.status).toBe('completed');
      expect(data.data.result).toBe('instant');
    });

    it('should return error when execution rejects immediately', async () => {
      const { parseWorkflow } = await import('../../../src/api/index');
      const { getTopologicalOrder } = await import('../../../src/api/query');
      const { executeWorkflow } = await import('../../../src/mcp/workflow-executor');

      vi.mocked(parseWorkflow).mockResolvedValue({
        ast: {} as any,
        errors: [],
        warnings: [],
        availableWorkflows: [],
        allWorkflows: [],
      });
      vi.mocked(getTopologicalOrder).mockReturnValue(['nodeA']);
      vi.mocked(executeWorkflow).mockRejectedValue(new Error('exec failed'));

      vi.spyOn(DebugController.prototype, 'onPause').mockReturnValue(new Promise(() => {}));

      const result = await tools['fw_debug_workflow']({
        filePath: '/fake/workflow.ts',
        params: {},
      });
      const data = parseToolResult(result);

      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
      // raceDebugPause catches the rejection -> EXECUTION_ERROR
      expect(data.error.code).toBe('EXECUTION_ERROR');
      expect(data.error.message).toBe('exec failed');
    });

    it('should refuse an immediate durable yield', async () => {
      const { parseWorkflow } = await import('../../../src/api/index');
      const { getTopologicalOrder } = await import('../../../src/api/query');
      const { executeWorkflow } = await import('../../../src/mcp/workflow-executor');

      vi.mocked(parseWorkflow).mockResolvedValue({
        ast: {} as any,
        errors: [],
        warnings: [],
        availableWorkflows: [],
        allWorkflows: [],
      });
      vi.mocked(getTopologicalOrder).mockReturnValue(['nodeA']);
      vi.mocked(executeWorkflow).mockResolvedValue({
        kind: 'yielded',
        functionName: 'test',
        executionTime: 0,
      } as never);
      vi.spyOn(DebugController.prototype, 'onPause').mockReturnValue(new Promise(() => {}));

      const result = await tools['fw_debug_workflow']({
        filePath: '/fake/workflow.ts',
        params: {},
      });
      const data = parseToolResult(result);

      expect(data.success).toBe(false);
      expect(data.error.code).toBe('EXECUTION_ERROR');
      expect(data.error.message).toContain('not a durable coordinator');
    });
  });

  // -----------------------------------------------------------------------

});
