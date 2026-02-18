/**
 * Recording LLM Provider — wraps a real provider and records all interactions.
 *
 * Usage:
 * ```typescript
 * import { createRecordingProvider } from 'flow-weaver/testing';
 *
 * const recorder = createRecordingProvider(realLlmProvider);
 *
 * // Use recorder.provider as the LLM provider in your workflow
 * (globalThis as unknown as { __fw_llm_provider__?: LLMProvider }).__fw_llm_provider__ = recorder.provider;
 *
 * // Run workflow...
 *
 * // Get the recording for later replay
 * const recording = recorder.getRecording();
 * const json = JSON.stringify(recording, null, 2);
 * // Save to disk, fixture file, etc.
 * ```
 */

import type { LLMMessage, LLMProvider, LLMResponse, LLMTool, LLMTokenUsage } from './mock-llm';

// ---------------------------------------------------------------------------
// Recording format
// ---------------------------------------------------------------------------

export interface LlmRecordingStep {
  /** Sequential index of this call */
  index: number;
  /** Input sent to the LLM */
  input: {
    messages: LLMMessage[];
    options?: {
      tools?: LLMTool[];
      systemPrompt?: string;
      model?: string;
      temperature?: number;
      maxTokens?: number;
    };
  };
  /** Response from the LLM */
  output: LLMResponse;
  /** ISO timestamp when the call started */
  timestamp: string;
  /** Wall-clock duration in milliseconds */
  durationMs: number;
}

export interface LlmRecording {
  /** Recorded LLM interactions in order */
  steps: LlmRecordingStep[];
  /** Optional metadata (test name, workflow name, etc.) */
  metadata: Record<string, unknown>;
  /** ISO timestamp when recording started */
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Recording provider
// ---------------------------------------------------------------------------

export interface RecordingLlmProvider {
  /** The wrapped provider — use this as your LLMProvider */
  provider: LLMProvider;
  /** Get the current recording */
  getRecording(): LlmRecording;
  /** Get the number of recorded calls */
  getCallCount(): number;
  /** Clear all recorded data */
  reset(): void;
}

/**
 * Creates a recording LLM provider that wraps a real provider.
 *
 * Every call to `chat()` is passed through to the real provider,
 * and the input/output/timing is recorded for later replay.
 *
 * @param realProvider - The real LLM provider to wrap
 * @param metadata - Optional metadata to include in the recording
 * @returns A recording provider with access to the recorded data
 */
export function createRecordingProvider(
  realProvider: LLMProvider,
  metadata?: Record<string, unknown>,
): RecordingLlmProvider {
  const steps: LlmRecordingStep[] = [];
  const createdAt = new Date().toISOString();

  const provider: LLMProvider = {
    async chat(messages, options) {
      const startTime = Date.now();
      const timestamp = new Date(startTime).toISOString();

      const response = await realProvider.chat(messages, options);

      const durationMs = Date.now() - startTime;

      steps.push({
        index: steps.length,
        input: {
          messages: [...messages],
          ...(options ? { options: { ...options } } : {}),
        },
        output: { ...response },
        timestamp,
        durationMs,
      });

      return response;
    },
  };

  return {
    provider,

    getRecording(): LlmRecording {
      return {
        steps: steps.map((s) => ({ ...s })),
        metadata: { ...(metadata ?? {}) },
        createdAt,
      };
    },

    getCallCount(): number {
      return steps.length;
    },

    reset(): void {
      steps.length = 0;
    },
  };
}
