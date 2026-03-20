import { describe, it, expect } from 'vitest';
import { StreamJsonParser } from '../../src/agent/streaming.js';
import type { StreamEvent } from '../../src/agent/types.js';

function collect(lines: string[]): StreamEvent[] {
  const events: StreamEvent[] = [];
  const parser = new StreamJsonParser((e) => events.push(e));
  for (const line of lines) {
    parser.feed(line);
  }
  return events;
}

describe('StreamJsonParser', () => {
  it('should parse text_delta from content_block_delta', () => {
    const events = collect([
      JSON.stringify({
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'Hello' },
      }),
    ]);
    expect(events).toEqual([{ type: 'text_delta', text: 'Hello' }]);
  });

  it('should unwrap stream_event wrapper', () => {
    const events = collect([
      JSON.stringify({
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'wrapped' },
        },
      }),
    ]);
    expect(events).toEqual([{ type: 'text_delta', text: 'wrapped' }]);
  });

  it('should parse tool_use lifecycle (start → delta → stop → end)', () => {
    const events = collect([
      JSON.stringify({
        type: 'content_block_start',
        content_block: { type: 'tool_use', id: 'tool_1', name: 'read_file' },
      }),
      JSON.stringify({
        type: 'content_block_delta',
        delta: { type: 'input_json_delta', partial_json: '{"file":' },
      }),
      JSON.stringify({
        type: 'content_block_delta',
        delta: { type: 'input_json_delta', partial_json: '"test.ts"}' },
      }),
      JSON.stringify({ type: 'content_block_stop' }),
    ]);

    expect(events).toEqual([
      { type: 'tool_use_start', id: 'tool_1', name: 'read_file' },
      { type: 'tool_use_end', id: 'tool_1', arguments: { file: 'test.ts' } },
    ]);
  });

  it('should parse tool_result from user events', () => {
    const events = collect([
      JSON.stringify({
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tool_1',
              content: [{ type: 'text', text: 'file content here' }],
              is_error: false,
            },
          ],
        },
      }),
    ]);
    expect(events).toEqual([
      { type: 'tool_result', id: 'tool_1', result: 'file content here', isError: false },
    ]);
  });

  it('should parse thinking_delta', () => {
    const events = collect([
      JSON.stringify({
        type: 'content_block_delta',
        delta: { type: 'thinking_delta', thinking: 'reasoning...' },
      }),
    ]);
    expect(events).toEqual([{ type: 'thinking_delta', text: 'reasoning...' }]);
  });

  it('should parse usage from message_start', () => {
    const events = collect([
      JSON.stringify({
        type: 'message_start',
        message: { usage: { input_tokens: 100, output_tokens: 50 } },
      }),
    ]);
    expect(events).toEqual([{ type: 'usage', promptTokens: 100, completionTokens: 50 }]);
  });

  it('should parse usage from message_delta', () => {
    const events = collect([
      JSON.stringify({
        type: 'message_delta',
        usage: { output_tokens: 200 },
      }),
    ]);
    expect(events).toEqual([{ type: 'usage', promptTokens: 0, completionTokens: 200 }]);
  });

  it('should parse message_stop', () => {
    const events = collect([JSON.stringify({ type: 'message_stop' })]);
    expect(events).toEqual([{ type: 'message_stop', finishReason: 'stop' }]);
  });

  it('should parse result event as text fallback when no content_block_delta', () => {
    const events = collect([
      JSON.stringify({ type: 'result', result: 'final text', usage: { input_tokens: 10, output_tokens: 20 } }),
    ]);
    expect(events).toEqual([
      { type: 'text_delta', text: 'final text' },
      { type: 'usage', promptTokens: 10, completionTokens: 20 },
      { type: 'message_stop', finishReason: 'stop' },
    ]);
  });

  it('should not emit result text when content_block_delta already fired', () => {
    const events = collect([
      JSON.stringify({
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'streamed' },
      }),
      JSON.stringify({ type: 'result', result: 'duplicate text' }),
    ]);
    const textEvents = events.filter((e) => e.type === 'text_delta');
    expect(textEvents).toEqual([{ type: 'text_delta', text: 'streamed' }]);
  });

  it('should parse result error', () => {
    const events = collect([
      JSON.stringify({ type: 'result', is_error: true, result: 'auth failed' }),
    ]);
    expect(events).toEqual([{ type: 'message_stop', finishReason: 'error' }]);
  });

  it('should parse authentication_failed from assistant event', () => {
    const events = collect([
      JSON.stringify({ type: 'assistant', error: 'authentication_failed' }),
    ]);
    expect(events).toEqual([{ type: 'message_stop', finishReason: 'error' }]);
  });

  it('should handle non-JSON lines as text fallback', () => {
    const events = collect(['some raw text output']);
    expect(events).toEqual([{ type: 'text_delta', text: 'some raw text output' }]);
  });

  it('should skip empty lines', () => {
    const events = collect(['', '  ', '\t']);
    expect(events).toEqual([]);
  });

  it('should reset state between turns', () => {
    const allEvents: StreamEvent[] = [];
    const parser = new StreamJsonParser((e) => allEvents.push(e));

    // Turn 1
    parser.feed(JSON.stringify({
      type: 'content_block_delta',
      delta: { type: 'text_delta', text: 'turn1' },
    }));

    parser.reset();

    // Turn 2 — result text should appear since hasAssistantText was reset
    parser.feed(JSON.stringify({ type: 'result', result: 'turn2' }));

    const textEvents = allEvents.filter((e) => e.type === 'text_delta');
    expect(textEvents).toEqual([
      { type: 'text_delta', text: 'turn1' },
      { type: 'text_delta', text: 'turn2' },
    ]);
  });

  it('should suppress text_delta inside tool_use blocks', () => {
    const events = collect([
      JSON.stringify({
        type: 'content_block_start',
        content_block: { type: 'tool_use', id: 'tool_1', name: 'test' },
      }),
      JSON.stringify({
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'should be suppressed' },
      }),
      JSON.stringify({ type: 'content_block_stop' }),
    ]);
    const textEvents = events.filter((e) => e.type === 'text_delta');
    expect(textEvents).toEqual([]);
  });
});
