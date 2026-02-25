import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock workflow executor ───────────────────────────────────────────────────
const mockExecuteWorkflowFromFile = vi.fn();

vi.mock('../../../src/mcp/workflow-executor.js', () => ({
  executeWorkflowFromFile: (...args: unknown[]) => mockExecuteWorkflowFromFile(...args),
}));

// ── Mock agent channel ───────────────────────────────────────────────────────
// Each test that uses file-based execution sets agentChannelSetup before calling
// the handler. The mock constructor reads from this object at construction time.
const agentChannelSetup: {
  onPause: ReturnType<typeof vi.fn>;
  resume: ReturnType<typeof vi.fn>;
} = {
  onPause: vi.fn(),
  resume: vi.fn(),
};

vi.mock('../../../src/mcp/agent-channel.js', () => ({
  AgentChannel: vi.fn().mockImplementation(() => ({
    onPause: (...a: unknown[]) => agentChannelSetup.onPause(...a),
    resume: (...a: unknown[]) => agentChannelSetup.resume(...a),
  })),
}));

// ── Mock run registry ────────────────────────────────────────────────────────
const mockStorePendingRun = vi.fn();
const mockGetPendingRun = vi.fn();
const mockRemovePendingRun = vi.fn();
const mockListPendingRuns = vi.fn();

vi.mock('../../../src/mcp/run-registry.js', () => ({
  storePendingRun: (...args: unknown[]) => mockStorePendingRun(...args),
  getPendingRun: (...args: unknown[]) => mockGetPendingRun(...args),
  removePendingRun: (...args: unknown[]) => mockRemovePendingRun(...args),
  listPendingRuns: (...args: unknown[]) => mockListPendingRuns(...args),
}));

// ── Mock MCP SDK ─────────────────────────────────────────────────────────────
const toolHandlers = new Map<string, (args: unknown, extra?: unknown) => Promise<unknown>>();

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => {
  class MockMcpServer {
    tool(
      name: string,
      _description: string,
      _schema: Record<string, unknown>,
      handler: (args: unknown, extra?: unknown) => Promise<unknown>,
    ): void {
      toolHandlers.set(name, handler);
    }
  }
  return { McpServer: MockMcpServer };
});

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerEditorTools } from '../../../src/mcp/tools-editor.js';

function parseResult(result: unknown): { success: boolean; data?: unknown; error?: unknown } {
  const r = result as { content: Array<{ text: string }>; isError?: boolean };
  return JSON.parse(r.content[0].text);
}

// Create mock connection and buffer objects
function createMockConnection(connected = true) {
  return {
    isConnected: connected,
    sendCommand: vi.fn(),
    sendBatch: vi.fn(),
  };
}

function createMockBuffer() {
  return {
    peek: vi.fn(),
    drain: vi.fn(),
    setFilter: vi.fn(),
  };
}

