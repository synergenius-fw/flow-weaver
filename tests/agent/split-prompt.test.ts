/**
 * Tests for SplitPrompt type and its integration with the agent loop and providers.
 */
import { describe, it, expect, vi } from 'vitest';
import { joinSplitPrompt } from '../../src/agent/types.js';
import { runAgentLoop } from '../../src/agent/agent-loop.js';
import type { AgentProvider, AgentMessage, ToolDefinition, StreamEvent, StreamOptions, SplitPrompt } from '../../src/agent/types.js';

// ── joinSplitPrompt ─────────────────────────────────────────────────

describe('joinSplitPrompt', () => {
  it('joins prefix and suffix with double newline', () => {
    const result = joinSplitPrompt({ prefix: 'Hello', suffix: 'World' });
    expect(result).toBe('Hello\n\nWorld');
  });

  it('returns only prefix when suffix is empty', () => {
    const result = joinSplitPrompt({ prefix: 'Hello', suffix: '' });
    expect(result).toBe('Hello');
  });

  it('handles multiline prefix and suffix', () => {
    const result = joinSplitPrompt({
      prefix: 'Line 1\nLine 2',
      suffix: 'Line 3\nLine 4',
    });
    expect(result).toBe('Line 1\nLine 2\n\nLine 3\nLine 4');
  });

  it('handles empty prefix with non-empty suffix', () => {
    const result = joinSplitPrompt({ prefix: '', suffix: 'Suffix' });
    expect(result).toBe('\n\nSuffix');
  });

  it('handles both empty', () => {
    const result = joinSplitPrompt({ prefix: '', suffix: '' });
    expect(result).toBe('');
  });
});

// ── SplitPrompt threading through agent loop ────────────────────────

describe('SplitPrompt in agent loop', () => {
  /** Mock provider that captures the StreamOptions it receives. */
  function capturingProvider(): { provider: AgentProvider; getCapturedOptions: () => StreamOptions | undefined } {
    let capturedOptions: StreamOptions | undefined;
    return {
      provider: {
        async *stream(
          _messages: AgentMessage[],
          _tools: ToolDefinition[],
          options?: StreamOptions,
        ): AsyncGenerator<StreamEvent> {
          capturedOptions = options;
          yield { type: 'text_delta', text: 'done' };
          yield { type: 'message_stop', finishReason: 'stop' };
        },
      },
      getCapturedOptions: () => capturedOptions,
    };
  }

  it('passes SplitPrompt through to provider', async () => {
    const { provider, getCapturedOptions } = capturingProvider();
    const splitPrompt: SplitPrompt = {
      prefix: 'You are a helpful assistant.',
      suffix: 'Project context: TypeScript project using vitest.',
    };

    await runAgentLoop(
      provider,
      [],
      async () => ({ result: '', isError: false }),
      [{ role: 'user', content: 'hello' }],
      { systemPrompt: splitPrompt },
    );

    const options = getCapturedOptions();
    expect(options?.systemPrompt).toBeDefined();
    expect(options?.systemPrompt?.prefix).toBe('You are a helpful assistant.');
    expect(options?.systemPrompt?.suffix).toBe('Project context: TypeScript project using vitest.');
  });

  it('passes undefined when no systemPrompt provided', async () => {
    const { provider, getCapturedOptions } = capturingProvider();

    await runAgentLoop(
      provider,
      [],
      async () => ({ result: '', isError: false }),
      [{ role: 'user', content: 'hello' }],
    );

    const options = getCapturedOptions();
    expect(options?.systemPrompt).toBeUndefined();
  });

  it('preserves SplitPrompt across multiple iterations', async () => {
    const capturedPrompts: Array<SplitPrompt | undefined> = [];
    let callIndex = 0;
    const eventSequences: StreamEvent[][] = [
      [
        { type: 'tool_use_start', id: 'tc_1', name: 'read_file' },
        { type: 'tool_use_end', id: 'tc_1', arguments: { file: 'test.ts' } },
        { type: 'message_stop', finishReason: 'tool_calls' },
      ],
      [
        { type: 'text_delta', text: 'done' },
        { type: 'message_stop', finishReason: 'stop' },
      ],
    ];

    const provider: AgentProvider = {
      async *stream(_msgs, _tools, options) {
        capturedPrompts.push(options?.systemPrompt);
        const events = eventSequences[callIndex++] ?? [];
        for (const e of events) yield e;
      },
    };

    const split: SplitPrompt = { prefix: 'system', suffix: 'context' };

    await runAgentLoop(
      provider,
      [{ name: 'read_file', description: 'Read', inputSchema: { type: 'object', properties: { file: { type: 'string' } }, required: ['file'] } }],
      async () => ({ result: 'content', isError: false }),
      [{ role: 'user', content: 'read test.ts' }],
      { systemPrompt: split },
    );

    // Both iterations should receive the same SplitPrompt
    expect(capturedPrompts).toHaveLength(2);
    expect(capturedPrompts[0]).toEqual(split);
    expect(capturedPrompts[1]).toEqual(split);
  });
});

