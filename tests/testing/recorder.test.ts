/**
 * Tests for recording LLM provider
 */

import { createRecordingProvider } from '../../src/testing/recorder';
import type { LLMProvider, LLMMessage, LLMResponse } from '../../src/testing/mock-llm';

function userMsg(content: string): LLMMessage {
  return { role: 'user', content };
}

function createFakeProvider(responses: LLMResponse[]): LLMProvider {
  let callIndex = 0;
  return {
    async chat() {
      const response = responses[callIndex] ?? {
        content: `Response #${callIndex}`,
        toolCalls: [],
        finishReason: 'stop' as const,
      };
      callIndex++;
      return response;
    },
  };
}

describe('createRecordingProvider', () => {
  describe('passthrough behavior', () => {
    it('should pass calls through to the real provider', async () => {
      const real = createFakeProvider([
        { content: 'Hello!', toolCalls: [], finishReason: 'stop' },
      ]);
      const recorder = createRecordingProvider(real);

      const result = await recorder.provider.chat([userMsg('hi')]);
      expect(result.content).toBe('Hello!');
      expect(result.finishReason).toBe('stop');
    });

    it('should pass options through to the real provider', async () => {
      const capturedOptions: unknown[] = [];
      const real: LLMProvider = {
        async chat(_messages, options) {
          capturedOptions.push(options);
          return { content: 'ok', toolCalls: [], finishReason: 'stop' };
        },
      };
      const recorder = createRecordingProvider(real);

      await recorder.provider.chat([userMsg('test')], {
        temperature: 0.5,
        model: 'gpt-4o',
      });

      expect(capturedOptions[0]).toEqual({ temperature: 0.5, model: 'gpt-4o' });
    });

    it('should propagate errors from the real provider', async () => {
      const real: LLMProvider = {
        async chat() {
          throw new Error('API rate limit');
        },
      };
      const recorder = createRecordingProvider(real);

      await expect(recorder.provider.chat([userMsg('test')])).rejects.toThrow('API rate limit');
    });

    it('should not record failed calls', async () => {
      const real: LLMProvider = {
        async chat() {
          throw new Error('API error');
        },
      };
      const recorder = createRecordingProvider(real);

      try {
        await recorder.provider.chat([userMsg('test')]);
      } catch {
        // expected
      }

      expect(recorder.getCallCount()).toBe(0);
    });
  });

  describe('recording', () => {
    it('should record calls with correct structure', async () => {
      const real = createFakeProvider([
        { content: 'Response', toolCalls: [], finishReason: 'stop' },
      ]);
      const recorder = createRecordingProvider(real);

      await recorder.provider.chat([userMsg('hello')]);

      const recording = recorder.getRecording();
      expect(recording.steps).toHaveLength(1);

      const step = recording.steps[0];
      expect(step.index).toBe(0);
      expect(step.input.messages).toEqual([userMsg('hello')]);
      expect(step.output.content).toBe('Response');
      expect(step.output.finishReason).toBe('stop');
      expect(step.timestamp).toBeTruthy();
      expect(typeof step.durationMs).toBe('number');
    });

    it('should record multiple calls in order', async () => {
      const real = createFakeProvider([
        { content: 'First', toolCalls: [], finishReason: 'stop' },
        { content: 'Second', toolCalls: [], finishReason: 'stop' },
        { content: 'Third', toolCalls: [], finishReason: 'stop' },
      ]);
      const recorder = createRecordingProvider(real);

      await recorder.provider.chat([userMsg('a')]);
      await recorder.provider.chat([userMsg('b')]);
      await recorder.provider.chat([userMsg('c')]);

      expect(recorder.getCallCount()).toBe(3);

      const recording = recorder.getRecording();
      expect(recording.steps[0].index).toBe(0);
      expect(recording.steps[0].output.content).toBe('First');
      expect(recording.steps[1].index).toBe(1);
      expect(recording.steps[1].output.content).toBe('Second');
      expect(recording.steps[2].index).toBe(2);
      expect(recording.steps[2].output.content).toBe('Third');
    });

    it('should record tool calls in responses', async () => {
      const real = createFakeProvider([
        {
          content: null,
          toolCalls: [{ id: 'tc1', name: 'search', arguments: { q: 'test' } }],
          finishReason: 'tool_calls',
        },
      ]);
      const recorder = createRecordingProvider(real);

      await recorder.provider.chat([userMsg('search for test')]);

      const step = recorder.getRecording().steps[0];
      expect(step.output.content).toBeNull();
      expect(step.output.toolCalls).toHaveLength(1);
      expect(step.output.toolCalls[0].name).toBe('search');
      expect(step.output.finishReason).toBe('tool_calls');
    });

    it('should record options when provided', async () => {
      const real = createFakeProvider([
        { content: 'ok', toolCalls: [], finishReason: 'stop' },
      ]);
      const recorder = createRecordingProvider(real);

      await recorder.provider.chat([userMsg('test')], {
        temperature: 0.7,
        model: 'gpt-4o',
        systemPrompt: 'Be helpful',
      });

      const step = recorder.getRecording().steps[0];
      expect(step.input.options?.temperature).toBe(0.7);
      expect(step.input.options?.model).toBe('gpt-4o');
      expect(step.input.options?.systemPrompt).toBe('Be helpful');
    });

    it('should omit options when not provided', async () => {
      const real = createFakeProvider([
        { content: 'ok', toolCalls: [], finishReason: 'stop' },
      ]);
      const recorder = createRecordingProvider(real);

      await recorder.provider.chat([userMsg('test')]);

      const step = recorder.getRecording().steps[0];
      expect(step.input.options).toBeUndefined();
    });

    it('should record usage data', async () => {
      const real = createFakeProvider([
        {
          content: 'ok',
          toolCalls: [],
          finishReason: 'stop',
          usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        },
      ]);
      const recorder = createRecordingProvider(real);

      await recorder.provider.chat([userMsg('test')]);

      const step = recorder.getRecording().steps[0];
      expect(step.output.usage).toEqual({
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
      });
    });
  });

  describe('metadata', () => {
    it('should include metadata in recording', () => {
      const real = createFakeProvider([]);
      const recorder = createRecordingProvider(real, {
        testName: 'my-test',
        workflow: 'classifier',
      });

      const recording = recorder.getRecording();
      expect(recording.metadata.testName).toBe('my-test');
      expect(recording.metadata.workflow).toBe('classifier');
    });

    it('should have empty metadata by default', () => {
      const real = createFakeProvider([]);
      const recorder = createRecordingProvider(real);

      expect(recorder.getRecording().metadata).toEqual({});
    });

    it('should include createdAt timestamp', () => {
      const real = createFakeProvider([]);
      const recorder = createRecordingProvider(real);

      const recording = recorder.getRecording();
      expect(recording.createdAt).toBeTruthy();
      // Should be a valid ISO date
      expect(() => new Date(recording.createdAt)).not.toThrow();
    });
  });

  describe('reset', () => {
    it('should clear all recorded data', async () => {
      const real = createFakeProvider([
        { content: 'a', toolCalls: [], finishReason: 'stop' },
        { content: 'b', toolCalls: [], finishReason: 'stop' },
      ]);
      const recorder = createRecordingProvider(real);

      await recorder.provider.chat([userMsg('first')]);
      await recorder.provider.chat([userMsg('second')]);
      expect(recorder.getCallCount()).toBe(2);

      recorder.reset();
      expect(recorder.getCallCount()).toBe(0);
      expect(recorder.getRecording().steps).toHaveLength(0);
    });
  });

  describe('snapshot isolation', () => {
    it('should return a copy, not a reference', async () => {
      const real = createFakeProvider([
        { content: 'ok', toolCalls: [], finishReason: 'stop' },
      ]);
      const recorder = createRecordingProvider(real);

      await recorder.provider.chat([userMsg('test')]);

      const recording1 = recorder.getRecording();
      const recording2 = recorder.getRecording();
      expect(recording1).not.toBe(recording2);
      expect(recording1.steps[0]).not.toBe(recording2.steps[0]);
    });
  });

  describe('serialization roundtrip', () => {
    it('should produce JSON-serializable recordings', async () => {
      const real = createFakeProvider([
        { content: 'Hello', toolCalls: [{ id: '1', name: 'search', arguments: { q: 'test' } }], finishReason: 'tool_calls' },
        { content: 'Done', toolCalls: [], finishReason: 'stop' },
      ]);
      const recorder = createRecordingProvider(real, { testName: 'roundtrip' });

      await recorder.provider.chat([userMsg('search')]);
      await recorder.provider.chat([userMsg('ok')]);

      const json = JSON.stringify(recorder.getRecording());
      const parsed = JSON.parse(json);

      expect(parsed.steps).toHaveLength(2);
      expect(parsed.metadata.testName).toBe('roundtrip');
      expect(parsed.steps[0].output.toolCalls[0].name).toBe('search');
    });
  });
});
