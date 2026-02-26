/**
 * Tests for src/mcp/resources.ts.
 * Verifies registerResources wires up the "events" and "state" resources
 * on a mock MCP server, and that the resource handlers behave correctly
 * for connected/disconnected/error states.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerResources } from '../../../src/mcp/resources';

type ResourceHandler = () => Promise<{ contents: Array<{ uri: string; text: string }> }>;

function createMockMcp() {
  const handlers = new Map<string, ResourceHandler>();
  return {
    resource: vi.fn(
      (
        _name: string,
        _uri: string,
        _meta: { description: string },
        handler: ResourceHandler,
      ) => {
        handlers.set(_name, handler);
      },
    ),
    handlers,
  };
}

function createMockBuffer(events: unknown[] = []) {
  return {
    peek: vi.fn(() => events),
  };
}

function createMockConnection(opts: {
  connected?: boolean;
  stateResult?: unknown;
  stateError?: Error;
} = {}) {
  const { connected = true, stateResult = {}, stateError } = opts;
  return {
    isConnected: connected,
    sendCommand: vi.fn(async () => {
      if (stateError) throw stateError;
      return stateResult;
    }),
  };
}

describe('registerResources', () => {
  let mockMcp: ReturnType<typeof createMockMcp>;

  beforeEach(() => {
    mockMcp = createMockMcp();
  });

  it('registers two resources: events and state', () => {
    const buffer = createMockBuffer();
    const conn = createMockConnection();

    registerResources(mockMcp as any, conn as any, buffer as any);

    expect(mockMcp.resource).toHaveBeenCalledTimes(2);

    const calls = mockMcp.resource.mock.calls;
    const names = calls.map((c) => c[0]);
    expect(names).toContain('events');
    expect(names).toContain('state');

    const uris = calls.map((c) => c[1]);
    expect(uris).toContain('fw://events');
    expect(uris).toContain('fw://state');
  });

  describe('fw://events resource', () => {
    it('returns buffer.peek() as JSON', async () => {
      const events = [{ type: 'click', ts: 1 }, { type: 'change', ts: 2 }];
      const buffer = createMockBuffer(events);
      const conn = createMockConnection();

      registerResources(mockMcp as any, conn as any, buffer as any);
      const handler = mockMcp.handlers.get('events')!;
      const result = await handler();

      expect(buffer.peek).toHaveBeenCalledOnce();
      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].uri).toBe('fw://events');
      expect(JSON.parse(result.contents[0].text)).toEqual(events);
    });

    it('returns empty array JSON when buffer is empty', async () => {
      const buffer = createMockBuffer([]);
      const conn = createMockConnection();

      registerResources(mockMcp as any, conn as any, buffer as any);
      const handler = mockMcp.handlers.get('events')!;
      const result = await handler();

      expect(JSON.parse(result.contents[0].text)).toEqual([]);
    });
  });

  describe('fw://state resource', () => {
    it('returns state from editor connection when connected', async () => {
      const stateData = { workflow: 'test', nodes: 5 };
      const buffer = createMockBuffer();
      const conn = createMockConnection({ connected: true, stateResult: stateData });

      registerResources(mockMcp as any, conn as any, buffer as any);
      const handler = mockMcp.handlers.get('state')!;
      const result = await handler();

      expect(conn.sendCommand).toHaveBeenCalledWith('get-state', {});
      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].uri).toBe('fw://state');
      expect(JSON.parse(result.contents[0].text)).toEqual(stateData);
    });

    it('returns error JSON when not connected', async () => {
      const buffer = createMockBuffer();
      const conn = createMockConnection({ connected: false });

      registerResources(mockMcp as any, conn as any, buffer as any);
      const handler = mockMcp.handlers.get('state')!;
      const result = await handler();

      expect(conn.sendCommand).not.toHaveBeenCalled();
      const parsed = JSON.parse(result.contents[0].text);
      expect(parsed.error).toBe('Not connected to Studio');
    });

    it('returns error JSON when sendCommand throws an Error', async () => {
      const buffer = createMockBuffer();
      const conn = createMockConnection({
        connected: true,
        stateError: new Error('WebSocket timeout'),
      });

      registerResources(mockMcp as any, conn as any, buffer as any);
      const handler = mockMcp.handlers.get('state')!;
      const result = await handler();

      const parsed = JSON.parse(result.contents[0].text);
      expect(parsed.error).toContain('Failed to get state');
      expect(parsed.error).toContain('WebSocket timeout');
    });

    it('handles non-Error throws gracefully', async () => {
      const buffer = createMockBuffer();
      const conn = createMockConnection({ connected: true });
      conn.sendCommand.mockRejectedValueOnce('string error');

      registerResources(mockMcp as any, conn as any, buffer as any);
      const handler = mockMcp.handlers.get('state')!;
      const result = await handler();

      const parsed = JSON.parse(result.contents[0].text);
      expect(parsed.error).toContain('string error');
    });
  });
});
