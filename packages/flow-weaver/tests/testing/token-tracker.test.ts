/**
 * Tests for TokenTracker
 */

import { TokenTracker } from '../../src/testing/token-tracker';

describe('TokenTracker', () => {
  let tracker: TokenTracker;

  beforeEach(() => {
    tracker = new TokenTracker();
  });

  describe('track', () => {
    it('should track a step with full usage', () => {
      tracker.track('llm-call', { promptTokens: 100, completionTokens: 50, totalTokens: 150 });
      expect(tracker.total).toBe(150);
      expect(tracker.promptTokens).toBe(100);
      expect(tracker.completionTokens).toBe(50);
    });

    it('should track a step with only totalTokens', () => {
      tracker.track('llm-call', { totalTokens: 200 });
      expect(tracker.total).toBe(200);
      expect(tracker.promptTokens).toBe(0);
      expect(tracker.completionTokens).toBe(0);
    });

    it('should track a step with undefined usage', () => {
      tracker.track('llm-call', undefined);
      expect(tracker.total).toBe(0);
    });

    it('should accumulate across multiple steps', () => {
      tracker.track('step-1', { promptTokens: 50, completionTokens: 25, totalTokens: 75 });
      tracker.track('step-2', { promptTokens: 100, completionTokens: 50, totalTokens: 150 });
      tracker.track('step-3', { promptTokens: 30, completionTokens: 20, totalTokens: 50 });

      expect(tracker.total).toBe(275);
      expect(tracker.promptTokens).toBe(180);
      expect(tracker.completionTokens).toBe(95);
      expect(tracker.stepCount).toBe(3);
    });
  });

  describe('getSteps / getStep', () => {
    it('should return all tracked steps', () => {
      tracker.track('a', { totalTokens: 10 });
      tracker.track('b', { totalTokens: 20 });

      const steps = tracker.getSteps();
      expect(steps).toHaveLength(2);
      expect(steps[0].step).toBe('a');
      expect(steps[1].step).toBe('b');
    });

    it('should find step by name', () => {
      tracker.track('llm-1', { promptTokens: 50, completionTokens: 25, totalTokens: 75 });
      tracker.track('llm-2', { promptTokens: 100, completionTokens: 50, totalTokens: 150 });

      const step = tracker.getStep('llm-2');
      expect(step).toBeDefined();
      expect(step!.usage.totalTokens).toBe(150);
    });

    it('should return undefined for unknown step', () => {
      expect(tracker.getStep('nonexistent')).toBeUndefined();
    });
  });

  describe('assertBelow', () => {
    it('should pass when under budget', () => {
      tracker.track('step', { totalTokens: 50 });
      expect(() => tracker.assertBelow(100)).not.toThrow();
    });

    it('should pass at exactly the budget', () => {
      tracker.track('step', { totalTokens: 100 });
      expect(() => tracker.assertBelow(100)).not.toThrow();
    });

    it('should fail when over budget', () => {
      tracker.track('step-1', { totalTokens: 60 });
      tracker.track('step-2', { totalTokens: 50 });

      expect(() => tracker.assertBelow(100)).toThrow(/Token budget exceeded: 110 > 100/);
    });

    it('should include step breakdown in error message', () => {
      tracker.track('fetch', { totalTokens: 30 });
      tracker.track('extract', { totalTokens: 80 });

      try {
        tracker.assertBelow(100);
      } catch (e: any) {
        expect(e.message).toContain('fetch: 30 tokens');
        expect(e.message).toContain('extract: 80 tokens');
      }
    });
  });

  describe('assertAbove', () => {
    it('should pass when above minimum', () => {
      tracker.track('step', { totalTokens: 50 });
      expect(() => tracker.assertAbove(10)).not.toThrow();
    });

    it('should fail when below minimum', () => {
      expect(() => tracker.assertAbove(10)).toThrow(/Token usage too low: 0 < 10/);
    });
  });

  describe('reset', () => {
    it('should clear all data', () => {
      tracker.track('step', { totalTokens: 100 });
      tracker.reset();

      expect(tracker.total).toBe(0);
      expect(tracker.stepCount).toBe(0);
      expect(tracker.getSteps()).toHaveLength(0);
    });
  });

  describe('trackFromCalls', () => {
    it('should track from mock call array', () => {
      const calls = [
        { response: { usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } } },
        { response: { usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 } } },
      ];

      tracker.trackFromCalls(calls);

      expect(tracker.stepCount).toBe(2);
      expect(tracker.total).toBe(45);
      expect(tracker.getStep('call-0')!.usage.totalTokens).toBe(15);
      expect(tracker.getStep('call-1')!.usage.totalTokens).toBe(30);
    });

    it('should use custom name resolver', () => {
      const calls = [
        { response: { usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } } },
      ];
      const names = ['think-step'];

      tracker.trackFromCalls(calls, (i) => names[i]);

      expect(tracker.getStep('think-step')).toBeDefined();
    });

    it('should handle calls without usage', () => {
      const calls = [
        { response: {} },
      ];

      tracker.trackFromCalls(calls);
      expect(tracker.total).toBe(0);
    });
  });
});
