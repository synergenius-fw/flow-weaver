/**
 * Tests for agent assertion helpers
 */

import { expectAgentResult, expectMockLlm } from '../../src/testing/assertions';
import { createMockLlmProvider } from '../../src/testing/mock-llm';

describe('expectAgentResult', () => {
  describe('toHaveSucceeded', () => {
    it('should pass when onSuccess is true', () => {
      expect(() => {
        expectAgentResult({ onSuccess: true, onFailure: false }).toHaveSucceeded();
      }).not.toThrow();
    });

    it('should fail when onSuccess is false', () => {
      expect(() => {
        expectAgentResult({ onSuccess: false, onFailure: true }).toHaveSucceeded();
      }).toThrow(/Expected workflow to succeed/);
    });
  });

  describe('toHaveFailed', () => {
    it('should pass when onFailure is true', () => {
      expect(() => {
        expectAgentResult({ onSuccess: false, onFailure: true }).toHaveFailed();
      }).not.toThrow();
    });

    it('should fail when onFailure is false', () => {
      expect(() => {
        expectAgentResult({ onSuccess: true, onFailure: false }).toHaveFailed();
      }).toThrow(/Expected workflow to fail/);
    });
  });

  describe('toHaveOutput', () => {
    it('should pass when output exists with value', () => {
      expect(() => {
        expectAgentResult({ answer: 'hello', onSuccess: true }).toHaveOutput('answer');
      }).not.toThrow();
    });

    it('should fail when output is missing', () => {
      expect(() => {
        expectAgentResult({ onSuccess: true }).toHaveOutput('answer');
      }).toThrow(/Expected output port 'answer' to exist/);
    });

    it('should fail when output is null', () => {
      expect(() => {
        expectAgentResult({ answer: null, onSuccess: true }).toHaveOutput('answer');
      }).toThrow(/Expected output port 'answer' to have a value/);
    });

    it('should check specific value when provided', () => {
      expect(() => {
        expectAgentResult({ count: 5 }).toHaveOutput('count', 5);
      }).not.toThrow();

      expect(() => {
        expectAgentResult({ count: 5 }).toHaveOutput('count', 10);
      }).toThrow(/Expected output 'count' to equal 10/);
    });

    it('should deep-compare objects', () => {
      expect(() => {
        expectAgentResult({ data: { a: 1, b: 2 } }).toHaveOutput('data', { a: 1, b: 2 });
      }).not.toThrow();

      expect(() => {
        expectAgentResult({ data: { a: 1 } }).toHaveOutput('data', { a: 1, b: 2 });
      }).toThrow(/Expected output 'data' to equal/);
    });
  });

  describe('toNotHaveOutput', () => {
    it('should pass when output is absent', () => {
      expect(() => {
        expectAgentResult({ onSuccess: true }).toNotHaveOutput('error');
      }).not.toThrow();
    });

    it('should pass when output is null', () => {
      expect(() => {
        expectAgentResult({ error: null }).toNotHaveOutput('error');
      }).not.toThrow();
    });

    it('should fail when output has value', () => {
      expect(() => {
        expectAgentResult({ error: 'something went wrong' }).toNotHaveOutput('error');
      }).toThrow(/Expected output port 'error' to be absent or null/);
    });
  });

  describe('chaining', () => {
    it('should support fluent chaining', () => {
      expect(() => {
        expectAgentResult({ onSuccess: true, onFailure: false, answer: 'hello', error: null })
          .toHaveSucceeded()
          .toHaveOutput('answer', 'hello')
          .toNotHaveOutput('error');
      }).not.toThrow();
    });
  });
});

