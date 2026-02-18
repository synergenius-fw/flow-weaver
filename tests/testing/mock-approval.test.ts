/**
 * Tests for mock approval provider
 */

import { createMockApprovalProvider } from '../../src/testing/mock-approval';
import type { ApprovalProvider, ApprovalRequest } from '../../src/testing/mock-approval';

function makeRequest(prompt: string, overrides?: Partial<ApprovalRequest>): ApprovalRequest {
  return { id: 'test-id', prompt, ...overrides };
}

describe('createMockApprovalProvider', () => {
  describe('response matching', () => {
    it('should match by string includes', async () => {
      const mock = createMockApprovalProvider([
        { match: 'expense', response: { approved: true, reviewer: 'alice' } },
      ]);

      const result = await mock.requestApproval(makeRequest('Approve this expense report'));
      expect(result.approved).toBe(true);
      expect(result.reviewer).toBe('alice');
    });

    it('should match by regex', async () => {
      const mock = createMockApprovalProvider([
        { match: /delete.*production/i, response: { approved: false, response: 'Too risky' } },
      ]);

      const result = await mock.requestApproval(makeRequest('Delete production database'));
      expect(result.approved).toBe(false);
      expect(result.response).toBe('Too risky');
    });

    it('should use first matching response', async () => {
      const mock = createMockApprovalProvider([
        { match: 'specific', response: { approved: false } },
        { match: /./, response: { approved: true } },
      ]);

      const r1 = await mock.requestApproval(makeRequest('something specific here'));
      expect(r1.approved).toBe(false);

      const r2 = await mock.requestApproval(makeRequest('anything else'));
      expect(r2.approved).toBe(true);
    });

    it('should use fallback when no match', async () => {
      const mock = createMockApprovalProvider([
        { match: 'nope', response: { approved: true } },
      ]);

      const result = await mock.requestApproval(makeRequest('hello'));
      expect(result.approved).toBe(false);
      expect(result.response).toContain('no matching');
    });

    it('should use custom fallback response', async () => {
      const mock = createMockApprovalProvider([], {
        fallbackResponse: { approved: true, reviewer: 'default-reviewer' },
      });

      const result = await mock.requestApproval(makeRequest('anything'));
      expect(result.approved).toBe(true);
      expect(result.reviewer).toBe('default-reviewer');
    });
  });

  describe('maxUses', () => {
    it('should respect maxUses limit', async () => {
      const mock = createMockApprovalProvider([
        { match: /./, response: { approved: true, reviewer: 'first' }, maxUses: 1 },
        { match: /./, response: { approved: true, reviewer: 'second' } },
      ]);

      const r1 = await mock.requestApproval(makeRequest('a'));
      expect(r1.reviewer).toBe('first');

      const r2 = await mock.requestApproval(makeRequest('b'));
      expect(r2.reviewer).toBe('second');
    });
  });

  describe('call recording', () => {
    it('should record all calls', async () => {
      const mock = createMockApprovalProvider([
        { match: /./, response: { approved: true } },
      ]);

      await mock.requestApproval(makeRequest('first'));
      await mock.requestApproval(makeRequest('second', { id: 'custom-id' }));

      expect(mock.getCallCount()).toBe(2);
      const calls = mock.getCalls();
      expect(calls[0].request.prompt).toBe('first');
      expect(calls[1].request.id).toBe('custom-id');
    });

    it('should record matched index', async () => {
      const mock = createMockApprovalProvider([
        { match: 'expense', response: { approved: true } },
        { match: /./, response: { approved: false } },
      ]);

      await mock.requestApproval(makeRequest('expense report'));
      await mock.requestApproval(makeRequest('something else'));

      const calls = mock.getCalls();
      expect(calls[0].matchedIndex).toBe(0);
      expect(calls[1].matchedIndex).toBe(1);
    });

    it('should record -1 for fallback', async () => {
      const mock = createMockApprovalProvider([
        { match: 'nope', response: { approved: true } },
      ]);

      await mock.requestApproval(makeRequest('hello'));
      expect(mock.getCalls()[0].matchedIndex).toBe(-1);
    });

    it('should filter calls by response index', async () => {
      const mock = createMockApprovalProvider([
        { match: 'a', response: { approved: true } },
        { match: /./, response: { approved: false } },
      ]);

      await mock.requestApproval(makeRequest('a'));
      await mock.requestApproval(makeRequest('b'));
      await mock.requestApproval(makeRequest('a again'));

      expect(mock.getCallsForResponse(0)).toHaveLength(2);
      expect(mock.getCallsForResponse(1)).toHaveLength(1);
    });

    it('should record request context', async () => {
      const mock = createMockApprovalProvider([
        { match: /./, response: { approved: true } },
      ]);

      await mock.requestApproval(makeRequest('test', {
        context: { amount: 500, department: 'engineering' },
        timeout: '24h',
      }));

      const call = mock.getCalls()[0];
      expect(call.request.context).toEqual({ amount: 500, department: 'engineering' });
      expect(call.request.timeout).toBe('24h');
    });
  });

  describe('reset', () => {
    it('should clear all state', async () => {
      const mock = createMockApprovalProvider([
        { match: /./, response: { approved: true }, maxUses: 1 },
      ]);

      await mock.requestApproval(makeRequest('hello'));
      expect(mock.getCallCount()).toBe(1);

      mock.reset();
      expect(mock.getCallCount()).toBe(0);

      // maxUses should reset too
      const result = await mock.requestApproval(makeRequest('hello again'));
      expect(result.approved).toBe(true);
    });
  });

  describe('globalThis injection', () => {
    const g = globalThis as unknown as { __fw_approval_provider__?: ApprovalProvider };

    afterEach(() => {
      delete g.__fw_approval_provider__;
    });

    it('should be injectable via globalThis', async () => {
      const mock = createMockApprovalProvider([
        { match: /./, response: { approved: true, reviewer: 'injected' } },
      ]);

      g.__fw_approval_provider__ = mock;

      // Simulate what generated code does
      const provider = g.__fw_approval_provider__ ?? null;
      expect(provider).toBe(mock);

      const result = await provider!.requestApproval(makeRequest('test'));
      expect(result.approved).toBe(true);
      expect(result.reviewer).toBe('injected');
    });
  });

  describe('snapshot isolation', () => {
    it('should return copies of calls, not references', async () => {
      const mock = createMockApprovalProvider([
        { match: /./, response: { approved: true } },
      ]);

      await mock.requestApproval(makeRequest('test'));

      const calls1 = mock.getCalls();
      const calls2 = mock.getCalls();
      expect(calls1).not.toBe(calls2);
    });
  });
});
