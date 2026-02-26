import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const MOCK_OUTPUT_FILE = path.join(os.tmpdir(), 'out.ts');

// ─── Mock socket.io-client ───────────────────────────────────────────────────
vi.mock('socket.io-client', () => {
  const handlers = new Map<string, ((...args: unknown[]) => void)[]>();
  let anyHandler: ((event: string, data: unknown) => void) | null = null;
  const mockSocket = {
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      const existing = handlers.get(event) || [];
      existing.push(handler);
      handlers.set(event, existing);
    }),
    off: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      const existing = handlers.get(event);
      if (existing) {
        const idx = existing.indexOf(handler);
        if (idx !== -1) existing.splice(idx, 1);
      }
    }),
    onAny: vi.fn((handler: (event: string, data: unknown) => void) => {
      anyHandler = handler;
    }),
    emit: vi.fn((event: string, ...args: unknown[]) => {
      if (event === 'integration:getContext' && typeof args[0] === 'function') {
        (args[0] as (ctx: unknown) => void)(mockSocket._contextResponse);
      }
    }),
    removeAllListeners: vi.fn(() => {
      handlers.clear();
      anyHandler = null;
    }),
    disconnect: vi.fn(),
    connected: true,
    id: 'mock-socket-id',
    _trigger: (event: string, ...args: unknown[]) => {
      const eventHandlers = handlers.get(event);
      if (eventHandlers) {
        for (const handler of eventHandlers) handler(...args);
      }
    },
    _triggerAny: (event: string, data: unknown) => {
      if (anyHandler) anyHandler(event, data);
    },
    _handlers: handlers,
    _contextResponse: null as unknown,
    _resetAnyHandler: () => {
      anyHandler = null;
    },
  };
  return {
    io: vi.fn().mockReturnValue(mockSocket),
    __mockSocket: mockSocket,
  };
});

// ─── Mock @modelcontextprotocol/sdk ──────────────────────────────────────────
const mockExtra = {
  _meta: {},
  sendNotification: () => Promise.resolve(),
};
const mockToolHandlers = new Map<string, (args: unknown, extra?: unknown) => Promise<unknown>>();
const mockResourceHandlers = new Map<string, () => Promise<unknown>>();

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => {
  class MockMcpServer {
    registeredTools: Array<{ name: string; description: string; schema: unknown }> = [];
    registeredResources: Array<{ name: string; uri: string; description: string }> = [];

    tool(
      name: string,
      description: string,
      schema: Record<string, unknown>,
      handler: (args: unknown, extra?: unknown) => Promise<unknown>
    ): void {
      this.registeredTools.push({ name, description, schema });
      mockToolHandlers.set(name, (args: unknown) => handler(args, mockExtra));
    }

    resource(
      name: string,
      uri: string,
      metadata: Record<string, unknown>,
      handler: () => Promise<unknown>
    ): void {
      this.registeredResources.push({ name, uri, description: metadata.description as string });
      mockResourceHandlers.set(name, handler);
    }

    async connect(_transport: unknown): Promise<void> {
      // noop
    }
  }
  return { McpServer: MockMcpServer };
});

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => {
  class MockStdioServerTransport {}
  return { StdioServerTransport: MockStdioServerTransport };
});

// ─── Mock library APIs ──────────────────────────────────────────────────────
const mockParseWorkflow = vi.fn();
const mockValidateWorkflow = vi.fn();
const mockCompileWorkflow = vi.fn();
vi.mock('../../../src/api/index.js', () => ({
  parseWorkflow: (...args: unknown[]) => mockParseWorkflow(...args),
  validateWorkflow: (...args: unknown[]) => mockValidateWorkflow(...args),
  compileWorkflow: (...args: unknown[]) => mockCompileWorkflow(...args),
}));

const mockDescribeWorkflow = vi.fn();
const mockFormatDescribeOutput = vi.fn();
vi.mock('../../../src/cli/commands/describe.js', () => ({
  describeWorkflow: (...args: unknown[]) => mockDescribeWorkflow(...args),
  formatDescribeOutput: (...args: unknown[]) => mockFormatDescribeOutput(...args),
}));

const mockRunDoctorChecks = vi.fn();
vi.mock('../../../src/cli/commands/doctor.js', () => ({
  runDoctorChecks: (...args: unknown[]) => mockRunDoctorChecks(...args),
}));

const mockGetNodes = vi.fn();
const mockGetConnections = vi.fn();
const mockGetDependencies = vi.fn();
const mockGetDependents = vi.fn();
const mockGetTopologicalOrder = vi.fn();
const mockFindIsolatedNodes = vi.fn();
const mockFindDeadEnds = vi.fn();
const mockFindDeadEndDetails = vi.fn();
const mockFindDisconnectedOutputPorts = vi.fn();
vi.mock('../../../src/api/query.js', () => ({
  getNodes: (...args: unknown[]) => mockGetNodes(...args),
  getConnections: (...args: unknown[]) => mockGetConnections(...args),
  getDependencies: (...args: unknown[]) => mockGetDependencies(...args),
  getDependents: (...args: unknown[]) => mockGetDependents(...args),
  getTopologicalOrder: (...args: unknown[]) => mockGetTopologicalOrder(...args),
  findIsolatedNodes: (...args: unknown[]) => mockFindIsolatedNodes(...args),
  findDeadEnds: (...args: unknown[]) => mockFindDeadEnds(...args),
  findDeadEndDetails: (...args: unknown[]) => mockFindDeadEndDetails(...args),
  findDisconnectedOutputPorts: (...args: unknown[]) => mockFindDisconnectedOutputPorts(...args),
}));

vi.mock('../../../src/diff/WorkflowDiffer.js', () => ({
  WorkflowDiffer: {
    compare: vi.fn().mockReturnValue({ identical: false, impact: 'MINOR', summary: {} }),
  },
}));

vi.mock('../../../src/diff/formatDiff.js', () => ({
  formatDiff: vi.fn().mockReturnValue('No changes'),
}));

const mockListWorkflowTemplates = vi
  .fn()
  .mockReturnValue([
    { id: 'simple', name: 'Simple', description: 'Basic workflow', category: 'utility' },
  ]);
const mockListNodeTemplates = vi
  .fn()
  .mockReturnValue([{ id: 'processor', name: 'Processor', description: 'Data processor node' }]);
const mockGetWorkflowTemplate = vi.fn();
const mockGetNodeTemplate = vi.fn();
const mockGenerateWorkflowFromTemplate = vi.fn().mockReturnValue('// generated workflow');
const mockGenerateNodeFromTemplate = vi.fn().mockReturnValue('// generated node');
vi.mock('../../../src/api/templates.js', () => ({
  listWorkflowTemplates: () => mockListWorkflowTemplates(),
  listNodeTemplates: () => mockListNodeTemplates(),
  getWorkflowTemplate: (...args: unknown[]) => mockGetWorkflowTemplate(...args),
  getNodeTemplate: (...args: unknown[]) => mockGetNodeTemplate(...args),
  generateWorkflowFromTemplate: (...args: unknown[]) => mockGenerateWorkflowFromTemplate(...args),
  generateNodeFromTemplate: (...args: unknown[]) => mockGenerateNodeFromTemplate(...args),
}));

const mockListPatterns = vi.fn();
const mockApplyPattern = vi.fn();
const mockFindWorkflows = vi.fn();
const mockExtractPattern = vi.fn();
vi.mock('../../../src/api/patterns.js', () => ({
  listPatterns: (...args: unknown[]) => mockListPatterns(...args),
  applyPattern: (...args: unknown[]) => mockApplyPattern(...args),
  findWorkflows: (...args: unknown[]) => mockFindWorkflows(...args),
  extractPattern: (...args: unknown[]) => mockExtractPattern(...args),
}));

const mockGenerateInPlace = vi.fn();
vi.mock('../../../src/api/generate-in-place.js', () => ({
  generateInPlace: (...args: unknown[]) => mockGenerateInPlace(...args),
}));

const mockManipAddNode = vi.fn();
const mockManipRemoveNode = vi.fn();
const mockManipRenameNode = vi.fn();
const mockManipAddConnection = vi.fn();
const mockManipRemoveConnection = vi.fn();
const mockManipSetNodePosition = vi.fn();
const mockManipSetNodeLabel = vi.fn();
vi.mock('../../../src/api/manipulation.js', () => ({
  addNode: (...args: unknown[]) => mockManipAddNode(...args),
  removeNode: (...args: unknown[]) => mockManipRemoveNode(...args),
  renameNode: (...args: unknown[]) => mockManipRenameNode(...args),
  addConnection: (...args: unknown[]) => mockManipAddConnection(...args),
  removeConnection: (...args: unknown[]) => mockManipRemoveConnection(...args),
  setNodePosition: (...args: unknown[]) => mockManipSetNodePosition(...args),
  setNodeLabel: (...args: unknown[]) => mockManipSetNodeLabel(...args),
}));

const mockAnnotationParserParse = vi.fn();
vi.mock('../../../src/parser.js', () => {
  return {
    AnnotationParser: class MockAnnotationParser {
      parse(...args: unknown[]) {
        return mockAnnotationParserParse(...args);
      }
    },
  };
});

const mockExecuteWorkflowFromFile = vi.fn();
vi.mock('../../../src/mcp/workflow-executor.js', () => ({
  executeWorkflowFromFile: (...args: unknown[]) => mockExecuteWorkflowFromFile(...args),
}));

// @ts-expect-error __mockSocket is injected by vi.mock above
import { io as mockIoFn, __mockSocket } from 'socket.io-client';
import {
  EventBuffer,
  EditorConnection,
  offerClaudeRegistration,
  startMcpServer,
} from '../../../src/mcp/index.js';
import type { RegistrationDeps } from '../../../src/mcp/types.js';

const mockSocket = __mockSocket as unknown as {
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  onAny: ReturnType<typeof vi.fn>;
  emit: ReturnType<typeof vi.fn>;
  removeAllListeners: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  connected: boolean;
  id: string;
  _trigger: (event: string, ...args: unknown[]) => void;
  _triggerAny: (event: string, data: unknown) => void;
  _handlers: Map<string, ((...args: unknown[]) => void)[]>;
  _contextResponse: unknown;
  _resetAnyHandler: () => void;
};

// ─── EventBuffer Tests ──────────────────────────────────────────────────────
describe('EventBuffer', () => {
  it('starts empty', () => {
    const buf = new EventBuffer(500, null);
    expect(buf.length).toBe(0);
    expect(buf.drain()).toEqual([]);
  });

  it('push and drain returns events in order', () => {
    const buf = new EventBuffer(500, null);
    buf.push('fw:nodeSelected', { nodeId: 'A' });
    buf.push('fw:contextUpdate', { selectedNode: 'B' });
    expect(buf.length).toBe(2);

    const drained = buf.drain();
    expect(drained).toHaveLength(2);
    expect(drained[0].event).toBe('fw:nodeSelected');
    expect(drained[0].data).toEqual({ nodeId: 'A' });
    expect(drained[1].event).toBe('fw:contextUpdate');

    // drain clears
    expect(buf.length).toBe(0);
    expect(buf.drain()).toEqual([]);
  });

  it('peek returns events without clearing', () => {
    const buf = new EventBuffer(500, null);
    buf.push('fw:test', { x: 1 });
    buf.push('fw:test2', { x: 2 });

    const peeked = buf.peek();
    expect(peeked).toHaveLength(2);
    expect(buf.length).toBe(2); // still there

    const peeked2 = buf.peek();
    expect(peeked2).toHaveLength(2);
  });

  it('evicts oldest entries beyond max size', () => {
    const buf = new EventBuffer(5, null, { dedupeWindowMs: 0 }); // small max, no dedup
    for (let i = 0; i < 8; i++) {
      buf.push('fw:event', { i });
    }
    expect(buf.length).toBe(5);
    const events = buf.drain();
    // Should have the last 5 events (i=3..7)
    expect(events[0].data).toEqual({ i: 3 });
    expect(events[4].data).toEqual({ i: 7 });
  });

  it('push adds timestamp to each entry', () => {
    const buf = new EventBuffer(500, null);
    buf.push('fw:test', {});
    const events = buf.peek();
    expect(events[0].timestamp).toBeDefined();
    expect(typeof events[0].timestamp).toBe('string');
  });

  it('clear removes all events', () => {
    const buf = new EventBuffer(500, null);
    buf.push('fw:a', {});
    buf.push('fw:b', {});
    buf.clear();
    expect(buf.length).toBe(0);
    expect(buf.drain()).toEqual([]);
  });
});

// ─── EventBuffer File Writing Tests ──────────────────────────────────────────
describe('EventBuffer file writing', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('appends JSONL to configured file path on push', () => {
    const filePath = path.join(tmpDir, 'events.jsonl');
    const buf = new EventBuffer(500, filePath);

    buf.push('fw:nodeSelected', { nodeId: 'A' });
    buf.push('fw:contextUpdate', { selected: 'B' });

    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(2);

    const first = JSON.parse(lines[0]);
    expect(first.event).toBe('fw:nodeSelected');
    expect(first.data).toEqual({ nodeId: 'A' });
    expect(first.timestamp).toBeDefined();

    const second = JSON.parse(lines[1]);
    expect(second.event).toBe('fw:contextUpdate');
    expect(second.data).toEqual({ selected: 'B' });
  });

  it('creates file on first push', () => {
    const filePath = path.join(tmpDir, 'new-events.jsonl');
    expect(fs.existsSync(filePath)).toBe(false);

    const buf = new EventBuffer(500, filePath);
    buf.push('fw:test', { x: 1 });

    expect(fs.existsSync(filePath)).toBe(true);
  });

  it('handles file being moved (next push creates new file)', () => {
    const filePath = path.join(tmpDir, 'events.jsonl');
    const buf = new EventBuffer(500, filePath);

    buf.push('fw:first', { n: 1 });
    expect(fs.existsSync(filePath)).toBe(true);

    // Simulate drain hook: mv the file
    const drainPath = filePath + '.drain';
    fs.renameSync(filePath, drainPath);
    expect(fs.existsSync(filePath)).toBe(false);

    // Next push should create a new file
    buf.push('fw:second', { n: 2 });
    expect(fs.existsSync(filePath)).toBe(true);

    // New file should only contain the second event
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).event).toBe('fw:second');

    // Drained file should still have the first event
    const drainContent = fs.readFileSync(drainPath, 'utf8');
    const drainLines = drainContent.trim().split('\n');
    expect(drainLines).toHaveLength(1);
    expect(JSON.parse(drainLines[0]).event).toBe('fw:first');
  });

  it('does not write to file when eventsFilePath is null', () => {
    const filePath = path.join(tmpDir, 'should-not-exist.jsonl');
    const buf = new EventBuffer(500, null);

    buf.push('fw:test', { x: 1 });

    expect(fs.existsSync(filePath)).toBe(false);
  });

  it('does not write when no FW_EVENTS_FILE env var and no constructor arg', () => {
    // Save and clear env var
    const original = process.env.FW_EVENTS_FILE;
    delete process.env.FW_EVENTS_FILE;

    try {
      const buf = new EventBuffer(500);
      buf.push('fw:test', {});
      // No file should be created — eventsFilePath falls through to null
      // We can't easily verify no file was created without knowing a path,
      // but we can verify the buffer still works in-memory
      expect(buf.length).toBe(1);
    } finally {
      if (original !== undefined) {
        process.env.FW_EVENTS_FILE = original;
      }
    }
  });

  it('reads FW_EVENTS_FILE from env when no constructor arg provided', () => {
    const filePath = path.join(tmpDir, 'env-events.jsonl');
    const original = process.env.FW_EVENTS_FILE;
    process.env.FW_EVENTS_FILE = filePath;

    try {
      const buf = new EventBuffer(500);
      buf.push('fw:env-test', { env: true });

      expect(fs.existsSync(filePath)).toBe(true);
      const content = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(content.trim());
      expect(parsed.event).toBe('fw:env-test');
    } finally {
      if (original !== undefined) {
        process.env.FW_EVENTS_FILE = original;
      } else {
        delete process.env.FW_EVENTS_FILE;
      }
    }
  });
});

