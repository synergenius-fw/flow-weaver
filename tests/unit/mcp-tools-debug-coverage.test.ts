vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    readFileSync: vi.fn().mockReturnValue('// workflow source'),
    unlinkSync: vi.fn(),
  };
});

vi.mock('../../src/api/index', () => ({
  parseWorkflow: vi.fn().mockResolvedValue({
    errors: [],
    ast: { nodes: [], connections: [] },
  }),
}));

vi.mock('../../src/api/query', () => ({
  getTopologicalOrder: vi.fn().mockReturnValue(['nodeA', 'nodeB']),
}));

vi.mock('../../src/runtime/debug-controller', () => ({
  DebugController: vi.fn().mockImplementation(() => ({
    onPause: vi.fn().mockReturnValue(new Promise(() => {})),
    resume: vi.fn(),
    addBreakpoint: vi.fn(),
    removeBreakpoint: vi.fn(),
    getBreakpoints: vi.fn().mockReturnValue([]),
    setVariable: vi.fn(),
  })),
}));

vi.mock('../../src/runtime/checkpoint', () => ({
  CheckpointWriter: vi.fn().mockImplementation(() => ({
    cleanup: vi.fn(),
  })),
  loadCheckpoint: vi.fn().mockReturnValue({
    data: {
      completedNodes: ['nodeA'],
      workflowName: 'TestFlow',
      params: { x: 1 },
      executionOrder: ['nodeA', 'nodeB'],
    },
    stale: false,
    rerunNodes: [],
    skipNodes: ['nodeA'],
  }),
  findLatestCheckpoint: vi.fn().mockReturnValue('/tmp/checkpoint.json'),
}));

vi.mock('../../src/mcp/workflow-executor', () => ({
  executeWorkflowFromFile: vi.fn().mockResolvedValue({ result: 'done' }),
}));

