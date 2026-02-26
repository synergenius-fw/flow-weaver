import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EditorConnection } from '../../../src/mcp/editor-connection';
import { EventBuffer } from '../../../src/mcp/event-buffer';
import type { AckResponse } from '../../../src/mcp/types';

// Minimal mock socket that tracks registrations and can simulate events.
function createMockSocket() {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const anyListeners = new Set<(event: string, data: unknown) => void>();

  const socket = {
    connected: false,
    on(event: string, handler: (...args: unknown[]) => void) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(handler);
    },
    off(event: string, handler: (...args: unknown[]) => void) {
      listeners.get(event)?.delete(handler);
    },
    onAny(handler: (event: string, data: unknown) => void) {
      anyListeners.add(handler);
    },
    emit: vi.fn(),
    removeAllListeners() {
      listeners.clear();
      anyListeners.clear();
    },
    disconnect: vi.fn(),

    // Test helpers
    _fire(event: string, ...args: unknown[]) {
      listeners.get(event)?.forEach((h) => h(...args));
      anyListeners.forEach((h) => h(event, args[0]));
    },
    _listeners: listeners,
    _anyListeners: anyListeners,
  };

  return socket;
}

describe('EditorConnection', () => {
  let mockSocket: ReturnType<typeof createMockSocket>;
  let mockIoFactory: ReturnType<typeof vi.fn>;
  let buffer: EventBuffer;

  beforeEach(() => {
    mockSocket = createMockSocket();
    mockIoFactory = vi.fn().mockReturnValue(mockSocket);
    buffer = new EventBuffer(100, null, { dedupeWindowMs: 0, exclude: [] });
  });

  describe('connect', () => {
    it('creates a socket.io connection to the /integrations namespace', () => {
      const conn = new EditorConnection('http://localhost:4000', buffer, {
        ioFactory: mockIoFactory as any,
      });
      conn.connect();

      expect(mockIoFactory).toHaveBeenCalledWith('http://localhost:4000/integrations', {
        query: { clientType: 'mcp' },
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionAttempts: Infinity,
      });
    });

    it('pushes a connecting status event to the buffer before connecting', () => {
      const conn = new EditorConnection('http://localhost:4000', buffer, {
        ioFactory: mockIoFactory as any,
      });
      conn.connect();

      const events = buffer.peek();
      expect(events.some((e) => e.event === 'mcp:status' && (e.data as any).status === 'connecting')).toBe(true);
    });

    it('pushes connected status when socket connects', () => {
      const conn = new EditorConnection('http://localhost:4000', buffer, {
        ioFactory: mockIoFactory as any,
      });
      conn.connect();
      mockSocket._fire('connect');

      const events = buffer.peek();
      expect(events.some((e) => e.event === 'mcp:status' && (e.data as any).status === 'connected')).toBe(true);
    });

    it('forwards fw: events to the buffer', () => {
      const conn = new EditorConnection('http://localhost:4000', buffer, {
        ioFactory: mockIoFactory as any,
      });
      conn.connect();
      mockSocket._fire('fw:node-added', { id: 'n1' });

      const events = buffer.peek();
      expect(events.some((e) => e.event === 'fw:node-added')).toBe(true);
    });

    it('forwards integration: events to the buffer', () => {
      const conn = new EditorConnection('http://localhost:4000', buffer, {
        ioFactory: mockIoFactory as any,
      });
      conn.connect();
      mockSocket._fire('integration:status', { ready: true });

      const events = buffer.peek();
      expect(events.some((e) => e.event === 'integration:status')).toBe(true);
    });

    it('ignores events that are not fw: or integration:', () => {
      const conn = new EditorConnection('http://localhost:4000', buffer, {
        ioFactory: mockIoFactory as any,
      });
      conn.connect();
      mockSocket._fire('random:event', { x: 1 });

      const events = buffer.peek();
      // Only the mcp:status from connect, no random:event
      expect(events.every((e) => e.event !== 'random:event')).toBe(true);
    });

    it('disconnects previous socket on reconnect', () => {
      const conn = new EditorConnection('http://localhost:4000', buffer, {
        ioFactory: mockIoFactory as any,
      });
      conn.connect();
      const firstSocket = mockSocket;

      // Create a new socket for the second connect
      const secondSocket = createMockSocket();
      mockIoFactory.mockReturnValue(secondSocket);
      conn.connect();

      expect(firstSocket.disconnect).toHaveBeenCalled();
    });

    it('logs "Connected to Studio" on first connect', () => {
      const log = vi.fn();
      const conn = new EditorConnection('http://localhost:4000', buffer, {
        ioFactory: mockIoFactory as any,
      });
      conn.connect(log);

      mockSocket._fire('connect');
      expect(log).toHaveBeenCalledWith(expect.stringContaining('Connected to Studio'));
    });

    it('logs "Studio disconnected" once on disconnect', () => {
      const log = vi.fn();
      const conn = new EditorConnection('http://localhost:4000', buffer, {
        ioFactory: mockIoFactory as any,
      });
      conn.connect(log);

      mockSocket._fire('connect');
      log.mockClear();

      mockSocket._fire('disconnect', 'transport close');
      expect(log).toHaveBeenCalledWith('Studio disconnected');

      // Second disconnect should not log again
      log.mockClear();
      mockSocket._fire('disconnect', 'transport close');
      expect(log).not.toHaveBeenCalled();
    });

    it('logs "Studio not reachable" once on connect_error', () => {
      const log = vi.fn();
      const conn = new EditorConnection('http://localhost:4000', buffer, {
        ioFactory: mockIoFactory as any,
      });
      conn.connect(log);

      mockSocket._fire('connect_error', new Error('refused'));
      expect(log).toHaveBeenCalledWith(expect.stringContaining('Studio not reachable'));

      // Repeated errors should not log again
      log.mockClear();
      mockSocket._fire('connect_error', new Error('refused'));
      mockSocket._fire('connect_error', new Error('refused'));
      expect(log).not.toHaveBeenCalled();
    });

    it('logs "Reconnected to Studio" after disconnect then reconnect', () => {
      const log = vi.fn();
      const conn = new EditorConnection('http://localhost:4000', buffer, {
        ioFactory: mockIoFactory as any,
      });
      conn.connect(log);

      // First connect
      mockSocket._fire('connect');
      expect(log).toHaveBeenCalledWith(expect.stringContaining('Connected to Studio'));

      // Disconnect
      mockSocket._fire('disconnect', 'transport close');
      log.mockClear();

      // Reconnect
      mockSocket._fire('connect');
      expect(log).toHaveBeenCalledWith(expect.stringContaining('Reconnected to Studio'));
    });
  });

  describe('isConnected', () => {
    it('returns false before connect', () => {
      const conn = new EditorConnection('http://localhost:4000', buffer, {
        ioFactory: mockIoFactory as any,
      });
      expect(conn.isConnected).toBe(false);
    });

    it('reflects socket.connected state', () => {
      const conn = new EditorConnection('http://localhost:4000', buffer, {
        ioFactory: mockIoFactory as any,
      });
      conn.connect();
      expect(conn.isConnected).toBe(false);

      mockSocket.connected = true;
      expect(conn.isConnected).toBe(true);
    });
  });

  describe('sendCommand', () => {
    it('returns error when not connected', async () => {
      const conn = new EditorConnection('http://localhost:4000', buffer, {
        ioFactory: mockIoFactory as any,
      });
      const result = await conn.sendCommand('get-state', {});
      expect(result.success).toBe(false);
      expect(result.error).toBe('Not connected');
    });

    it('emits integration:command and resolves on matching ack', async () => {
      const conn = new EditorConnection('http://localhost:4000', buffer, {
        ioFactory: mockIoFactory as any,
        ackTimeout: 5000,
      });
      conn.connect();

      const resultPromise = conn.sendCommand('get-state', { key: 'value' });

      // The emit should have been called with integration:command
      expect(mockSocket.emit).toHaveBeenCalledWith(
        'integration:command',
        expect.objectContaining({ action: 'get-state', params: { key: 'value' } })
      );

      // Extract requestId from the emit call
      const emittedPayload = mockSocket.emit.mock.calls[0][1] as { requestId: string };
      const requestId = emittedPayload.requestId;

      // Simulate ack
      mockSocket._fire('fw:ack', { requestId, success: true, result: { state: 'ok' } });

      const result = await resultPromise;
      expect(result.success).toBe(true);
      expect(result.result).toEqual({ state: 'ok' });
    });

    it('resolves with timeout error when no ack received', async () => {
      vi.useFakeTimers();
      const conn = new EditorConnection('http://localhost:4000', buffer, {
        ioFactory: mockIoFactory as any,
        ackTimeout: 100,
      });
      conn.connect();

      const resultPromise = conn.sendCommand('slow-action', {});

      vi.advanceTimersByTime(150);

      const result = await resultPromise;
      expect(result.success).toBe(false);
      expect(result.error).toBe('Timeout');

      vi.useRealTimers();
    });

    it('ignores ack responses with non-matching requestId', async () => {
      vi.useFakeTimers();
      const conn = new EditorConnection('http://localhost:4000', buffer, {
        ioFactory: mockIoFactory as any,
        ackTimeout: 200,
      });
      conn.connect();

      const resultPromise = conn.sendCommand('action', {});

      // Fire ack with wrong requestId
      mockSocket._fire('fw:ack', { requestId: 'wrong-id', success: true });

      // Should still be pending, so advance past timeout
      vi.advanceTimersByTime(250);

      const result = await resultPromise;
      expect(result.error).toBe('Timeout');

      vi.useRealTimers();
    });
  });

  describe('sendBatch', () => {
    it('returns error when not connected', async () => {
      const conn = new EditorConnection('http://localhost:4000', buffer, {
        ioFactory: mockIoFactory as any,
      });
      const result = await conn.sendBatch([{ action: 'a' }, { action: 'b' }]);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Not connected');
    });

    it('emits integration:batch and resolves on ack', async () => {
      const conn = new EditorConnection('http://localhost:4000', buffer, {
        ioFactory: mockIoFactory as any,
      });
      conn.connect();

      const commands = [
        { action: 'add-node', params: { type: 'A' } },
        { action: 'add-node', params: { type: 'B' } },
      ];

      const resultPromise = conn.sendBatch(commands);

      expect(mockSocket.emit).toHaveBeenCalledWith(
        'integration:batch',
        expect.objectContaining({ commands })
      );

      const emittedPayload = mockSocket.emit.mock.calls[0][1] as { requestId: string };
      mockSocket._fire('fw:ack', { requestId: emittedPayload.requestId, success: true });

      const result = await resultPromise;
      expect(result.success).toBe(true);
    });

    it('resolves with timeout error when no ack received', async () => {
      vi.useFakeTimers();
      const conn = new EditorConnection('http://localhost:4000', buffer, {
        ioFactory: mockIoFactory as any,
        ackTimeout: 100,
      });
      conn.connect();

      const resultPromise = conn.sendBatch([{ action: 'a' }]);
      vi.advanceTimersByTime(150);

      const result = await resultPromise;
      expect(result.success).toBe(false);
      expect(result.error).toBe('Timeout');

      vi.useRealTimers();
    });
  });

  describe('disconnect', () => {
    it('disconnects the socket and nullifies it', () => {
      const conn = new EditorConnection('http://localhost:4000', buffer, {
        ioFactory: mockIoFactory as any,
      });
      conn.connect();
      conn.disconnect();

      expect(mockSocket.disconnect).toHaveBeenCalled();
      expect(conn.isConnected).toBe(false);
    });

    it('is safe to call when not connected', () => {
      const conn = new EditorConnection('http://localhost:4000', buffer, {
        ioFactory: mockIoFactory as any,
      });
      expect(() => conn.disconnect()).not.toThrow();
    });
  });
});