describe('expectMockLlm', () => {
  describe('toHaveBeenCalledTimes', () => {
    it('should pass with correct count', async () => {
      const mock = createMockLlmProvider([{ match: /./, response: { content: 'ok' } }]);
      await mock.chat([{ role: 'user', content: 'a' }]);
      await mock.chat([{ role: 'user', content: 'b' }]);

      expect(() => expectMockLlm(mock).toHaveBeenCalledTimes(2)).not.toThrow();
    });

    it('should fail with wrong count', async () => {
      const mock = createMockLlmProvider([{ match: /./, response: { content: 'ok' } }]);
      await mock.chat([{ role: 'user', content: 'a' }]);

      expect(() => expectMockLlm(mock).toHaveBeenCalledTimes(2)).toThrow(/called 1 time/);
    });
  });

  describe('toHaveUsedTool', () => {
    it('should pass when tool was used', async () => {
      const mock = createMockLlmProvider([
        { match: /./, response: { content: null, toolCalls: [{ id: '1', name: 'search', arguments: {} }] } },
      ]);
      await mock.chat([{ role: 'user', content: 'search' }]);

      expect(() => expectMockLlm(mock).toHaveUsedTool('search')).not.toThrow();
    });

    it('should fail when tool was not used', async () => {
      const mock = createMockLlmProvider([
        { match: /./, response: { content: 'text' } },
      ]);
      await mock.chat([{ role: 'user', content: 'hello' }]);

      expect(() => expectMockLlm(mock).toHaveUsedTool('search')).toThrow(/only these tools were used: \(none\)/);
    });
  });

  describe('toNotHaveUsedTool', () => {
    it('should pass when tool was not used', async () => {
      const mock = createMockLlmProvider([
        { match: /./, response: { content: 'text' } },
      ]);
      await mock.chat([{ role: 'user', content: 'hello' }]);

      expect(() => expectMockLlm(mock).toNotHaveUsedTool('delete')).not.toThrow();
    });
  });

  describe('toHaveTokenUsageBelow', () => {
    it('should pass when under budget', async () => {
      const mock = createMockLlmProvider([
        { match: /./, response: { content: 'ok' }, usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 } },
      ]);
      await mock.chat([{ role: 'user', content: 'hello' }]);

      expect(() => expectMockLlm(mock).toHaveTokenUsageBelow(100)).not.toThrow();
    });

    it('should fail when over budget', async () => {
      const mock = createMockLlmProvider([
        { match: /./, response: { content: 'ok' }, usage: { promptTokens: 500, completionTokens: 500, totalTokens: 1000 } },
      ]);
      await mock.chat([{ role: 'user', content: 'hello' }]);

      expect(() => expectMockLlm(mock).toHaveTokenUsageBelow(500)).toThrow(/token usage below 500/);
    });
  });

  describe('toHaveReceivedMessage', () => {
    it('should pass with string match', async () => {
      const mock = createMockLlmProvider([{ match: /./, response: { content: 'ok' } }]);
      await mock.chat([{ role: 'user', content: 'find weather in Paris' }]);

      expect(() => expectMockLlm(mock).toHaveReceivedMessage('weather')).not.toThrow();
    });

    it('should pass with regex match', async () => {
      const mock = createMockLlmProvider([{ match: /./, response: { content: 'ok' } }]);
      await mock.chat([{ role: 'user', content: 'search for cats' }]);

      expect(() => expectMockLlm(mock).toHaveReceivedMessage(/search.*cats/)).not.toThrow();
    });

    it('should scope to specific call index', async () => {
      const mock = createMockLlmProvider([{ match: /./, response: { content: 'ok' } }]);
      await mock.chat([{ role: 'user', content: 'first' }]);
      await mock.chat([{ role: 'user', content: 'second' }]);

      expect(() => expectMockLlm(mock).toHaveReceivedMessage('first', 0)).not.toThrow();
      expect(() => expectMockLlm(mock).toHaveReceivedMessage('first', 1)).toThrow();
    });
  });

  describe('chaining', () => {
    it('should support fluent chaining', async () => {
      const mock = createMockLlmProvider([
        { match: 'search', response: { content: null, toolCalls: [{ id: '1', name: 'search', arguments: {} }] } },
        { match: /./, response: { content: 'answer' } },
      ]);
      await mock.chat([{ role: 'user', content: 'search for info' }]);
      await mock.chat([{ role: 'user', content: 'summarize' }]);

      expect(() => {
        expectMockLlm(mock)
          .toHaveBeenCalledTimes(2)
          .toHaveUsedTool('search')
          .toNotHaveUsedTool('delete')
          .toHaveTokenUsageBelow(1000);
      }).not.toThrow();
    });
  });
});
