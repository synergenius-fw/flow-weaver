import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock all tool registration functions before importing the module
const mockRegisterEditorTools = vi.fn();
const mockRegisterQueryTools = vi.fn();
const mockRegisterTemplateTools = vi.fn();
const mockRegisterPatternTools = vi.fn();
const mockRegisterExportTools = vi.fn();
const mockRegisterMarketplaceTools = vi.fn();
const mockRegisterDiagramTools = vi.fn();
const mockRegisterDocsTools = vi.fn();
const mockRegisterModelTools = vi.fn();
const mockRegisterResources = vi.fn();

vi.mock('../../../src/mcp/tools-editor.js', () => ({
  registerEditorTools: (...a: unknown[]) => mockRegisterEditorTools(...a),
}));
vi.mock('../../../src/mcp/tools-query.js', () => ({
  registerQueryTools: (...a: unknown[]) => mockRegisterQueryTools(...a),
}));
vi.mock('../../../src/mcp/tools-template.js', () => ({
  registerTemplateTools: (...a: unknown[]) => mockRegisterTemplateTools(...a),
}));
vi.mock('../../../src/mcp/tools-pattern.js', () => ({
  registerPatternTools: (...a: unknown[]) => mockRegisterPatternTools(...a),
}));
vi.mock('../../../src/mcp/tools-export.js', () => ({
  registerExportTools: (...a: unknown[]) => mockRegisterExportTools(...a),
}));
vi.mock('../../../src/mcp/tools-marketplace.js', () => ({
  registerMarketplaceTools: (...a: unknown[]) => mockRegisterMarketplaceTools(...a),
}));
vi.mock('../../../src/mcp/tools-diagram.js', () => ({
  registerDiagramTools: (...a: unknown[]) => mockRegisterDiagramTools(...a),
}));
vi.mock('../../../src/mcp/tools-docs.js', () => ({
  registerDocsTools: (...a: unknown[]) => mockRegisterDocsTools(...a),
}));
vi.mock('../../../src/mcp/tools-model.js', () => ({
  registerModelTools: (...a: unknown[]) => mockRegisterModelTools(...a),
}));
vi.mock('../../../src/mcp/resources.js', () => ({
  registerResources: (...a: unknown[]) => mockRegisterResources(...a),
}));

// Mock EventBuffer and EditorConnection as classes (must be constructable)
const MockEventBufferConstructor = vi.fn();
const mockConnectionConnect = vi.fn();
const MockEditorConnectionConstructor = vi.fn();

vi.mock('../../../src/mcp/event-buffer.js', () => {
  return {
    EventBuffer: class {
      constructor(...args: unknown[]) {
        MockEventBufferConstructor(...args);
      }
    },
  };
});

vi.mock('../../../src/mcp/editor-connection.js', () => {
  return {
    EditorConnection: class {
      connect(...args: unknown[]) {
        return mockConnectionConnect(...args);
      }
      constructor(...args: unknown[]) {
        MockEditorConnectionConstructor(...args);
      }
    },
  };
});

// Mock McpServer as a class
const mockMcpConnect = vi.fn();
vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => {
  return {
    McpServer: class {
      connect = mockMcpConnect;
      tool() {}
      resource() {}
      registerPrompt() {}
    },
  };
});

// Mock StdioServerTransport as a class
vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => {
  return {
    StdioServerTransport: class {},
  };
});

import { startMcpServer } from '../../../src/mcp/server.js';

