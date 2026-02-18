import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock socket.io-client before importing ui
vi.mock('socket.io-client', () => {
  const handlers = new Map<string, ((...args: unknown[]) => void)[]>();
  const mockSocket = {
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      const existing = handlers.get(event) || [];
      existing.push(handler);
      handlers.set(event, existing);
    }),
    emit: vi.fn(),
    disconnect: vi.fn(),
    connected: true,
    _trigger: (event: string, ...args: unknown[]) => {
      const eventHandlers = handlers.get(event);
      if (eventHandlers) {
        for (const handler of eventHandlers) handler(...args);
      }
    },
    _handlers: handlers,
  };
  return {
    io: vi.fn().mockReturnValue(mockSocket),
    __mockSocket: mockSocket,
  };
});

import {
  uiFocusNode,
  uiAddNode,
  uiOpenWorkflow,
  uiGetState,
  uiBatch,
} from '../../../src/cli/commands/ui.js';
import { io as mockIoFn, __mockSocket } from 'socket.io-client';

const mockSocket = __mockSocket as unknown as {
  on: ReturnType<typeof vi.fn>;
  emit: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  connected: boolean;
  _trigger: (event: string, ...args: unknown[]) => void;
  _handlers: Map<string, ((...args: unknown[]) => void)[]>;
};

