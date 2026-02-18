/**
 * Tests for mock LLM provider
 */

import { createMockLlmProvider } from '../../src/testing/mock-llm';
import type { LLMMessage, LLMProvider } from '../../src/testing/mock-llm';

function userMsg(content: string): LLMMessage {
  return { role: 'user', content };
}

function systemMsg(content: string): LLMMessage {
  return { role: 'system', content };
}

describe('createMockLlmProvider', () => {
  describe('response matching', () => {
    it('should match by string includes', async () => {
      const mock = createMockLlmProvider([
        { match: 'hello', response: { content: 'Hi there!' } },
      ]);

      const result = await mock.chat([userMsg('say hello world')]);
      expect(result.content).toBe('Hi there!');
      expect(result.finishReason).toBe('stop');
    });

    it('should match by regex', async () => {
      const mock = createMockLlmProvider([
        { match: /search.*weather/i, response: { content: null, toolCalls: [{ id: '1', name: 'weather', arguments: {} }], finishReason: 'tool_calls' } },
      ]);

      const result = await mock.chat([userMsg('Please search for weather')]);
      expect(result.content).toBeNull();
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('weather');
      expect(result.finishReason).toBe('tool_calls');
    });

    it('should use first matching response', async () => {
      const mock = createMockLlmProvider([
        { match: 'specific', response: { content: 'Specific match' } },
        { match: /./, response: { content: 'Catch-all' } },
      ]);

      const r1 = await mock.chat([userMsg('something specific here')]);
      expect(r1.content).toBe('Specific match');

      const r2 = await mock.chat([userMsg('anything else')]);
      expect(r2.content).toBe('Catch-all');
    });

    it('should use fallback when no match', async () => {
      const mock = createMockLlmProvider([
        { match: 'nope', response: { content: 'Won\'t match' } },
      ]);

      const result = await mock.chat([userMsg('hello')]);
      expect(result.content).toContain('no matching response');
    });

    it('should use custom fallback response', async () => {
      const mock = createMockLlmProvider([], {
        fallbackResponse: { content: 'Custom fallback' },
      });

      const result = await mock.chat([userMsg('anything')]);
      expect(result.content).toBe('Custom fallback');
    });

    it('should match against last user message only', async () => {
      const mock = createMockLlmProvider([
        { match: 'target', response: { content: 'Found it' } },
      ]);

      const result = await mock.chat([
        systemMsg('You are helpful'),
        userMsg('first message'),
        { role: 'assistant', content: 'target response' },
        userMsg('this has the target word'),
      ]);

      expect(result.content).toBe('Found it');
    });
  });

  describe('maxUses', () => {
    it('should respect maxUses limit', async () => {
      const mock = createMockLlmProvider([
        { match: /./, response: { content: 'First response' }, maxUses: 1 },
        { match: /./, response: { content: 'Second response' } },
      ]);

      const r1 = await mock.chat([userMsg('a')]);
      expect(r1.content).toBe('First response');

      const r2 = await mock.chat([userMsg('b')]);
      expect(r2.content).toBe('Second response');
    });
  });

  describe('call recording', () => {
    it('should record all calls', async () => {
      const mock = createMockLlmProvider([
        { match: /./, response: { content: 'ok' } },
      ]);

      await mock.chat([userMsg('first')]);
      await mock.chat([userMsg('second')], { temperature: 0.5 });

      expect(mock.getCallCount()).toBe(2);
      const calls = mock.getCalls();
      expect(calls[0].messages[0].content).toBe('first');
      expect(calls[1].options?.temperature).toBe(0.5);
    });

    it('should record matched index', async () => {
      const mock = createMockLlmProvider([
        { match: 'hello', response: { content: 'Hi' } },
        { match: /./, response: { content: 'Default' } },
      ]);

      await mock.chat([userMsg('hello')]);
      await mock.chat([userMsg('bye')]);

      const calls = mock.getCalls();
      expect(calls[0].matchedIndex).toBe(0);
      expect(calls[1].matchedIndex).toBe(1);
    });

    it('should record -1 for fallback', async () => {
      const mock = createMockLlmProvider([
        { match: 'nope', response: { content: 'x' } },
      ]);

      await mock.chat([userMsg('hello')]);
      expect(mock.getCalls()[0].matchedIndex).toBe(-1);
    });

    it('should filter calls by response index', async () => {
      const mock = createMockLlmProvider([
        { match: 'a', response: { content: 'A' } },
        { match: /./, response: { content: 'B' } },
      ]);

      await mock.chat([userMsg('a')]);
      await mock.chat([userMsg('b')]);
      await mock.chat([userMsg('a again')]);

      expect(mock.getCallsForResponse(0)).toHaveLength(2);
      expect(mock.getCallsForResponse(1)).toHaveLength(1);
    });
  });

  describe('token tracking', () => {
    it('should use default token usage', async () => {
      const mock = createMockLlmProvider([
        { match: /./, response: { content: 'ok' } },
      ]);

      await mock.chat([userMsg('hello')]);
      expect(mock.getTotalTokens()).toBe(75); // default: 50 + 25
    });

    it('should use per-response token usage', async () => {
      const mock = createMockLlmProvider([
        {
          match: /./,
          response: { content: 'ok' },
          usage: { promptTokens: 100, completionTokens: 200, totalTokens: 300 },
        },
      ]);

      await mock.chat([userMsg('hello')]);
      expect(mock.getTotalTokens()).toBe(300);
    });

    it('should accumulate tokens across calls', async () => {
      const mock = createMockLlmProvider([
        {
          match: /./,
          response: { content: 'ok' },
          usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        },
      ]);

      await mock.chat([userMsg('a')]);
      await mock.chat([userMsg('b')]);
      await mock.chat([userMsg('c')]);

      expect(mock.getTotalTokens()).toBe(90);
    });

    it('should use custom default usage', async () => {
      const mock = createMockLlmProvider([{ match: /./, response: { content: 'ok' } }], {
        defaultUsage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
      });

      await mock.chat([userMsg('hello')]);
      expect(mock.getTotalTokens()).toBe(10);
    });

    it('should return per-call token breakdown', async () => {
      const mock = createMockLlmProvider([
        { match: /./, response: { content: 'ok' }, usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 } },
      ]);

      await mock.chat([userMsg('a')]);
      await mock.chat([userMsg('b')]);

      const usage = mock.getTokenUsage();
      expect(usage).toHaveLength(2);
      expect(usage[0].totalTokens).toBe(30);
    });
  });

  describe('reset', () => {
    it('should clear all state', async () => {
      const mock = createMockLlmProvider([
        { match: /./, response: { content: 'ok' }, maxUses: 1 },
      ]);

      await mock.chat([userMsg('hello')]);
      expect(mock.getCallCount()).toBe(1);

      mock.reset();
      expect(mock.getCallCount()).toBe(0);
      expect(mock.getTotalTokens()).toBe(0);

      // maxUses should reset too
      const result = await mock.chat([userMsg('hello again')]);
      expect(result.content).toBe('ok');
    });
  });

  describe('globalThis injection', () => {
    const g = globalThis as unknown as { __fw_llm_provider__?: LLMProvider };

    afterEach(() => {
      delete g.__fw_llm_provider__;
    });

    it('should be injectable via globalThis', async () => {
      const mock = createMockLlmProvider([
        { match: /./, response: { content: 'injected!' } },
      ]);

      g.__fw_llm_provider__ = mock;

      // Simulate what generated code does
      const provider = g.__fw_llm_provider__ ?? null;
      expect(provider).toBe(mock);

      const result = await provider!.chat([userMsg('test')]);
      expect(result.content).toBe('injected!');
    });
  });
});
