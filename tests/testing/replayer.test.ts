/**
 * Tests for replay LLM provider
 */

import { createReplayProvider, loadRecording } from '../../src/testing/replayer';
import { createRecordingProvider } from '../../src/testing/recorder';
import { TokenTracker } from '../../src/testing/token-tracker';
import { expectMockLlm } from '../../src/testing/assertions';
import type { LLMProvider, LLMMessage, LLMTokenUsage } from '../../src/testing/mock-llm';
import type { LlmRecording } from '../../src/testing/recorder';

function userMsg(content: string): LLMMessage {
  return { role: 'user', content };
}

function makeRecording(
  steps: Array<{
    content: string | null;
    toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
    finishReason?: string;
    usage?: LLMTokenUsage;
  }>,
): LlmRecording {
  return {
    steps: steps.map((s, i) => ({
      index: i,
      input: { messages: [userMsg(`message-${i}`)] },
      output: {
        content: s.content,
        toolCalls: s.toolCalls ?? [],
        finishReason: (s.finishReason ?? 'stop') as 'stop' | 'tool_calls',
        usage: s.usage,
      },
      timestamp: new Date().toISOString(),
      durationMs: 100,
    })),
    metadata: {},
    createdAt: new Date().toISOString(),
  };
}

describe('createReplayProvider', () => {
  describe('sequential replay', () => {
    it('should replay responses in order', async () => {
      const recording = makeRecording([
        { content: 'First' },
        { content: 'Second' },
        { content: 'Third' },
      ]);
      const replay = createReplayProvider(recording);

      const r1 = await replay.chat([userMsg('a')]);
      const r2 = await replay.chat([userMsg('b')]);
      const r3 = await replay.chat([userMsg('c')]);

      expect(r1.content).toBe('First');
      expect(r2.content).toBe('Second');
      expect(r3.content).toBe('Third');
    });

    it('should replay tool calls', async () => {
      const recording = makeRecording([
        {
          content: null,
          toolCalls: [{ id: 'tc1', name: 'search', arguments: { q: 'test' } }],
          finishReason: 'tool_calls',
        },
      ]);
      const replay = createReplayProvider(recording);

      const result = await replay.chat([userMsg('search')]);
      expect(result.content).toBeNull();
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('search');
      expect(result.finishReason).toBe('tool_calls');
    });

    it('should replay usage data', async () => {
      const recording = makeRecording([
        { content: 'ok', usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 } },
      ]);
      const replay = createReplayProvider(recording);

      const result = await replay.chat([userMsg('test')]);
      expect(result.usage).toEqual({ promptTokens: 100, completionTokens: 50, totalTokens: 150 });
    });
  });

  describe('strict mode', () => {
    it('should throw when replay is exhausted (strict=true, default)', async () => {
      const recording = makeRecording([{ content: 'only one' }]);
      const replay = createReplayProvider(recording);

      await replay.chat([userMsg('a')]); // OK
      await expect(replay.chat([userMsg('b')])).rejects.toThrow('Replay exhausted');
    });

    it('should return fallback when replay is exhausted (strict=false)', async () => {
      const recording = makeRecording([{ content: 'only one' }]);
      const replay = createReplayProvider(recording, { strict: false });

      await replay.chat([userMsg('a')]); // OK
      const result = await replay.chat([userMsg('b')]); // Fallback
      expect(result.content).toContain('Replay exhausted');
      expect(result.finishReason).toBe('stop');
    });

    it('should record fallback calls with matchedIndex -1', async () => {
      const recording = makeRecording([{ content: 'ok' }]);
      const replay = createReplayProvider(recording, { strict: false });

      await replay.chat([userMsg('a')]);
      await replay.chat([userMsg('b')]);

      const calls = replay.getCalls();
      expect(calls[0].matchedIndex).toBe(0);
      expect(calls[1].matchedIndex).toBe(-1);
    });
  });

  describe('MockLlmProvider interface', () => {
    it('should track call count', async () => {
      const recording = makeRecording([
        { content: 'a' },
        { content: 'b' },
      ]);
      const replay = createReplayProvider(recording);

      await replay.chat([userMsg('x')]);
      await replay.chat([userMsg('y')]);

      expect(replay.getCallCount()).toBe(2);
    });

    it('should record calls with messages and options', async () => {
      const recording = makeRecording([{ content: 'ok' }]);
      const replay = createReplayProvider(recording);

      await replay.chat([userMsg('hello')], { temperature: 0.5 });

      const calls = replay.getCalls();
      expect(calls[0].messages[0].content).toBe('hello');
      expect(calls[0].options?.temperature).toBe(0.5);
    });

    it('should track total tokens', async () => {
      const recording = makeRecording([
        { content: 'a', usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 } },
        { content: 'b', usage: { promptTokens: 15, completionTokens: 25, totalTokens: 40 } },
      ]);
      const replay = createReplayProvider(recording);

      await replay.chat([userMsg('x')]);
      await replay.chat([userMsg('y')]);

      expect(replay.getTotalTokens()).toBe(70);
    });

    it('should return per-call token usage', async () => {
      const recording = makeRecording([
        { content: 'a', usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 } },
        { content: 'b', usage: { promptTokens: 15, completionTokens: 25, totalTokens: 40 } },
      ]);
      const replay = createReplayProvider(recording);

      await replay.chat([userMsg('x')]);
      await replay.chat([userMsg('y')]);

      const usage = replay.getTokenUsage();
      expect(usage).toHaveLength(2);
      expect(usage[0].totalTokens).toBe(30);
      expect(usage[1].totalTokens).toBe(40);
    });

    it('should filter calls by response index', async () => {
      const recording = makeRecording([
        { content: 'a' },
        { content: 'b' },
        { content: 'c' },
      ]);
      const replay = createReplayProvider(recording);

      await replay.chat([userMsg('x')]);
      await replay.chat([userMsg('y')]);
      await replay.chat([userMsg('z')]);

      expect(replay.getCallsForResponse(0)).toHaveLength(1);
      expect(replay.getCallsForResponse(1)).toHaveLength(1);
      expect(replay.getCallsForResponse(5)).toHaveLength(0);
    });
  });

  describe('reset', () => {
    it('should reset call history and replay position', async () => {
      const recording = makeRecording([
        { content: 'First' },
        { content: 'Second' },
      ]);
      const replay = createReplayProvider(recording);

      await replay.chat([userMsg('a')]);
      expect(replay.getCallCount()).toBe(1);

      replay.reset();
      expect(replay.getCallCount()).toBe(0);
      expect(replay.getTotalTokens()).toBe(0);

      // Should replay from the beginning
      const result = await replay.chat([userMsg('b')]);
      expect(result.content).toBe('First');
    });
  });

  describe('integration with assertions', () => {
    it('should work with expectMockLlm', async () => {
      const recording = makeRecording([
        {
          content: null,
          toolCalls: [{ id: '1', name: 'search', arguments: {} }],
          finishReason: 'tool_calls',
          usage: { promptTokens: 50, completionTokens: 25, totalTokens: 75 },
        },
        {
          content: 'Answer',
          usage: { promptTokens: 80, completionTokens: 40, totalTokens: 120 },
        },
      ]);
      const replay = createReplayProvider(recording);

      await replay.chat([userMsg('search for weather')]);
      await replay.chat([userMsg('what did you find?')]);

      expectMockLlm(replay)
        .toHaveBeenCalledTimes(2)
        .toHaveUsedTool('search')
        .toHaveTokenUsageBelow(200)
        .toHaveReceivedMessage('weather', 0);
    });
  });

  describe('integration with TokenTracker', () => {
    it('should work with TokenTracker.trackFromCalls', async () => {
      const recording = makeRecording([
        { content: 'a', usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 } },
        { content: 'b', usage: { promptTokens: 15, completionTokens: 25, totalTokens: 40 } },
      ]);
      const replay = createReplayProvider(recording);

      await replay.chat([userMsg('x')]);
      await replay.chat([userMsg('y')]);

      const tracker = new TokenTracker();
      tracker.trackFromCalls(replay.getCalls());

      expect(tracker.total).toBe(70);
      expect(tracker.stepCount).toBe(2);
      tracker.assertBelow(100);
    });
  });

  describe('record-then-replay roundtrip', () => {
    it('should faithfully replay recorded interactions', async () => {
      // Step 1: Record
      const fakeProvider: LLMProvider = {
        async chat(messages) {
          const last = messages[messages.length - 1];
          if (last.content.includes('search')) {
            return {
              content: null,
              toolCalls: [{ id: 'tc1', name: 'web_search', arguments: { q: last.content } }],
              finishReason: 'tool_calls',
              usage: { promptTokens: 80, completionTokens: 0, totalTokens: 80 },
            };
          }
          return {
            content: `Answer to: ${last.content}`,
            toolCalls: [],
            finishReason: 'stop',
            usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
          };
        },
      };

      const recorder = createRecordingProvider(fakeProvider, { test: 'roundtrip' });

      const r1 = await recorder.provider.chat([userMsg('search for weather')]);
      const r2 = await recorder.provider.chat([
        userMsg('search for weather'),
        { role: 'tool', content: 'Sunny, 72F', toolCallId: 'tc1' },
        userMsg('summarize'),
      ]);

      // Step 2: Serialize and deserialize
      const json = JSON.stringify(recorder.getRecording());
      const loaded = loadRecording(json);

      // Step 3: Replay
      const replay = createReplayProvider(loaded);

      const rr1 = await replay.chat([userMsg('different input — doesnt matter')]);
      const rr2 = await replay.chat([userMsg('also different')]);

      // Responses should match originals exactly
      expect(rr1.content).toBe(r1.content);
      expect(rr1.toolCalls).toEqual(r1.toolCalls);
      expect(rr1.finishReason).toBe(r1.finishReason);

      expect(rr2.content).toBe(r2.content);
      expect(rr2.toolCalls).toEqual(r2.toolCalls);

      // Token tracking should work
      expect(replay.getTotalTokens()).toBe(230); // 80 + 150
    });
  });
});