describe('mcp/server', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('startMcpServer', () => {
    it('registers all tool sets and resources', async () => {
      const mockBuffer = {} as never;
      const mockConnection = { connect: vi.fn() } as never;

      await startMcpServer({
        _testDeps: { buffer: mockBuffer, connection: mockConnection },
      });

      expect(mockRegisterEditorTools).toHaveBeenCalledTimes(1);
      expect(mockRegisterQueryTools).toHaveBeenCalledTimes(1);
      expect(mockRegisterTemplateTools).toHaveBeenCalledTimes(1);
      expect(mockRegisterPatternTools).toHaveBeenCalledTimes(1);
      expect(mockRegisterExportTools).toHaveBeenCalledTimes(1);
      expect(mockRegisterMarketplaceTools).toHaveBeenCalledTimes(1);
      expect(mockRegisterDiagramTools).toHaveBeenCalledTimes(1);
      expect(mockRegisterDocsTools).toHaveBeenCalledTimes(1);
      expect(mockRegisterModelTools).toHaveBeenCalledTimes(1);
      expect(mockRegisterResources).toHaveBeenCalledTimes(1);
    });

    it('passes injected buffer and connection to editor tools and resources', async () => {
      const mockBuffer = { id: 'buffer' } as never;
      const mockConnection = { id: 'conn', connect: vi.fn() } as never;

      await startMcpServer({
        _testDeps: { buffer: mockBuffer, connection: mockConnection },
      });

      expect(mockRegisterEditorTools).toHaveBeenCalledWith(
        expect.anything(),
        mockConnection,
        mockBuffer,
      );
      expect(mockRegisterResources).toHaveBeenCalledWith(
        expect.anything(),
        mockConnection,
        mockBuffer,
      );
    });

    it('does not connect to editor or create stdio transport when _testDeps provided', async () => {
      const mockBuffer = {} as never;
      const mockConnection = { connect: vi.fn() } as never;

      await startMcpServer({
        _testDeps: { buffer: mockBuffer, connection: mockConnection },
      });

      expect(mockConnectionConnect).not.toHaveBeenCalled();
      expect(mockMcpConnect).not.toHaveBeenCalled();
    });

    it('does not create stdio transport when stdio is false and no _testDeps', async () => {
      await startMcpServer({ stdio: false });

      // Without _testDeps it connects to editor, but no stdio transport
      expect(mockMcpConnect).not.toHaveBeenCalled();
    });

    it('connects to editor when no _testDeps', async () => {
      await startMcpServer({ stdio: false });

      expect(mockConnectionConnect).toHaveBeenCalled();
    });
  });

  describe('parseEventFilterFromEnv', () => {
    // parseEventFilterFromEnv is called internally during startMcpServer when
    // no _testDeps are provided. We set env vars and check what EventBuffer
    // constructor receives.

    it('parses FW_EVENT_INCLUDE from environment', async () => {
      process.env.FW_EVENT_INCLUDE = 'fw:node-added, fw:connection-added';

      await startMcpServer({ stdio: false });

      expect(MockEventBufferConstructor).toHaveBeenCalledWith(
        undefined,
        undefined,
        expect.objectContaining({
          include: ['fw:node-added', 'fw:connection-added'],
        }),
      );
    });

    it('parses FW_EVENT_EXCLUDE from environment', async () => {
      process.env.FW_EVENT_EXCLUDE = 'fw:ack, fw:ping';

      await startMcpServer({ stdio: false });

      expect(MockEventBufferConstructor).toHaveBeenCalledWith(
        undefined,
        undefined,
        expect.objectContaining({
          exclude: ['fw:ack', 'fw:ping'],
        }),
      );
    });

    it('parses FW_EVENT_DEDUPE_MS from environment', async () => {
      process.env.FW_EVENT_DEDUPE_MS = '500';

      await startMcpServer({ stdio: false });

      expect(MockEventBufferConstructor).toHaveBeenCalledWith(
        undefined,
        undefined,
        expect.objectContaining({
          dedupeWindowMs: 500,
        }),
      );
    });

    it('parses FW_EVENT_MAX from environment', async () => {
      process.env.FW_EVENT_MAX = '1000';

      await startMcpServer({ stdio: false });

      expect(MockEventBufferConstructor).toHaveBeenCalledWith(
        undefined,
        undefined,
        expect.objectContaining({
          maxBufferSize: 1000,
        }),
      );
    });

    it('ignores non-numeric FW_EVENT_DEDUPE_MS', async () => {
      process.env.FW_EVENT_DEDUPE_MS = 'not-a-number';

      await startMcpServer({ stdio: false });

      const lastCall = MockEventBufferConstructor.mock.calls[
        MockEventBufferConstructor.mock.calls.length - 1
      ];
      const filterConfig = lastCall[2] as Record<string, unknown>;
      expect(filterConfig.dedupeWindowMs).toBeUndefined();
    });

    it('ignores non-numeric FW_EVENT_MAX', async () => {
      process.env.FW_EVENT_MAX = 'abc';

      await startMcpServer({ stdio: false });

      const lastCall = MockEventBufferConstructor.mock.calls[
        MockEventBufferConstructor.mock.calls.length - 1
      ];
      const filterConfig = lastCall[2] as Record<string, unknown>;
      expect(filterConfig.maxBufferSize).toBeUndefined();
    });

    it('returns empty filter when no env vars are set', async () => {
      delete process.env.FW_EVENT_INCLUDE;
      delete process.env.FW_EVENT_EXCLUDE;
      delete process.env.FW_EVENT_DEDUPE_MS;
      delete process.env.FW_EVENT_MAX;

      await startMcpServer({ stdio: false });

      const lastCall = MockEventBufferConstructor.mock.calls[
        MockEventBufferConstructor.mock.calls.length - 1
      ];
      const filterConfig = lastCall[2] as Record<string, unknown>;
      expect(filterConfig.include).toBeUndefined();
      expect(filterConfig.exclude).toBeUndefined();
    });

    it('filters out empty strings from comma-separated include list', async () => {
      process.env.FW_EVENT_INCLUDE = 'fw:node-added,,, fw:ping, ';

      await startMcpServer({ stdio: false });

      expect(MockEventBufferConstructor).toHaveBeenCalledWith(
        undefined,
        undefined,
        expect.objectContaining({
          include: ['fw:node-added', 'fw:ping'],
        }),
      );
    });
  });
});
