import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { tunnelCommand } from '../../../src/cli/commands/tunnel.js';

// ---------------------------------------------------------------------------
// Mock WebSocket (use createWs injection — no vi.mock needed)
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
 * Start tunnel and simulate a successful cloud connection.
 * Returns the cloud ws mock for further assertions.
 */
async function startTunnel(
  dir: string,
): Promise<{ promise: Promise<void>; cloudWs: MockWs }> {
  let capturedWs: MockWs | null = null;
  const createWsFn = vi.fn((_url: string) => {
    capturedWs = createMockWs();
    return capturedWs;
  });

  const promise = tunnelCommand({
    key: 'fw_testkey1234567890abcdef',
    cloud: 'http://localhost:4800',
    dir,
    createWs: createWsFn as unknown as (url: string) => import('ws').default,
  });

  // Wait for ws creation
  await new Promise((r) => setTimeout(r, 10));
  const cloudWs = capturedWs!;

  // Simulate cloud WebSocket open + hello
  cloudWs._trigger('open');
  cloudWs._trigger(
    'message',
    JSON.stringify({ type: 'tunnel:hello', userId: 'user-123' }),
  );
  await new Promise((r) => setTimeout(r, 10));

  return { promise, cloudWs };
}

describe('tunnel command (self-contained)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tunnel-test-'));
    // Create a test file in the workspace
    await fs.writeFile(path.join(tmpDir, 'hello.txt'), 'hello world', 'utf-8');
  });

  it('responds to ping with pong', async () => {
    const { promise, cloudWs } = await startTunnel(tmpDir);

    cloudWs._trigger('message', JSON.stringify({ type: 'ping' }));
    await new Promise((r) => setTimeout(r, 10));

    expect(cloudWs.send).toHaveBeenCalledWith(JSON.stringify({ type: 'pong' }));

    void promise;
  });

  it('dispatches getCWD and returns /', async () => {
    const { promise, cloudWs } = await startTunnel(tmpDir);

    cloudWs._trigger(
      'message',
      JSON.stringify({
        type: 'tunnel:request',
        requestId: 'r-1',
        id: 'req-1',
        method: 'getCWD',
        params: {},
      }),
    );

    await new Promise((r) => setTimeout(r, 50));

    expect(cloudWs.send).toHaveBeenCalledWith(
      JSON.stringify({
        type: 'tunnel:response',
        requestId: 'r-1',
        id: 'req-1',
        success: true,
        result: '/',
      }),
    );

    void promise;
  });

  it('dispatches hasFile and returns true for existing file', async () => {
    const { promise, cloudWs } = await startTunnel(tmpDir);

    cloudWs._trigger(
      'message',
      JSON.stringify({
        type: 'tunnel:request',
        requestId: 'r-2',
        id: 'req-2',
        method: 'hasFile',
        params: { filePath: '/hello.txt' },
      }),
    );

    await new Promise((r) => setTimeout(r, 50));

    expect(cloudWs.send).toHaveBeenCalledWith(
      JSON.stringify({
        type: 'tunnel:response',
        requestId: 'r-2',
        id: 'req-2',
        success: true,
        result: true,
      }),
    );

    void promise;
  });

  it('dispatches getFile and returns file content', async () => {
    const { promise, cloudWs } = await startTunnel(tmpDir);

    cloudWs._trigger(
      'message',
      JSON.stringify({
        type: 'tunnel:request',
        requestId: 'r-3',
        id: 'req-3',
        method: 'getFile',
        params: { filePath: '/hello.txt' },
      }),
    );

    await new Promise((r) => setTimeout(r, 50));

    expect(cloudWs.send).toHaveBeenCalledWith(
      JSON.stringify({
        type: 'tunnel:response',
        requestId: 'r-3',
        id: 'req-3',
        success: true,
        result: 'hello world',
      }),
    );

    void promise;
  });

  it('handles unknown methods gracefully', async () => {
    const { promise, cloudWs } = await startTunnel(tmpDir);

    cloudWs._trigger(
      'message',
      JSON.stringify({
        type: 'tunnel:request',
        requestId: 'r-4',
        id: 'req-4',
        method: 'nonExistentMethod',
        params: {},
      }),
    );

    await new Promise((r) => setTimeout(r, 50));

    expect(cloudWs.send).toHaveBeenCalledWith(
      JSON.stringify({
        type: 'tunnel:response',
        requestId: 'r-4',
        id: 'req-4',
        success: true,
        result: undefined,
      }),
    );

    void promise;
  });

  it('returns error for missing required params', async () => {
    const { promise, cloudWs } = await startTunnel(tmpDir);

    cloudWs._trigger(
      'message',
      JSON.stringify({
        type: 'tunnel:request',
        requestId: 'r-5',
        id: 'req-5',
        method: 'getFile',
        params: {}, // no filePath
      }),
    );

    await new Promise((r) => setTimeout(r, 50));

    const sent = cloudWs.send.mock.calls.find((call) => {
      const msg = JSON.parse(call[0] as string);
      return msg.requestId === 'r-5';
    });

    expect(sent).toBeTruthy();
    const response = JSON.parse(sent![0] as string);
    expect(response.success).toBe(false);
    expect(response.error.message).toContain('filePath');

    void promise;
  });

  it('dispatches writeFile and reads it back', async () => {
    const { promise, cloudWs } = await startTunnel(tmpDir);

    // Write
    cloudWs._trigger(
      'message',
      JSON.stringify({
        type: 'tunnel:request',
        requestId: 'r-6',
        id: 'req-6',
        method: 'writeFile',
        params: { filePath: '/new-file.txt', content: 'new content' },
      }),
    );
    await new Promise((r) => setTimeout(r, 50));

    // Read back to verify
    const written = await fs.readFile(path.join(tmpDir, 'new-file.txt'), 'utf-8');
    expect(written).toBe('new content');

    void promise;
  });
});
