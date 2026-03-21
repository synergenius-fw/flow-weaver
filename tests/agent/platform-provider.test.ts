import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PlatformProvider, createPlatformProvider } from '../../src/agent/providers/platform.js';
import type { AgentMessage, ToolDefinition } from '../../src/agent/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Encode a string as a Uint8Array for ReadableStream chunks. */
function encode(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/** Build SSE lines from an array of event objects. */
function sseLines(events: Record<string, unknown>[]): string {
  return events.map((e) => `data: ${JSON.stringify(e)}\n`).join('\n') + '\n';
}

/** Create a ReadableStream that yields the given chunks sequentially. */
function mockReadableStream(chunks: string[]): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encode(chunks[index++]));
      } else {
        controller.close();
      }
    },
  });
}

/** Create a mock Response with the given status and SSE body. */
function mockResponse(status: number, chunks: string[]): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    body: mockReadableStream(chunks),
    text: async () => 'error body',
    headers: new Headers(),
  } as unknown as Response;
}

/** Collect all events from the provider's stream generator. */
async function collectEvents(provider: PlatformProvider, messages: AgentMessage[], tools: ToolDefinition[] = []) {
  const events = [];
  for await (const e of provider.stream(messages, tools)) {
    events.push(e);
  }
  return events;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

const dummyTools: ToolDefinition[] = [];

describe('PlatformProvider', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---- Constructor --------------------------------------------------------

  describe('constructor', () => {
    it('requires token', () => {
      expect(() => new PlatformProvider({ token: '', platformUrl: 'https://example.com' }))
        .toThrow('PlatformProvider requires a token');
    });

    it('requires platformUrl', () => {
      expect(() => new PlatformProvider({ token: 'tok', platformUrl: '' }))
        .toThrow('PlatformProvider requires a platformUrl');
    });

    it('strips trailing slashes from URL', () => {
      const provider = new PlatformProvider({ token: 'tok', platformUrl: 'https://example.com///' });
      // We verify indirectly by checking the fetch URL in stream
      fetchSpy.mockResolvedValue(mockResponse(200, [sseLines([{ type: 'done' }])]));
      // Trigger a stream call to inspect the URL
      const gen = provider.stream([{ role: 'user', content: 'hi' }], dummyTools);
      // Consume the generator
      (async () => { for await (const _ of gen) { /* drain */ } })();
      // Wait a tick for fetch to be called
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(fetchSpy).toHaveBeenCalledWith(
            'https://example.com/ai-chat/stream',
            expect.anything(),
          );
          resolve();
        }, 10);
      });
    });
  });

  // ---- stream: request format ---------------------------------------------

  describe('stream – request format', () => {
    it('sends POST to /ai-chat/stream', async () => {
      fetchSpy.mockResolvedValue(mockResponse(200, [sseLines([{ type: 'done' }])]));
      const provider = new PlatformProvider({ token: 'jwt-token', platformUrl: 'https://p.io' });
      await collectEvents(provider, [{ role: 'user', content: 'hello' }]);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe('https://p.io/ai-chat/stream');
      expect(init.method).toBe('POST');
    });

    it('uses Bearer auth for JWT tokens', async () => {
      fetchSpy.mockResolvedValue(mockResponse(200, [sseLines([{ type: 'done' }])]));
      const provider = new PlatformProvider({ token: 'jwt-token-abc', platformUrl: 'https://p.io' });
      await collectEvents(provider, [{ role: 'user', content: 'hi' }]);

      const headers = fetchSpy.mock.calls[0][1].headers;
      expect(headers.Authorization).toBe('Bearer jwt-token-abc');
      expect(headers['X-API-Key']).toBeUndefined();
    });

    it('uses X-API-Key for fw_ tokens', async () => {
      fetchSpy.mockResolvedValue(mockResponse(200, [sseLines([{ type: 'done' }])]));
      const provider = new PlatformProvider({ token: 'fw_secret123', platformUrl: 'https://p.io' });
      await collectEvents(provider, [{ role: 'user', content: 'hi' }]);

      const headers = fetchSpy.mock.calls[0][1].headers;
      expect(headers['X-API-Key']).toBe('fw_secret123');
      expect(headers.Authorization).toBeUndefined();
    });
  });

  // ---- stream: SSE event mapping ------------------------------------------

  describe('stream – SSE event mapping', () => {
    it('yields text_delta from SSE events', async () => {
      fetchSpy.mockResolvedValue(mockResponse(200, [
        sseLines([
          { type: 'text_delta', content: 'Hello ' },
          { type: 'text_delta', content: 'world' },
          { type: 'done' },
        ]),
      ]));
      const provider = new PlatformProvider({ token: 'tok', platformUrl: 'https://p.io' });
      const events = await collectEvents(provider, [{ role: 'user', content: 'hi' }]);

      expect(events[0]).toEqual({ type: 'text_delta', text: 'Hello ' });
      expect(events[1]).toEqual({ type: 'text_delta', text: 'world' });
    });

    it('yields thinking_delta from SSE events', async () => {
      fetchSpy.mockResolvedValue(mockResponse(200, [
        sseLines([
          { type: 'thinking_delta', content: 'Let me think...' },
          { type: 'done' },
        ]),
      ]));
      const provider = new PlatformProvider({ token: 'tok', platformUrl: 'https://p.io' });
      const events = await collectEvents(provider, [{ role: 'user', content: 'hi' }]);

      expect(events[0]).toEqual({ type: 'thinking_delta', text: 'Let me think...' });
    });

    it('yields tool_use_start from tool_call_start events', async () => {
      fetchSpy.mockResolvedValue(mockResponse(200, [
        sseLines([
          { type: 'tool_call_start', toolCallId: 'tc_1', name: 'read_file' },
          { type: 'done' },
        ]),
      ]));
      const provider = new PlatformProvider({ token: 'tok', platformUrl: 'https://p.io' });
      const events = await collectEvents(provider, [{ role: 'user', content: 'hi' }]);

      expect(events[0]).toEqual({ type: 'tool_use_start', id: 'tc_1', name: 'read_file' });
    });

    it('yields tool_result from tool_call_result events', async () => {
      fetchSpy.mockResolvedValue(mockResponse(200, [
        sseLines([
          { type: 'tool_call_result', toolCallId: 'tc_1', result: 'file contents', isError: false },
          { type: 'done' },
        ]),
      ]));
      const provider = new PlatformProvider({ token: 'tok', platformUrl: 'https://p.io' });
      const events = await collectEvents(provider, [{ role: 'user', content: 'hi' }]);

      expect(events[0]).toEqual({ type: 'tool_result', id: 'tc_1', result: 'file contents', isError: false });
    });

    it('yields usage events', async () => {
      fetchSpy.mockResolvedValue(mockResponse(200, [
        sseLines([
          { type: 'usage', promptTokens: 100, completionTokens: 50 },
          { type: 'done' },
        ]),
      ]));
      const provider = new PlatformProvider({ token: 'tok', platformUrl: 'https://p.io' });
      const events = await collectEvents(provider, [{ role: 'user', content: 'hi' }]);

      expect(events[0]).toEqual({ type: 'usage', promptTokens: 100, completionTokens: 50 });
    });

    it('yields message_stop on done event', async () => {
      fetchSpy.mockResolvedValue(mockResponse(200, [
        sseLines([{ type: 'done' }]),
      ]));
      const provider = new PlatformProvider({ token: 'tok', platformUrl: 'https://p.io' });
      const events = await collectEvents(provider, [{ role: 'user', content: 'hi' }]);

      expect(events).toContainEqual({ type: 'message_stop', finishReason: 'stop' });
    });
  });

  // ---- stream: error handling ---------------------------------------------

  describe('stream – error handling', () => {
    it('yields error on non-200 response', async () => {
      const errResponse = {
        ok: false,
        status: 500,
        body: null,
        text: async () => 'Internal Server Error',
        headers: new Headers(),
      } as unknown as Response;
      fetchSpy.mockResolvedValue(errResponse);

      const provider = new PlatformProvider({ token: 'tok', platformUrl: 'https://p.io' });
      const events = await collectEvents(provider, [{ role: 'user', content: 'hi' }]);

      expect(events[0]).toEqual({
        type: 'text_delta',
        text: expect.stringContaining('Platform error 500'),
      });
      expect(events[1]).toEqual({ type: 'message_stop', finishReason: 'error' });
    });

    it('yields error on network failure', async () => {
      fetchSpy.mockRejectedValue(new Error('Network failure'));
      const provider = new PlatformProvider({ token: 'tok', platformUrl: 'https://p.io' });

      await expect(collectEvents(provider, [{ role: 'user', content: 'hi' }]))
        .rejects.toThrow('Network failure');
    });

    it('yields error from SSE error event', async () => {
      fetchSpy.mockResolvedValue(mockResponse(200, [
        sseLines([{ type: 'error', message: 'rate limited' }]),
      ]));
      const provider = new PlatformProvider({ token: 'tok', platformUrl: 'https://p.io' });
      const events = await collectEvents(provider, [{ role: 'user', content: 'hi' }]);

      expect(events[0]).toEqual({ type: 'text_delta', text: 'Error: rate limited' });
      expect(events[1]).toEqual({ type: 'message_stop', finishReason: 'error' });
    });
  });

  // ---- stream: edge cases -------------------------------------------------

  describe('stream – edge cases', () => {
    it('handles empty message gracefully', async () => {
      const provider = new PlatformProvider({ token: 'tok', platformUrl: 'https://p.io' });
      const events = await collectEvents(provider, []);

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({ type: 'message_stop', finishReason: 'stop' });
      // fetch should not have been called
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('handles messages with no user role gracefully', async () => {
      const provider = new PlatformProvider({ token: 'tok', platformUrl: 'https://p.io' });
      const events = await collectEvents(provider, [{ role: 'assistant', content: 'I said something' }]);

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({ type: 'message_stop', finishReason: 'stop' });
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('handles response with no body', async () => {
      const noBodyResponse = {
        ok: true,
        status: 200,
        body: null,
        text: async () => '',
        headers: new Headers(),
      } as unknown as Response;
      fetchSpy.mockResolvedValue(noBodyResponse);

      const provider = new PlatformProvider({ token: 'tok', platformUrl: 'https://p.io' });
      const events = await collectEvents(provider, [{ role: 'user', content: 'hi' }]);

      expect(events).toEqual([{ type: 'message_stop', finishReason: 'error' }]);
    });
  });

  // ---- Factory ------------------------------------------------------------

  describe('createPlatformProvider', () => {
    it('returns PlatformProvider instance', () => {
      const provider = createPlatformProvider({ token: 'tok', platformUrl: 'https://p.io' });
      expect(provider).toBeInstanceOf(PlatformProvider);
    });
  });
});