describe('loadRecording', () => {
  it('should parse a JSON string', () => {
    const json = JSON.stringify({
      steps: [
        {
          index: 0,
          input: { messages: [userMsg('test')] },
          output: { content: 'ok', toolCalls: [], finishReason: 'stop' },
          timestamp: '2026-01-01T00:00:00Z',
          durationMs: 100,
        },
      ],
      metadata: { test: true },
      createdAt: '2026-01-01T00:00:00Z',
    });

    const recording = loadRecording(json);
    expect(recording.steps).toHaveLength(1);
    expect(recording.steps[0].output.content).toBe('ok');
    expect(recording.metadata.test).toBe(true);
  });

  it('should accept a parsed object', () => {
    const obj: LlmRecording = {
      steps: [
        {
          index: 0,
          input: { messages: [] },
          output: { content: 'test', toolCalls: [], finishReason: 'stop' },
          timestamp: '',
          durationMs: 0,
        },
      ],
      metadata: {},
      createdAt: '',
    };

    const recording = loadRecording(obj);
    expect(recording.steps).toHaveLength(1);
  });

  it('should fill defaults for missing optional fields', () => {
    const minimal = JSON.stringify({
      steps: [
        {
          output: { content: 'ok', toolCalls: [], finishReason: 'stop' },
        },
      ],
    });

    const recording = loadRecording(minimal);
    expect(recording.steps[0].index).toBe(0);
    expect(recording.steps[0].timestamp).toBe('');
    expect(recording.steps[0].durationMs).toBe(0);
    expect(recording.metadata).toEqual({});
    expect(recording.createdAt).toBe('');
  });

  it('should throw for invalid JSON', () => {
    expect(() => loadRecording('not json')).toThrow();
  });

  it('should throw for missing steps array', () => {
    expect(() => loadRecording(JSON.stringify({}))).toThrow('missing or invalid "steps" array');
  });

  it('should throw for steps without output', () => {
    expect(() =>
      loadRecording(JSON.stringify({ steps: [{ input: {} }] })),
    ).toThrow('missing "output" object');
  });

  it('should throw for null input', () => {
    expect(() => loadRecording(JSON.stringify(null))).toThrow('expected an object');
  });
});