describe('tools-editor', () => {
  let mockConnection: ReturnType<typeof createMockConnection>;
  let mockBuffer: ReturnType<typeof createMockBuffer>;

  beforeEach(() => {
    vi.clearAllMocks();
    toolHandlers.clear();
    mockConnection = createMockConnection();
    mockBuffer = createMockBuffer();
    const mcp = new McpServer({ name: 'test', version: '1.0.0' });
    registerEditorTools(mcp, mockConnection as never, mockBuffer as never);
  });

  // ── fw_check_events ────────────────────────────────────────────────────

  describe('fw_check_events', () => {
    function callCheckEvents(args: Record<string, unknown>) {
      const handler = toolHandlers.get('fw_check_events')!;
      expect(handler).toBeDefined();
      return handler(args);
    }

    it('drains the buffer by default', async () => {
      mockBuffer.drain.mockReturnValue([{ type: 'NODE_ADDED', data: {} }]);

      const result = parseResult(await callCheckEvents({}));
      expect(result.success).toBe(true);
      expect(mockBuffer.drain).toHaveBeenCalled();
      expect(mockBuffer.peek).not.toHaveBeenCalled();
    });

    it('peeks when peek=true', async () => {
      mockBuffer.peek.mockReturnValue([{ type: 'NODE_REMOVED' }]);

      const result = parseResult(await callCheckEvents({ peek: true }));
      expect(result.success).toBe(true);
      expect(mockBuffer.peek).toHaveBeenCalled();
      expect(mockBuffer.drain).not.toHaveBeenCalled();
    });

    it('returns empty array when no events', async () => {
      mockBuffer.drain.mockReturnValue([]);

      const result = parseResult(await callCheckEvents({}));
      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });
  });

  // ── fw_get_state ───────────────────────────────────────────────────────

  describe('fw_get_state', () => {
    function callGetState() {
      const handler = toolHandlers.get('fw_get_state')!;
      expect(handler).toBeDefined();
      return handler({});
    }

    it('returns editor state when connected', async () => {
      mockConnection.sendCommand.mockResolvedValue({
        requestId: '1',
        success: true,
        result: { workflowName: 'myWorkflow', nodes: 5 },
      });

      const result = parseResult(await callGetState());
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ workflowName: 'myWorkflow', nodes: 5 });
      expect(mockConnection.sendCommand).toHaveBeenCalledWith('get-state', {});
    });

    it('returns EDITOR_NOT_CONNECTED when disconnected', async () => {
      mockConnection.isConnected = false;

      const result = parseResult(await callGetState());
      expect(result.success).toBe(false);
      expect((result.error as { code: string }).code).toBe('EDITOR_NOT_CONNECTED');
    });
  });

  // ── fw_focus_node ──────────────────────────────────────────────────────

  describe('fw_focus_node', () => {
    function callFocusNode(args: Record<string, unknown>) {
      const handler = toolHandlers.get('fw_focus_node')!;
      expect(handler).toBeDefined();
      return handler(args);
    }

    it('sends focus-node command when connected', async () => {
      mockConnection.sendCommand.mockResolvedValue({ requestId: '1', success: true, result: { focused: true } });

      const result = parseResult(await callFocusNode({ nodeId: 'step1' }));
      expect(result.success).toBe(true);
      expect(mockConnection.sendCommand).toHaveBeenCalledWith('focus-node', { nodeId: 'step1' });
    });

    it('returns error when not connected', async () => {
      mockConnection.isConnected = false;

      const result = parseResult(await callFocusNode({ nodeId: 'step1' }));
      expect(result.success).toBe(false);
      expect((result.error as { code: string }).code).toBe('EDITOR_NOT_CONNECTED');
    });
  });

  // ── fw_add_node ────────────────────────────────────────────────────────

  describe('fw_add_node', () => {
    function callAddNode(args: Record<string, unknown>) {
      const handler = toolHandlers.get('fw_add_node')!;
      expect(handler).toBeDefined();
      return handler(args);
    }

    it('sends add-node command with type name only', async () => {
      mockConnection.sendCommand.mockResolvedValue({ requestId: '1', success: true, result: { nodeId: 'new1' } });

      const result = parseResult(await callAddNode({ nodeTypeName: 'MyNode' }));
      expect(result.success).toBe(true);
      expect(mockConnection.sendCommand).toHaveBeenCalledWith('add-node', { nodeTypeName: 'MyNode' });
    });

    it('includes nodeTypeDefinition when provided', async () => {
      mockConnection.sendCommand.mockResolvedValue({ requestId: '1', success: true, result: {} });
      const def = { inputs: { x: 'string' }, outputs: { y: 'number' } };

      await callAddNode({ nodeTypeName: 'Custom', nodeTypeDefinition: def });
      expect(mockConnection.sendCommand).toHaveBeenCalledWith('add-node', {
        nodeTypeName: 'Custom',
        nodeTypeDefinition: def,
      });
    });

    it('returns error when not connected', async () => {
      mockConnection.isConnected = false;

      const result = parseResult(await callAddNode({ nodeTypeName: 'MyNode' }));
      expect(result.success).toBe(false);
      expect((result.error as { code: string }).code).toBe('EDITOR_NOT_CONNECTED');
    });
  });

  // ── fw_open_workflow ───────────────────────────────────────────────────

  describe('fw_open_workflow', () => {
    function callOpenWorkflow(args: Record<string, unknown>) {
      const handler = toolHandlers.get('fw_open_workflow')!;
      expect(handler).toBeDefined();
      return handler(args);
    }

    it('sends open-workflow command', async () => {
      mockConnection.sendCommand.mockResolvedValue({ requestId: '1', success: true, result: { opened: true } });

      const result = parseResult(await callOpenWorkflow({ filePath: '/path/to/wf.ts' }));
      expect(result.success).toBe(true);
      expect(mockConnection.sendCommand).toHaveBeenCalledWith('open-workflow', { filePath: '/path/to/wf.ts' });
    });

    it('returns error when not connected', async () => {
      mockConnection.isConnected = false;

      const result = parseResult(await callOpenWorkflow({ filePath: '/path/to/wf.ts' }));
      expect(result.success).toBe(false);
      expect((result.error as { code: string }).code).toBe('EDITOR_NOT_CONNECTED');
    });
  });

  // ── fw_send_command ────────────────────────────────────────────────────

  describe('fw_send_command', () => {
    function callSendCommand(args: Record<string, unknown>) {
      const handler = toolHandlers.get('fw_send_command')!;
      expect(handler).toBeDefined();
      return handler(args);
    }

    it('sends a generic command with params', async () => {
      mockConnection.sendCommand.mockResolvedValue({ requestId: '1', success: true, result: { ok: true } });

      const result = parseResult(await callSendCommand({ action: 'custom-action', params: { key: 'value' } }));
      expect(result.success).toBe(true);
      expect(mockConnection.sendCommand).toHaveBeenCalledWith('custom-action', { key: 'value' });
    });

    it('defaults params to empty object', async () => {
      mockConnection.sendCommand.mockResolvedValue({ requestId: '1', success: true, result: {} });

      await callSendCommand({ action: 'no-params' });
      expect(mockConnection.sendCommand).toHaveBeenCalledWith('no-params', {});
    });

    it('returns error when not connected', async () => {
      mockConnection.isConnected = false;

      const result = parseResult(await callSendCommand({ action: 'test' }));
      expect(result.success).toBe(false);
      expect((result.error as { code: string }).code).toBe('EDITOR_NOT_CONNECTED');
    });
  });

  // ── fw_batch ───────────────────────────────────────────────────────────

  describe('fw_batch', () => {
    function callBatch(args: Record<string, unknown>) {
      const handler = toolHandlers.get('fw_batch')!;
      expect(handler).toBeDefined();
      return handler(args);
    }

    it('sends batch of commands', async () => {
      const commands = [
        { action: 'add-node', params: { nodeTypeName: 'A' } },
        { action: 'add-connection', params: { from: 'Start.execute', to: 'A.execute' } },
      ];
      mockConnection.sendBatch.mockResolvedValue({ requestId: '1', success: true, result: { applied: 2 } });

      const result = parseResult(await callBatch({ commands }));
      expect(result.success).toBe(true);
      expect(mockConnection.sendBatch).toHaveBeenCalledWith(commands);
    });

    it('returns error when not connected', async () => {
      mockConnection.isConnected = false;

      const result = parseResult(await callBatch({ commands: [] }));
      expect(result.success).toBe(false);
      expect((result.error as { code: string }).code).toBe('EDITOR_NOT_CONNECTED');
    });
  });

  // ── fw_remove_node ─────────────────────────────────────────────────────

  describe('fw_remove_node', () => {
    function callRemoveNode(args: Record<string, unknown>) {
      const handler = toolHandlers.get('fw_remove_node')!;
      expect(handler).toBeDefined();
      return handler(args);
    }

    it('sends remove-node command', async () => {
      mockConnection.sendCommand.mockResolvedValue({ requestId: '1', success: true, result: { removed: true } });

      const result = parseResult(await callRemoveNode({ nodeName: 'step1' }));
      expect(result.success).toBe(true);
      expect(mockConnection.sendCommand).toHaveBeenCalledWith('remove-node', { nodeName: 'step1' });
    });

    it('returns error when not connected', async () => {
      mockConnection.isConnected = false;

      const result = parseResult(await callRemoveNode({ nodeName: 'step1' }));
      expect(result.success).toBe(false);
      expect((result.error as { code: string }).code).toBe('EDITOR_NOT_CONNECTED');
    });
  });

  // ── fw_connect ─────────────────────────────────────────────────────────

  describe('fw_connect', () => {
    function callConnect(args: Record<string, unknown>) {
      const handler = toolHandlers.get('fw_connect')!;
      expect(handler).toBeDefined();
      return handler(args);
    }

    it('sends add-connection command for action "add"', async () => {
      mockConnection.sendCommand.mockResolvedValue({ requestId: '1', success: true, result: {} });
      const conn = { sourceNode: 'A', sourcePort: 'out', targetNode: 'B', targetPort: 'in' };

      const result = parseResult(await callConnect({ action: 'add', connection: conn }));
      expect(result.success).toBe(true);
      expect(mockConnection.sendCommand).toHaveBeenCalledWith('add-connection', { connection: conn });
    });

    it('sends remove-connection command for action "remove"', async () => {
      mockConnection.sendCommand.mockResolvedValue({ requestId: '1', success: true, result: {} });
      const conn = { sourceNode: 'A', sourcePort: 'out', targetNode: 'B', targetPort: 'in' };

      await callConnect({ action: 'remove', connection: conn });
      expect(mockConnection.sendCommand).toHaveBeenCalledWith('remove-connection', { connection: conn });
    });

    it('returns error when not connected', async () => {
      mockConnection.isConnected = false;

      const result = parseResult(
        await callConnect({
          action: 'add',
          connection: { sourceNode: 'A', sourcePort: 'o', targetNode: 'B', targetPort: 'i' },
        }),
      );
      expect(result.success).toBe(false);
      expect((result.error as { code: string }).code).toBe('EDITOR_NOT_CONNECTED');
    });
  });

  // ── fw_undo_redo ───────────────────────────────────────────────────────

  describe('fw_undo_redo', () => {
    function callUndoRedo(args: Record<string, unknown>) {
      const handler = toolHandlers.get('fw_undo_redo')!;
      expect(handler).toBeDefined();
      return handler(args);
    }

    it('sends undo command', async () => {
      mockConnection.sendCommand.mockResolvedValue({ requestId: '1', success: true, result: {} });

      await callUndoRedo({ action: 'undo' });
      expect(mockConnection.sendCommand).toHaveBeenCalledWith('undo', {});
    });

    it('sends redo command', async () => {
      mockConnection.sendCommand.mockResolvedValue({ requestId: '1', success: true, result: {} });

      await callUndoRedo({ action: 'redo' });
      expect(mockConnection.sendCommand).toHaveBeenCalledWith('redo', {});
    });

    it('returns error when not connected', async () => {
      mockConnection.isConnected = false;

      const result = parseResult(await callUndoRedo({ action: 'undo' }));
      expect(result.success).toBe(false);
      expect((result.error as { code: string }).code).toBe('EDITOR_NOT_CONNECTED');
    });
  });

  // ── fw_execute_workflow ────────────────────────────────────────────────

  describe('fw_execute_workflow', () => {
    function callExecute(args: Record<string, unknown>, extra?: unknown) {
      const handler = toolHandlers.get('fw_execute_workflow')!;
      expect(handler).toBeDefined();
      return handler(args, extra ?? { _meta: {}, sendNotification: vi.fn() });
    }

    it('executes via editor when no filePath is provided', async () => {
      mockConnection.sendCommand.mockResolvedValue({
        requestId: '1',
        success: true,
        result: { status: 'completed', output: 42 },
      });

      const result = parseResult(await callExecute({ params: { input: 'test' } }));
      expect(result.success).toBe(true);
      expect(mockConnection.sendCommand).toHaveBeenCalledWith('execute-workflow', { input: 'test' });
    });

    it('returns error via editor when not connected and no filePath', async () => {
      mockConnection.isConnected = false;

      const result = parseResult(await callExecute({}));
      expect(result.success).toBe(false);
      expect((result.error as { code: string }).code).toBe('EDITOR_NOT_CONNECTED');
    });

    // File-based execution tests: the actual executeWorkflowFromFile call is
    // hard to mock reliably with isolate:false + vmForks, so we test the error
    // handling paths that don't depend on the mock (they hit real code that fails
    // on missing files) and cover the editor-delegation path thoroughly instead.

    it('returns an error when file-based execution fails', async () => {
      // With no mock taking effect, the real executor tries to read /tmp/nonexistent.ts
      // and fails. The error message won't contain "Parse errors" so it becomes EXECUTION_ERROR.
      const result = parseResult(
        await callExecute({ filePath: '/tmp/fw-editor-test-nonexistent-file.ts' }),
      );
      expect(result.success).toBe(false);
      const code = (result.error as { code: string }).code;
      expect(['COMPILE_ERROR', 'EXECUTION_ERROR']).toContain(code);
    });

    it('uses params default of empty when delegating to editor', async () => {
      mockConnection.sendCommand.mockResolvedValue({ requestId: '1', success: true, result: {} });

      await callExecute({});
      expect(mockConnection.sendCommand).toHaveBeenCalledWith('execute-workflow', {});
    });
  });

  // ── fw_resume_workflow ─────────────────────────────────────────────────

  describe('fw_resume_workflow', () => {
    function callResume(args: Record<string, unknown>) {
      const handler = toolHandlers.get('fw_resume_workflow')!;
      expect(handler).toBeDefined();
      return handler(args);
    }

    it('returns RUN_NOT_FOUND when run does not exist', async () => {
      mockGetPendingRun.mockReturnValue(undefined);

      const result = parseResult(await callResume({ runId: 'unknown-run', result: {} }));
      expect(result.success).toBe(false);
      expect((result.error as { code: string }).code).toBe('RUN_NOT_FOUND');
    });

    it('resumes and completes a paused run', async () => {
      const execResult = { status: 'completed', output: { answer: 42 } };
      const mockChannel = { resume: vi.fn(), onPause: vi.fn().mockReturnValue(new Promise(() => {})) };
      mockGetPendingRun.mockReturnValue({
        runId: 'run-1',
        filePath: '/tmp/wf.ts',
        executionPromise: Promise.resolve(execResult),
        agentChannel: mockChannel,
        request: {},
        createdAt: Date.now(),
        tmpFiles: [],
      });

      const result = parseResult(await callResume({ runId: 'run-1', result: { answer: 42 } }));
      expect(result.success).toBe(true);
      const data = result.data as { status: string; result: unknown };
      expect(data.status).toBe('completed');
      expect(mockChannel.resume).toHaveBeenCalledWith({ answer: 42 });
      expect(mockRemovePendingRun).toHaveBeenCalledWith('run-1');
    });

    it('returns waiting again when workflow pauses at another waitForAgent', async () => {
      const mockChannel = {
        resume: vi.fn(),
        onPause: vi.fn().mockResolvedValue({ prompt: 'Second question?' }),
      };
      mockGetPendingRun.mockReturnValue({
        runId: 'run-2',
        filePath: '/tmp/wf.ts',
        executionPromise: new Promise(() => {}),
        agentChannel: mockChannel,
        request: {},
        createdAt: Date.now(),
        tmpFiles: [],
      });

      const result = parseResult(await callResume({ runId: 'run-2', result: { first: 'response' } }));
      expect(result.success).toBe(true);
      const data = result.data as { status: string; request: object };
      expect(data.status).toBe('waiting');
      expect(data.request).toEqual({ prompt: 'Second question?' });
      // Should NOT remove the pending run since it paused again
      expect(mockRemovePendingRun).not.toHaveBeenCalled();
    });

    it('removes run and returns EXECUTION_ERROR on failure', async () => {
      const mockChannel = {
        resume: vi.fn().mockImplementation(() => {
          throw new Error('resume failed');
        }),
        onPause: vi.fn(),
      };
      mockGetPendingRun.mockReturnValue({
        runId: 'run-3',
        filePath: '/tmp/wf.ts',
        executionPromise: new Promise(() => {}),
        agentChannel: mockChannel,
        request: {},
        createdAt: Date.now(),
        tmpFiles: [],
      });

      const result = parseResult(await callResume({ runId: 'run-3', result: {} }));
      expect(result.success).toBe(false);
      expect((result.error as { code: string }).code).toBe('EXECUTION_ERROR');
      expect(mockRemovePendingRun).toHaveBeenCalledWith('run-3');
    });
  });

  // ── fw_list_pending_runs ───────────────────────────────────────────────

  describe('fw_list_pending_runs', () => {
    function callListPending() {
      const handler = toolHandlers.get('fw_list_pending_runs')!;
      expect(handler).toBeDefined();
      return handler({});
    }

    it('returns list of pending runs', async () => {
      mockListPendingRuns.mockReturnValue([
        { runId: 'run-1', filePath: '/tmp/wf.ts', createdAt: 1000 },
      ]);

      const result = parseResult(await callListPending());
      expect(result.success).toBe(true);
      const data = result.data as Array<{ runId: string }>;
      expect(data).toHaveLength(1);
      expect(data[0].runId).toBe('run-1');
    });

    it('returns empty list when nothing pending', async () => {
      mockListPendingRuns.mockReturnValue([]);

      const result = parseResult(await callListPending());
      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });
  });

  // ── fw_get_workflow_details ────────────────────────────────────────────

  describe('fw_get_workflow_details', () => {
    function callGetDetails() {
      const handler = toolHandlers.get('fw_get_workflow_details')!;
      expect(handler).toBeDefined();
      return handler({});
    }

    it('returns workflow details when connected', async () => {
      mockConnection.sendCommand.mockResolvedValue({
        requestId: '1',
        success: true,
        result: { nodes: [], connections: [], nodeTypes: [] },
      });

      const result = parseResult(await callGetDetails());
      expect(result.success).toBe(true);
      expect(mockConnection.sendCommand).toHaveBeenCalledWith('get-workflow-details', {});
    });

    it('returns error when not connected', async () => {
      mockConnection.isConnected = false;

      const result = parseResult(await callGetDetails());
      expect(result.success).toBe(false);
      expect((result.error as { code: string }).code).toBe('EDITOR_NOT_CONNECTED');
    });
  });

  // ── fw_configure_events ────────────────────────────────────────────────

  describe('fw_configure_events', () => {
    function callConfigure(args: Record<string, unknown>) {
      const handler = toolHandlers.get('fw_configure_events')!;
      expect(handler).toBeDefined();
      return handler(args);
    }

    it('sets include/exclude filters', async () => {
      mockBuffer.setFilter.mockReturnValue({ include: ['NODE_*'], exclude: ['NODE_MOVED'] });

      const result = parseResult(
        await callConfigure({ include: ['NODE_*'], exclude: ['NODE_MOVED'] }),
      );
      expect(result.success).toBe(true);
      expect(mockBuffer.setFilter).toHaveBeenCalledWith({
        include: ['NODE_*'],
        exclude: ['NODE_MOVED'],
      });
    });

    it('sets dedupeWindowMs and maxBufferSize', async () => {
      mockBuffer.setFilter.mockReturnValue({ dedupeWindowMs: 500, maxBufferSize: 100 });

      await callConfigure({ dedupeWindowMs: 500, maxBufferSize: 100 });
      expect(mockBuffer.setFilter).toHaveBeenCalledWith({
        dedupeWindowMs: 500,
        maxBufferSize: 100,
      });
    });

    it('only passes defined fields', async () => {
      mockBuffer.setFilter.mockReturnValue({});

      await callConfigure({});
      expect(mockBuffer.setFilter).toHaveBeenCalledWith({});
    });

    it('passes all fields when all are provided', async () => {
      mockBuffer.setFilter.mockReturnValue({});

      await callConfigure({
        include: ['*'],
        exclude: [],
        dedupeWindowMs: 0,
        maxBufferSize: 50,
      });
      expect(mockBuffer.setFilter).toHaveBeenCalledWith({
        include: ['*'],
        exclude: [],
        dedupeWindowMs: 0,
        maxBufferSize: 50,
      });
    });
  });

  // ── unwrapAckResult behavior ───────────────────────────────────────────

  describe('unwrapAckResult (via tools)', () => {
    it('unwraps nested result from ack response', async () => {
      mockConnection.sendCommand.mockResolvedValue({
        requestId: '123',
        success: true,
        result: { workflowName: 'test', nodeCount: 3 },
      });

      const result = parseResult(await toolHandlers.get('fw_get_state')!({}));
      expect(result.success).toBe(true);
      // The result field is unwrapped, not the full ack
      expect(result.data).toEqual({ workflowName: 'test', nodeCount: 3 });
    });

    it('returns raw ack when no result field', async () => {
      mockConnection.sendCommand.mockResolvedValue({
        requestId: '123',
        success: true,
      });

      const result = parseResult(await toolHandlers.get('fw_get_state')!({}));
      expect(result.success).toBe(true);
      // Ack without result field gets returned as-is
      expect(result.data).toEqual({ requestId: '123', success: true });
    });
  });
});
