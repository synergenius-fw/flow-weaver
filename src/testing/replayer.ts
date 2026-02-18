/**
 * Replay LLM Provider — creates a mock provider from a recorded session.
 *
 * Usage:
 * ```typescript
 * import { createReplayProvider, loadRecording } from 'flow-weaver/testing';
 *
 * const recording = loadRecording(jsonFixture);
 * const replay = createReplayProvider(recording);
 *
 * // Use as LLM provider — calls are replayed in order
 * (globalThis as unknown as { __fw_llm_provider__?: LLMProvider }).__fw_llm_provider__ = replay;
 *
 * // Run workflow — LLM calls return recorded responses, no network calls
 *
 * // All MockLlmProvider methods work: getCalls(), getTotalTokens(), etc.
 * expect(replay.getCallCount()).toBe(3);
 * ```
 */

import type { LLMTokenUsage, MockLlmCall, MockLlmProvider } from './mock-llm';
import type { LlmRecording, LlmRecordingStep } from './recorder';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface ReplayOptions {
  /**
   * In strict mode, throws an error if more calls are made than were recorded.
   * Default: true
   */
  strict?: boolean;

  /**
   * Default token usage when a recorded step has no usage data.
   * Default: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
   */
  defaultUsage?: LLMTokenUsage;
}

// ---------------------------------------------------------------------------
// Replay provider factory
// ---------------------------------------------------------------------------

const ZERO_USAGE: LLMTokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

/**
 * Creates a MockLlmProvider that replays recorded LLM interactions in order.
 *
 * Each `chat()` call returns the next recorded response sequentially.
 * The returned provider implements the full MockLlmProvider interface,
 * so all existing assertion helpers and TokenTracker work out of the box.
 *
 * @param recording - The recording to replay (from createRecordingProvider or loadRecording)
 * @param options - Replay configuration
 * @returns A MockLlmProvider that replays recorded responses
 */
export function createReplayProvider(
  recording: LlmRecording,
  options?: ReplayOptions,
): MockLlmProvider {
  const strict = options?.strict ?? true;
  const defaultUsage = options?.defaultUsage ?? ZERO_USAGE;
  const steps = [...recording.steps];

  let callIndex = 0;
  const calls: MockLlmCall[] = [];

  return {
    async chat(messages, chatOptions) {
      if (callIndex >= steps.length) {
        if (strict) {
          throw new Error(
            `Replay exhausted: recording has ${steps.length} step(s) but call #${callIndex} was attempted. ` +
              `Set strict: false to return a fallback response instead.`,
          );
        }
        // Non-strict: return an empty response
        const fallback = {
          content: `[Replay exhausted at call #${callIndex}]`,
          toolCalls: [],
          finishReason: 'stop' as const,
          usage: defaultUsage,
        };
        calls.push({
          messages: [...messages],
          options: chatOptions,
          matchedIndex: -1,
          response: fallback,
          timestamp: Date.now(),
        });
        callIndex++;
        return fallback;
      }

      const step = steps[callIndex];
      const response = {
        content: step.output.content,
        toolCalls: step.output.toolCalls ?? [],
        finishReason: step.output.finishReason ?? 'stop',
        usage: step.output.usage ?? defaultUsage,
      };

      calls.push({
        messages: [...messages],
        options: chatOptions,
        matchedIndex: callIndex,
        response,
        timestamp: Date.now(),
      });

      callIndex++;
      return response;
    },

    getCalls(): MockLlmCall[] {
      return [...calls];
    },

    getCallCount(): number {
      return calls.length;
    },

    getTotalTokens(): number {
      return calls.reduce((sum, call) => sum + (call.response.usage?.totalTokens ?? 0), 0);
    },

    getTokenUsage(): LLMTokenUsage[] {
      return calls.map((call) => call.response.usage ?? defaultUsage);
    },

    reset(): void {
      calls.length = 0;
      callIndex = 0;
    },

    getCallsForResponse(index: number): MockLlmCall[] {
      return calls.filter((c) => c.matchedIndex === index);
    },
  };
}

// ---------------------------------------------------------------------------
// Loading helpers
// ---------------------------------------------------------------------------

/**
 * Parse a recording from JSON data.
 *
 * Accepts either a parsed object or a JSON string.
 * Validates the structure and returns a typed LlmRecording.
 *
 * @param data - JSON string or parsed object
 * @returns A validated LlmRecording
 */
export function loadRecording(data: string | LlmRecording): LlmRecording {
  const parsed: unknown = typeof data === 'string' ? JSON.parse(data) : data;

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid recording: expected an object');
  }

  const rec = parsed as Record<string, unknown>;

  if (!Array.isArray(rec.steps)) {
    throw new Error('Invalid recording: missing or invalid "steps" array');
  }

  // Validate each step has minimum required fields
  for (let i = 0; i < rec.steps.length; i++) {
    const step = rec.steps[i] as Record<string, unknown>;
    if (!step.output || typeof step.output !== 'object') {
      throw new Error(`Invalid recording step ${i}: missing "output" object`);
    }
  }

  return {
    steps: (rec.steps as LlmRecordingStep[]).map((step, i) => ({
      index: step.index ?? i,
      input: step.input ?? { messages: [] },
      output: step.output,
      timestamp: step.timestamp ?? '',
      durationMs: step.durationMs ?? 0,
    })),
    metadata: (rec.metadata as Record<string, unknown>) ?? {},
    createdAt: (rec.createdAt as string) ?? '',
  };
}