describe('ui commands', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.clearAllMocks();
    mockSocket._handlers.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uiFocusNode connects to /integrations and emits integration:command with focus-node', async () => {
    const resultPromise = uiFocusNode('Start', { server: 'http://localhost:6546' });

    // Simulate connect
    mockSocket._trigger('connect');

    // Wait for the command to be emitted
    await vi.advanceTimersByTimeAsync(10);

    expect(mockIoFn).toHaveBeenCalledWith(
      'http://localhost:6546/integrations',
      expect.objectContaining({
        query: { clientType: 'cli' },
      })
    );

    // Find the emitted integration:command call
    const commandCall = mockSocket.emit.mock.calls.find(
      (c: unknown[]) => c[0] === 'integration:command'
    );
    expect(commandCall).toBeDefined();
    expect(commandCall![1]).toEqual(
      expect.objectContaining({
        action: 'focus-node',
        params: { nodeId: 'Start' },
      })
    );

    // Simulate ACK
    const requestId = commandCall![1].requestId;
    mockSocket._trigger('fw:ack', { requestId, success: true, result: { focused: true } });

    await resultPromise;

    expect(mockSocket.disconnect).toHaveBeenCalled();
  });

  it('uiAddNode emits integration:command with add-node action', async () => {
    const resultPromise = uiAddNode('TRANSFORM', { server: 'http://localhost:6546' });

    mockSocket._trigger('connect');
    await vi.advanceTimersByTimeAsync(10);

    const commandCall = mockSocket.emit.mock.calls.find(
      (c: unknown[]) => c[0] === 'integration:command'
    );
    expect(commandCall).toBeDefined();
    expect(commandCall![1]).toEqual(
      expect.objectContaining({
        action: 'add-node',
        params: { nodeTypeName: 'TRANSFORM' },
      })
    );

    const requestId = commandCall![1].requestId;
    mockSocket._trigger('fw:ack', { requestId, success: true });

    await resultPromise;
    expect(mockSocket.disconnect).toHaveBeenCalled();
  });

  it('uiOpenWorkflow emits integration:command with open-workflow action', async () => {
    const resultPromise = uiOpenWorkflow('/workflows/main.ts', { server: 'http://localhost:6546' });

    mockSocket._trigger('connect');
    await vi.advanceTimersByTimeAsync(10);

    const commandCall = mockSocket.emit.mock.calls.find(
      (c: unknown[]) => c[0] === 'integration:command'
    );
    expect(commandCall).toBeDefined();
    expect(commandCall![1]).toEqual(
      expect.objectContaining({
        action: 'open-workflow',
        params: { filePath: '/workflows/main.ts' },
      })
    );

    const requestId = commandCall![1].requestId;
    mockSocket._trigger('fw:ack', { requestId, success: true });

    await resultPromise;
    expect(mockSocket.disconnect).toHaveBeenCalled();
  });

  it('uiGetState emits integration:command with get-state action', async () => {
    const resultPromise = uiGetState({ server: 'http://localhost:6546' });

    mockSocket._trigger('connect');
    await vi.advanceTimersByTimeAsync(10);

    const commandCall = mockSocket.emit.mock.calls.find(
      (c: unknown[]) => c[0] === 'integration:command'
    );
    expect(commandCall).toBeDefined();
    expect(commandCall![1]).toEqual(
      expect.objectContaining({
        action: 'get-state',
        params: {},
      })
    );

    const requestId = commandCall![1].requestId;
    mockSocket._trigger('fw:ack', { requestId, success: true, result: { state: 'idle' } });

    await resultPromise;
    expect(mockSocket.disconnect).toHaveBeenCalled();
  });

  it('resolves on matching fw:ack', async () => {
    const resultPromise = uiFocusNode('A', { server: 'http://localhost:6546' });

    mockSocket._trigger('connect');
    await vi.advanceTimersByTimeAsync(10);

    const commandCall = mockSocket.emit.mock.calls.find(
      (c: unknown[]) => c[0] === 'integration:command'
    );
    const requestId = commandCall![1].requestId;

    // Trigger ack with wrong requestId first (should be ignored)
    mockSocket._trigger('fw:ack', { requestId: 'wrong-id', success: true });

    // Then trigger matching ack
    mockSocket._trigger('fw:ack', { requestId, success: true, result: { ok: true } });

    await resultPromise;
    expect(mockSocket.disconnect).toHaveBeenCalled();
  });

  it('times out if no ACK within timeout', async () => {
    const resultPromise = uiFocusNode('B', { server: 'http://localhost:6546' });

    mockSocket._trigger('connect');
    await vi.advanceTimersByTimeAsync(10);

    // Don't trigger fw:ack — let it timeout
    vi.advanceTimersByTime(15_000);

    await resultPromise;

    // Should have set exitCode = 1 due to timeout error
    expect(mockSocket.disconnect).toHaveBeenCalled();
  });

  it('uiBatch emits integration:batch', async () => {
    const commands = JSON.stringify([
      { action: 'focus-node', params: { nodeId: 'Start' } },
      { action: 'add-node', params: { nodeTypeName: 'TRANSFORM' } },
    ]);

    const resultPromise = uiBatch(commands, { server: 'http://localhost:6546' });

    mockSocket._trigger('connect');
    await vi.advanceTimersByTimeAsync(10);

    const batchCall = mockSocket.emit.mock.calls.find(
      (c: unknown[]) => c[0] === 'integration:batch'
    );
    expect(batchCall).toBeDefined();
    expect(batchCall![1]).toEqual(
      expect.objectContaining({
        commands: [
          { action: 'focus-node', params: { nodeId: 'Start' } },
          { action: 'add-node', params: { nodeTypeName: 'TRANSFORM' } },
        ],
      })
    );

    const requestId = batchCall![1].requestId;
    mockSocket._trigger('fw:ack', { requestId, success: true, result: [null, null] });

    await resultPromise;
    expect(mockSocket.disconnect).toHaveBeenCalled();
  });

  it('uses default server when --server option is not provided', async () => {
    const resultPromise = uiFocusNode('C', {});

    mockSocket._trigger('connect');
    await vi.advanceTimersByTimeAsync(10);

    expect(mockIoFn).toHaveBeenCalledWith('http://localhost:6546/integrations', expect.any(Object));

    const commandCall = mockSocket.emit.mock.calls.find(
      (c: unknown[]) => c[0] === 'integration:command'
    );
    const requestId = commandCall![1].requestId;
    mockSocket._trigger('fw:ack', { requestId, success: true });

    await resultPromise;
  });
});