// ── Anthropic provider block format ─────────────────────────────────

describe('Anthropic provider system blocks', () => {
  it('constructs cache-controlled blocks from SplitPrompt', async () => {
    // We test the buildSystemBlocks function indirectly by checking
    // the fetch request body. This requires importing the provider.
    const { AnthropicProvider } = await import('../../src/agent/providers/anthropic.js');

    let capturedBody: string | undefined;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      capturedBody = init.body as string;
      return {
        ok: true,
        body: {
          getReader: () => ({
            releaseLock: vi.fn(),
            read: vi.fn()
              .mockResolvedValueOnce({
                done: false,
                value: new TextEncoder().encode('event: message_start\ndata: {"type":"message_start","message":{"id":"m1","type":"message","role":"assistant","content":[],"model":"c","usage":{"input_tokens":10,"output_tokens":0}}}\n\n'),
              })
              .mockResolvedValueOnce({
                done: false,
                value: new TextEncoder().encode('event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\nevent: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hello"}}\n\n'),
              })
              .mockResolvedValueOnce({
                done: false,
                value: new TextEncoder().encode('event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n'),
              })
              .mockResolvedValueOnce({ done: true, value: undefined }),
          }),
        },
      } as unknown as Response;
    });

    try {
      const provider = new AnthropicProvider({ apiKey: 'test-key', model: 'test-model' });
      const stream = provider.stream(
        [{ role: 'user', content: 'hi' }],
        [],
        {
          systemPrompt: {
            prefix: 'You are Weaver.',
            suffix: 'Project: test-project',
          },
        },
      );

      // Consume the stream
      for await (const _event of stream) { /* drain */ }

      // Verify the request body
      expect(capturedBody).toBeDefined();
      const body = JSON.parse(capturedBody!);

      // system should be an array of blocks, not a string
      expect(Array.isArray(body.system)).toBe(true);
      expect(body.system).toHaveLength(2);

      // First block: prefix with cache_control
      expect(body.system[0].type).toBe('text');
      expect(body.system[0].text).toBe('You are Weaver.');
      expect(body.system[0].cache_control).toEqual({ type: 'ephemeral' });

      // Second block: suffix without cache_control
      expect(body.system[1].type).toBe('text');
      expect(body.system[1].text).toBe('Project: test-project');
      expect(body.system[1].cache_control).toBeUndefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('produces single block when suffix is empty', async () => {
    const { AnthropicProvider } = await import('../../src/agent/providers/anthropic.js');

    let capturedBody: string | undefined;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      capturedBody = init.body as string;
      return {
        ok: true,
        body: {
          getReader: () => ({
            releaseLock: vi.fn(),
            read: vi.fn()
              .mockResolvedValueOnce({
                done: false,
                value: new TextEncoder().encode('event: message_start\ndata: {"type":"message_start","message":{"id":"m1","type":"message","role":"assistant","content":[],"model":"c","usage":{"input_tokens":10,"output_tokens":0}}}\n\n'),
              })
              .mockResolvedValueOnce({
                done: false,
                value: new TextEncoder().encode('event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n'),
              })
              .mockResolvedValueOnce({ done: true, value: undefined }),
          }),
        },
      } as unknown as Response;
    });

    try {
      const provider = new AnthropicProvider({ apiKey: 'test-key', model: 'test-model' });
      const stream = provider.stream(
        [{ role: 'user', content: 'hi' }],
        [],
        { systemPrompt: { prefix: 'System only.', suffix: '' } },
      );

      for await (const _event of stream) { /* drain */ }

      const body = JSON.parse(capturedBody!);
      expect(Array.isArray(body.system)).toBe(true);
      expect(body.system).toHaveLength(1);
      expect(body.system[0].text).toBe('System only.');
      expect(body.system[0].cache_control).toEqual({ type: 'ephemeral' });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
