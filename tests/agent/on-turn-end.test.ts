import { describe, it, expect, vi } from 'vitest';
import { runAgentLoop } from '../../src/agent/agent-loop.js';
import type { AgentProvider, AgentMessage, ToolDefinition, StreamEvent, StreamOptions, TurnEndContext } from '../../src/agent/types.js';

function mockProvider(eventSequences: StreamEvent[][]): AgentProvider {
  let callIndex = 0;
  return {
    async *stream(
      _messages: AgentMessage[],
      _tools: ToolDefinition[],
      _options?: StreamOptions,
    ): AsyncGenerator<StreamEvent> {
      const events = eventSequences[callIndex++] ?? [];
      for (const event of events) yield event;
    },
  };
}

const testTools: ToolDefinition[] = [
  {
    name: 'read_file',
    description: 'Read a file',
    inputSchema: { type: 'object', properties: { file: { type: 'string' } }, required: ['file'] },
  },
];

const executor = async (name: string) => ({ result: 'ok', isError: false });

describe('onTurnEnd callback', () => {

  it('fires on final turn with isFinalTurn=true', async () => {
    const onTurnEnd = vi.fn();
    const provider = mockProvider([
      [
        { type: 'text_delta', text: 'Hello' },
        { type: 'message_stop', finishReason: 'stop' },
      ],
    ]);

    await runAgentLoop(provider, testTools, executor, [{ role: 'user', content: 'hi' }], { onTurnEnd });

    expect(onTurnEnd).toHaveBeenCalledOnce();
    const ctx: TurnEndContext = onTurnEnd.mock.calls[0][0];
    expect(ctx.isFinalTurn).toBe(true);
    expect(ctx.iteration).toBe(0);
    expect(ctx.toolCallCount).toBe(0);
  });

  it('fires between turns with isFinalTurn=false', async () => {
    const contexts: TurnEndContext[] = [];
    const onTurnEnd = vi.fn(async (ctx: TurnEndContext) => { contexts.push(ctx); });

    const provider = mockProvider([
      [
        { type: 'tool_use_start', id: 'tc_1', name: 'read_file' },
        { type: 'tool_use_end', id: 'tc_1', arguments: { file: 'test.ts' } },
        { type: 'message_stop', finishReason: 'tool_calls' },
      ],
      [
        { type: 'text_delta', text: 'Done' },
        { type: 'message_stop', finishReason: 'stop' },
      ],
    ]);

    await runAgentLoop(provider, testTools, executor, [{ role: 'user', content: 'read' }], { onTurnEnd });

    expect(onTurnEnd).toHaveBeenCalledTimes(2);
    // First call: between turns (after tool execution)
    expect(contexts[0].isFinalTurn).toBe(false);
    expect(contexts[0].iteration).toBe(0);
    expect(contexts[0].toolCallCount).toBe(1);
    // Second call: final turn
    expect(contexts[1].isFinalTurn).toBe(true);
    expect(contexts[1].iteration).toBe(1);
  });

  it('aborts loop when hook returns continue=false', async () => {
    const onTurnEnd = vi.fn(async () => ({ continue: false }));

    const provider = mockProvider([
      [
        { type: 'tool_use_start', id: 'tc_1', name: 'read_file' },
        { type: 'tool_use_end', id: 'tc_1', arguments: { file: 'test.ts' } },
        { type: 'message_stop', finishReason: 'tool_calls' },
      ],
      // This sequence should never be reached
      [
        { type: 'text_delta', text: 'Should not reach' },
        { type: 'message_stop', finishReason: 'stop' },
      ],
    ]);

    const result = await runAgentLoop(provider, testTools, executor, [{ role: 'user', content: 'read' }], { onTurnEnd });

    expect(onTurnEnd).toHaveBeenCalledOnce(); // only the between-turns call
    expect(result.summary).toBe('Stopped by hook');
    expect(result.success).toBe(true); // hook-initiated stop is not a failure
  });

  it('uses custom injectMessage when aborting', async () => {
    const onTurnEnd = vi.fn(async () => ({ continue: false, injectMessage: 'Budget exceeded' }));

    const provider = mockProvider([
      [
        { type: 'tool_use_start', id: 'tc_1', name: 'read_file' },
        { type: 'tool_use_end', id: 'tc_1', arguments: { file: 'test.ts' } },
        { type: 'message_stop', finishReason: 'tool_calls' },
      ],
    ]);

    const result = await runAgentLoop(provider, testTools, executor, [{ role: 'user', content: 'read' }], { onTurnEnd });

    expect(result.summary).toBe('Budget exceeded');
  });

  it('injects steering message into conversation', async () => {
    let secondCallMessages: AgentMessage[] = [];
    let callIndex = 0;
    const provider: AgentProvider = {
      async *stream(messages, _tools, _options) {
        if (callIndex === 1) secondCallMessages = [...messages];
        const events: StreamEvent[][] = [
          [
            { type: 'tool_use_start', id: 'tc_1', name: 'read_file' },
            { type: 'tool_use_end', id: 'tc_1', arguments: { file: 'test.ts' } },
            { type: 'message_stop', finishReason: 'tool_calls' },
          ],
          [
            { type: 'text_delta', text: 'Done' },
            { type: 'message_stop', finishReason: 'stop' },
          ],
        ];
        for (const e of events[callIndex++] ?? []) yield e;
      },
    };

    const onTurnEnd = vi.fn(async (ctx: TurnEndContext) => {
      if (!ctx.isFinalTurn) return { injectMessage: 'Focus on the auth module' };
    });

    await runAgentLoop(provider, testTools, executor, [{ role: 'user', content: 'read' }], { onTurnEnd });

    // The steering message should appear in the second LLM call's messages
    const steeringMsg = secondCallMessages.find(m => m.role === 'user' && m.content === 'Focus on the auth module');
    expect(steeringMsg).toBeDefined();
  });

  it('passes cumulative usage in context', async () => {
    const contexts: TurnEndContext[] = [];
    const onTurnEnd = vi.fn(async (ctx: TurnEndContext) => { contexts.push(ctx); });

    const provider = mockProvider([
      [
        { type: 'usage', promptTokens: 100, completionTokens: 50 },
        { type: 'tool_use_start', id: 'tc_1', name: 'read_file' },
        { type: 'tool_use_end', id: 'tc_1', arguments: { file: 'test.ts' } },
        { type: 'message_stop', finishReason: 'tool_calls' },
      ],
      [
        { type: 'usage', promptTokens: 200, completionTokens: 80 },
        { type: 'text_delta', text: 'Done' },
        { type: 'message_stop', finishReason: 'stop' },
      ],
    ]);

    await runAgentLoop(provider, testTools, executor, [{ role: 'user', content: 'read' }], { onTurnEnd });

    expect(contexts[0].usage).toEqual({ promptTokens: 100, completionTokens: 50 });
    expect(contexts[1].usage).toEqual({ promptTokens: 300, completionTokens: 130 });
  });

  it('works without onTurnEnd (backward compatible)', async () => {
    const provider = mockProvider([
      [
        { type: 'text_delta', text: 'Hello' },
        { type: 'message_stop', finishReason: 'stop' },
      ],
    ]);

    const result = await runAgentLoop(provider, testTools, executor, [{ role: 'user', content: 'hi' }]);

    expect(result.success).toBe(true);
    expect(result.summary).toBe('Hello');
  });

  it('hook errors are propagated (not swallowed)', async () => {
    const onTurnEnd = vi.fn(async () => { throw new Error('Hook crashed'); });

    const provider = mockProvider([
      [
        { type: 'text_delta', text: 'Hello' },
        { type: 'message_stop', finishReason: 'stop' },
      ],
    ]);

    await expect(
      runAgentLoop(provider, testTools, executor, [{ role: 'user', content: 'hi' }], { onTurnEnd }),
    ).rejects.toThrow('Hook crashed');
  });

  it('passes maxIterations in context', async () => {
    const onTurnEnd = vi.fn();
    const provider = mockProvider([
      [
        { type: 'text_delta', text: 'Hello' },
        { type: 'message_stop', finishReason: 'stop' },
      ],
    ]);

    await runAgentLoop(provider, testTools, executor, [{ role: 'user', content: 'hi' }], {
      onTurnEnd,
      maxIterations: 5,
    });

    const ctx: TurnEndContext = onTurnEnd.mock.calls[0][0];
    expect(ctx.maxIterations).toBe(5);
  });
});
