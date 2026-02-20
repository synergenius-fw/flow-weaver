import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Writable } from 'stream';

// Mock socket.io-client before importing listen
vi.mock('socket.io-client', () => {
  const handlers = new Map<string, ((...args: unknown[]) => void)[]>();
  let anyHandler: ((event: string, data: unknown) => void) | null = null;
  const mockSocket = {
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      const existing = handlers.get(event) || [];
      existing.push(handler);
      handlers.set(event, existing);
    }),
    onAny: vi.fn((handler: (event: string, data: unknown) => void) => {
      anyHandler = handler;
    }),
    emit: vi.fn((event: string, ...args: unknown[]) => {
      // If the last arg is a function (callback), invoke it
      if (event === 'integration:getContext' && typeof args[0] === 'function') {
        (args[0] as (ctx: unknown) => void)(mockSocket._contextResponse);
      }
    }),
    disconnect: vi.fn(),
    connected: true,
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

import { listenCommand } from '../../../src/cli/commands/listen.js';
// @ts-expect-error __mockSocket is injected by vi.mock above
import { io as mockIoFn, __mockSocket } from 'socket.io-client';

const mockSocket = __mockSocket as unknown as {
  on: ReturnType<typeof vi.fn>;
  onAny: ReturnType<typeof vi.fn>;
  emit: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  connected: boolean;
  _trigger: (event: string, ...args: unknown[]) => void;
  _triggerAny: (event: string, data: unknown) => void;
  _handlers: Map<string, ((...args: unknown[]) => void)[]>;
  _contextResponse: unknown;
  _resetAnyHandler: () => void;
};

/** Collect lines written to the writable stream */
function createCapture(): { lines: string[]; writable: Writable } {
  const lines: string[] = [];
  const writable = new Writable({
    write(chunk: Buffer, _enc: string, cb: () => void) {
      const text = chunk.toString();
      for (const line of text.split('\n').filter(Boolean)) lines.push(line);
      cb();
    },
  });
  return { lines, writable };
}

describe('listen command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSocket._handlers.clear();
    mockSocket._resetAnyHandler();
    mockSocket._contextResponse = null;
  });

  it('connects to /integrations with clientType cli', async () => {
    const { writable } = createCapture();

    // Start the command but don't await (it never resolves)
    const promise = listenCommand({
      server: 'http://localhost:6546',
      ioFactory: mockIoFn as typeof import('socket.io-client').io,
      output: writable,
    });

    // Verify the socket.io connection
    expect(mockIoFn).toHaveBeenCalledWith(
      'http://localhost:6546/integrations',
      expect.objectContaining({
        query: { clientType: 'cli' },
      })
    );

    // Prevent unhandled promise from leaking (it never resolves by design)
    void promise;
  });

  it('emits integration:getContext on connect and writes context as JSON line', async () => {
    const { lines, writable } = createCapture();
    mockSocket._contextResponse = {
      selectedNode: 'node1',
      openFile: '/test.ts',
      workflowState: 'idle',
    };

    const promise = listenCommand({
      server: 'http://localhost:6546',
      ioFactory: mockIoFn as typeof import('socket.io-client').io,
      output: writable,
    });

    // Simulate the connect event
    mockSocket._trigger('connect');

    // Wait for the callback to flush
    await new Promise((r) => setTimeout(r, 10));

    expect(mockSocket.emit).toHaveBeenCalledWith('integration:getContext', expect.any(Function));

    expect(lines.length).toBeGreaterThanOrEqual(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed).toEqual({
      event: 'integration:context',
      data: {
        selectedNode: 'node1',
        openFile: '/test.ts',
        workflowState: 'idle',
      },
    });

    void promise;
  });

  it('streams fw:nodeSelected events as JSON lines via onAny', async () => {
    const { lines, writable } = createCapture();

    const promise = listenCommand({
      server: 'http://localhost:6546',
      ioFactory: mockIoFn as typeof import('socket.io-client').io,
      output: writable,
    });

    // Simulate a fw:nodeSelected event via onAny
    mockSocket._triggerAny('fw:nodeSelected', { nodeId: 'Start' });

    await new Promise((r) => setTimeout(r, 10));

    expect(lines.length).toBe(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed).toEqual({
      event: 'fw:nodeSelected',
      data: { nodeId: 'Start' },
    });

    void promise;
  });

  it('streams fw:contextUpdate events as JSON lines via onAny', async () => {
    const { lines, writable } = createCapture();

    const promise = listenCommand({
      server: 'http://localhost:6546',
      ioFactory: mockIoFn as typeof import('socket.io-client').io,
      output: writable,
    });

    mockSocket._triggerAny('fw:contextUpdate', { selectedNode: 'B' });

    await new Promise((r) => setTimeout(r, 10));

    expect(lines.length).toBe(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed).toEqual({
      event: 'fw:contextUpdate',
      data: { selectedNode: 'B' },
    });

    void promise;
  });

  it('streams integration:* events as JSON lines via onAny', async () => {
    const { lines, writable } = createCapture();

    const promise = listenCommand({
      server: 'http://localhost:6546',
      ioFactory: mockIoFn as typeof import('socket.io-client').io,
      output: writable,
    });

    mockSocket._triggerAny('integration:hello', { clientType: 'cli', serverVersion: '1.0.0' });

    await new Promise((r) => setTimeout(r, 10));

    expect(lines.length).toBe(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed).toEqual({
      event: 'integration:hello',
      data: { clientType: 'cli', serverVersion: '1.0.0' },
    });

    void promise;
  });

  it('ignores non-fw/integration events', async () => {
    const { lines, writable } = createCapture();

    const promise = listenCommand({
      server: 'http://localhost:6546',
      ioFactory: mockIoFn as typeof import('socket.io-client').io,
      output: writable,
    });

    mockSocket._triggerAny('someOtherEvent', { data: 'test' });
    mockSocket._triggerAny('random', { data: 'ignored' });

    await new Promise((r) => setTimeout(r, 10));

    expect(lines.length).toBe(0);

    void promise;
  });

  it('disconnects cleanly on socket disconnect event', async () => {
    const { writable } = createCapture();

    const promise = listenCommand({
      server: 'http://localhost:6546',
      ioFactory: mockIoFn as typeof import('socket.io-client').io,
      output: writable,
    });

    // Should not throw when disconnect fires
    mockSocket._trigger('disconnect', 'transport close');

    void promise;
  });
});