vi.mock('../../src/mcp/agent-channel', () => ({
  AgentChannel: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('../../src/mcp/debug-session', () => {
  const sessions = new Map<string, unknown>();
  return {
    storeDebugSession: vi.fn((s: { debugId: string }) => sessions.set(s.debugId, s)),
    getDebugSession: vi.fn((id: string) => sessions.get(id)),
    removeDebugSession: vi.fn((id: string) => sessions.delete(id)),
    listDebugSessions: vi.fn(() => []),
  };
});

import * as fs from 'fs';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerDebugTools } from '../../src/mcp/tools-debug';
import { parseWorkflow } from '../../src/api/index';
import { executeWorkflowFromFile } from '../../src/mcp/workflow-executor';
import { storeDebugSession, getDebugSession, removeDebugSession, listDebugSessions } from '../../src/mcp/debug-session';
import { findLatestCheckpoint, loadCheckpoint } from '../../src/runtime/checkpoint';
import { DebugController } from '../../src/runtime/debug-controller';

type ToolHandler = (args: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}>;

const toolHandlers: Record<string, ToolHandler> = {};

function createMockMcp(): McpServer {
  return {
    tool: vi.fn().mockImplementation(
      (name: string, _desc: string, _schema: unknown, handler: ToolHandler) => {
        toolHandlers[name] = handler;
      }
    ),
  } as unknown as McpServer;
}

function parseResult(result: { content: Array<{ type: string; text: string }> }) {
  return JSON.parse(result.content[0].text);
}

describe('registerDebugTools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(toolHandlers).forEach((k) => delete toolHandlers[k]);
    const mcp = createMockMcp();
    registerDebugTools(mcp);
  });

  it('registers all expected debug tools', () => {
    expect(toolHandlers).toHaveProperty('fw_debug_workflow');
    expect(toolHandlers).toHaveProperty('fw_debug_step');
    expect(toolHandlers).toHaveProperty('fw_debug_continue');
    expect(toolHandlers).toHaveProperty('fw_debug_inspect');
    expect(toolHandlers).toHaveProperty('fw_debug_set_variable');
    expect(toolHandlers).toHaveProperty('fw_debug_breakpoint');
    expect(toolHandlers).toHaveProperty('fw_resume_from_checkpoint');
    expect(toolHandlers).toHaveProperty('fw_list_debug_sessions');
  });

  // ---------------------------------------------------------------------------
  // fw_debug_workflow
  // ---------------------------------------------------------------------------
  describe('fw_debug_workflow', () => {
    it('returns paused status when execution pauses', async () => {
      const pauseState = {
        currentNodeId: 'nodeA',
        phase: 'before',
        position: 0,
        completedNodes: [],
        variables: {},
      };

      // Make onPause resolve immediately
      vi.mocked(DebugController).mockImplementationOnce(() => ({
        onPause: vi.fn().mockResolvedValue(pauseState),
        resume: vi.fn(),
        addBreakpoint: vi.fn(),
        removeBreakpoint: vi.fn(),
        getBreakpoints: vi.fn().mockReturnValue([]),
        setVariable: vi.fn(),
      }) as any);

      // Make executeWorkflowFromFile hang (never resolve)
      vi.mocked(executeWorkflowFromFile).mockReturnValueOnce(new Promise(() => {}));

      const result = await toolHandlers.fw_debug_workflow({
        filePath: '/tmp/test.ts',
      });
      const parsed = parseResult(result);
      expect(parsed).toMatchObject({ success: true });
      expect(parsed.data.status).toBe('paused');
      expect(parsed.data.debugId).toContain('debug-');
    });

    it('returns completed status when workflow finishes immediately', async () => {
      // Make onPause never resolve, execution resolves immediately
      vi.mocked(DebugController).mockImplementationOnce(() => ({
        onPause: vi.fn().mockReturnValue(new Promise(() => {})),
        resume: vi.fn(),
        addBreakpoint: vi.fn(),
        removeBreakpoint: vi.fn(),
        getBreakpoints: vi.fn().mockReturnValue([]),
        setVariable: vi.fn(),
      }) as any);

      vi.mocked(executeWorkflowFromFile).mockResolvedValueOnce({ result: 'all done' });

      const result = await toolHandlers.fw_debug_workflow({
        filePath: '/tmp/test.ts',
      });
      const parsed = parseResult(result);
      expect(parsed.success).toBe(true);
      expect(parsed.data.status).toBe('completed');
    });

    it('returns error when execution rejects', async () => {
      vi.mocked(DebugController).mockImplementationOnce(() => ({
        onPause: vi.fn().mockReturnValue(new Promise(() => {})),
        resume: vi.fn(),
        addBreakpoint: vi.fn(),
        removeBreakpoint: vi.fn(),
        getBreakpoints: vi.fn().mockReturnValue([]),
        setVariable: vi.fn(),
      }) as any);

      vi.mocked(executeWorkflowFromFile).mockRejectedValueOnce(new Error('exec failed'));

      const result = await toolHandlers.fw_debug_workflow({
        filePath: '/tmp/test.ts',
      });
      const parsed = parseResult(result);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe('EXECUTION_ERROR');
    });

    it('returns DEBUG_START_ERROR when parse fails', async () => {
      vi.mocked(parseWorkflow).mockResolvedValueOnce({
        errors: ['syntax error at line 1'],
        ast: null as any,
      });

      const result = await toolHandlers.fw_debug_workflow({
        filePath: '/tmp/bad.ts',
      });
      const parsed = parseResult(result);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe('DEBUG_START_ERROR');
    });

    it('passes breakpoints and checkpoint options', async () => {
      vi.mocked(DebugController).mockImplementationOnce(() => ({
        onPause: vi.fn().mockReturnValue(new Promise(() => {})),
        resume: vi.fn(),
        addBreakpoint: vi.fn(),
        removeBreakpoint: vi.fn(),
        getBreakpoints: vi.fn().mockReturnValue([]),
        setVariable: vi.fn(),
      }) as any);
      vi.mocked(executeWorkflowFromFile).mockResolvedValueOnce({ result: 'ok' });

      await toolHandlers.fw_debug_workflow({
        filePath: '/tmp/test.ts',
        breakpoints: ['nodeA'],
        checkpoint: true,
        workflowName: 'MyFlow',
        params: { key: 'val' },
      });

      expect(DebugController).toHaveBeenCalledWith(
        expect.objectContaining({
          debug: true,
          checkpoint: true,
          breakpoints: ['nodeA'],
        })
      );
    });
  });

  // ---------------------------------------------------------------------------
  // fw_debug_step
  // ---------------------------------------------------------------------------
  describe('fw_debug_step', () => {
    it('returns SESSION_NOT_FOUND for unknown session', async () => {
      const result = await toolHandlers.fw_debug_step({ debugId: 'nonexistent' });
      const parsed = parseResult(result);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe('SESSION_NOT_FOUND');
    });

    it('steps and returns paused status', async () => {
      const pauseState = {
        currentNodeId: 'nodeB',
        phase: 'before',
        position: 1,
        completedNodes: ['nodeA'],
        variables: {},
      };

      const mockController = {
        onPause: vi.fn().mockResolvedValue(pauseState),
        resume: vi.fn(),
        addBreakpoint: vi.fn(),
        removeBreakpoint: vi.fn(),
        getBreakpoints: vi.fn().mockReturnValue([]),
        setVariable: vi.fn(),
      };

      const session = {
        debugId: 'step-test',
        filePath: '/tmp/test.ts',
        controller: mockController,
        executionPromise: new Promise(() => {}),
        createdAt: Date.now(),
        tmpFiles: [],
      };

      vi.mocked(getDebugSession).mockReturnValueOnce(session as any);

      const result = await toolHandlers.fw_debug_step({ debugId: 'step-test' });
      const parsed = parseResult(result);
      expect(parsed.success).toBe(true);
      expect(parsed.data.status).toBe('paused');
      expect(mockController.resume).toHaveBeenCalledWith({ type: 'step' });
    });

    it('returns completed when workflow finishes after step', async () => {
      const mockController = {
        onPause: vi.fn().mockReturnValue(new Promise(() => {})),
        resume: vi.fn(),
      };

      const session = {
        debugId: 'step-complete',
        filePath: '/tmp/test.ts',
        controller: mockController,
        executionPromise: Promise.resolve({ result: 'final' }),
        createdAt: Date.now(),
        tmpFiles: [],
      };

      vi.mocked(getDebugSession).mockReturnValueOnce(session as any);

      const result = await toolHandlers.fw_debug_step({ debugId: 'step-complete' });
      const parsed = parseResult(result);
      expect(parsed.success).toBe(true);
      expect(parsed.data.status).toBe('completed');
    });

    it('returns STEP_ERROR when resume throws', async () => {
      const mockController = {
        onPause: vi.fn(),
        resume: vi.fn().mockImplementation(() => { throw new Error('resume fail'); }),
      };

      const session = {
        debugId: 'step-err',
        filePath: '/tmp/test.ts',
        controller: mockController,
        executionPromise: new Promise(() => {}),
        createdAt: Date.now(),
        tmpFiles: [],
      };

      vi.mocked(getDebugSession).mockReturnValueOnce(session as any);

      const result = await toolHandlers.fw_debug_step({ debugId: 'step-err' });
      const parsed = parseResult(result);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe('STEP_ERROR');
    });
  });

  // ---------------------------------------------------------------------------
  // fw_debug_continue
  // ---------------------------------------------------------------------------
  describe('fw_debug_continue', () => {
    it('returns SESSION_NOT_FOUND for unknown session', async () => {
      const result = await toolHandlers.fw_debug_continue({ debugId: 'nope' });
      const parsed = parseResult(result);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe('SESSION_NOT_FOUND');
    });

    it('continues with type continue by default', async () => {
      const mockController = {
        onPause: vi.fn().mockReturnValue(new Promise(() => {})),
        resume: vi.fn(),
      };
      const session = {
        debugId: 'cont-test',
        controller: mockController,
        executionPromise: Promise.resolve({ result: 'done' }),
        createdAt: Date.now(),
        tmpFiles: [],
      };
      vi.mocked(getDebugSession).mockReturnValueOnce(session as any);

      const result = await toolHandlers.fw_debug_continue({ debugId: 'cont-test' });
      const parsed = parseResult(result);
      expect(parsed.success).toBe(true);
      expect(mockController.resume).toHaveBeenCalledWith({ type: 'continue' });
    });

    it('continues to breakpoint when toBreakpoint is true', async () => {
      const pauseState = {
        currentNodeId: 'nodeB',
        phase: 'before',
        position: 1,
        completedNodes: ['nodeA'],
        variables: {},
      };
      const mockController = {
        onPause: vi.fn().mockResolvedValue(pauseState),
        resume: vi.fn(),
      };
      const session = {
        debugId: 'cont-bp',
        controller: mockController,
        executionPromise: new Promise(() => {}),
        createdAt: Date.now(),
        tmpFiles: [],
      };
      vi.mocked(getDebugSession).mockReturnValueOnce(session as any);

      const result = await toolHandlers.fw_debug_continue({
        debugId: 'cont-bp',
        toBreakpoint: true,
      });
      const parsed = parseResult(result);
      expect(parsed.success).toBe(true);
      expect(parsed.data.status).toBe('paused');
      expect(mockController.resume).toHaveBeenCalledWith({ type: 'continueToBreakpoint' });
    });

    it('returns CONTINUE_ERROR when resume throws', async () => {
      const mockController = {
        onPause: vi.fn(),
        resume: vi.fn().mockImplementation(() => { throw new Error('boom'); }),
      };
      const session = {
        debugId: 'cont-err',
        controller: mockController,
        executionPromise: new Promise(() => {}),
        createdAt: Date.now(),
        tmpFiles: [],
      };
      vi.mocked(getDebugSession).mockReturnValueOnce(session as any);

      const result = await toolHandlers.fw_debug_continue({ debugId: 'cont-err' });
      const parsed = parseResult(result);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe('CONTINUE_ERROR');
    });
  });

  // ---------------------------------------------------------------------------
  // fw_debug_inspect
  // ---------------------------------------------------------------------------
  describe('fw_debug_inspect', () => {
    it('returns SESSION_NOT_FOUND for unknown session', async () => {
      const result = await toolHandlers.fw_debug_inspect({ debugId: 'nope' });
      const parsed = parseResult(result);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe('SESSION_NOT_FOUND');
    });

    it('returns NOT_PAUSED when no lastPauseState', async () => {
      const session = {
        debugId: 'insp-nostate',
        controller: {},
        executionPromise: new Promise(() => {}),
        createdAt: Date.now(),
        tmpFiles: [],
      };
      vi.mocked(getDebugSession).mockReturnValueOnce(session as any);

      const result = await toolHandlers.fw_debug_inspect({ debugId: 'insp-nostate' });
      const parsed = parseResult(result);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe('NOT_PAUSED');
    });

    it('returns full state when no nodeId filter', async () => {
      const session = {
        debugId: 'insp-full',
        controller: {},
        lastPauseState: {
          currentNodeId: 'nodeA',
          phase: 'before',
          position: 0,
          completedNodes: [],
          variables: { 'nodeA:out:0': 42 },
        },
        executionPromise: new Promise(() => {}),
        createdAt: Date.now(),
        tmpFiles: [],
      };
      vi.mocked(getDebugSession).mockReturnValueOnce(session as any);

      const result = await toolHandlers.fw_debug_inspect({ debugId: 'insp-full' });
      const parsed = parseResult(result);
      expect(parsed.success).toBe(true);
      expect(parsed.data.state.variables['nodeA:out:0']).toBe(42);
    });

    it('filters variables by nodeId', async () => {
      const session = {
        debugId: 'insp-filter',
        controller: {},
        lastPauseState: {
          currentNodeId: 'nodeB',
          phase: 'before',
          position: 1,
          completedNodes: ['nodeA'],
          variables: {
            'nodeA:out:0': 42,
            'nodeB:in:0': 'hello',
          },
        },
        executionPromise: new Promise(() => {}),
        createdAt: Date.now(),
        tmpFiles: [],
      };
      vi.mocked(getDebugSession).mockReturnValueOnce(session as any);

      const result = await toolHandlers.fw_debug_inspect({
        debugId: 'insp-filter',
        nodeId: 'nodeA',
      });
      const parsed = parseResult(result);
      expect(parsed.success).toBe(true);
      expect(parsed.data.nodeId).toBe('nodeA');
      expect(parsed.data.variables['out:0']).toBe(42);
      expect(parsed.data.variables['in:0']).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // fw_debug_set_variable
  // ---------------------------------------------------------------------------
  describe('fw_debug_set_variable', () => {
    it('returns SESSION_NOT_FOUND for unknown session', async () => {
      const result = await toolHandlers.fw_debug_set_variable({
        debugId: 'nope',
        nodeId: 'n',
        portName: 'p',
        value: 1,
      });
      const parsed = parseResult(result);
      expect(parsed.error.code).toBe('SESSION_NOT_FOUND');
    });

    it('returns NOT_PAUSED when no lastPauseState', async () => {
      vi.mocked(getDebugSession).mockReturnValueOnce({
        debugId: 'sv-nostate',
        controller: { setVariable: vi.fn() },
        tmpFiles: [],
      } as any);

      const result = await toolHandlers.fw_debug_set_variable({
        debugId: 'sv-nostate',
        nodeId: 'n',
        portName: 'p',
        value: 1,
      });
      const parsed = parseResult(result);
      expect(parsed.error.code).toBe('NOT_PAUSED');
    });

    it('returns VARIABLE_NOT_FOUND when key does not exist', async () => {
      vi.mocked(getDebugSession).mockReturnValueOnce({
        debugId: 'sv-notfound',
        controller: { setVariable: vi.fn() },
        lastPauseState: { variables: {} },
        tmpFiles: [],
      } as any);

      const result = await toolHandlers.fw_debug_set_variable({
        debugId: 'sv-notfound',
        nodeId: 'n',
        portName: 'p',
        value: 1,
      });
      const parsed = parseResult(result);
      expect(parsed.error.code).toBe('VARIABLE_NOT_FOUND');
    });

    it('sets a variable using latest execution index', async () => {
      const setVariable = vi.fn();
      const variables: Record<string, unknown> = { 'nodeA:out:0': 42, 'nodeA:out:1': 99 };
      vi.mocked(getDebugSession).mockReturnValueOnce({
        debugId: 'sv-ok',
        controller: { setVariable },
        lastPauseState: { variables },
        tmpFiles: [],
      } as any);

      const result = await toolHandlers.fw_debug_set_variable({
        debugId: 'sv-ok',
        nodeId: 'nodeA',
        portName: 'out',
        value: 'new-value',
      });
      const parsed = parseResult(result);
      expect(parsed.success).toBe(true);
      expect(parsed.data.modified).toBe('nodeA:out:1');
      expect(parsed.data.value).toBe('new-value');
      expect(setVariable).toHaveBeenCalledWith('nodeA:out:1', 'new-value');
    });

    it('sets a variable with explicit executionIndex', async () => {
      const setVariable = vi.fn();
      const variables: Record<string, unknown> = { 'nodeA:out:0': 42 };
      vi.mocked(getDebugSession).mockReturnValueOnce({
        debugId: 'sv-idx',
        controller: { setVariable },
        lastPauseState: { variables },
        tmpFiles: [],
      } as any);

      const result = await toolHandlers.fw_debug_set_variable({
        debugId: 'sv-idx',
        nodeId: 'nodeA',
        portName: 'out',
        value: 100,
        executionIndex: 0,
      });
      const parsed = parseResult(result);
      expect(parsed.success).toBe(true);
      expect(parsed.data.modified).toBe('nodeA:out:0');
    });

    it('returns VARIABLE_NOT_FOUND with explicit executionIndex that does not exist', async () => {
      vi.mocked(getDebugSession).mockReturnValueOnce({
        debugId: 'sv-idx-miss',
        controller: { setVariable: vi.fn() },
        lastPauseState: { variables: { 'nodeA:out:0': 42 } },
        tmpFiles: [],
      } as any);

      const result = await toolHandlers.fw_debug_set_variable({
        debugId: 'sv-idx-miss',
        nodeId: 'nodeA',
        portName: 'out',
        value: 0,
        executionIndex: 5,
      });
      const parsed = parseResult(result);
      expect(parsed.error.code).toBe('VARIABLE_NOT_FOUND');
    });
  });

  // ---------------------------------------------------------------------------
  // fw_debug_breakpoint
  // ---------------------------------------------------------------------------
  describe('fw_debug_breakpoint', () => {
    it('returns SESSION_NOT_FOUND for unknown session', async () => {
      const result = await toolHandlers.fw_debug_breakpoint({
        debugId: 'nope',
        action: 'list',
      });
      const parsed = parseResult(result);
      expect(parsed.error.code).toBe('SESSION_NOT_FOUND');
    });

    it('adds a breakpoint', async () => {
      const addBreakpoint = vi.fn();
      const getBreakpoints = vi.fn().mockReturnValue(['nodeA']);
      vi.mocked(getDebugSession).mockReturnValueOnce({
        debugId: 'bp-add',
        controller: { addBreakpoint, getBreakpoints },
        tmpFiles: [],
      } as any);

      const result = await toolHandlers.fw_debug_breakpoint({
        debugId: 'bp-add',
        action: 'add',
        nodeId: 'nodeA',
      });
      const parsed = parseResult(result);
      expect(parsed.success).toBe(true);
      expect(addBreakpoint).toHaveBeenCalledWith('nodeA');
      expect(parsed.data.breakpoints).toEqual(['nodeA']);
    });

    it('returns MISSING_PARAM when adding without nodeId', async () => {
      vi.mocked(getDebugSession).mockReturnValueOnce({
        debugId: 'bp-noid',
        controller: {},
        tmpFiles: [],
      } as any);

      const result = await toolHandlers.fw_debug_breakpoint({
        debugId: 'bp-noid',
        action: 'add',
      });
      const parsed = parseResult(result);
      expect(parsed.error.code).toBe('MISSING_PARAM');
    });

    it('removes a breakpoint', async () => {
      const removeBreakpoint = vi.fn();
      const getBreakpoints = vi.fn().mockReturnValue([]);
      vi.mocked(getDebugSession).mockReturnValueOnce({
        debugId: 'bp-rm',
        controller: { removeBreakpoint, getBreakpoints },
        tmpFiles: [],
      } as any);

      const result = await toolHandlers.fw_debug_breakpoint({
        debugId: 'bp-rm',
        action: 'remove',
        nodeId: 'nodeA',
      });
      const parsed = parseResult(result);
      expect(parsed.success).toBe(true);
      expect(removeBreakpoint).toHaveBeenCalledWith('nodeA');
    });

    it('returns MISSING_PARAM when removing without nodeId', async () => {
      vi.mocked(getDebugSession).mockReturnValueOnce({
        debugId: 'bp-rm-noid',
        controller: {},
        tmpFiles: [],
      } as any);

      const result = await toolHandlers.fw_debug_breakpoint({
        debugId: 'bp-rm-noid',
        action: 'remove',
      });
      const parsed = parseResult(result);
      expect(parsed.error.code).toBe('MISSING_PARAM');
    });

    it('lists breakpoints', async () => {
      const getBreakpoints = vi.fn().mockReturnValue(['x', 'y']);
      vi.mocked(getDebugSession).mockReturnValueOnce({
        debugId: 'bp-list',
        controller: { getBreakpoints },
        tmpFiles: [],
      } as any);

      const result = await toolHandlers.fw_debug_breakpoint({
        debugId: 'bp-list',
        action: 'list',
      });
      const parsed = parseResult(result);
      expect(parsed.success).toBe(true);
      expect(parsed.data.breakpoints).toEqual(['x', 'y']);
    });
  });

  // ---------------------------------------------------------------------------
  // fw_resume_from_checkpoint
  // ---------------------------------------------------------------------------
  describe('fw_resume_from_checkpoint', () => {
    it('returns NO_CHECKPOINT when no checkpoint found', async () => {
      vi.mocked(findLatestCheckpoint).mockReturnValueOnce(null as any);

      const result = await toolHandlers.fw_resume_from_checkpoint({
        filePath: '/tmp/test.ts',
      });
      const parsed = parseResult(result);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe('NO_CHECKPOINT');
    });

    it('resumes in non-debug mode and returns completed', async () => {
      vi.mocked(executeWorkflowFromFile).mockResolvedValueOnce({ result: 'resumed' });

      const result = await toolHandlers.fw_resume_from_checkpoint({
        filePath: '/tmp/test.ts',
      });
      const parsed = parseResult(result);
      expect(parsed.success).toBe(true);
      expect(parsed.data.status).toBe('completed');
      expect(parsed.data.resumedFrom).toBe('/tmp/checkpoint.json');
    });

    it('resumes in debug mode and returns paused', async () => {
      const pauseState = {
        currentNodeId: 'nodeB',
        phase: 'before',
        position: 1,
        completedNodes: ['nodeA'],
        variables: {},
      };

      vi.mocked(DebugController).mockImplementationOnce(() => ({
        onPause: vi.fn().mockResolvedValue(pauseState),
        resume: vi.fn(),
        addBreakpoint: vi.fn(),
        removeBreakpoint: vi.fn(),
        getBreakpoints: vi.fn().mockReturnValue([]),
        setVariable: vi.fn(),
      }) as any);

      vi.mocked(executeWorkflowFromFile).mockReturnValueOnce(new Promise(() => {}));

      const result = await toolHandlers.fw_resume_from_checkpoint({
        filePath: '/tmp/test.ts',
        debug: true,
      });
      const parsed = parseResult(result);
      expect(parsed.success).toBe(true);
      expect(parsed.data.status).toBe('paused');
      expect(parsed.data.debugId).toContain('debug-resume-');
    });

    it('uses explicit checkpointFile when provided', async () => {
      vi.mocked(executeWorkflowFromFile).mockResolvedValueOnce({ result: 'ok' });

      await toolHandlers.fw_resume_from_checkpoint({
        filePath: '/tmp/test.ts',
        checkpointFile: '/custom/checkpoint.json',
      });

      expect(loadCheckpoint).toHaveBeenCalledWith('/custom/checkpoint.json', '/tmp/test.ts');
    });

    it('returns RESUME_ERROR on exception', async () => {
      vi.mocked(findLatestCheckpoint).mockImplementationOnce(() => {
        throw new Error('disk error');
      });

      const result = await toolHandlers.fw_resume_from_checkpoint({
        filePath: '/tmp/test.ts',
      });
      const parsed = parseResult(result);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe('RESUME_ERROR');
    });

    it('includes stale warning when checkpoint is stale', async () => {
      vi.mocked(loadCheckpoint).mockReturnValueOnce({
        data: {
          completedNodes: ['nodeA'],
          workflowName: 'TestFlow',
          params: {},
          executionOrder: ['nodeA', 'nodeB'],
        },
        stale: true,
        rerunNodes: ['nodeB'],
        skipNodes: ['nodeA'],
      } as any);

      vi.mocked(executeWorkflowFromFile).mockResolvedValueOnce({ result: 'ok' });

      const result = await toolHandlers.fw_resume_from_checkpoint({
        filePath: '/tmp/test.ts',
      });
      const parsed = parseResult(result);
      expect(parsed.success).toBe(true);
      expect(parsed.data.warning).toContain('changed since checkpoint');
      expect(parsed.data.rerunNodes).toEqual(['nodeB']);
    });

    it('returns completed in debug resume when workflow finishes immediately', async () => {
      vi.mocked(DebugController).mockImplementationOnce(() => ({
        onPause: vi.fn().mockReturnValue(new Promise(() => {})),
        resume: vi.fn(),
        addBreakpoint: vi.fn(),
        removeBreakpoint: vi.fn(),
        getBreakpoints: vi.fn().mockReturnValue([]),
        setVariable: vi.fn(),
      }) as any);

      vi.mocked(executeWorkflowFromFile).mockResolvedValueOnce({ result: 'instant' });

      const result = await toolHandlers.fw_resume_from_checkpoint({
        filePath: '/tmp/test.ts',
        debug: true,
      });
      const parsed = parseResult(result);
      expect(parsed.success).toBe(true);
      expect(parsed.data.status).toBe('completed');
    });

    it('returns EXECUTION_ERROR in debug resume when execution fails', async () => {
      vi.mocked(DebugController).mockImplementationOnce(() => ({
        onPause: vi.fn().mockReturnValue(new Promise(() => {})),
        resume: vi.fn(),
        addBreakpoint: vi.fn(),
        removeBreakpoint: vi.fn(),
        getBreakpoints: vi.fn().mockReturnValue([]),
        setVariable: vi.fn(),
      }) as any);

      vi.mocked(executeWorkflowFromFile).mockRejectedValueOnce(new Error('crash'));

      const result = await toolHandlers.fw_resume_from_checkpoint({
        filePath: '/tmp/test.ts',
        debug: true,
      });
      const parsed = parseResult(result);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe('EXECUTION_ERROR');
    });
  });

  // ---------------------------------------------------------------------------
  // fw_list_debug_sessions
  // ---------------------------------------------------------------------------
  describe('fw_list_debug_sessions', () => {
    it('returns the list from the session store', async () => {
      vi.mocked(listDebugSessions).mockReturnValueOnce([
        { debugId: 'a', filePath: '/tmp/a.ts', createdAt: 123 },
      ] as any);

      const result = await toolHandlers.fw_list_debug_sessions({});
      const parsed = parseResult(result);
      expect(parsed.success).toBe(true);
      expect(parsed.data).toHaveLength(1);
      expect(parsed.data[0].debugId).toBe('a');
    });
  });
});
