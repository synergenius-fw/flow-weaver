/**
 * Additional coverage tests for src/mcp/tools-debug.ts.
 * Targets uncovered lines 205-324 (fw_debug_step and fw_debug_continue
 * success/error paths with live sessions) and 567-620 (fw_resume_from_checkpoint
 * debug-mode and non-debug completion paths).
 *
 * Mocks executeWorkflowFromFile, checkpoint utilities, parseWorkflow, and
 * getTopologicalOrder so we can control execution outcomes without compiling
 * real workflows.
 */

import { DebugController } from '../../src/runtime/debug-controller';
import {
  storeDebugSession,
  removeDebugSession,
} from '../../src/mcp/debug-session';
import type { DebugSession } from '../../src/mcp/debug-session';

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

vi.mock('../../src/mcp/workflow-executor', () => ({
  executeWorkflowFromFile: vi.fn(),
}));

vi.mock('../../src/runtime/checkpoint', () => {
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

vi.mock('../../src/api/index', () => ({
  parseWorkflow: vi.fn(),
}));

vi.mock('../../src/api/query', () => ({
  getTopologicalOrder: vi.fn(),
}));

vi.mock('../../src/mcp/agent-channel', () => {
  class MockAgentChannel {}
  return { AgentChannel: MockAgentChannel };
});

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
    version: 1,
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
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('tools-debug coverage: step, continue, and resume paths', () => {
  let tools: Record<string, (args: any) => Promise<any>>;

  beforeAll(async () => {
    const { registerDebugTools } = await import('../../src/mcp/tools-debug');
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
      const completionResult = { result: { answer: 42 } };
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
      const execPromise = Promise.resolve({ result: 'done' });
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
      const { parseWorkflow } = await import('../../src/api/index');
      const { getTopologicalOrder } = await import('../../src/api/query');
      const { executeWorkflowFromFile } = await import('../../src/mcp/workflow-executor');

      vi.mocked(parseWorkflow).mockResolvedValue({
        ast: {} as any,
        errors: [],
        warnings: [],
      });
      vi.mocked(getTopologicalOrder).mockReturnValue(['nodeA']);
      vi.mocked(executeWorkflowFromFile).mockResolvedValue({ result: 'instant' });

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
      const { parseWorkflow } = await import('../../src/api/index');
      const { getTopologicalOrder } = await import('../../src/api/query');
      const { executeWorkflowFromFile } = await import('../../src/mcp/workflow-executor');

      vi.mocked(parseWorkflow).mockResolvedValue({
        ast: {} as any,
        errors: [],
        warnings: [],
      });
      vi.mocked(getTopologicalOrder).mockReturnValue(['nodeA']);
      vi.mocked(executeWorkflowFromFile).mockRejectedValue(new Error('exec failed'));

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
  });

  // -----------------------------------------------------------------------
  // fw_resume_from_checkpoint: debug mode paused/completed/error (lines 567-606)
  // and non-debug completion (lines 608-627)
  // -----------------------------------------------------------------------

  describe('fw_resume_from_checkpoint with debug mode', () => {
    it('should return paused state with debug info when resuming in debug mode', async () => {
      const { loadCheckpoint, findLatestCheckpoint } = await import('../../src/runtime/checkpoint');
      const { executeWorkflowFromFile } = await import('../../src/mcp/workflow-executor');

      vi.mocked(findLatestCheckpoint).mockReturnValue('/fake/.fw-checkpoints/ckpt.json');
      vi.mocked(loadCheckpoint).mockReturnValue({
        data: makeCheckpointData(),
        stale: true,
        rerunNodes: ['nodeB'],
        skipNodes: new Map([['nodeA', { out: 'val' }]]),
      });

      // Return a never-resolving promise so onPause wins the race
      vi.mocked(executeWorkflowFromFile).mockReturnValue(new Promise(() => {}));

      const pauseState = {
        currentNodeId: 'nodeC',
        phase: 'before' as const,
        position: 2,
        executionOrder: ['nodeA', 'nodeB', 'nodeC'],
        completedNodes: ['nodeA', 'nodeB'],
        variables: {},
        breakpoints: [],
      };

      vi.spyOn(DebugController.prototype, 'onPause').mockResolvedValue(pauseState);

      const result = await tools['fw_resume_from_checkpoint']({
        filePath: '/fake/workflow.ts',
        debug: true,
      });
      const data = parseToolResult(result);

      expect(data.success).toBe(true);
      expect(data.data.status).toBe('paused');
      expect(data.data.resumedFrom).toBe('/fake/.fw-checkpoints/ckpt.json');
      expect(data.data.skippedNodes).toBe(1); // 2 completed - 1 rerun
      expect(data.data.rerunNodes).toEqual(['nodeB']);
      expect(data.data.warning).toContain('changed since checkpoint');
      expect(data.data.state.currentNodeId).toBe('nodeC');
    });

    it('should return completed when resume debug finishes immediately', async () => {
      const { loadCheckpoint, findLatestCheckpoint } = await import('../../src/runtime/checkpoint');
      const { executeWorkflowFromFile } = await import('../../src/mcp/workflow-executor');

      vi.mocked(findLatestCheckpoint).mockReturnValue('/fake/.fw-checkpoints/ckpt.json');
      vi.mocked(loadCheckpoint).mockReturnValue({
        data: makeCheckpointData({
          completedNodes: ['nodeA'],
          executionOrder: ['nodeA', 'nodeB'],
          position: 1,
        }),
        stale: false,
        rerunNodes: [],
        skipNodes: new Map([['nodeA', {}]]),
      });

      vi.mocked(executeWorkflowFromFile).mockResolvedValue({ result: 'resumed-ok' });
      vi.spyOn(DebugController.prototype, 'onPause').mockReturnValue(new Promise(() => {}));

      const result = await tools['fw_resume_from_checkpoint']({
        filePath: '/fake/workflow.ts',
        debug: true,
      });
      const data = parseToolResult(result);

      expect(data.success).toBe(true);
      expect(data.data.status).toBe('completed');
      // The result is extracted via (r as {result?}).result ?? r
      expect(data.data.result).toBe('resumed-ok');
      expect(data.data.resumedFrom).toBe('/fake/.fw-checkpoints/ckpt.json');
    });

    it('should return error when resume debug execution fails', async () => {
      const { loadCheckpoint, findLatestCheckpoint } = await import('../../src/runtime/checkpoint');
      const { executeWorkflowFromFile } = await import('../../src/mcp/workflow-executor');

      vi.mocked(findLatestCheckpoint).mockReturnValue('/fake/.fw-checkpoints/ckpt.json');
      vi.mocked(loadCheckpoint).mockReturnValue({
        data: makeCheckpointData({
          completedNodes: ['nodeA'],
          executionOrder: ['nodeA', 'nodeB'],
          position: 1,
        }),
        stale: false,
        rerunNodes: [],
        skipNodes: new Map([['nodeA', {}]]),
      });

      // Use a deferred promise that rejects, so it doesn't reject synchronously
      // before being assigned to session.executionPromise
      let rejectFn: (err: Error) => void;
      const execPromise = new Promise((_resolve, reject) => {
        rejectFn = reject;
      });
      vi.mocked(executeWorkflowFromFile).mockReturnValue(execPromise as Promise<unknown>);
      vi.spyOn(DebugController.prototype, 'onPause').mockReturnValue(new Promise(() => {}));

      // Start the tool call, then reject
      const resultPromise = tools['fw_resume_from_checkpoint']({
        filePath: '/fake/workflow.ts',
        debug: true,
      });

      // Reject after a microtask so raceDebugPause is already listening
      await Promise.resolve();
      rejectFn!(new Error('resume boom'));

      const result = await resultPromise;
      const data = parseToolResult(result);

      expect(data.success).toBe(false);
      expect(data.error.code).toBe('EXECUTION_ERROR');
      expect(data.error.message).toBe('resume boom');
    });
  });

  describe('fw_resume_from_checkpoint non-debug mode', () => {
    it('should run to completion and clean up checkpoint', async () => {
      const { loadCheckpoint, findLatestCheckpoint } = await import('../../src/runtime/checkpoint');
      const { executeWorkflowFromFile } = await import('../../src/mcp/workflow-executor');

      vi.mocked(findLatestCheckpoint).mockReturnValue('/fake/.fw-checkpoints/ckpt.json');
      vi.mocked(loadCheckpoint).mockReturnValue({
        data: makeCheckpointData(),
        stale: true,
        rerunNodes: ['nodeB'],
        skipNodes: new Map([['nodeA', { out: 'v' }]]),
      });

      vi.mocked(executeWorkflowFromFile).mockResolvedValue({ result: 'final' });

      const result = await tools['fw_resume_from_checkpoint']({
        filePath: '/fake/workflow.ts',
      });
      const data = parseToolResult(result);

      expect(data.success).toBe(true);
      expect(data.data.status).toBe('completed');
      expect(data.data.resumedFrom).toBe('/fake/.fw-checkpoints/ckpt.json');
      expect(data.data.skippedNodes).toBe(1); // 2 completed - 1 rerun
      expect(data.data.rerunNodes).toEqual(['nodeB']);
      expect(data.data.warning).toContain('changed since checkpoint');
      expect(data.data.result).toBe('final');
    });

    it('should handle result without .result property', async () => {
      const { loadCheckpoint, findLatestCheckpoint } = await import('../../src/runtime/checkpoint');
      const { executeWorkflowFromFile } = await import('../../src/mcp/workflow-executor');

      vi.mocked(findLatestCheckpoint).mockReturnValue('/fake/ckpt.json');
      vi.mocked(loadCheckpoint).mockReturnValue({
        data: makeCheckpointData({
          completedNodes: [],
          executionOrder: ['n'],
          position: 0,
          params: {},
        }),
        stale: false,
        rerunNodes: [],
        skipNodes: new Map(),
      });

      // Return a value that has no .result property
      vi.mocked(executeWorkflowFromFile).mockResolvedValue('bare-value');

      const result = await tools['fw_resume_from_checkpoint']({
        filePath: '/fake/workflow.ts',
      });
      const data = parseToolResult(result);

      expect(data.success).toBe(true);
      expect(data.data.result).toBe('bare-value');
    });
  });
});
