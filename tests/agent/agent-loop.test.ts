import { describe, it, expect } from 'vitest';
import { runAgentLoop } from '../../src/agent/agent-loop.js';
import type { AgentProvider, AgentMessage, ToolDefinition, StreamEvent, StreamOptions } from '../../src/agent/types.js';

/** Create a mock provider that yields a predetermined sequence of events. */
function mockProvider(eventSequences: StreamEvent[][]): AgentProvider {
  let callIndex = 0;
  return {
    async *stream(
      _messages: AgentMessage[],
      _tools: ToolDefinition[],
      _options?: StreamOptions,
    ): AsyncGenerator<StreamEvent> {
      const events = eventSequences[callIndex++] ?? [];
      for (const event of events) {
        yield event;
      }
    },
  };
}

const testTools: ToolDefinition[] = [
  {
    name: 'read_file',
    description: 'Read a file',
    inputSchema: {
      type: 'object',
      properties: { file: { type: 'string' } },
      required: ['file'],
    },
  },
];

describe('runAgentLoop', () => {
  it('should complete when provider returns stop (no tool calls)', async () => {
    const provider = mockProvider([
      [
        { type: 'text_delta', text: 'Hello world' },
        { type: 'message_stop', finishReason: 'stop' },
      ],
    ]);

    const result = await runAgentLoop(
      provider,
      testTools,
      async () => ({ result: '', isError: false }),
      [{ role: 'user', content: 'hi' }],
    );

    expect(result.success).toBe(true);
    expect(result.summary).toBe('Hello world');
    expect(result.toolCallCount).toBe(0);
  });

  it('should execute tool calls and iterate', async () => {
    const provider = mockProvider([
      // First call: model requests a tool call
      [
        { type: 'text_delta', text: 'Let me read that file' },
        { type: 'tool_use_start', id: 'tc_1', name: 'read_file' },
        { type: 'tool_use_end', id: 'tc_1', arguments: { file: 'test.ts' } },
        { type: 'message_stop', finishReason: 'tool_calls' },
      ],
      // Second call: model responds with final text
      [
        { type: 'text_delta', text: 'The file contains test code' },
        { type: 'message_stop', finishReason: 'stop' },
      ],
    ]);

    const result = await runAgentLoop(
      provider,
      testTools,
      async (name, args) => {
        if (name === 'read_file') {
          return { result: 'export const x = 1;', isError: false };
        }
        return { result: 'unknown tool', isError: true };
      },
      [{ role: 'user', content: 'read test.ts' }],
    );

    expect(result.success).toBe(true);
    expect(result.toolCallCount).toBe(1);
    expect(result.summary).toBe('The file contains test code');
    // Conversation should have: user, assistant (with tool call), tool result, assistant (final)
    expect(result.messages).toHaveLength(4);
    expect(result.messages[1].role).toBe('assistant');
    expect(result.messages[1].toolCalls).toHaveLength(1);
    expect(result.messages[2].role).toBe('tool');
    expect(result.messages[3].role).toBe('assistant');
  });

  it('should respect maxIterations', async () => {
    // Provider always requests tool calls — should hit max
    const provider = mockProvider(
      Array.from({ length: 5 }, () => [
        { type: 'tool_use_start', id: 'tc_1', name: 'read_file' } as StreamEvent,
        { type: 'tool_use_end', id: 'tc_1', arguments: { file: 'x' } } as StreamEvent,
        { type: 'message_stop', finishReason: 'tool_calls' } as StreamEvent,
      ]),
    );

    const result = await runAgentLoop(
      provider,
      testTools,
      async () => ({ result: 'ok', isError: false }),
      [{ role: 'user', content: 'loop forever' }],
      { maxIterations: 3 },
    );

    expect(result.success).toBe(false);
    expect(result.summary).toContain('max iterations');
    expect(result.toolCallCount).toBe(3);
  });

  it('should handle AbortSignal', async () => {
    const controller = new AbortController();
    controller.abort(); // Abort immediately

    const provider = mockProvider([]);

    const result = await runAgentLoop(
      provider,
      testTools,
      async () => ({ result: '', isError: false }),
      [{ role: 'user', content: 'test' }],
      { signal: controller.signal },
    );

    expect(result.success).toBe(false);
    expect(result.summary).toBe('Aborted');
  });

  it('should track usage across iterations', async () => {
    const provider = mockProvider([
      [
        { type: 'usage', promptTokens: 100, completionTokens: 50 },
        { type: 'tool_use_start', id: 'tc_1', name: 'read_file' },
        { type: 'tool_use_end', id: 'tc_1', arguments: { file: 'a.ts' } },
        { type: 'message_stop', finishReason: 'tool_calls' },
      ],
      [
        { type: 'usage', promptTokens: 200, completionTokens: 100 },
        { type: 'text_delta', text: 'done' },
        { type: 'message_stop', finishReason: 'stop' },
      ],
    ]);

    const result = await runAgentLoop(
      provider,
      testTools,
      async () => ({ result: 'content', isError: false }),
      [{ role: 'user', content: 'test' }],
    );

    expect(result.usage.promptTokens).toBe(300);
    expect(result.usage.completionTokens).toBe(150);
  });

  it('should handle tool executor errors gracefully', async () => {
    const provider = mockProvider([
      [
        { type: 'tool_use_start', id: 'tc_1', name: 'read_file' },
        { type: 'tool_use_end', id: 'tc_1', arguments: { file: 'missing.ts' } },
        { type: 'message_stop', finishReason: 'tool_calls' },
      ],
      [
        { type: 'text_delta', text: 'File not found, done' },
        { type: 'message_stop', finishReason: 'stop' },
      ],
    ]);

    const result = await runAgentLoop(
      provider,
      testTools,
      async () => {
        throw new Error('ENOENT: file not found');
      },
      [{ role: 'user', content: 'read missing.ts' }],
    );

    expect(result.success).toBe(true);
    expect(result.toolCallCount).toBe(1);
    // Tool error should be in conversation
    const toolMsg = result.messages.find((m) => m.role === 'tool');
    expect(toolMsg?.content).toContain('ENOENT');
  });

  it('should fire onStreamEvent and onToolEvent callbacks', async () => {
    const streamEvents: StreamEvent[] = [];
    const toolEvents: Array<{ type: string; name: string }> = [];

    const provider = mockProvider([
      [
        { type: 'text_delta', text: 'hi' },
        { type: 'tool_use_start', id: 'tc_1', name: 'read_file' },
        { type: 'tool_use_end', id: 'tc_1', arguments: { file: 'a.ts' } },
        { type: 'message_stop', finishReason: 'tool_calls' },
      ],
      [
        { type: 'text_delta', text: 'done' },
        { type: 'message_stop', finishReason: 'stop' },
      ],
    ]);

    await runAgentLoop(
      provider,
      testTools,
      async () => ({ result: 'ok', isError: false }),
      [{ role: 'user', content: 'test' }],
      {
        onStreamEvent: (e) => streamEvents.push(e),
        onToolEvent: (e) => toolEvents.push({ type: e.type, name: e.name }),
      },
    );

    expect(streamEvents.length).toBeGreaterThan(0);
    expect(toolEvents).toEqual([
      { type: 'tool_call_start', name: 'read_file' },
      { type: 'tool_call_result', name: 'read_file' },
    ]);
  });
});
