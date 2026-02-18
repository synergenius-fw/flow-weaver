/**
 * Token usage tracker for agent workflow tests.
 *
 * Accumulates token usage across LLM calls and provides
 * budget assertions for cost control testing.
 *
 * Usage:
 * ```typescript
 * import { TokenTracker, createMockLlmProvider } from 'flow-weaver/testing';
 *
 * const tracker = new TokenTracker();
 * const mockLlm = createMockLlmProvider([...]);
 *
 * // After running workflow
 * mockLlm.getCalls().forEach((call, i) => {
 *   tracker.track(`step-${i}`, call.response.usage);
 * });
 *
 * tracker.assertBelow(10000); // Fail if total exceeds budget
 * ```
 */

import type { LLMTokenUsage } from './mock-llm';

export interface TrackedStep {
  /** Identifier for this step (e.g., node name, call index) */
  step: string;
  /** Token usage for this step */
  usage: LLMTokenUsage;
  /** Timestamp when tracked */
  timestamp: number;
}

export class TokenTracker {
  private steps: TrackedStep[] = [];

  /** Track token usage for a step */
  track(step: string, usage?: LLMTokenUsage | { totalTokens: number }): void {
    const normalized: LLMTokenUsage = {
      promptTokens: (usage as LLMTokenUsage)?.promptTokens ?? 0,
      completionTokens: (usage as LLMTokenUsage)?.completionTokens ?? 0,
      totalTokens: usage?.totalTokens ?? 0,
    };

    this.steps.push({ step, usage: normalized, timestamp: Date.now() });
  }

  /** Total tokens across all tracked steps */
  get total(): number {
    return this.steps.reduce((sum, s) => sum + s.usage.totalTokens, 0);
  }

  /** Total prompt tokens */
  get promptTokens(): number {
    return this.steps.reduce((sum, s) => sum + s.usage.promptTokens, 0);
  }

  /** Total completion tokens */
  get completionTokens(): number {
    return this.steps.reduce((sum, s) => sum + s.usage.completionTokens, 0);
  }

  /** Number of tracked steps */
  get stepCount(): number {
    return this.steps.length;
  }

  /** Get all tracked steps */
  getSteps(): TrackedStep[] {
    return [...this.steps];
  }

  /** Get usage for a specific step by name */
  getStep(step: string): TrackedStep | undefined {
    return this.steps.find((s) => s.step === step);
  }

  /**
   * Assert total tokens are below a budget.
   * Throws with a descriptive message if exceeded.
   */
  assertBelow(maxTokens: number): void {
    if (this.total > maxTokens) {
      const breakdown = this.steps
        .map((s) => `  ${s.step}: ${s.usage.totalTokens} tokens`)
        .join('\n');
      throw new Error(
        `Token budget exceeded: ${this.total} > ${maxTokens}\n` +
          `Breakdown (${this.steps.length} steps):\n${breakdown}`,
      );
    }
  }

  /**
   * Assert total tokens are above a minimum.
   * Useful to verify the LLM was actually called.
   */
  assertAbove(minTokens: number): void {
    if (this.total < minTokens) {
      throw new Error(
        `Token usage too low: ${this.total} < ${minTokens}. Was the LLM actually called?`,
      );
    }
  }

  /** Reset all tracking data */
  reset(): void {
    this.steps.length = 0;
  }

  /**
   * Convenience: track all calls from a mock LLM provider.
   * Uses call index as step name unless a nameResolver is provided.
   */
  trackFromCalls(
    calls: Array<{ response: { usage?: LLMTokenUsage } }>,
    nameResolver?: (index: number) => string,
  ): void {
    calls.forEach((call, i) => {
      const step = nameResolver ? nameResolver(i) : `call-${i}`;
      this.track(step, call.response.usage);
    });
  }
}