// ─── EditorConnection Tests ─────────────────────────────────────────────────
describe('EditorConnection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSocket._handlers.clear();
    mockSocket._resetAnyHandler();
    mockSocket._contextResponse = null;
    mockSocket.connected = true;
  });

  it('connects to /integrations with clientType mcp', () => {
    const buffer = new EventBuffer(500, null);
    const conn = new EditorConnection('http://localhost:6546', buffer, {
      ioFactory: mockIoFn as typeof import('socket.io-client').io,
    });
    conn.connect();

    expect(mockIoFn).toHaveBeenCalledWith(
      'http://localhost:6546/integrations',
      expect.objectContaining({
        query: { clientType: 'mcp' },
      })
    );
  });

  it('pushes fw: events to buffer via onAny', () => {
    const buffer = new EventBuffer(500, null);
    const conn = new EditorConnection('http://localhost:6546', buffer, {
      ioFactory: mockIoFn as typeof import('socket.io-client').io,
    });
    conn.connect();
    const baseCount = buffer.length; // mcp:status from connect()

    mockSocket._triggerAny('fw:nodeSelected', { nodeId: 'A' });

    expect(buffer.length).toBe(baseCount + 1);
    const events = buffer.peek();
    expect(events[events.length - 1].event).toBe('fw:nodeSelected');
  });

  it('pushes integration: events to buffer via onAny', () => {
    const buffer = new EventBuffer(500, null);
    const conn = new EditorConnection('http://localhost:6546', buffer, {
      ioFactory: mockIoFn as typeof import('socket.io-client').io,
    });
    conn.connect();
    const baseCount = buffer.length;

    mockSocket._triggerAny('integration:stateChanged', { state: 'active' });

    expect(buffer.length).toBe(baseCount + 1);
  });

  it('ignores non-fw/integration events', () => {
    const buffer = new EventBuffer(500, null);
    const conn = new EditorConnection('http://localhost:6546', buffer, {
      ioFactory: mockIoFn as typeof import('socket.io-client').io,
    });
    conn.connect();
    const baseCount = buffer.length;

    mockSocket._triggerAny('randomEvent', { data: 'ignored' });

    expect(buffer.length).toBe(baseCount);
  });

  it('sendCommand emits integration:command and resolves on fw:ack', async () => {
    const buffer = new EventBuffer(500, null);
    const conn = new EditorConnection('http://localhost:6546', buffer, {
      ioFactory: mockIoFn as typeof import('socket.io-client').io,
    });
    conn.connect();
    mockSocket._trigger('connect');

    // Setup: capture the emitted command and respond with ack
    mockSocket.emit.mockImplementation((event: string, data: unknown) => {
      if (event === 'integration:command') {
        const cmd = data as { requestId: string };
        // Simulate ack from editor
        setTimeout(() => {
          mockSocket._trigger('fw:ack', {
            requestId: cmd.requestId,
            success: true,
            result: { focused: true },
          });
        }, 5);
      }
    });

    const result = await conn.sendCommand('focus-node', { nodeId: 'A' });

    expect(result.success).toBe(true);
    expect(result.result).toEqual({ focused: true });
  });

  it('sendCommand times out after specified duration', async () => {
    const buffer = new EventBuffer(500, null);
    const conn = new EditorConnection('http://localhost:6546', buffer, {
      ioFactory: mockIoFn as typeof import('socket.io-client').io,
      ackTimeout: 50, // very short for tests
    });
    conn.connect();
    mockSocket._trigger('connect');

    // Don't send ack — should timeout
    mockSocket.emit.mockImplementation(() => {});

    const result = await conn.sendCommand('focus-node', { nodeId: 'A' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('Timeout');
  });

  it('sendBatch emits integration:batch and resolves on fw:ack', async () => {
    const buffer = new EventBuffer(500, null);
    const conn = new EditorConnection('http://localhost:6546', buffer, {
      ioFactory: mockIoFn as typeof import('socket.io-client').io,
    });
    conn.connect();
    mockSocket._trigger('connect');

    mockSocket.emit.mockImplementation((event: string, data: unknown) => {
      if (event === 'integration:batch') {
        const cmd = data as { requestId: string };
        setTimeout(() => {
          mockSocket._trigger('fw:ack', {
            requestId: cmd.requestId,
            success: true,
            result: { applied: 2 },
          });
        }, 5);
      }
    });

    const commands = [
      { action: 'focus-node', params: { nodeId: 'A' } },
      { action: 'add-node', params: { nodeTypeName: 'processor' } },
    ];
    const result = await conn.sendBatch(commands);
    expect(result.success).toBe(true);
  });

  it('disconnect cleans up socket', () => {
    const buffer = new EventBuffer(500, null);
    const conn = new EditorConnection('http://localhost:6546', buffer, {
      ioFactory: mockIoFn as typeof import('socket.io-client').io,
    });
    conn.connect();
    conn.disconnect();
    expect(mockSocket.disconnect).toHaveBeenCalled();
  });

  it('isConnected reflects socket state', () => {
    const buffer = new EventBuffer(500, null);
    const conn = new EditorConnection('http://localhost:6546', buffer, {
      ioFactory: mockIoFn as typeof import('socket.io-client').io,
    });

    expect(conn.isConnected).toBe(false);

    conn.connect();
    mockSocket.connected = true;
    expect(conn.isConnected).toBe(true);
  });

  // ─── Bug 1: Event listener memory leak fix tests ─────────────────────
  it('sendCommand removes fw:ack listener after successful resolve', async () => {
    const buffer = new EventBuffer(500, null);
    const conn = new EditorConnection('http://localhost:6546', buffer, {
      ioFactory: mockIoFn as typeof import('socket.io-client').io,
    });
    conn.connect();
    mockSocket._trigger('connect');

    mockSocket.emit.mockImplementation((event: string, data: unknown) => {
      if (event === 'integration:command') {
        const cmd = data as { requestId: string };
        setTimeout(() => {
          mockSocket._trigger('fw:ack', {
            requestId: cmd.requestId,
            success: true,
            result: { ok: true },
          });
        }, 5);
      }
    });

    const ackHandlersBefore = (mockSocket._handlers.get('fw:ack') || []).length;
    await conn.sendCommand('test-action', {});
    const ackHandlersAfter = (mockSocket._handlers.get('fw:ack') || []).length;

    // The handler should have been removed after resolving
    expect(ackHandlersAfter).toBe(ackHandlersBefore);
  });

  it('sendCommand removes fw:ack listener after timeout', async () => {
    const buffer = new EventBuffer(500, null);
    const conn = new EditorConnection('http://localhost:6546', buffer, {
      ioFactory: mockIoFn as typeof import('socket.io-client').io,
      ackTimeout: 50,
    });
    conn.connect();
    mockSocket._trigger('connect');

    // Don't send ack — should timeout
    mockSocket.emit.mockImplementation(() => {});

    const ackHandlersBefore = (mockSocket._handlers.get('fw:ack') || []).length;
    await conn.sendCommand('test-action', {});
    const ackHandlersAfter = (mockSocket._handlers.get('fw:ack') || []).length;

    // The handler should have been removed after timeout
    expect(ackHandlersAfter).toBe(ackHandlersBefore);
  });

  it('sendBatch removes fw:ack listener after successful resolve', async () => {
    const buffer = new EventBuffer(500, null);
    const conn = new EditorConnection('http://localhost:6546', buffer, {
      ioFactory: mockIoFn as typeof import('socket.io-client').io,
    });
    conn.connect();
    mockSocket._trigger('connect');

    mockSocket.emit.mockImplementation((event: string, data: unknown) => {
      if (event === 'integration:batch') {
        const cmd = data as { requestId: string };
        setTimeout(() => {
          mockSocket._trigger('fw:ack', {
            requestId: cmd.requestId,
            success: true,
            result: { applied: 1 },
          });
        }, 5);
      }
    });

    const ackHandlersBefore = (mockSocket._handlers.get('fw:ack') || []).length;
    await conn.sendBatch([{ action: 'test' }]);
    const ackHandlersAfter = (mockSocket._handlers.get('fw:ack') || []).length;

    expect(ackHandlersAfter).toBe(ackHandlersBefore);
  });

  it('sendBatch removes fw:ack listener after timeout', async () => {
    const buffer = new EventBuffer(500, null);
    const conn = new EditorConnection('http://localhost:6546', buffer, {
      ioFactory: mockIoFn as typeof import('socket.io-client').io,
      ackTimeout: 50,
    });
    conn.connect();
    mockSocket._trigger('connect');

    mockSocket.emit.mockImplementation(() => {});

    const ackHandlersBefore = (mockSocket._handlers.get('fw:ack') || []).length;
    await conn.sendBatch([{ action: 'test' }]);
    const ackHandlersAfter = (mockSocket._handlers.get('fw:ack') || []).length;

    expect(ackHandlersAfter).toBe(ackHandlersBefore);
  });

  // ─── connect() idempotency tests (event tripling fix) ─────────────
  describe('connect() idempotency', () => {
    it('should disconnect previous socket before creating new one', () => {
      const buffer = new EventBuffer(500, null);
      const conn = new EditorConnection('http://localhost:6546', buffer, {
        ioFactory: mockIoFn as typeof import('socket.io-client').io,
      });

      conn.connect();
      conn.connect();

      // mockSocket.disconnect should have been called for the first connection
      expect(mockSocket.disconnect).toHaveBeenCalled();
    });

    it('should not accumulate onAny handlers across multiple connect calls', () => {
      const buffer = new EventBuffer(500, null);
      const conn = new EditorConnection('http://localhost:6546', buffer, {
        ioFactory: mockIoFn as typeof import('socket.io-client').io,
      });

      // Connect three times
      conn.connect();
      conn.connect();
      conn.connect();

      // Simulate one event
      mockSocket._triggerAny('fw:nodeSelected', { nodeId: 'A' });

      // Should have exactly 1 fw:nodeSelected event, not 3
      // (plus the mcp:status events from each connect() call)
      const events = buffer.drain().filter((e) => e.event === 'fw:nodeSelected');
      expect(events).toHaveLength(1);
    });
  });
});

// ─── Auto-Registration Tests ────────────────────────────────────────────────
describe('offerClaudeRegistration', () => {
  it('does nothing when claude is not found', async () => {
    const log = vi.fn();
    const deps: RegistrationDeps = {
      execCommand: vi.fn().mockResolvedValue({ stdout: '', exitCode: 1 }),
      prompt: vi.fn(),
      log,
      resolveCliPath: () => '/path/to/cli',
    };

    await offerClaudeRegistration({ server: 'http://localhost:6546' }, deps);

    expect(deps.prompt).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('not found'));
  });

  it('does nothing when already registered', async () => {
    const log = vi.fn();
    const deps: RegistrationDeps = {
      execCommand: vi
        .fn()
        .mockResolvedValueOnce({ stdout: '/usr/local/bin/claude', exitCode: 0 }) // which claude
        .mockResolvedValueOnce({ stdout: 'flow-weaver: npx tsx ...', exitCode: 0 }), // claude mcp list
      prompt: vi.fn(),
      log,
      resolveCliPath: () => '/path/to/cli',
    };

    await offerClaudeRegistration({ server: 'http://localhost:6546' }, deps);

    expect(deps.prompt).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('already registered'));
  });

  it('registers when user says yes', async () => {
    const log = vi.fn();
    const execCommand = vi
      .fn()
      .mockResolvedValueOnce({ stdout: '/usr/local/bin/claude', exitCode: 0 }) // which claude
      .mockResolvedValueOnce({ stdout: '', exitCode: 0 }) // claude mcp list (no flow-weaver)
      .mockResolvedValueOnce({ stdout: 'Added flow-weaver', exitCode: 0 }); // claude mcp add

    const deps: RegistrationDeps = {
      execCommand,
      prompt: vi.fn().mockResolvedValue('y'),
      log,
      resolveCliPath: () => '/path/to/cli',
    };

    await offerClaudeRegistration({ server: 'http://localhost:6546' }, deps);

    expect(deps.prompt).toHaveBeenCalled();
    expect(execCommand).toHaveBeenCalledTimes(3);
    // The third call should be claude mcp add
    const addCall = execCommand.mock.calls[2][0] as string;
    expect(addCall).toContain('claude mcp add');
    expect(addCall).toContain('flow-weaver');
    expect(addCall).toContain('--scope project');
    expect(addCall).toContain('mcp-server');
    expect(addCall).toContain('--stdio');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Registered'));
  });

  it('skips when user says no', async () => {
    const log = vi.fn();
    const execCommand = vi
      .fn()
      .mockResolvedValueOnce({ stdout: '/usr/local/bin/claude', exitCode: 0 }) // which claude
      .mockResolvedValueOnce({ stdout: '', exitCode: 0 }); // claude mcp list

    const deps: RegistrationDeps = {
      execCommand,
      prompt: vi.fn().mockResolvedValue('n'),
      log,
      resolveCliPath: () => '/path/to/cli',
    };

    await offerClaudeRegistration({ server: 'http://localhost:6546' }, deps);

    expect(deps.prompt).toHaveBeenCalled();
    expect(execCommand).toHaveBeenCalledTimes(2); // no mcp add call
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Skipped'));
  });
});

