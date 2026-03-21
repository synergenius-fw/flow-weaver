import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAICompatProvider, createOpenAICompatProvider } from '../../src/agent/providers/openai-compat.js';
import type { AgentMessage, ToolDefinition } from '../../src/agent/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function encode(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/** Build SSE lines from raw data strings (already JSON-encoded or [DONE]). */
function sseRaw(dataLines: string[]): string {
  return dataLines.map((d) => `data: ${d}\n`).join('\n') + '\n';
}

/** Build OpenAI-style SSE chunks from choice deltas. */
function openaiChunks(deltas: Array<{ delta: Record<string, unknown>; finish_reason?: string | null; usage?: Record<string, number> }>): string {
  return deltas
    .map((d) => {
      const payload: Record<string, unknown> = {
        choices: [{ index: 0, delta: d.delta, finish_reason: d.finish_reason ?? null }],
      };
      if (d.usage) payload.usage = d.usage;
      return `data: ${JSON.stringify(payload)}\n`;
    })
    .join('\n') + '\n';
}

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

function mockResponse(status: number, chunks: string[]): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    body: mockReadableStream(chunks),
    text: async () => 'error body',
    headers: new Headers(),
  } as unknown as Response;
}

async function collectEvents(provider: OpenAICompatProvider, messages: AgentMessage[], tools: ToolDefinition[] = []) {
  const events = [];
  for await (const e of provider.stream(messages, tools)) {
    events.push(e);
  }
  return events;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const sampleTools: ToolDefinition[] = [
  {
    name: 'get_weather',
    description: 'Get current weather',
    inputSchema: {
      type: 'object',
      properties: { city: { type: 'string' } },
      required: ['city'],
    },
  },
];

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('OpenAICompatProvider', () => {
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
    it('requires apiKey', () => {
      expect(() => new OpenAICompatProvider({ apiKey: '' }))
        .toThrow('OpenAICompatProvider requires an API key');
    });

    it('defaults model to gpt-4o', async () => {
      fetchSpy.mockResolvedValue(mockResponse(200, [sseRaw(['[DONE]'])]));
      const provider = new OpenAICompatProvider({ apiKey: 'sk-test' });
      await collectEvents(provider, [{ role: 'user', content: 'hi' }]);

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.model).toBe('gpt-4o');
    });

    it('defaults baseUrl to openai', async () => {
      fetchSpy.mockResolvedValue(mockResponse(200, [sseRaw(['[DONE]'])]));
      const provider = new OpenAICompatProvider({ apiKey: 'sk-test' });
      await collectEvents(provider, [{ role: 'user', content: 'hi' }]);

      const url = fetchSpy.mock.calls[0][0];
      expect(url).toBe('https://api.openai.com/v1/chat/completions');
    });

    it('strips trailing slashes from baseUrl', async () => {
      fetchSpy.mockResolvedValue(mockResponse(200, [sseRaw(['[DONE]'])]));
      const provider = new OpenAICompatProvider({ apiKey: 'sk-test', baseUrl: 'https://custom.ai///' });
      await collectEvents(provider, [{ role: 'user', content: 'hi' }]);

      const url = fetchSpy.mock.calls[0][0];
      expect(url).toBe('https://custom.ai/v1/chat/completions');
    });
  });

  // ---- stream: request format ---------------------------------------------

  describe('stream – request format', () => {
    it('sends POST to /v1/chat/completions', async () => {
      fetchSpy.mockResolvedValue(mockResponse(200, [sseRaw(['[DONE]'])]));
      const provider = new OpenAICompatProvider({ apiKey: 'sk-test' });
      await collectEvents(provider, [{ role: 'user', content: 'hi' }]);

      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toContain('/v1/chat/completions');
      expect(init.method).toBe('POST');
      expect(init.headers.Authorization).toBe('Bearer sk-test');
    });

    it('includes tools in request body', async () => {
      fetchSpy.mockResolvedValue(mockResponse(200, [sseRaw(['[DONE]'])]));
      const provider = new OpenAICompatProvider({ apiKey: 'sk-test' });
      await collectEvents(provider, [{ role: 'user', content: 'hi' }], sampleTools);

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.tools).toHaveLength(1);
      expect(body.tools[0]).toEqual({
        type: 'function',
        function: {
          name: 'get_weather',
          description: 'Get current weather',
          parameters: sampleTools[0].inputSchema,
        },
      });
    });

    it('does not include tools when array is empty', async () => {
      fetchSpy.mockResolvedValue(mockResponse(200, [sseRaw(['[DONE]'])]));
      const provider = new OpenAICompatProvider({ apiKey: 'sk-test' });
      await collectEvents(provider, [{ role: 'user', content: 'hi' }], []);

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.tools).toBeUndefined();
    });

    it('includes system prompt in messages', async () => {
      fetchSpy.mockResolvedValue(mockResponse(200, [sseRaw(['[DONE]'])]));
      const provider = new OpenAICompatProvider({ apiKey: 'sk-test' });
      const gen = provider.stream(
        [{ role: 'user', content: 'hi' }],
        [],
        { systemPrompt: 'You are a helpful assistant.' },
      );
      for await (const _ of gen) { /* drain */ }

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.messages[0]).toEqual({ role: 'system', content: 'You are a helpful assistant.' });
      expect(body.messages[1]).toEqual({ role: 'user', content: 'hi' });
    });
  });

  // ---- stream: SSE event mapping ------------------------------------------

  describe('stream – SSE event mapping', () => {
    it('yields text_delta from content deltas', async () => {
      fetchSpy.mockResolvedValue(mockResponse(200, [
        openaiChunks([
          { delta: { content: 'Hello' } },
          { delta: { content: ' world' } },
        ]),
        sseRaw(['[DONE]']),
      ]));
      const provider = new OpenAICompatProvider({ apiKey: 'sk-test' });
      const events = await collectEvents(provider, [{ role: 'user', content: 'hi' }]);

      expect(events[0]).toEqual({ type: 'text_delta', text: 'Hello' });
      expect(events[1]).toEqual({ type: 'text_delta', text: ' world' });
    });

    it('handles tool_calls in delta format', async () => {
      const toolCallChunks = [
        openaiChunks([
          {
            delta: {
              tool_calls: [{
                index: 0,
                id: 'call_abc',
                function: { name: 'get_weather', arguments: '' },
              }],
            },
          },
          {
            delta: {
              tool_calls: [{
                index: 0,
                function: { arguments: '{"city"' },
              }],
            },
          },
          {
            delta: {
              tool_calls: [{
                index: 0,
                function: { arguments: ':"NYC"}' },
              }],
            },
          },
        ]),
        sseRaw(['[DONE]']),
      ];

      fetchSpy.mockResolvedValue(mockResponse(200, toolCallChunks));
      const provider = new OpenAICompatProvider({ apiKey: 'sk-test' });
      const events = await collectEvents(provider, [{ role: 'user', content: 'weather?' }]);

      // Should start with tool_use_start
      expect(events[0]).toEqual({ type: 'tool_use_start', id: 'call_abc', name: 'get_weather' });
      // Should have tool_use_delta events for argument accumulation
      // First delta has empty arguments ('') so no tool_use_delta is emitted for it
      expect(events.filter((e) => e.type === 'tool_use_delta')).toHaveLength(2);
    });

    it('accumulates tool call arguments across deltas', async () => {
      const toolCallChunks = [
        openaiChunks([
          {
            delta: {
              tool_calls: [{
                index: 0,
                id: 'call_1',
                function: { name: 'get_weather', arguments: '{"ci' },
              }],
            },
          },
          {
            delta: {
              tool_calls: [{
                index: 0,
                function: { arguments: 'ty":"Lo' },
              }],
            },
          },
          {
            delta: {
              tool_calls: [{
                index: 0,
                function: { arguments: 'ndon"}' },
              }],
            },
          },
        ]),
        sseRaw(['[DONE]']),
      ];

      fetchSpy.mockResolvedValue(mockResponse(200, toolCallChunks));
      const provider = new OpenAICompatProvider({ apiKey: 'sk-test' });
      const events = await collectEvents(provider, [{ role: 'user', content: 'weather?' }]);

      // On [DONE], it should flush with accumulated args
      const endEvent = events.find((e) => e.type === 'tool_use_end');
      expect(endEvent).toEqual({
        type: 'tool_use_end',
        id: 'call_1',
        arguments: { city: 'London' },
      });
    });

    it('yields tool_use_start and tool_use_end', async () => {
      fetchSpy.mockResolvedValue(mockResponse(200, [
        openaiChunks([
          {
            delta: {
              tool_calls: [{
                index: 0,
                id: 'call_x',
                function: { name: 'get_weather', arguments: '{"city":"Paris"}' },
              }],
            },
          },
        ]),
        sseRaw(['[DONE]']),
      ]));

      const provider = new OpenAICompatProvider({ apiKey: 'sk-test' });
      const events = await collectEvents(provider, [{ role: 'user', content: 'hi' }]);

      const startEvents = events.filter((e) => e.type === 'tool_use_start');
      const endEvents = events.filter((e) => e.type === 'tool_use_end');
      expect(startEvents).toHaveLength(1);
      expect(startEvents[0]).toEqual({ type: 'tool_use_start', id: 'call_x', name: 'get_weather' });
      expect(endEvents).toHaveLength(1);
      expect(endEvents[0]).toEqual({
        type: 'tool_use_end',
        id: 'call_x',
        arguments: { city: 'Paris' },
      });
    });

    it('handles [DONE] marker', async () => {
      fetchSpy.mockResolvedValue(mockResponse(200, [
        openaiChunks([{ delta: { content: 'done' } }]),
        sseRaw(['[DONE]']),
      ]));
      const provider = new OpenAICompatProvider({ apiKey: 'sk-test' });
      const events = await collectEvents(provider, [{ role: 'user', content: 'hi' }]);

      const lastEvent = events[events.length - 1];
      expect(lastEvent).toEqual({ type: 'message_stop', finishReason: 'stop' });
    });

    it('yields usage events', async () => {
      const usageChunk = `data: ${JSON.stringify({
        choices: [{ index: 0, delta: {}, finish_reason: null }],
        usage: { prompt_tokens: 42, completion_tokens: 18 },
      })}\n\n`;

      fetchSpy.mockResolvedValue(mockResponse(200, [
        usageChunk,
        sseRaw(['[DONE]']),
      ]));

      const provider = new OpenAICompatProvider({ apiKey: 'sk-test' });
      const events = await collectEvents(provider, [{ role: 'user', content: 'hi' }]);

      const usageEvent = events.find((e) => e.type === 'usage');
      expect(usageEvent).toEqual({ type: 'usage', promptTokens: 42, completionTokens: 18 });
    });

    it('handles finish_reason tool_calls', async () => {
      fetchSpy.mockResolvedValue(mockResponse(200, [
        openaiChunks([
          {
            delta: {
              tool_calls: [{
                index: 0,
                id: 'call_z',
                function: { name: 'get_weather', arguments: '{}' },
              }],
            },
          },
          { delta: {}, finish_reason: 'tool_calls' },
        ]),
        sseRaw(['[DONE]']),
      ]));

      const provider = new OpenAICompatProvider({ apiKey: 'sk-test' });
      const events = await collectEvents(provider, [{ role: 'user', content: 'hi' }]);

      const stopEvent = events.find((e) => e.type === 'message_stop');
      expect(stopEvent).toEqual({ type: 'message_stop', finishReason: 'tool_calls' });
    });
  });

  // ---- stream: error handling ---------------------------------------------

  describe('stream – error handling', () => {
    it('handles non-200 response', async () => {
      const errResponse = {
        ok: false,
        status: 429,
        body: null,
        text: async () => 'Rate limit exceeded',
        headers: new Headers(),
      } as unknown as Response;
      fetchSpy.mockResolvedValue(errResponse);

      const provider = new OpenAICompatProvider({ apiKey: 'sk-test' });
      const events = await collectEvents(provider, [{ role: 'user', content: 'hi' }]);

      expect(events[0]).toEqual({
        type: 'text_delta',
        text: expect.stringContaining('OpenAI API error 429'),
      });
      expect(events[1]).toEqual({ type: 'message_stop', finishReason: 'error' });
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

      const provider = new OpenAICompatProvider({ apiKey: 'sk-test' });
      const events = await collectEvents(provider, [{ role: 'user', content: 'hi' }]);

      expect(events).toEqual([{ type: 'message_stop', finishReason: 'error' }]);
    });

    it('handles network failure', async () => {
      fetchSpy.mockRejectedValue(new Error('ECONNREFUSED'));
      const provider = new OpenAICompatProvider({ apiKey: 'sk-test' });

      await expect(collectEvents(provider, [{ role: 'user', content: 'hi' }]))
        .rejects.toThrow('ECONNREFUSED');
    });
  });

  // ---- formatMessage (tested via request body) ----------------------------

  describe('formatMessage – message conversion', () => {
    it('converts user message correctly', async () => {
      fetchSpy.mockResolvedValue(mockResponse(200, [sseRaw(['[DONE]'])]));
      const provider = new OpenAICompatProvider({ apiKey: 'sk-test' });
      await collectEvents(provider, [{ role: 'user', content: 'Hello there' }]);

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      const userMsg = body.messages.find((m: Record<string, unknown>) => m.role === 'user');
      expect(userMsg).toEqual({ role: 'user', content: 'Hello there' });
    });

    it('converts assistant message with tool calls correctly', async () => {
      fetchSpy.mockResolvedValue(mockResponse(200, [sseRaw(['[DONE]'])]));
      const provider = new OpenAICompatProvider({ apiKey: 'sk-test' });
      const messages: AgentMessage[] = [
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'tc_1', name: 'get_weather', arguments: { city: 'NYC' } }],
        },
        {
          role: 'tool',
          content: 'Sunny 75F',
          toolCallId: 'tc_1',
        },
        { role: 'user', content: 'thanks' },
      ];
      await collectEvents(provider, messages);

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      const assistantMsg = body.messages.find((m: Record<string, unknown>) => m.role === 'assistant');
      expect(assistantMsg.tool_calls).toEqual([
        {
          id: 'tc_1',
          type: 'function',
          function: { name: 'get_weather', arguments: '{"city":"NYC"}' },
        },
      ]);
      expect(assistantMsg.content).toBeNull();
    });

    it('converts tool message correctly', async () => {
      fetchSpy.mockResolvedValue(mockResponse(200, [sseRaw(['[DONE]'])]));
      const provider = new OpenAICompatProvider({ apiKey: 'sk-test' });
      const messages: AgentMessage[] = [
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'tc_1', name: 'read', arguments: {} }],
        },
        { role: 'tool', content: 'result data', toolCallId: 'tc_1' },
        { role: 'user', content: 'ok' },
      ];
      await collectEvents(provider, messages);

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      const toolMsg = body.messages.find((m: Record<string, unknown>) => m.role === 'tool');
      expect(toolMsg).toEqual({
        role: 'tool',
        tool_call_id: 'tc_1',
        content: 'result data',
      });
    });

    it('converts non-string content to JSON', async () => {
      fetchSpy.mockResolvedValue(mockResponse(200, [sseRaw(['[DONE]'])]));
      const provider = new OpenAICompatProvider({ apiKey: 'sk-test' });
      const messages: AgentMessage[] = [
        { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      ];
      await collectEvents(provider, messages);

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      const userMsg = body.messages.find((m: Record<string, unknown>) => m.role === 'user');
      expect(userMsg.content).toBe(JSON.stringify([{ type: 'text', text: 'hello' }]));
    });
  });

  // ---- Factory ------------------------------------------------------------

  describe('createOpenAICompatProvider', () => {
    it('returns OpenAICompatProvider instance', () => {
      const provider = createOpenAICompatProvider({ apiKey: 'sk-test' });
      expect(provider).toBeInstanceOf(OpenAICompatProvider);
    });
  });
});
