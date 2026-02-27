import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock socket.io-client (hoisted — no top-level refs allowed in factory)
// ---------------------------------------------------------------------------

vi.mock('socket.io-client', () => {
  const handlers = new Map<string, ((...args: unknown[]) => void)[]>();
  const socket = {
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      const existing = handlers.get(event) || [];
      existing.push(handler);
      handlers.set(event, existing);
    }),
    emit: vi.fn(),
    disconnect: vi.fn(),
    connected: true,
    _trigger: (event: string, ...args: unknown[]) => {
      const h = handlers.get(event);
      if (h) for (const fn of h) fn(...args);
    },
    _handlers: handlers,
    _reset: () => {
      handlers.clear();
      socket.on = vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        const existing = handlers.get(event) || [];
        existing.push(handler);
        handlers.set(event, existing);
      });
      socket.emit = vi.fn();
      socket.disconnect = vi.fn();
    },
  };
  return {
    io: vi.fn().mockReturnValue(socket),
    __mockSocket: socket,
  };
});

// ---------------------------------------------------------------------------
// Import after mock
// ---------------------------------------------------------------------------

import { tunnelCommand } from '../../../src/cli/commands/tunnel.js';
// @ts-expect-error __mockSocket is injected by vi.mock above
import { io as mockIoFn, __mockSocket as rawLocalSocket } from 'socket.io-client';

type MockSocket = {
  on: ReturnType<typeof vi.fn>;
  emit: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  _trigger: (event: string, ...args: unknown[]) => void;
  _handlers: Map<string, ((...args: unknown[]) => void)[]>;
  _reset: () => void;
};

const localSocket = rawLocalSocket as unknown as MockSocket;

// ---------------------------------------------------------------------------
// Mock WebSocket (no vi.mock — use wsFactory injection instead)
// ---------------------------------------------------------------------------

function createMockWs() {
  const handlers = new Map<string, ((...args: unknown[]) => void)[]>();
  return {
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      const existing = handlers.get(event) || [];
      existing.push(handler);
      handlers.set(event, existing);
    }),
    send: vi.fn(),
    close: vi.fn(),
    readyState: 1,
    OPEN: 1,
    _trigger: (event: string, ...args: unknown[]) => {
      const h = handlers.get(event);
      if (h) for (const fn of h) fn(...args);
    },
    _handlers: handlers,
  };
}

type MockWs = ReturnType<typeof createMockWs>;

/**
 * Start tunnel and simulate a successful connection sequence.
 * Returns the cloud ws mock for further assertions.
 */
async function startTunnel(): Promise<{ promise: Promise<void>; cloudWs: MockWs }> {
  let capturedWs: MockWs | null = null;
  const createWsFn = vi.fn((_url: string) => {
    capturedWs = createMockWs();
    return capturedWs;
  });

  const promise = tunnelCommand({
    key: 'fw_testkey1234567890abcdef',
    cloud: 'http://localhost:4800',
    server: 'http://localhost:6546',
    createWs: createWsFn as unknown as (url: string) => import('ws').default,
    ioFactory: mockIoFn as typeof import('socket.io-client').io,
  });

  // Simulate local Socket.IO connect
  localSocket._trigger('connect');
  await new Promise((r) => setTimeout(r, 10));

  const cloudWs = capturedWs!;

  // Simulate cloud WebSocket open + hello
  cloudWs._trigger('open');
  cloudWs._trigger('message', JSON.stringify({ type: 'tunnel:hello', userId: 'user-123' }));
  await new Promise((r) => setTimeout(r, 10));

  return { promise, cloudWs };
}

describe('tunnel command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localSocket._reset();
  });

  it('connects to local server via Socket.IO', async () => {
    const { promise } = await startTunnel();

    expect(mockIoFn).toHaveBeenCalledWith(
      'http://localhost:6546',
      expect.objectContaining({
        query: { clientType: 'tunnel' },
      }),
    );

    void promise;
  });

  it('relays tunnel:request to local server and sends response back', async () => {
    const { promise, cloudWs } = await startTunnel();

    // When local socket emit is called, invoke the callback with a response
    localSocket.emit.mockImplementation(
      (_event: string, _data: unknown, callback: (response: unknown) => void) => {
        callback({
          id: 'req-1',
          success: true,
          result: 'file content here',
        });
      },
    );

    // Simulate a tunnel:request from cloud
    cloudWs._trigger('message', JSON.stringify({
      type: 'tunnel:request',
      requestId: 'tunnel-1234-abcd',
      id: 'req-1',
      method: 'getFile',
      params: { filePath: '/test.ts' },
    }));

    await new Promise((r) => setTimeout(r, 10));

    // Verify it was forwarded to local server
    expect(localSocket.emit).toHaveBeenCalledWith(
      'method',
      { id: 'req-1', method: 'getFile', params: { filePath: '/test.ts' } },
      expect.any(Function),
    );

    // Verify the response was sent back to cloud
    expect(cloudWs.send).toHaveBeenCalledWith(
      JSON.stringify({
        type: 'tunnel:response',
        requestId: 'tunnel-1234-abcd',
        id: 'req-1',
        success: true,
        result: 'file content here',
      }),
    );

    void promise;
  });

  it('responds to ping with pong', async () => {
    const { promise, cloudWs } = await startTunnel();

    cloudWs._trigger('message', JSON.stringify({ type: 'ping' }));
    await new Promise((r) => setTimeout(r, 10));

    expect(cloudWs.send).toHaveBeenCalledWith(JSON.stringify({ type: 'pong' }));

    void promise;
  });

  it('relays error responses from local server', async () => {
    const { promise, cloudWs } = await startTunnel();

    localSocket.emit.mockImplementation(
      (_event: string, _data: unknown, callback: (response: unknown) => void) => {
        callback({
          id: 'req-2',
          success: false,
          error: { message: 'File not found' },
        });
      },
    );

    cloudWs._trigger('message', JSON.stringify({
      type: 'tunnel:request',
      requestId: 'tunnel-5678-efgh',
      id: 'req-2',
      method: 'getFile',
      params: { filePath: '/missing.ts' },
    }));

    await new Promise((r) => setTimeout(r, 10));

    expect(cloudWs.send).toHaveBeenCalledWith(
      JSON.stringify({
        type: 'tunnel:response',
        requestId: 'tunnel-5678-efgh',
        id: 'req-2',
        success: false,
        result: undefined,
        error: { message: 'File not found' },
      }),
    );

    void promise;
  });
});