// ─── MCP Tools Tests ────────────────────────────────────────────────────────
describe('MCP tools and resources', () => {
  let buffer: EventBuffer;
  let conn: EditorConnection;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSocket._handlers.clear();
    mockSocket._resetAnyHandler();
    mockSocket._contextResponse = null;
    mockSocket.connected = true;
    mockToolHandlers.clear();
    mockResourceHandlers.clear();

    buffer = new EventBuffer(500, null);
    conn = new EditorConnection('http://localhost:6546', buffer, {
      ioFactory: mockIoFn as typeof import('socket.io-client').io,
    });
  });

  it('registers all expected tools', async () => {
    await startMcpServer({
      server: 'http://localhost:6546',
      stdio: true,
      _testDeps: { buffer, connection: conn },
    });

    const toolNames = [...mockToolHandlers.keys()];
    expect(toolNames).toContain('fw_check_events');
    expect(toolNames).toContain('fw_get_state');
    expect(toolNames).toContain('fw_focus_node');
    expect(toolNames).toContain('fw_add_node');
    expect(toolNames).toContain('fw_open_workflow');
    expect(toolNames).toContain('fw_send_command');
    expect(toolNames).toContain('fw_batch');
  });

  it('registers all expected resources', async () => {
    await startMcpServer({
      server: 'http://localhost:6546',
      stdio: true,
      _testDeps: { buffer, connection: conn },
    });

    const resourceNames = [...mockResourceHandlers.keys()];
    expect(resourceNames).toContain('events');
    expect(resourceNames).toContain('state');
  });

  describe('fw_check_events', () => {
    beforeEach(async () => {
      await startMcpServer({
        server: 'http://localhost:6546',
        stdio: true,
        _testDeps: { buffer, connection: conn },
      });
    });

    it('drains buffer by default', async () => {
      buffer.push('fw:nodeSelected', { nodeId: 'A' });
      buffer.push('fw:contextUpdate', { selectedNode: 'B' });

      const handler = mockToolHandlers.get('fw_check_events')!;
      const result = (await handler({})) as { content: Array<{ type: string; text: string }> };

      expect(result.content[0].type).toBe('text');
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.data).toHaveLength(2);
      expect(buffer.length).toBe(0); // drained
    });

    it('peeks when peek=true', async () => {
      buffer.push('fw:nodeSelected', { nodeId: 'A' });

      const handler = mockToolHandlers.get('fw_check_events')!;
      const result = (await handler({ peek: true })) as {
        content: Array<{ type: string; text: string }>;
      };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.data).toHaveLength(1);
      expect(buffer.length).toBe(1); // not drained
    });
  });

  describe('fw_get_state', () => {
    beforeEach(async () => {
      conn.connect();
      mockSocket._trigger('connect');
      await startMcpServer({
        server: 'http://localhost:6546',
        stdio: true,
        _testDeps: { buffer, connection: conn },
      });
    });

    it('sends get-state command to editor', async () => {
      mockSocket.emit.mockImplementation((event: string, data: unknown) => {
        if (event === 'integration:command') {
          const cmd = data as { requestId: string };
          setTimeout(() => {
            mockSocket._trigger('fw:ack', {
              requestId: cmd.requestId,
              success: true,
              result: { nodes: ['A', 'B'], selectedNode: 'A' },
            });
          }, 5);
        }
      });

      const handler = mockToolHandlers.get('fw_get_state')!;
      const result = (await handler({})) as { content: Array<{ type: string; text: string }> };

      expect(result.content[0].type).toBe('text');
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      // After flattening, data is the unwrapped result (no inner success/requestId)
      expect(parsed.data.nodes).toEqual(['A', 'B']);
      expect(parsed.data.selectedNode).toBe('A');
    });
  });

  describe('fw_focus_node', () => {
    beforeEach(async () => {
      conn.connect();
      mockSocket._trigger('connect');
      await startMcpServer({
        server: 'http://localhost:6546',
        stdio: true,
        _testDeps: { buffer, connection: conn },
      });
    });

    it('sends focus-node command with nodeId', async () => {
      mockSocket.emit.mockImplementation((event: string, data: unknown) => {
        if (event === 'integration:command') {
          const cmd = data as { requestId: string; action: string; params: unknown };
          expect(cmd.action).toBe('focus-node');
          expect(cmd.params).toEqual({ nodeId: 'myNode' });
          setTimeout(() => {
            mockSocket._trigger('fw:ack', {
              requestId: cmd.requestId,
              success: true,
            });
          }, 5);
        }
      });

      const handler = mockToolHandlers.get('fw_focus_node')!;
      const result = (await handler({ nodeId: 'myNode' })) as {
        content: Array<{ type: string; text: string }>;
      };
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.data.success).toBe(true);
    });
  });

  describe('fw_add_node', () => {
    beforeEach(async () => {
      conn.connect();
      mockSocket._trigger('connect');
      await startMcpServer({
        server: 'http://localhost:6546',
        stdio: true,
        _testDeps: { buffer, connection: conn },
      });
    });

    it('sends add-node command with nodeTypeName', async () => {
      mockSocket.emit.mockImplementation((event: string, data: unknown) => {
        if (event === 'integration:command') {
          const cmd = data as { requestId: string; action: string; params: unknown };
          expect(cmd.action).toBe('add-node');
          expect(cmd.params).toEqual({ nodeTypeName: 'processor' });
          setTimeout(() => {
            mockSocket._trigger('fw:ack', {
              requestId: cmd.requestId,
              success: true,
            });
          }, 5);
        }
      });

      const handler = mockToolHandlers.get('fw_add_node')!;
      await handler({ nodeTypeName: 'processor' });
    });

    it('includes nodeTypeDefinition when provided', async () => {
      mockSocket.emit.mockImplementation((event: string, data: unknown) => {
        if (event === 'integration:command') {
          const cmd = data as {
            requestId: string;
            action: string;
            params: Record<string, unknown>;
          };
          expect(cmd.params.nodeTypeDefinition).toEqual({ type: 'custom' });
          setTimeout(() => {
            mockSocket._trigger('fw:ack', {
              requestId: cmd.requestId,
              success: true,
            });
          }, 5);
        }
      });

      const handler = mockToolHandlers.get('fw_add_node')!;
      await handler({ nodeTypeName: 'custom', nodeTypeDefinition: { type: 'custom' } });
    });
  });

  describe('fw_open_workflow', () => {
    beforeEach(async () => {
      conn.connect();
      mockSocket._trigger('connect');
      await startMcpServer({
        server: 'http://localhost:6546',
        stdio: true,
        _testDeps: { buffer, connection: conn },
      });
    });

    it('sends open-workflow command with filePath', async () => {
      mockSocket.emit.mockImplementation((event: string, data: unknown) => {
        if (event === 'integration:command') {
          const cmd = data as { requestId: string; action: string; params: unknown };
          expect(cmd.action).toBe('open-workflow');
          expect(cmd.params).toEqual({ filePath: '/path/to/workflow.ts' });
          setTimeout(() => {
            mockSocket._trigger('fw:ack', {
              requestId: cmd.requestId,
              success: true,
            });
          }, 5);
        }
      });

      const handler = mockToolHandlers.get('fw_open_workflow')!;
      await handler({ filePath: '/path/to/workflow.ts' });
    });
  });

  describe('fw_send_command', () => {
    beforeEach(async () => {
      conn.connect();
      mockSocket._trigger('connect');
      await startMcpServer({
        server: 'http://localhost:6546',
        stdio: true,
        _testDeps: { buffer, connection: conn },
      });
    });

    it('sends generic command with action and params', async () => {
      mockSocket.emit.mockImplementation((event: string, data: unknown) => {
        if (event === 'integration:command') {
          const cmd = data as { requestId: string; action: string; params: unknown };
          expect(cmd.action).toBe('custom-action');
          expect(cmd.params).toEqual({ key: 'value' });
          setTimeout(() => {
            mockSocket._trigger('fw:ack', {
              requestId: cmd.requestId,
              success: true,
            });
          }, 5);
        }
      });

      const handler = mockToolHandlers.get('fw_send_command')!;
      await handler({ action: 'custom-action', params: { key: 'value' } });
    });
  });

  describe('fw_batch', () => {
    beforeEach(async () => {
      conn.connect();
      mockSocket._trigger('connect');
      await startMcpServer({
        server: 'http://localhost:6546',
        stdio: true,
        _testDeps: { buffer, connection: conn },
      });
    });

    it('sends batch commands', async () => {
      mockSocket.emit.mockImplementation((event: string, data: unknown) => {
        if (event === 'integration:batch') {
          const cmd = data as { requestId: string; commands: unknown };
          expect(cmd.commands).toEqual([
            { action: 'focus-node', params: { nodeId: 'A' } },
            { action: 'add-node', params: { nodeTypeName: 'processor' } },
          ]);
          setTimeout(() => {
            mockSocket._trigger('fw:ack', {
              requestId: cmd.requestId,
              success: true,
            });
          }, 5);
        }
      });

      const handler = mockToolHandlers.get('fw_batch')!;
      await handler({
        commands: [
          { action: 'focus-node', params: { nodeId: 'A' } },
          { action: 'add-node', params: { nodeTypeName: 'processor' } },
        ],
      });
    });
  });

  describe('tools return error when not connected', () => {
    beforeEach(async () => {
      mockSocket.connected = false;
      await startMcpServer({
        server: 'http://localhost:6546',
        stdio: true,
        _testDeps: { buffer, connection: conn },
      });
    });

    it('fw_get_state returns error', async () => {
      const handler = mockToolHandlers.get('fw_get_state')!;
      const result = (await handler({})) as {
        content: Array<{ type: string; text: string }>;
        isError: boolean;
      };
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error.message).toContain('Not connected');
    });
  });

  describe('resources', () => {
    beforeEach(async () => {
      await startMcpServer({
        server: 'http://localhost:6546',
        stdio: true,
        _testDeps: { buffer, connection: conn },
      });
    });

    it('fw://events resource returns buffer contents', async () => {
      buffer.push('fw:nodeSelected', { nodeId: 'A' });

      const handler = mockResourceHandlers.get('events')!;
      const result = (await handler()) as { contents: Array<{ uri: string; text: string }> };

      expect(result.contents[0].uri).toBe('fw://events');
      const parsed = JSON.parse(result.contents[0].text);
      expect(parsed).toHaveLength(1);
    });

    it('fw://state resource sends get-state command', async () => {
      conn.connect();
      mockSocket._trigger('connect');
      mockSocket.connected = true;

      mockSocket.emit.mockImplementation((event: string, data: unknown) => {
        if (event === 'integration:command') {
          const cmd = data as { requestId: string };
          setTimeout(() => {
            mockSocket._trigger('fw:ack', {
              requestId: cmd.requestId,
              success: true,
              result: { nodes: ['X'] },
            });
          }, 5);
        }
      });

      const handler = mockResourceHandlers.get('state')!;
      const result = (await handler()) as { contents: Array<{ uri: string; text: string }> };

      expect(result.contents[0].uri).toBe('fw://state');
    });
  });
});

// ─── mcpServerCommand wiring Tests ──────────────────────────────────────────
describe('mcpServerCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSocket._handlers.clear();
    mockSocket._resetAnyHandler();
    mockSocket._contextResponse = null;
    mockSocket.connected = true;
    mockToolHandlers.clear();
    mockResourceHandlers.clear();
  });

  it('in stdio mode, starts server with connection and buffer', async () => {
    await startMcpServer({
      server: 'http://localhost:6546',
      stdio: true,
      _testDeps: {
        buffer: new EventBuffer(500, null),
        connection: new EditorConnection('http://localhost:6546', new EventBuffer(500, null), {
          ioFactory: mockIoFn as typeof import('socket.io-client').io,
        }),
      },
    });

    // Tools should be registered
    expect(mockToolHandlers.size).toBeGreaterThan(0);
  });

  it('events flow from socket to buffer in wired setup', async () => {
    const buffer = new EventBuffer(500, null);
    const conn = new EditorConnection('http://localhost:6546', buffer, {
      ioFactory: mockIoFn as typeof import('socket.io-client').io,
    });
    conn.connect();

    await startMcpServer({
      server: 'http://localhost:6546',
      stdio: true,
      _testDeps: { buffer, connection: conn },
    });

    // Simulate events from editor
    const baseCount = buffer.length; // mcp:status from connect()
    mockSocket._triggerAny('fw:nodeSelected', { nodeId: 'Z' });
    mockSocket._triggerAny('fw:contextUpdate', { x: 1 });

    expect(buffer.length).toBe(baseCount + 2);

    // Check events tool reads from same buffer (drain returns all including mcp:status)
    const handler = mockToolHandlers.get('fw_check_events')!;
    const result = (await handler({})) as { content: Array<{ type: string; text: string }> };
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toHaveLength(baseCount + 2);
    // The socket events are after the mcp:status event(s)
    const socketEvents = parsed.data.filter((e: { event: string }) => e.event.startsWith('fw:'));
    expect(socketEvents[0].event).toBe('fw:nodeSelected');
  });
});

// ─── Library Tool Tests ─────────────────────────────────────────────────────

describe('Library MCP tools', () => {
  let buffer: EventBuffer;
  let conn: EditorConnection;

  function makeFakeAST() {
    return {
      functionName: 'testWorkflow',
      description: 'A test workflow',
      instances: [
        { id: 'proc1', nodeType: 'process', config: {} },
        { id: 'proc2', nodeType: 'transform', config: {} },
      ],
      connections: [
        { from: { node: 'Start', port: 'execute' }, to: { node: 'proc1', port: 'execute' } },
        { from: { node: 'proc1', port: 'onSuccess' }, to: { node: 'proc2', port: 'execute' } },
        { from: { node: 'proc2', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } },
      ],
      nodeTypes: [
        {
          name: 'process',
          functionName: 'process',
          inputs: { execute: {} },
          outputs: { onSuccess: {} },
        },
        {
          name: 'transform',
          functionName: 'transform',
          inputs: { execute: {} },
          outputs: { onSuccess: {} },
        },
      ],
    };
  }

  let fakeAST: ReturnType<typeof makeFakeAST>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockSocket._handlers.clear();
    mockSocket._resetAnyHandler();
    mockSocket.connected = true;
    mockToolHandlers.clear();
    mockResourceHandlers.clear();

    // Create a fresh AST for each test to prevent mutation leaks
    fakeAST = makeFakeAST();

    // Provide default mock return values for post-modify validation
    mockValidateWorkflow.mockReturnValue({ valid: true, errors: [], warnings: [] });
    mockDescribeWorkflow.mockReturnValue({});
    mockFormatDescribeOutput.mockReturnValue('');

    buffer = new EventBuffer(500, null);
    conn = new EditorConnection('http://localhost:6546', buffer, {
      ioFactory: mockIoFn as typeof import('socket.io-client').io,
    });

    await startMcpServer({
      server: 'http://localhost:6546',
      stdio: true,
      _testDeps: { buffer, connection: conn },
    });
  });

  it('registers all library tools', () => {
    const toolNames = [...mockToolHandlers.keys()];
    expect(toolNames).toContain('fw_describe');
    expect(toolNames).toContain('fw_validate');
    expect(toolNames).toContain('fw_compile');
    expect(toolNames).toContain('fw_diff');
    expect(toolNames).toContain('fw_list_templates');
    expect(toolNames).toContain('fw_scaffold');
    expect(toolNames).toContain('fw_query');
    expect(toolNames).toContain('fw_list_patterns');
    expect(toolNames).toContain('fw_apply_pattern');
    expect(toolNames).toContain('fw_find_workflows');
    expect(toolNames).toContain('fw_modify');
    expect(toolNames).toContain('fw_extract_pattern');
    expect(toolNames).toContain('fw_doctor');
  });

  describe('fw_describe', () => {
    it('returns workflow description in json format', async () => {
      mockParseWorkflow.mockResolvedValue({ ast: fakeAST, errors: [], warnings: [] });
      const descOutput = {
        name: 'testWorkflow',
        nodes: [],
        connections: [],
        graph: '',
        validation: { valid: true, errors: [], warnings: [] },
      };
      mockDescribeWorkflow.mockReturnValue(descOutput);
      mockFormatDescribeOutput.mockReturnValue(JSON.stringify(descOutput));

      const handler = mockToolHandlers.get('fw_describe')!;
      const result = (await handler({ filePath: '/test/workflow.ts' })) as {
        content: Array<{ text: string }>;
      };
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.data.name).toBe('testWorkflow');
      expect(mockParseWorkflow).toHaveBeenCalled();
      expect(mockDescribeWorkflow).toHaveBeenCalled();
    });

    it('returns error on parse failure', async () => {
      mockParseWorkflow.mockResolvedValue({ ast: {}, errors: ['Syntax error'], warnings: [] });

      const handler = mockToolHandlers.get('fw_describe')!;
      const result = (await handler({ filePath: '/test/bad.ts' })) as {
        isError: boolean;
        content: Array<{ text: string }>;
      };
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error.message).toContain('Parse errors');
    });

    it('passes node focus option', async () => {
      mockParseWorkflow.mockResolvedValue({ ast: fakeAST, errors: [], warnings: [] });
      const focusOutput = {
        focusNode: 'proc1',
        node: {},
        incoming: [],
        outgoing: [],
        validation: { valid: true, errors: [], warnings: [] },
      };
      mockDescribeWorkflow.mockReturnValue(focusOutput);
      mockFormatDescribeOutput.mockReturnValue(JSON.stringify(focusOutput));

      const handler = mockToolHandlers.get('fw_describe')!;
      await handler({ filePath: '/test/workflow.ts', node: 'proc1' });
      expect(mockDescribeWorkflow).toHaveBeenCalledWith(fakeAST, { node: 'proc1' });
    });

    it('returns text format as string data', async () => {
      mockParseWorkflow.mockResolvedValue({ ast: fakeAST, errors: [], warnings: [] });
      mockDescribeWorkflow.mockReturnValue({ name: 'test' });
      mockFormatDescribeOutput.mockReturnValue('Workflow: test\nNodes: 2');

      const handler = mockToolHandlers.get('fw_describe')!;
      const result = (await handler({ filePath: '/test/workflow.ts', format: 'text' })) as {
        content: Array<{ text: string }>;
      };
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(typeof parsed.data).toBe('string');
      expect(parsed.data).toContain('Workflow: test');
    });

    it('returns mermaid format as string data', async () => {
      mockParseWorkflow.mockResolvedValue({ ast: fakeAST, errors: [], warnings: [] });
      mockDescribeWorkflow.mockReturnValue({ name: 'test' });
      mockFormatDescribeOutput.mockReturnValue('graph LR\n  A --> B');

      const handler = mockToolHandlers.get('fw_describe')!;
      const result = (await handler({ filePath: '/test/workflow.ts', format: 'mermaid' })) as {
        content: Array<{ text: string }>;
      };
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(typeof parsed.data).toBe('string');
      expect(parsed.data).toContain('graph LR');
    });

    it('returns ascii format as string data', async () => {
      mockParseWorkflow.mockResolvedValue({ ast: fakeAST, errors: [], warnings: [] });
      mockDescribeWorkflow.mockReturnValue({ name: 'test' });
      mockFormatDescribeOutput.mockReturnValue('testWorkflow\n┌────┐\n│Start│');

      const handler = mockToolHandlers.get('fw_describe')!;
      const result = (await handler({ filePath: '/test/workflow.ts', format: 'ascii' })) as {
        content: Array<{ text: string }>;
      };
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(typeof parsed.data).toBe('string');
    });

    it('returns ascii-compact format as string data', async () => {
      mockParseWorkflow.mockResolvedValue({ ast: fakeAST, errors: [], warnings: [] });
      mockDescribeWorkflow.mockReturnValue({ name: 'test' });
      mockFormatDescribeOutput.mockReturnValue('testWorkflow\n┌─────┐━━━▶┌────┐');

      const handler = mockToolHandlers.get('fw_describe')!;
      const result = (await handler({ filePath: '/test/workflow.ts', format: 'ascii-compact' })) as {
        content: Array<{ text: string }>;
      };
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(typeof parsed.data).toBe('string');
    });
  });

  describe('fw_validate', () => {
    it('returns validation result', async () => {
      mockParseWorkflow.mockResolvedValue({ ast: fakeAST, errors: [], warnings: [] });
      mockValidateWorkflow.mockReturnValue({ valid: true, errors: [], warnings: [] });

      const handler = mockToolHandlers.get('fw_validate')!;
      const result = (await handler({ filePath: '/test/workflow.ts' })) as {
        content: Array<{ text: string }>;
      };
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.data.valid).toBe(true);
    });

    it('returns parse errors as invalid', async () => {
      mockParseWorkflow.mockResolvedValue({
        ast: {},
        errors: ['No workflows found'],
        warnings: [],
      });

      const handler = mockToolHandlers.get('fw_validate')!;
      const result = (await handler({ filePath: '/test/bad.ts' })) as {
        content: Array<{ text: string }>;
      };
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.data.valid).toBe(false);
      expect(parsed.data.errors).toContain('No workflows found');
    });

    it('maps validation errors with metadata', async () => {
      mockParseWorkflow.mockResolvedValue({ ast: fakeAST, errors: [], warnings: [] });
      mockValidateWorkflow.mockReturnValue({
        valid: false,
        errors: [
          { type: 'error', code: 'MISSING_REQUIRED_INPUT', message: 'Missing port', node: 'proc1' },
        ],
        warnings: [{ type: 'warning', code: 'UNUSED_NODE', message: 'Unused node', node: 'proc2' }],
      });

      const handler = mockToolHandlers.get('fw_validate')!;
      const result = (await handler({ filePath: '/test/workflow.ts' })) as {
        content: Array<{ text: string }>;
      };
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.data.valid).toBe(false);
      expect(parsed.data.errors[0].message).toBe('Missing port');
      expect(parsed.data.errors[0].severity).toBe('error');
      expect(parsed.data.errors[0].nodeId).toBe('proc1');
      expect(parsed.data.errors[0].code).toBe('MISSING_REQUIRED_INPUT');
      expect(parsed.data.warnings[0].message).toBe('Unused node');
      expect(parsed.data.warnings[0].severity).toBe('warning');
      expect(parsed.data.warnings[0].nodeId).toBe('proc2');
      expect(parsed.data.warnings[0].code).toBe('UNUSED_NODE');
    });

    it('includes parse warnings in validation response alongside validation warnings', async () => {
      mockParseWorkflow.mockResolvedValue({
        ast: fakeAST,
        errors: [],
        warnings: ['Failed to parse port line: "@input [name"'],
      });
      mockValidateWorkflow.mockReturnValue({
        valid: true,
        errors: [],
        warnings: [{ type: 'warning', code: 'UNUSED_NODE', message: 'Unused node', node: 'proc2' }],
      });

      const handler = mockToolHandlers.get('fw_validate')!;
      const result = (await handler({ filePath: '/test/workflow.ts' })) as {
        content: Array<{ text: string }>;
      };
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.data.valid).toBe(true);
      // Parse warnings (raw strings) come first, then validation warnings (objects)
      expect(parsed.data.warnings.length).toBe(2);
      expect(parsed.data.warnings[0]).toBe('Failed to parse port line: "@input [name"');
      expect(parsed.data.warnings[1].message).toBe('Unused node');
    });

    it('includes parse warnings when parse errors also exist', async () => {
      mockParseWorkflow.mockResolvedValue({
        ast: {},
        errors: ['No workflows found'],
        warnings: ['Failed to parse port line: "@input [broken"'],
      });

      const handler = mockToolHandlers.get('fw_validate')!;
      const result = (await handler({ filePath: '/test/bad.ts' })) as {
        content: Array<{ text: string }>;
      };
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.data.valid).toBe(false);
      expect(parsed.data.errors).toContain('No workflows found');
      expect(parsed.data.warnings).toContain('Failed to parse port line: "@input [broken"');
    });

    it('should return valid for node-type-only files when nodeTypesOnly fallback succeeds', async () => {
      // First call fails (no workflows found), second call succeeds with nodeTypesOnly
      mockParseWorkflow
        .mockResolvedValueOnce({
          ast: {},
          errors: ['No workflows found in file'],
          warnings: [],
        })
        .mockResolvedValueOnce({
          ast: {
            nodeTypes: [
              {
                name: 'double',
                functionName: 'double',
                inputs: { x: {} },
                outputs: { result: {} },
              },
              {
                name: 'upper',
                functionName: 'upper',
                inputs: { text: {} },
                outputs: { result: {} },
              },
            ],
          },
          errors: [],
          warnings: [],
        });

      const handler = mockToolHandlers.get('fw_validate')!;
      const result = (await handler({ filePath: '/test/node-types.ts' })) as {
        content: Array<{ text: string }>;
      };
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.data.valid).toBe(true);
      expect(parsed.data.nodeTypesOnly).toBe(true);
      expect(parsed.data.nodeTypeCount).toBe(2);
    });

    it('should include NO_WORKFLOW_FOUND warning for node-type-only files', async () => {
      mockParseWorkflow
        .mockResolvedValueOnce({
          ast: {},
          errors: ['No workflows found in file'],
          warnings: [],
        })
        .mockResolvedValueOnce({
          ast: {
            nodeTypes: [
              {
                name: 'double',
                functionName: 'double',
                inputs: { x: {} },
                outputs: { result: {} },
              },
              {
                name: 'upper',
                functionName: 'upper',
                inputs: { text: {} },
                outputs: { result: {} },
              },
            ],
          },
          errors: [],
          warnings: [],
        });

      const handler = mockToolHandlers.get('fw_validate')!;
      const result = (await handler({ filePath: '/test/node-types.ts' })) as {
        content: Array<{ text: string }>;
      };
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.data.valid).toBe(true);
      expect(parsed.data.nodeTypesOnly).toBe(true);
      expect(parsed.data.warnings).toBeDefined();
      expect(parsed.data.warnings.length).toBeGreaterThan(0);
      expect(parsed.data.warnings[0].code).toBe('NO_WORKFLOW_FOUND');
      expect(parsed.data.warnings[0].message).toContain('No workflow function found');
      expect(parsed.data.warnings[0].message).toContain('2 node types');
    });
  });

  describe('fw_compile', () => {
    it('compiles and returns success metadata without code', async () => {
      mockCompileWorkflow.mockResolvedValue({
        code: '// compiled code that could be very long',
        ast: fakeAST,
        analysis: { warnings: ['unused variable'] },
        metadata: {},
      });

      const handler = mockToolHandlers.get('fw_compile')!;
      const result = (await handler({ filePath: '/test/workflow.ts' })) as {
        content: Array<{ text: string }>;
      };
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.data.warnings).toEqual(['unused variable']);
      expect(parsed.data.code).toBeUndefined();
      expect(mockCompileWorkflow).toHaveBeenCalled();
    });

    it('returns empty warnings when metadata has none', async () => {
      mockCompileWorkflow.mockResolvedValue({
        code: '// code',
        ast: fakeAST,
        metadata: {},
      });

      const handler = mockToolHandlers.get('fw_compile')!;
      const result = (await handler({ filePath: '/test/workflow.ts' })) as {
        content: Array<{ text: string }>;
      };
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.data.warnings).toEqual([]);
    });

    it('returns error on compile failure', async () => {
      mockCompileWorkflow.mockRejectedValue(new Error('Compilation failed'));

      const handler = mockToolHandlers.get('fw_compile')!;
      const result = (await handler({ filePath: '/test/bad.ts' })) as {
        isError: boolean;
        content: Array<{ text: string }>;
      };
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error.message).toContain('Compilation failed');
    });

    it('passes production and write options', async () => {
      mockCompileWorkflow.mockResolvedValue({ code: '// code', ast: fakeAST, metadata: {} });

      const handler = mockToolHandlers.get('fw_compile')!;
      await handler({ filePath: '/test/workflow.ts', production: true, write: false });
      expect(mockCompileWorkflow).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ write: false, generate: { production: true } })
      );
    });
  });

  describe('fw_diff', () => {
    it('compares two workflow files', async () => {
      mockParseWorkflow
        .mockResolvedValueOnce({
          ast: { ...fakeAST, functionName: 'v1' },
          errors: [],
          warnings: [],
        })
        .mockResolvedValueOnce({
          ast: { ...fakeAST, functionName: 'v2' },
          errors: [],
          warnings: [],
        });

      const { WorkflowDiffer: MockDiffer } = await import('../../../src/diff/WorkflowDiffer.js');
      const { formatDiff: mockFormatDiffFn } = await import('../../../src/diff/formatDiff.js');
      (MockDiffer.compare as ReturnType<typeof vi.fn>).mockReturnValue({
        identical: false,
        impact: 'MINOR',
      });
      (mockFormatDiffFn as ReturnType<typeof vi.fn>).mockReturnValue('some diff text');

      const handler = mockToolHandlers.get('fw_diff')!;
      const result = (await handler({ file1: '/test/v1.ts', file2: '/test/v2.ts' })) as {
        content: Array<{ text: string }>;
      };
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.data).toContain('some diff text');
    });

    it('returns error if file1 has parse errors', async () => {
      mockParseWorkflow
        .mockResolvedValueOnce({ ast: {}, errors: ['Bad syntax'], warnings: [] })
        .mockResolvedValueOnce({ ast: fakeAST, errors: [], warnings: [] });

      const handler = mockToolHandlers.get('fw_diff')!;
      const result = (await handler({ file1: '/test/bad.ts', file2: '/test/good.ts' })) as {
        isError: boolean;
        content: Array<{ text: string }>;
      };
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error.message).toContain('file1');
    });
  });

  describe('fw_list_templates', () => {
    it('returns all templates by default', async () => {
      const handler = mockToolHandlers.get('fw_list_templates')!;
      const result = (await handler({})) as { content: Array<{ text: string }> };
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.data.length).toBeGreaterThan(0);
      const types = parsed.data.map((t: { type: string }) => t.type);
      expect(types).toContain('workflow');
      expect(types).toContain('node');
    });

    it('filters by workflow type', async () => {
      const handler = mockToolHandlers.get('fw_list_templates')!;
      const result = (await handler({ type: 'workflow' })) as { content: Array<{ text: string }> };
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.data.every((t: { type: string }) => t.type === 'workflow')).toBe(true);
    });

    it('filters by node type', async () => {
      const handler = mockToolHandlers.get('fw_list_templates')!;
      const result = (await handler({ type: 'node' })) as { content: Array<{ text: string }> };
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.data.every((t: { type: string }) => t.type === 'node')).toBe(true);
    });
  });

  describe('fw_scaffold', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-scaffold-'));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('scaffolds a workflow template', async () => {
      mockGetWorkflowTemplate.mockReturnValue({
        id: 'simple',
        name: 'Simple',
        generate: () => '// wf',
      });

      const handler = mockToolHandlers.get('fw_scaffold')!;
      const outPath = path.join(tmpDir, 'new-workflow.ts');
      const result = (await handler({ template: 'simple', filePath: outPath, name: 'myFlow' })) as {
        content: Array<{ text: string }>;
      };
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.data.success).toBe(true);
      expect(parsed.data.type).toBe('workflow');
      expect(fs.existsSync(outPath)).toBe(true);
    });

    it('scaffolds a node template', async () => {
      mockGetWorkflowTemplate.mockReturnValue(undefined);
      mockGetNodeTemplate.mockReturnValue({
        id: 'processor',
        name: 'Processor',
        generate: () => '// node',
      });

      const handler = mockToolHandlers.get('fw_scaffold')!;
      const outPath = path.join(tmpDir, 'new-node.ts');
      const result = (await handler({
        template: 'processor',
        filePath: outPath,
        name: 'myNode',
      })) as { content: Array<{ text: string }> };
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.data.success).toBe(true);
      expect(parsed.data.type).toBe('node');
    });

    it('returns error for unknown template', async () => {
      mockGetWorkflowTemplate.mockReturnValue(undefined);
      mockGetNodeTemplate.mockReturnValue(undefined);

      const handler = mockToolHandlers.get('fw_scaffold')!;
      const result = (await handler({ template: 'nonexistent', filePath: MOCK_OUTPUT_FILE })) as {
        isError: boolean;
        content: Array<{ text: string }>;
      };
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error.message).toContain('not found');
    });

    it('previews a workflow template without writing', async () => {
      mockGetWorkflowTemplate.mockReturnValue({
        id: 'simple',
        name: 'Simple',
        generate: () => '// wf',
      });
      mockGenerateWorkflowFromTemplate.mockReturnValue('// preview workflow code');

      const handler = mockToolHandlers.get('fw_scaffold')!;
      const outPath = path.join(tmpDir, 'preview-wf.ts');
      const result = (await handler({
        template: 'simple',
        filePath: outPath,
        name: 'myFlow',
        preview: true,
      })) as { content: Array<{ text: string }> };
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.data.success).toBe(true);
      expect(parsed.data.preview).toBe(true);
      expect(parsed.data.code).toBe('// preview workflow code');
      expect(parsed.data.type).toBe('workflow');
      // File should NOT be written
      expect(fs.existsSync(outPath)).toBe(false);
    });

    it('previews a node template without writing', async () => {
      mockGetWorkflowTemplate.mockReturnValue(undefined);
      mockGetNodeTemplate.mockReturnValue({
        id: 'processor',
        name: 'Processor',
        generate: () => '// node',
      });
      mockGenerateNodeFromTemplate.mockReturnValue('// preview node code');

      const handler = mockToolHandlers.get('fw_scaffold')!;
      const outPath = path.join(tmpDir, 'preview-node.ts');
      const result = (await handler({
        template: 'processor',
        filePath: outPath,
        name: 'myNode',
        preview: true,
      })) as { content: Array<{ text: string }> };
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.data.success).toBe(true);
      expect(parsed.data.preview).toBe(true);
      expect(parsed.data.code).toBe('// preview node code');
      expect(parsed.data.type).toBe('node');
      expect(fs.existsSync(outPath)).toBe(false);
    });

    it('appends second workflow to existing file instead of overwriting (F5 fix)', async () => {
      // First scaffold creates the file
      mockGetWorkflowTemplate.mockReturnValue({
        id: 'simple',
        name: 'Simple',
        generate: () => '// wf',
      });
      mockGenerateWorkflowFromTemplate
        .mockReturnValueOnce('// workflow A code')
        .mockReturnValueOnce('// workflow B code');

      const handler = mockToolHandlers.get('fw_scaffold')!;
      const outPath = path.join(tmpDir, 'multi-workflow.ts');

      // Scaffold first workflow — creates file
      await handler({ template: 'simple', filePath: outPath, name: 'workflowA' });
      expect(fs.existsSync(outPath)).toBe(true);
      const contentAfterFirst = fs.readFileSync(outPath, 'utf8');
      expect(contentAfterFirst).toContain('// workflow A code');

      // Scaffold second workflow — should APPEND, not overwrite
      await handler({ template: 'simple', filePath: outPath, name: 'workflowB' });
      const contentAfterSecond = fs.readFileSync(outPath, 'utf8');

      // Both workflows must be present
      expect(contentAfterSecond).toContain('// workflow A code');
      expect(contentAfterSecond).toContain('// workflow B code');
    });
  });

  describe('fw_query', () => {
    beforeEach(() => {
      mockParseWorkflow.mockResolvedValue({ ast: fakeAST, errors: [], warnings: [] });
    });

    it('queries nodes', async () => {
      mockGetNodes.mockReturnValue(fakeAST.instances);
      const handler = mockToolHandlers.get('fw_query')!;
      const result = (await handler({ filePath: '/test/workflow.ts', query: 'nodes' })) as {
        content: Array<{ text: string }>;
      };
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.data).toHaveLength(2);
      expect(parsed.data[0].id).toBe('proc1');
    });

    it('queries connections', async () => {
      mockGetConnections.mockReturnValue(fakeAST.connections);
      const handler = mockToolHandlers.get('fw_query')!;
      const result = (await handler({ filePath: '/test/workflow.ts', query: 'connections' })) as {
        content: Array<{ text: string }>;
      };
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.data.length).toBeGreaterThan(0);
      expect(parsed.data[0].from).toContain('.');
    });

    it('queries deps with nodeId', async () => {
      mockGetDependencies.mockReturnValue(['proc1']);
      const handler = mockToolHandlers.get('fw_query')!;
      const result = (await handler({
        filePath: '/test/workflow.ts',
        query: 'deps',
        nodeId: 'proc2',
      })) as { content: Array<{ text: string }> };
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.data).toContain('proc1');
    });

    it('returns error for deps without nodeId', async () => {
      const handler = mockToolHandlers.get('fw_query')!;
      const result = (await handler({ filePath: '/test/workflow.ts', query: 'deps' })) as {
        isError: boolean;
        content: Array<{ text: string }>;
      };
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error.message).toContain('nodeId is required');
    });

    it('queries dependents with nodeId', async () => {
      mockGetDependents.mockReturnValue(['proc2']);
      const handler = mockToolHandlers.get('fw_query')!;
      const result = (await handler({
        filePath: '/test/workflow.ts',
        query: 'dependents',
        nodeId: 'proc1',
      })) as { content: Array<{ text: string }> };
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.data).toContain('proc2');
    });

    it('returns error for dependents without nodeId', async () => {
      const handler = mockToolHandlers.get('fw_query')!;
      const result = (await handler({ filePath: '/test/workflow.ts', query: 'dependents' })) as {
        isError: boolean;
        content: Array<{ text: string }>;
      };
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
    });

    it('queries execution-order', async () => {
      mockGetTopologicalOrder.mockReturnValue(['proc1', 'proc2']);
      const handler = mockToolHandlers.get('fw_query')!;
      const result = (await handler({
        filePath: '/test/workflow.ts',
        query: 'execution-order',
      })) as { content: Array<{ text: string }> };
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.data.order).toEqual(['proc1', 'proc2']);
    });

    it('returns structured error on cycle in execution-order', async () => {
      mockGetTopologicalOrder.mockImplementation(() => {
        throw new Error('Cannot compute topological order: workflow contains cycles');
      });
      const handler = mockToolHandlers.get('fw_query')!;
      const result = (await handler({
        filePath: '/test/workflow.ts',
        query: 'execution-order',
      })) as { content: Array<{ text: string }>; isError?: boolean };
      const parsed = JSON.parse(result.content[0].text);
      expect(result.isError).toBe(true);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe('CYCLE_DETECTED');
      expect(parsed.error.message).toContain('cycles');
    });

    it('execution-order includes scopedNodes when scoped nodes exist', async () => {
      const scopedAST = {
        ...fakeAST,
        instances: [
          ...fakeAST.instances,
          { id: 'scopedProc', nodeType: 'process', config: {}, parent: { id: 'proc1' } },
        ],
      };
      mockParseWorkflow.mockResolvedValue({ ast: scopedAST, errors: [], warnings: [] });
      mockGetTopologicalOrder.mockReturnValue(['proc1', 'proc2']);

      const handler = mockToolHandlers.get('fw_query')!;
      const result = (await handler({
        filePath: '/test/workflow.ts',
        query: 'execution-order',
      })) as { content: Array<{ text: string }> };
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.data.order).toEqual(['proc1', 'proc2']);
      expect(parsed.data.scopedNodes).toEqual(['scopedProc']);
      expect(parsed.data.note).toContain('Scoped nodes');
    });

    it('queries isolated nodes', async () => {
      mockFindIsolatedNodes.mockReturnValue([]);
      const handler = mockToolHandlers.get('fw_query')!;
      const result = (await handler({ filePath: '/test/workflow.ts', query: 'isolated' })) as {
        content: Array<{ text: string }>;
      };
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.data).toEqual([]);
    });

    it('queries dead-ends', async () => {
      mockFindDeadEndDetails.mockReturnValue({
        deadEndNodes: ['proc2'],
        disconnectedOutputs: [],
      });
      const handler = mockToolHandlers.get('fw_query')!;
      const result = (await handler({ filePath: '/test/workflow.ts', query: 'dead-ends' })) as {
        content: Array<{ text: string }>;
      };
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.data.deadEndNodes).toEqual(['proc2']);
      expect(parsed.data.disconnectedOutputs).toEqual([]);
    });

    it('queries node-types', async () => {
      const handler = mockToolHandlers.get('fw_query')!;
      const result = (await handler({ filePath: '/test/workflow.ts', query: 'node-types' })) as {
        content: Array<{ text: string }>;
      };
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.data).toHaveLength(2);
      expect(parsed.data[0].name).toBe('process');
      expect(parsed.data[0].inputs).toEqual(['execute']);
    });

    it('should return node types from node-type-only files', async () => {
      // First call fails (no workflows found), second call succeeds with nodeTypesOnly
      mockParseWorkflow
        .mockResolvedValueOnce({
          ast: {},
          errors: ['No workflows found in file'],
          warnings: [],
        })
        .mockResolvedValueOnce({
          ast: {
            nodeTypes: [
              {
                name: 'double',
                functionName: 'double',
                inputs: { x: { dataType: 'NUMBER' } },
                outputs: { result: { dataType: 'NUMBER' } },
              },
            ],
          },
          errors: [],
          warnings: [],
        });

      const handler = mockToolHandlers.get('fw_query')!;
      const result = (await handler({
        filePath: '/test/node-types.ts',
        query: 'node-types',
      })) as { content: Array<{ text: string }> };
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.data).toHaveLength(1);
      expect(parsed.data[0].name).toBe('double');
    });
  });

  describe('fw_list_patterns', () => {
    it('returns empty array when no patterns found', async () => {
      mockListPatterns.mockReturnValue([]);

      const handler = mockToolHandlers.get('fw_list_patterns')!;
      const result = (await handler({ filePath: '/test/patterns.ts' })) as {
        content: Array<{ text: string }>;
      };
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.data).toEqual([]);
    });

    it('returns patterns with ports and nodes via API', async () => {
      mockListPatterns.mockReturnValue([
        {
          name: 'retry-pattern',
          description: 'A retry pattern',
          inputPorts: [{ name: 'IN.data', description: 'Input data' }],
          outputPorts: [{ name: 'OUT.result', description: 'Output result' }],
          nodes: ['retry1', 'retry2'],
        },
      ]);

      const handler = mockToolHandlers.get('fw_list_patterns')!;
      const result = (await handler({ filePath: '/test/patterns.ts' })) as {
        content: Array<{ text: string }>;
      };
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.data).toHaveLength(1);
      expect(parsed.data[0].name).toBe('retry-pattern');
      expect(parsed.data[0].inputPorts[0].name).toBe('IN.data');
      expect(parsed.data[0].nodes).toEqual(['retry1', 'retry2']);
    });

    it('returns error on parse failure', async () => {
      mockListPatterns.mockImplementation(() => {
        throw new Error('File not found');
      });

      const handler = mockToolHandlers.get('fw_list_patterns')!;
      const result = (await handler({ filePath: '/test/missing.ts' })) as {
        isError: boolean;
        content: Array<{ text: string }>;
      };
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error.message).toContain('File not found');
    });
  });

  describe('fw_apply_pattern', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-apply-'));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('applies a pattern to a workflow file via API', async () => {
      const targetPath = path.join(tmpDir, 'target.ts');
      const originalContent = [
        '/**',
        ' * @flowWeaver workflow',
        ' * @node proc1 process',
        ' */',
        'function testWorkflow() {}',
      ].join('\n');
      fs.writeFileSync(targetPath, originalContent);

      mockAnnotationParserParse.mockImplementation((filePath: string) => {
        if (filePath === targetPath) {
          return { patterns: [], workflows: [fakeAST], nodeTypes: fakeAST.nodeTypes, errors: [] };
        }
        return {
          patterns: [
            {
              name: 'my-pattern',
              description: 'Test pattern',
              inputPorts: {},
              outputPorts: {},
              instances: [{ id: 'p1', nodeType: 'process', config: {} }],
              connections: [],
              nodeTypes: [],
            },
          ],
          workflows: [],
          nodeTypes: [],
          errors: [],
        };
      });

      const modifiedContent = originalContent.replace('*/', '* @node p1 process\n */');
      mockApplyPattern.mockReturnValue({
        modifiedContent,
        nodesAdded: 1,
        connectionsAdded: 0,
        nodeTypesAdded: [],
        conflicts: [],
        wiringInstructions: [],
      });

      const handler = mockToolHandlers.get('fw_apply_pattern')!;
      const result = (await handler({
        patternFile: '/test/pattern.ts',
        targetFile: targetPath,
      })) as { content: Array<{ text: string }> };
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.data.success).toBe(true);
      expect(parsed.data.nodesAdded).toBe(1);
      expect(parsed.data.conflicts).toEqual([]);
      expect(parsed.data.wiringInstructions).toEqual([]);

      // Verify file was modified
      const content = fs.readFileSync(targetPath, 'utf8');
      expect(content).toContain('@node p1 process');
    });

    it('includes conflict detection and wiring instructions', async () => {
      const targetPath = path.join(tmpDir, 'target-conflicts.ts');
      const originalContent = [
        '/**',
        ' * @flowWeaver workflow',
        ' * @node proc1 process',
        ' */',
        'function testWorkflow() {}',
      ].join('\n');
      fs.writeFileSync(targetPath, originalContent);

      mockAnnotationParserParse.mockImplementation((filePath: string) => {
        if (filePath === targetPath) {
          return { patterns: [], workflows: [fakeAST], nodeTypes: fakeAST.nodeTypes, errors: [] };
        }
        return {
          patterns: [
            {
              name: 'my-pattern',
              inputPorts: {},
              outputPorts: {},
              instances: [{ id: 'p1', nodeType: 'process', config: {} }],
              connections: [],
              nodeTypes: [{ name: 'process' }],
            },
          ],
          workflows: [],
          nodeTypes: [],
          errors: [],
        };
      });

      mockApplyPattern.mockReturnValue({
        modifiedContent: originalContent,
        nodesAdded: 1,
        connectionsAdded: 0,
        nodeTypesAdded: [],
        conflicts: ['process'],
        wiringInstructions: ['Connect to p1.execute from IN.data'],
      });

      const handler = mockToolHandlers.get('fw_apply_pattern')!;
      const result = (await handler({
        patternFile: '/test/pattern.ts',
        targetFile: targetPath,
      })) as { content: Array<{ text: string }> };
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.data.success).toBe(true);
      expect(parsed.data.conflicts).toEqual(['process']);
      expect(parsed.data.wiringInstructions).toEqual(['Connect to p1.execute from IN.data']);
    });

    it('supports preview mode with full result', async () => {
      const targetPath = path.join(tmpDir, 'target-preview.ts');
      const originalContent = [
        '/**',
        ' * @flowWeaver workflow',
        ' * @node proc1 process',
        ' */',
        'function testWorkflow() {}',
      ].join('\n');
      fs.writeFileSync(targetPath, originalContent);

      mockAnnotationParserParse.mockImplementation((filePath: string) => {
        if (filePath === targetPath) {
          return { patterns: [], workflows: [fakeAST], nodeTypes: fakeAST.nodeTypes, errors: [] };
        }
        return {
          patterns: [
            {
              name: 'my-pattern',
              inputPorts: {},
              outputPorts: {},
              instances: [{ id: 'p1', nodeType: 'process', config: {} }],
              connections: [],
              nodeTypes: [],
            },
          ],
          workflows: [],
          nodeTypes: [],
          errors: [],
        };
      });

      const previewContent = originalContent + '\n// preview applied';
      mockApplyPattern.mockReturnValue({
        modifiedContent: previewContent,
        nodesAdded: 1,
        connectionsAdded: 0,
        nodeTypesAdded: ['newType'],
        conflicts: [],
        wiringInstructions: ['Wire IN.data'],
      });

      const handler = mockToolHandlers.get('fw_apply_pattern')!;
      const result = (await handler({
        patternFile: '/test/pattern.ts',
        targetFile: targetPath,
        preview: true,
      })) as { content: Array<{ text: string }> };
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.data.preview).toBe(true);
      expect(parsed.data.content).toContain('// preview applied');
      expect(parsed.data.nodeTypesAdded).toEqual(['newType']);
      expect(parsed.data.wiringInstructions).toEqual(['Wire IN.data']);

      // File should not be modified
      expect(fs.readFileSync(targetPath, 'utf8')).toBe(originalContent);
    });

    it('returns error when no patterns found', async () => {
      mockAnnotationParserParse.mockReturnValue({
        patterns: [],
        workflows: [],
        nodeTypes: [],
        errors: [],
      });

      const handler = mockToolHandlers.get('fw_apply_pattern')!;
      const result = (await handler({
        patternFile: '/test/empty.ts',
        targetFile: '/test/target.ts',
      })) as { isError: boolean; content: Array<{ text: string }> };
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error.message).toContain('No patterns found');
    });

    it('passes prefix to applyPattern API', async () => {
      const targetPath = path.join(tmpDir, 'target-prefix.ts');
      fs.writeFileSync(
        targetPath,
        [
          '/**',
          ' * @flowWeaver workflow',
          ' * @node proc1 process',
          ' */',
          'function testWorkflow() {}',
        ].join('\n')
      );

      mockAnnotationParserParse.mockImplementation((filePath: string) => {
        if (filePath === targetPath) {
          return { patterns: [], workflows: [fakeAST], nodeTypes: fakeAST.nodeTypes, errors: [] };
        }
        return {
          patterns: [
            {
              name: 'my-pattern',
              inputPorts: {},
              outputPorts: {},
              instances: [{ id: 'p1', nodeType: 'process', config: {} }],
              connections: [],
              nodeTypes: [],
            },
          ],
          workflows: [],
          nodeTypes: [],
          errors: [],
        };
      });

      mockApplyPattern.mockReturnValue({
        modifiedContent: '// modified with prefix',
        nodesAdded: 1,
        connectionsAdded: 0,
        nodeTypesAdded: [],
        conflicts: [],
        wiringInstructions: [],
      });

      const handler = mockToolHandlers.get('fw_apply_pattern')!;
      const result = (await handler({
        patternFile: '/test/pattern.ts',
        targetFile: targetPath,
        prefix: 'retry',
      })) as { content: Array<{ text: string }> };
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.data.success).toBe(true);

      // Verify applyPattern was called with prefix
      expect(mockApplyPattern).toHaveBeenCalledWith(expect.objectContaining({ prefix: 'retry' }));
    });
  });

  describe('fw_find_workflows', () => {
    it('returns workflow file info', async () => {
      mockFindWorkflows.mockResolvedValue([
        {
          filePath: '/test/dir/workflow.ts',
          workflows: [
            { name: 'myWorkflow', functionName: 'myWorkflow', nodeCount: 3, connectionCount: 2 },
          ],
        },
      ]);

      const handler = mockToolHandlers.get('fw_find_workflows')!;
      const result = (await handler({ directory: '/test/dir' })) as {
        content: Array<{ text: string }>;
      };
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.data).toHaveLength(1);
      expect(parsed.data[0].filePath).toBe('/test/dir/workflow.ts');
      expect(parsed.data[0].workflows[0].name).toBe('myWorkflow');
      expect(parsed.data[0].workflows[0].nodeCount).toBe(3);
    });

    it('returns empty array when no workflows found', async () => {
      mockFindWorkflows.mockResolvedValue([]);

      const handler = mockToolHandlers.get('fw_find_workflows')!;
      const result = (await handler({ directory: '/test/empty' })) as {
        content: Array<{ text: string }>;
      };
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.data).toEqual([]);
    });

    it('passes custom pattern to findWorkflows', async () => {
      mockFindWorkflows.mockResolvedValue([]);

      const handler = mockToolHandlers.get('fw_find_workflows')!;
      await handler({ directory: '/test/dir', pattern: 'src/**/*.workflow.ts' });
      expect(mockFindWorkflows).toHaveBeenCalledWith(expect.any(String), 'src/**/*.workflow.ts');
    });

    it('returns error on failure', async () => {
      mockFindWorkflows.mockRejectedValue(new Error('Directory not found'));

      const handler = mockToolHandlers.get('fw_find_workflows')!;
      const result = (await handler({ directory: '/nonexistent' })) as {
        isError: boolean;
        content: Array<{ text: string }>;
      };
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error.message).toContain('Directory not found');
    });
  });

  describe('fw_modify', () => {
    let modifiedAST: ReturnType<typeof makeFakeAST>;
    beforeEach(() => {
      modifiedAST = { ...fakeAST, functionName: 'modified' };
    });

    it('adds a node and writes file', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-modify-'));
      const filePath = path.join(tmpDir, 'workflow.ts');
      fs.writeFileSync(filePath, '// original source');

      mockParseWorkflow.mockResolvedValue({ ast: fakeAST, errors: [], warnings: [] });
      mockManipAddNode.mockReturnValue(modifiedAST);
      mockGenerateInPlace.mockReturnValue({ code: '// modified source', hasChanges: true });

      try {
        const handler = mockToolHandlers.get('fw_modify')!;
        const result = (await handler({
          filePath,
          operation: 'addNode',
          params: { nodeId: 'newNode', nodeType: 'process', x: 100, y: 200 },
        })) as { content: Array<{ text: string }> };
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.success).toBe(true);
        expect(parsed.data.success).toBe(true);
        expect(parsed.data.hasChanges).toBe(true);
        expect(parsed.data.operation).toBe('addNode');
        expect(fs.readFileSync(filePath, 'utf8')).toBe('// modified source');
        expect(mockManipAddNode).toHaveBeenCalledWith(
          fakeAST,
          expect.objectContaining({ id: 'newNode', nodeType: 'process' })
        );
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('removes a node', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-modify-'));
      const filePath = path.join(tmpDir, 'workflow.ts');
      fs.writeFileSync(filePath, '// source');

      mockParseWorkflow.mockResolvedValue({ ast: fakeAST, errors: [], warnings: [] });
      mockManipRemoveNode.mockReturnValue(modifiedAST);
      mockGenerateInPlace.mockReturnValue({ code: '// removed', hasChanges: true });

      try {
        const handler = mockToolHandlers.get('fw_modify')!;
        const result = (await handler({
          filePath,
          operation: 'removeNode',
          params: { nodeId: 'proc1' },
        })) as { content: Array<{ text: string }> };
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.success).toBe(true);
        expect(parsed.data.success).toBe(true);
        expect(mockManipRemoveNode).toHaveBeenCalledWith(fakeAST, 'proc1');
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('renames a node', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-modify-'));
      const filePath = path.join(tmpDir, 'workflow.ts');
      fs.writeFileSync(filePath, '// source');

      mockParseWorkflow.mockResolvedValue({ ast: fakeAST, errors: [], warnings: [] });
      mockManipRenameNode.mockReturnValue(modifiedAST);
      mockGenerateInPlace.mockReturnValue({ code: '// renamed', hasChanges: true });

      try {
        const handler = mockToolHandlers.get('fw_modify')!;
        const result = (await handler({
          filePath,
          operation: 'renameNode',
          params: { oldId: 'proc1', newId: 'processor1' },
        })) as { content: Array<{ text: string }> };
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.success).toBe(true);
        expect(parsed.data.success).toBe(true);
        expect(mockManipRenameNode).toHaveBeenCalledWith(fakeAST, 'proc1', 'processor1');
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('adds a connection', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-modify-'));
      const filePath = path.join(tmpDir, 'workflow.ts');
      fs.writeFileSync(filePath, '// source');

      mockParseWorkflow.mockResolvedValue({ ast: fakeAST, errors: [], warnings: [] });
      mockManipAddConnection.mockReturnValue(modifiedAST);
      mockGenerateInPlace.mockReturnValue({ code: '// connected', hasChanges: true });

      try {
        const handler = mockToolHandlers.get('fw_modify')!;
        const result = (await handler({
          filePath,
          operation: 'addConnection',
          params: { from: 'proc1.onSuccess', to: 'proc2.execute' },
        })) as { content: Array<{ text: string }> };
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.success).toBe(true);
        expect(parsed.data.success).toBe(true);
        expect(mockManipAddConnection).toHaveBeenCalledWith(
          fakeAST,
          'proc1.onSuccess',
          'proc2.execute'
        );
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('removes a connection', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-modify-'));
      const filePath = path.join(tmpDir, 'workflow.ts');
      fs.writeFileSync(filePath, '// source');

      mockParseWorkflow.mockResolvedValue({ ast: fakeAST, errors: [], warnings: [] });
      mockManipRemoveConnection.mockReturnValue(modifiedAST);
      mockGenerateInPlace.mockReturnValue({ code: '// disconnected', hasChanges: true });

      try {
        const handler = mockToolHandlers.get('fw_modify')!;
        const result = (await handler({
          filePath,
          operation: 'removeConnection',
          params: { from: 'proc1.onSuccess', to: 'proc2.execute' },
        })) as { content: Array<{ text: string }> };
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.success).toBe(true);
        expect(parsed.data.success).toBe(true);
        expect(mockManipRemoveConnection).toHaveBeenCalledWith(
          fakeAST,
          'proc1.onSuccess',
          'proc2.execute'
        );
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('sets node position', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-modify-'));
      const filePath = path.join(tmpDir, 'workflow.ts');
      fs.writeFileSync(filePath, '// source');

      mockParseWorkflow.mockResolvedValue({ ast: fakeAST, errors: [], warnings: [] });
      mockManipSetNodePosition.mockReturnValue(modifiedAST);
      mockGenerateInPlace.mockReturnValue({ code: '// positioned', hasChanges: true });

      try {
        const handler = mockToolHandlers.get('fw_modify')!;
        const result = (await handler({
          filePath,
          operation: 'setNodePosition',
          params: { nodeId: 'proc1', x: 300, y: 400 },
        })) as { content: Array<{ text: string }> };
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.success).toBe(true);
        expect(parsed.data.success).toBe(true);
        expect(mockManipSetNodePosition).toHaveBeenCalledWith(fakeAST, 'proc1', 300, 400);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('sets node label', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-modify-'));
      const filePath = path.join(tmpDir, 'workflow.ts');
      fs.writeFileSync(filePath, '// source');

      mockParseWorkflow.mockResolvedValue({ ast: fakeAST, errors: [], warnings: [] });
      mockManipSetNodeLabel.mockReturnValue(modifiedAST);
      mockGenerateInPlace.mockReturnValue({ code: '// labeled', hasChanges: true });

      try {
        const handler = mockToolHandlers.get('fw_modify')!;
        const result = (await handler({
          filePath,
          operation: 'setNodeLabel',
          params: { nodeId: 'proc1', label: 'My Processor' },
        })) as { content: Array<{ text: string }> };
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.success).toBe(true);
        expect(parsed.data.success).toBe(true);
        expect(mockManipSetNodeLabel).toHaveBeenCalledWith(fakeAST, 'proc1', 'My Processor');
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('supports preview mode', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-modify-'));
      const filePath = path.join(tmpDir, 'workflow.ts');
      const originalContent = '// original source';
      fs.writeFileSync(filePath, originalContent);

      mockParseWorkflow.mockResolvedValue({ ast: fakeAST, errors: [], warnings: [] });
      mockManipAddNode.mockReturnValue(modifiedAST);
      mockGenerateInPlace.mockReturnValue({ code: '// modified source', hasChanges: true });

      try {
        const handler = mockToolHandlers.get('fw_modify')!;
        const result = (await handler({
          filePath,
          operation: 'addNode',
          params: { nodeId: 'newNode', nodeType: 'process' },
          preview: true,
        })) as { content: Array<{ text: string }> };
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.success).toBe(true);
        expect(parsed.data.success).toBe(true);
        expect(parsed.data.preview).toBe(true);
        expect(parsed.data.code).toBe('// modified source');
        // File should not be modified
        expect(fs.readFileSync(filePath, 'utf8')).toBe(originalContent);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('returns error on parse failure', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-modify-'));
      const filePath = path.join(tmpDir, 'workflow.ts');
      fs.writeFileSync(filePath, '// source');

      mockParseWorkflow.mockResolvedValue({ ast: {}, errors: ['Syntax error'], warnings: [] });

      try {
        const handler = mockToolHandlers.get('fw_modify')!;
        const result = (await handler({
          filePath,
          operation: 'addNode',
          params: { nodeId: 'x', nodeType: 'y' },
        })) as { isError: boolean; content: Array<{ text: string }> };
        expect(result.isError).toBe(true);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.success).toBe(false);
        expect(parsed.error.message).toContain('Parse errors');
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('returns error for missing required params', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-modify-'));
      const filePath = path.join(tmpDir, 'workflow.ts');
      fs.writeFileSync(filePath, '// source');

      mockParseWorkflow.mockResolvedValue({ ast: fakeAST, errors: [], warnings: [] });

      try {
        const handler = mockToolHandlers.get('fw_modify')!;
        const result = (await handler({
          filePath,
          operation: 'addNode',
          params: { nodeId: 'x' }, // missing nodeType
        })) as { isError: boolean; content: Array<{ text: string }> };
        expect(result.isError).toBe(true);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.success).toBe(false);
        expect(parsed.error.message).toContain('addNode params invalid');
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('rejects non-numeric x/y for setNodePosition', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-modify-'));
      const filePath = path.join(tmpDir, 'workflow.ts');
      fs.writeFileSync(filePath, '// source');

      try {
        const handler = mockToolHandlers.get('fw_modify')!;
        const result = (await handler({
          filePath,
          operation: 'setNodePosition',
          params: { nodeId: 'proc1', x: 'not-a-number', y: 200 },
        })) as { isError: boolean; content: Array<{ text: string }> };
        expect(result.isError).toBe(true);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.success).toBe(false);
        expect(parsed.error.message).toContain('setNodePosition params invalid');
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('rejects missing from/to for addConnection', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-modify-'));
      const filePath = path.join(tmpDir, 'workflow.ts');
      fs.writeFileSync(filePath, '// source');

      try {
        const handler = mockToolHandlers.get('fw_modify')!;
        const result = (await handler({
          filePath,
          operation: 'addConnection',
          params: { from: 'proc1.onSuccess' }, // missing "to"
        })) as { isError: boolean; content: Array<{ text: string }> };
        expect(result.isError).toBe(true);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.success).toBe(false);
        expect(parsed.error.message).toContain('addConnection params invalid');
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('rejects missing label for setNodeLabel', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-modify-'));
      const filePath = path.join(tmpDir, 'workflow.ts');
      fs.writeFileSync(filePath, '// source');

      try {
        const handler = mockToolHandlers.get('fw_modify')!;
        const result = (await handler({
          filePath,
          operation: 'setNodeLabel',
          params: { nodeId: 'proc1' }, // missing "label"
        })) as { isError: boolean; content: Array<{ text: string }> };
        expect(result.isError).toBe(true);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.success).toBe(false);
        expect(parsed.error.message).toContain('setNodeLabel params invalid');
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('does not write when no changes', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-modify-'));
      const filePath = path.join(tmpDir, 'workflow.ts');
      const originalContent = '// source';
      fs.writeFileSync(filePath, originalContent);

      mockParseWorkflow.mockResolvedValue({ ast: fakeAST, errors: [], warnings: [] });
      mockManipAddNode.mockReturnValue(modifiedAST);
      mockGenerateInPlace.mockReturnValue({ code: originalContent, hasChanges: false });

      try {
        const handler = mockToolHandlers.get('fw_modify')!;
        const result = (await handler({
          filePath,
          operation: 'addNode',
          params: { nodeId: 'x', nodeType: 'y' },
        })) as { content: Array<{ text: string }> };
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.success).toBe(true);
        expect(parsed.data.success).toBe(true);
        expect(parsed.data.hasChanges).toBe(false);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('returns warning when addNode uses undefined node type', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-modify-'));
      const filePath = path.join(tmpDir, 'workflow.ts');
      fs.writeFileSync(filePath, '// source');

      mockParseWorkflow.mockResolvedValue({ ast: fakeAST, errors: [], warnings: [] });
      mockManipAddNode.mockReturnValue(modifiedAST);
      mockGenerateInPlace.mockReturnValue({ code: '// modified', hasChanges: true });

      try {
        const handler = mockToolHandlers.get('fw_modify')!;
        const result = (await handler({
          filePath,
          operation: 'addNode',
          params: { nodeId: 'myNode', nodeType: 'nonExistentType' },
        })) as { content: Array<{ text: string }> };
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.success).toBe(true);
        expect(parsed.data.success).toBe(true);
        expect(parsed.data.warnings).toBeDefined();
        expect(parsed.data.warnings.length).toBeGreaterThan(0);
        expect(parsed.data.warnings[0]).toContain('nonExistentType');
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('returns no warning when addNode uses existing node type', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-modify-'));
      const filePath = path.join(tmpDir, 'workflow.ts');
      fs.writeFileSync(filePath, '// source');

      mockParseWorkflow.mockResolvedValue({ ast: fakeAST, errors: [], warnings: [] });
      mockManipAddNode.mockReturnValue(modifiedAST);
      mockGenerateInPlace.mockReturnValue({ code: '// modified', hasChanges: true });

      try {
        const handler = mockToolHandlers.get('fw_modify')!;
        const result = (await handler({
          filePath,
          operation: 'addNode',
          // 'process' exists in fakeAST.nodeTypes
          params: { nodeId: 'myNode', nodeType: 'process' },
        })) as { content: Array<{ text: string }> };
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.success).toBe(true);
        expect(parsed.data.success).toBe(true);
        expect(parsed.data.warnings).toBeUndefined();
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    // ─── addConnection pre-validation tests ────────────────────────────
    it('should reject connection from non-existent source node', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-modify-'));
      const filePath = path.join(tmpDir, 'workflow.ts');
      fs.writeFileSync(filePath, '// source');

      mockParseWorkflow.mockResolvedValue({ ast: fakeAST, errors: [], warnings: [] });

      try {
        const handler = mockToolHandlers.get('fw_modify')!;
        const result = (await handler({
          filePath,
          operation: 'addConnection',
          params: { from: 'ghost.output', to: 'proc1.execute' },
        })) as { content: Array<{ text: string }> };
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.success).toBe(false);
        expect(parsed.error.code).toBe('UNKNOWN_SOURCE_NODE');

        // manipAddConnection should NOT have been called
        expect(mockManipAddConnection).not.toHaveBeenCalled();
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('should reject connection to non-existent target node', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-modify-'));
      const filePath = path.join(tmpDir, 'workflow.ts');
      fs.writeFileSync(filePath, '// source');

      mockParseWorkflow.mockResolvedValue({ ast: fakeAST, errors: [], warnings: [] });

      try {
        const handler = mockToolHandlers.get('fw_modify')!;
        const result = (await handler({
          filePath,
          operation: 'addConnection',
          params: { from: 'proc1.onSuccess', to: 'ghost.execute' },
        })) as { content: Array<{ text: string }> };
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.success).toBe(false);
        expect(parsed.error.code).toBe('UNKNOWN_TARGET_NODE');
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('should accept connection between valid nodes', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-modify-'));
      const filePath = path.join(tmpDir, 'workflow.ts');
      fs.writeFileSync(filePath, '// source');

      mockParseWorkflow.mockResolvedValue({ ast: fakeAST, errors: [], warnings: [] });
      mockManipAddConnection.mockReturnValue({ ...fakeAST, functionName: 'modified' });
      mockGenerateInPlace.mockReturnValue({ code: '// connected', hasChanges: true });

      try {
        const handler = mockToolHandlers.get('fw_modify')!;
        const result = (await handler({
          filePath,
          operation: 'addConnection',
          params: { from: 'Start.execute', to: 'proc1.execute' },
        })) as { content: Array<{ text: string }> };
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.success).toBe(true);
        expect(mockManipAddConnection).toHaveBeenCalled();
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('should reject connection with invalid format (missing port)', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-modify-'));
      const filePath = path.join(tmpDir, 'workflow.ts');
      fs.writeFileSync(filePath, '// source');

      mockParseWorkflow.mockResolvedValue({ ast: fakeAST, errors: [], warnings: [] });

      try {
        const handler = mockToolHandlers.get('fw_modify')!;
        const result = (await handler({
          filePath,
          operation: 'addConnection',
          params: { from: 'proc1', to: 'proc2.execute' },
        })) as { content: Array<{ text: string }> };
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.success).toBe(false);
        expect(parsed.error.code).toBe('INVALID_PARAMS');
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe('fw_extract_pattern', () => {
    it('extracts a pattern and returns preview by default', async () => {
      mockParseWorkflow.mockResolvedValue({ ast: fakeAST, errors: [], warnings: [] });
      mockAnnotationParserParse.mockReturnValue({
        patterns: [],
        workflows: [fakeAST],
        nodeTypes: fakeAST.nodeTypes,
        errors: [],
      });
      mockExtractPattern.mockReturnValue({
        patternCode: '// pattern code',
        patternName: 'my-pattern',
        nodes: ['proc1', 'proc2'],
        inputPorts: ['execute'],
        outputPorts: ['onSuccess'],
        internalConnectionCount: 1,
      });

      const handler = mockToolHandlers.get('fw_extract_pattern')!;
      const result = (await handler({
        sourceFile: '/test/workflow.ts',
        nodes: 'proc1,proc2',
        name: 'my-pattern',
      })) as { content: Array<{ text: string }> };
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.data.success).toBe(true);
      expect(parsed.data.preview).toBe(true);
      expect(parsed.data.patternName).toBe('my-pattern');
      expect(parsed.data.nodes).toEqual(['proc1', 'proc2']);
      expect(parsed.data.code).toBe('// pattern code');
    });

    it('writes to output file when provided', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-extract-'));

      mockParseWorkflow.mockResolvedValue({ ast: fakeAST, errors: [], warnings: [] });
      mockAnnotationParserParse.mockReturnValue({
        patterns: [],
        workflows: [fakeAST],
        nodeTypes: fakeAST.nodeTypes,
        errors: [],
      });
      mockExtractPattern.mockReturnValue({
        patternCode: '// extracted pattern code',
        patternName: 'extracted',
        nodes: ['proc1'],
        inputPorts: [],
        outputPorts: [],
        internalConnectionCount: 0,
      });

      try {
        const outPath = path.join(tmpDir, 'pattern.ts');
        const handler = mockToolHandlers.get('fw_extract_pattern')!;
        const result = (await handler({
          sourceFile: '/test/workflow.ts',
          nodes: 'proc1',
          outputFile: outPath,
        })) as { content: Array<{ text: string }> };
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.success).toBe(true);
        expect(parsed.data.success).toBe(true);
        expect(parsed.data.preview).toBeUndefined();
        expect(parsed.data.filePath).toBe(outPath);
        expect(fs.readFileSync(outPath, 'utf8')).toBe('// extracted pattern code');
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('returns error on parse failure', async () => {
      mockParseWorkflow.mockResolvedValue({
        ast: {},
        errors: ['No workflows found'],
        warnings: [],
      });

      const handler = mockToolHandlers.get('fw_extract_pattern')!;
      const result = (await handler({
        sourceFile: '/test/bad.ts',
        nodes: 'proc1',
      })) as { isError: boolean; content: Array<{ text: string }> };
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error.message).toContain('Parse errors');
    });

    it('returns error when nodes not found', async () => {
      mockParseWorkflow.mockResolvedValue({ ast: fakeAST, errors: [], warnings: [] });
      mockAnnotationParserParse.mockReturnValue({
        patterns: [],
        workflows: [fakeAST],
        nodeTypes: fakeAST.nodeTypes,
        errors: [],
      });
      mockExtractPattern.mockImplementation(() => {
        throw new Error('Nodes not found: missing1, missing2');
      });

      const handler = mockToolHandlers.get('fw_extract_pattern')!;
      const result = (await handler({
        sourceFile: '/test/workflow.ts',
        nodes: 'missing1,missing2',
      })) as { isError: boolean; content: Array<{ text: string }> };
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error.message).toContain('Nodes not found');
    });
  });

  // ─── Bug 3: fw_compile returns correct outputFile ───────────────────
  describe('fw_compile outputFile (Bug 3)', () => {
    it('uses outputFile from metadata when available', async () => {
      mockCompileWorkflow.mockResolvedValue({
        code: '// compiled code',
        ast: fakeAST,
        metadata: {
          outputFile: '/output/compiled-workflow.ts',
          warnings: [],
        },
      });

      const handler = mockToolHandlers.get('fw_compile')!;
      const result = (await handler({ filePath: '/test/workflow.ts' })) as {
        content: Array<{ text: string }>;
      };
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.data.outputFile).toBe('/output/compiled-workflow.ts');
    });

    it('falls back to filePath when metadata has no outputFile', async () => {
      mockCompileWorkflow.mockResolvedValue({
        code: '// compiled code',
        ast: fakeAST,
        metadata: { warnings: [] },
      });

      const handler = mockToolHandlers.get('fw_compile')!;
      const result = (await handler({ filePath: '/test/workflow.ts' })) as {
        content: Array<{ text: string }>;
      };
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      // Should fall back to the resolved filePath
      expect(parsed.data.outputFile).toBeDefined();
    });
  });

  // ─── MCP response envelope format tests ─────────────────────────────
  describe('MCP response envelope format', () => {
    it('success responses wrap data in { success: true, data }', async () => {
      mockParseWorkflow.mockResolvedValue({ ast: fakeAST, errors: [], warnings: [] });
      mockValidateWorkflow.mockReturnValue({ valid: true, errors: [], warnings: [] });

      const handler = mockToolHandlers.get('fw_validate')!;
      const result = (await handler({ filePath: '/test/workflow.ts' })) as {
        content: Array<{ text: string }>;
      };
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveProperty('success', true);
      expect(parsed).toHaveProperty('data');
      expect(parsed.data.valid).toBe(true);
    });

    it('error responses wrap in { success: false, error: { code, message } }', async () => {
      mockParseWorkflow.mockResolvedValue({ ast: {}, errors: ['Syntax error'], warnings: [] });

      const handler = mockToolHandlers.get('fw_describe')!;
      const result = (await handler({ filePath: '/test/bad.ts' })) as {
        isError: boolean;
        content: Array<{ text: string }>;
      };
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveProperty('success', false);
      expect(parsed.error).toHaveProperty('code');
      expect(parsed.error).toHaveProperty('message');
    });

    it('fw_validate wraps result in { success: true, data: { valid, errors, warnings } }', async () => {
      mockParseWorkflow.mockResolvedValue({ ast: fakeAST, errors: [], warnings: [] });
      mockValidateWorkflow.mockReturnValue({ valid: true, errors: [], warnings: [] });

      const handler = mockToolHandlers.get('fw_validate')!;
      const result = (await handler({ filePath: '/test/workflow.ts' })) as {
        content: Array<{ text: string }>;
      };
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.data).toHaveProperty('valid');
      expect(parsed.data).toHaveProperty('errors');
      expect(parsed.data).toHaveProperty('warnings');
    });

    it('fw_compile returns { success: true, data: { outputFile, warnings } }', async () => {
      mockCompileWorkflow.mockResolvedValue({
        code: '// code',
        ast: fakeAST,
        analysis: { warnings: ['test warning'] },
        metadata: { outputFile: '/out.ts' },
      });

      const handler = mockToolHandlers.get('fw_compile')!;
      const result = (await handler({ filePath: '/test/workflow.ts' })) as {
        content: Array<{ text: string }>;
      };
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.data).toHaveProperty('outputFile');
      expect(parsed.data).toHaveProperty('warnings');
    });

    it('fw_query returns { success: true, data: [...] } not raw arrays', async () => {
      mockParseWorkflow.mockResolvedValue({ ast: fakeAST, errors: [], warnings: [] });
      mockGetNodes.mockReturnValue(fakeAST.instances);

      const handler = mockToolHandlers.get('fw_query')!;
      const result = (await handler({ filePath: '/test/workflow.ts', query: 'nodes' })) as {
        content: Array<{ text: string }>;
      };
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(Array.isArray(parsed.data)).toBe(true);
    });

    it('fw_query cycle error returns { success: false, error: { code: "CYCLE_DETECTED" } }', async () => {
      mockParseWorkflow.mockResolvedValue({ ast: fakeAST, errors: [], warnings: [] });
      mockGetTopologicalOrder.mockImplementation(() => {
        throw new Error('Cycle found');
      });

      const handler = mockToolHandlers.get('fw_query')!;
      const result = (await handler({
        filePath: '/test/workflow.ts',
        query: 'execution-order',
      })) as { isError: boolean; content: Array<{ text: string }> };
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe('CYCLE_DETECTED');
    });

    it('fw_describe text/mermaid returns { success: true, data: <string> }', async () => {
      mockParseWorkflow.mockResolvedValue({ ast: fakeAST, errors: [], warnings: [] });
      mockDescribeWorkflow.mockReturnValue({ name: 'test', nodes: [] });
      mockFormatDescribeOutput.mockReturnValue('graph LR\\n  A --> B');

      const handler = mockToolHandlers.get('fw_describe')!;
      const result = (await handler({ filePath: '/test/workflow.ts', format: 'mermaid' })) as {
        content: Array<{ text: string }>;
      };
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(typeof parsed.data).toBe('string');
    });
  });

  // ─── fw_execute_workflow (P1 + P2) ──────────────────────────────────
  describe('fw_execute_workflow', () => {
    it('filePath provided -> compiles and executes, returns result', async () => {
      mockExecuteWorkflowFromFile.mockResolvedValue({
        result: { onSuccess: true, value: 42 },
        functionName: 'myWorkflow',
        executionTime: 15,
        trace: [],
      });

      const handler = mockToolHandlers.get('fw_execute_workflow')!;
      const result = (await handler({
        filePath: '/test/workflow.ts',
        params: { value: 5 },
      })) as { content: Array<{ text: string }> };
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.success).toBe(true);
      expect(parsed.data.result).toEqual({ onSuccess: true, value: 42 });
      expect(parsed.data.functionName).toBe('myWorkflow');
      expect(parsed.data.executionTime).toBe(15);
      expect(mockExecuteWorkflowFromFile).toHaveBeenCalledWith(
        '/test/workflow.ts',
        { value: 5 },
        expect.objectContaining({ workflowName: undefined, includeTrace: undefined })
      );
    });

    it('filePath provided, compile fails -> returns COMPILE_ERROR', async () => {
      mockExecuteWorkflowFromFile.mockRejectedValue(
        new Error('Parse errors:\nSyntax error at line 5')
      );

      const handler = mockToolHandlers.get('fw_execute_workflow')!;
      const result = (await handler({
        filePath: '/test/bad-workflow.ts',
      })) as { isError: boolean; content: Array<{ text: string }> };

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe('COMPILE_ERROR');
      expect(parsed.error.message).toContain('Parse errors');
    });

    it('filePath provided, execution throws -> returns EXECUTION_ERROR', async () => {
      mockExecuteWorkflowFromFile.mockRejectedValue(
        new Error('TypeError: Cannot read property "x" of undefined')
      );

      const handler = mockToolHandlers.get('fw_execute_workflow')!;
      const result = (await handler({
        filePath: '/test/workflow.ts',
      })) as { isError: boolean; content: Array<{ text: string }> };

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe('EXECUTION_ERROR');
    });

    it('no filePath -> delegates to editor', async () => {
      conn.connect();
      mockSocket._trigger('connect');

      const handler = mockToolHandlers.get('fw_execute_workflow')!;
      await handler({
        params: { data: 'test' },
      });

      // Should have called sendCommand, not executeWorkflowFromFile
      expect(mockExecuteWorkflowFromFile).not.toHaveBeenCalled();
      expect(mockSocket.emit).toHaveBeenCalled();
    });

    it('includes execution trace when filePath provided', async () => {
      const traceEvents = [
        { type: 'STATUS_CHANGED', timestamp: 1000, data: { nodeId: 'proc1', status: 'running' } },
        {
          type: 'VARIABLE_SET',
          timestamp: 1001,
          data: { nodeId: 'proc1', name: 'result', value: 42 },
        },
      ];
      mockExecuteWorkflowFromFile.mockResolvedValue({
        result: { onSuccess: true },
        functionName: 'myWorkflow',
        executionTime: 10,
        trace: traceEvents,
      });

      const handler = mockToolHandlers.get('fw_execute_workflow')!;
      const result = (await handler({
        filePath: '/test/workflow.ts',
        includeTrace: true,
      })) as { content: Array<{ text: string }> };
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.success).toBe(true);
      expect(parsed.data.trace).toHaveLength(2);
      expect(parsed.data.trace[0].type).toBe('STATUS_CHANGED');
      expect(parsed.data.trace[1].type).toBe('VARIABLE_SET');
    });

    it('trace events are ordered chronologically', async () => {
      const traceEvents = [
        { type: 'STATUS_CHANGED', timestamp: 100, data: {} },
        { type: 'VARIABLE_SET', timestamp: 200, data: {} },
        { type: 'STATUS_CHANGED', timestamp: 300, data: {} },
      ];
      mockExecuteWorkflowFromFile.mockResolvedValue({
        result: { onSuccess: true },
        functionName: 'myWorkflow',
        executionTime: 5,
        trace: traceEvents,
      });

      const handler = mockToolHandlers.get('fw_execute_workflow')!;
      const result = (await handler({
        filePath: '/test/workflow.ts',
      })) as { content: Array<{ text: string }> };
      const parsed = JSON.parse(result.content[0].text);

      const timestamps = parsed.data.trace.map((e: { timestamp: number }) => e.timestamp);
      for (let i = 1; i < timestamps.length; i++) {
        expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1]);
      }
    });
  });

  // ─── fw_describe on node-type-only files (P3) ─────────────────────────
  describe('fw_describe node-type-only fallback', () => {
    it('returns node type info for node-type-only files', async () => {
      // First parse fails with "No workflows found"
      mockParseWorkflow
        .mockResolvedValueOnce({
          ast: {},
          errors: ['No workflows found in file'],
          warnings: [],
        })
        // Second parse with nodeTypesOnly succeeds
        .mockResolvedValueOnce({
          ast: {
            nodeTypes: [
              {
                name: 'myProcessor',
                inputs: { execute: {}, data: {} },
                outputs: { onSuccess: {}, result: {} },
                isExpression: false,
              },
            ],
          },
          errors: [],
          warnings: [],
        });

      const handler = mockToolHandlers.get('fw_describe')!;
      const result = (await handler({
        filePath: '/test/node-types.ts',
      })) as { content: Array<{ text: string }> };
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.success).toBe(true);
      expect(parsed.data.nodeTypesOnly).toBe(true);
      expect(parsed.data.nodeTypes).toHaveLength(1);
      expect(parsed.data.nodeTypes[0].name).toBe('myProcessor');
      expect(parsed.data.nodeTypes[0].inputs).toEqual(['execute', 'data']);
      expect(parsed.data.nodeTypes[0].outputs).toEqual(['onSuccess', 'result']);
    });

    it('still fails for genuinely empty files', async () => {
      mockParseWorkflow
        .mockResolvedValueOnce({
          ast: {},
          errors: ['No workflows found in file'],
          warnings: [],
        })
        .mockResolvedValueOnce({
          ast: { nodeTypes: [] },
          errors: [],
          warnings: [],
        });

      const handler = mockToolHandlers.get('fw_describe')!;
      const result = (await handler({
        filePath: '/test/empty.ts',
      })) as { isError: boolean; content: Array<{ text: string }> };

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
    });
  });

  // ─── fw_modify_batch (P4) ─────────────────────────────────────────────
  describe('fw_modify_batch', () => {
    it('tool is registered', () => {
      const toolNames = [...mockToolHandlers.keys()];
      expect(toolNames).toContain('fw_modify_batch');
    });

    it('applies addNode + addConnection in one call', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-batch-'));
      const filePath = path.join(tmpDir, 'workflow.ts');
      fs.writeFileSync(filePath, '// source code');

      const modifiedAST = {
        ...fakeAST,
        instances: [
          ...fakeAST.instances,
          { id: 'newNode', nodeType: 'process', config: { x: 360, y: 0 } },
        ],
      };
      mockParseWorkflow.mockResolvedValue({ ast: fakeAST, errors: [], warnings: [] });
      mockManipAddNode.mockReturnValue(modifiedAST);
      mockManipAddConnection.mockReturnValue(modifiedAST);
      mockGenerateInPlace.mockReturnValue({ hasChanges: true, code: '// updated code' });

      try {
        const handler = mockToolHandlers.get('fw_modify_batch')!;
        const result = (await handler({
          filePath,
          operations: [
            { operation: 'addNode', params: { nodeId: 'newNode', nodeType: 'process' } },
            {
              operation: 'addConnection',
              params: { from: 'proc2.onSuccess', to: 'newNode.execute' },
            },
          ],
        })) as { content: Array<{ text: string }> };
        const parsed = JSON.parse(result.content[0].text);

        expect(parsed.success).toBe(true);
        expect(parsed.data.operationsApplied).toBe(2);
        // File should be written with the updated code
        expect(fs.readFileSync(filePath, 'utf8')).toBe('// updated code');
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('rejects if operation params invalid before writing', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-batch-'));
      const filePath = path.join(tmpDir, 'workflow.ts');
      fs.writeFileSync(filePath, '// source code');

      mockParseWorkflow.mockResolvedValue({ ast: fakeAST, errors: [], warnings: [] });

      try {
        const handler = mockToolHandlers.get('fw_modify_batch')!;
        const result = (await handler({
          filePath,
          operations: [
            { operation: 'addNode', params: { nodeId: 'good', nodeType: 'process' } },
            { operation: 'addNode', params: {} }, // invalid - missing required params
          ],
        })) as { isError: boolean; content: Array<{ text: string }> };

        expect(result.isError).toBe(true);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.success).toBe(false);
        // File should be unchanged
        expect(fs.readFileSync(filePath, 'utf8')).toBe('// source code');
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('supports preview mode', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-batch-'));
      const filePath = path.join(tmpDir, 'workflow.ts');
      fs.writeFileSync(filePath, '// source code');

      mockParseWorkflow.mockResolvedValue({ ast: fakeAST, errors: [], warnings: [] });
      mockManipAddNode.mockReturnValue(fakeAST);
      mockGenerateInPlace.mockReturnValue({ hasChanges: true, code: '// preview code' });

      try {
        const handler = mockToolHandlers.get('fw_modify_batch')!;
        const result = (await handler({
          filePath,
          preview: true,
          operations: [
            { operation: 'addNode', params: { nodeId: 'newNode', nodeType: 'process' } },
          ],
        })) as { content: Array<{ text: string }> };
        const parsed = JSON.parse(result.content[0].text);

        expect(parsed.success).toBe(true);
        expect(parsed.data.preview).toBe(true);
        // File should be unchanged in preview mode
        expect(fs.readFileSync(filePath, 'utf8')).toBe('// source code');
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe('fw_doctor', () => {
    it('returns report with checks array for a valid directory', async () => {
      const fakeReport = {
        ok: true,
        checks: [
          { name: 'Node.js version', status: 'pass', message: 'Node.js v20.0.0 (>= 18 required)' },
          { name: 'TypeScript version', status: 'pass', message: 'TypeScript 5.4.0 (>= 5.0 required)' },
        ],
        summary: { pass: 2, warn: 0, fail: 0 },
        moduleFormat: { format: 'esm', source: 'package.json', details: '"type": "module"' },
      };
      mockRunDoctorChecks.mockReturnValue(fakeReport);

      const handler = mockToolHandlers.get('fw_doctor')!;
      const result = (await handler({ directory: '/test/project' })) as {
        content: Array<{ text: string }>;
      };
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.success).toBe(true);
      expect(parsed.data.ok).toBe(true);
      expect(parsed.data.checks).toHaveLength(2);
      expect(parsed.data.summary).toEqual({ pass: 2, warn: 0, fail: 0 });
      expect(parsed.data.moduleFormat.format).toBe('esm');
      expect(mockRunDoctorChecks).toHaveBeenCalledWith(path.resolve('/test/project'));
    });

    it('defaults to cwd when no directory provided', async () => {
      const fakeReport = {
        ok: true,
        checks: [],
        summary: { pass: 0, warn: 0, fail: 0 },
        moduleFormat: { format: 'esm', source: 'default', details: 'defaulting to ESM' },
      };
      mockRunDoctorChecks.mockReturnValue(fakeReport);

      const handler = mockToolHandlers.get('fw_doctor')!;
      const result = (await handler({})) as {
        content: Array<{ text: string }>;
      };
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.success).toBe(true);
      expect(mockRunDoctorChecks).toHaveBeenCalledWith(path.resolve(process.cwd()));
    });

    it('handles errors gracefully', async () => {
      mockRunDoctorChecks.mockImplementation(() => {
        throw new Error('Directory not accessible');
      });

      const handler = mockToolHandlers.get('fw_doctor')!;
      const result = (await handler({ directory: '/nonexistent' })) as {
        isError: boolean;
        content: Array<{ text: string }>;
      };

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe('DOCTOR_ERROR');
      expect(parsed.error.message).toContain('Directory not accessible');
    });
  });
});

// ─── Bug 2: fw://state resource error handling ────────────────────────────
describe('Bug 2: fw://state resource error handling', () => {
  let buffer: EventBuffer;
  let conn: EditorConnection;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockSocket._handlers.clear();
    mockSocket._resetAnyHandler();
    mockSocket.connected = true;
    mockToolHandlers.clear();
    mockResourceHandlers.clear();

    buffer = new EventBuffer(500, null);
    conn = new EditorConnection('http://localhost:6546', buffer, {
      ioFactory: mockIoFn as typeof import('socket.io-client').io,
    });
    conn.connect();
    mockSocket._trigger('connect');

    await startMcpServer({
      server: 'http://localhost:6546',
      stdio: true,
      _testDeps: { buffer, connection: conn },
    });
  });

  it('fw://state returns error content instead of throwing when sendCommand rejects', async () => {
    // Make sendCommand throw by having emit trigger an error scenario
    mockSocket.emit.mockImplementation(() => {
      throw new Error('Connection lost');
    });

    const handler = mockResourceHandlers.get('state')!;
    // Should not throw — should return error JSON
    const result = (await handler()) as { contents: Array<{ uri: string; text: string }> };

    expect(result.contents[0].uri).toBe('fw://state');
    const parsed = JSON.parse(result.contents[0].text);
    expect(parsed.error).toBeDefined();
    expect(parsed.error).toContain('Connection lost');
  });
});
