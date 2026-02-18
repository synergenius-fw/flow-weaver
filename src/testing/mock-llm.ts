/**
 * Mock LLM Provider for deterministic agent workflow testing.
 *
 * Usage in vitest/jest tests:
 * ```typescript
 * import { createMockLlmProvider } from 'flow-weaver/testing';
 *
 * const mockLlm = createMockLlmProvider([
 *   { match: /search/, response: { content: null, toolCalls: [{ id: '1', name: 'search', arguments: { q: 'test' } }], finishReason: 'tool_calls' } },
 *   { match: /./, response: { content: 'Default answer', toolCalls: [], finishReason: 'stop' } },
 * ]);
 *
 * // Inject globally for compiled workflows
 * (globalThis as unknown as { __fw_llm_provider__?: LLMProvider }).__fw_llm_provider__ = mockLlm;
 *
 * // After test
 * expect(mockLlm.getCallCount()).toBe(2);
 * expect(mockLlm.getTotalTokens()).toBe(150);
 * ```
 */

// ---------------------------------------------------------------------------
// Types (mirror the LLM types used in templates)
// ---------------------------------------------------------------------------

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
}

export interface LLMToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface LLMResponse {
  content: string | null;
  toolCalls: LLMToolCall[];
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error';
  usage?: LLMTokenUsage;
}

export interface LLMTokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface LLMTool {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, { type: string }>;
    required?: string[];
  };
}

export interface LLMProvider {
  chat(
    messages: LLMMessage[],
    options?: {
      tools?: LLMTool[];
      systemPrompt?: string;
      model?: string;
      temperature?: number;
      maxTokens?: number;
    },
  ): Promise<LLMResponse>;
}

// ---------------------------------------------------------------------------
// Mock response definition
// ---------------------------------------------------------------------------

export interface MockLlmResponse {
  /** Pattern to match against the last user message content. String = includes check, RegExp = test. */
  match: string | RegExp;
  /** The response to return when matched */
  response: {
    content?: string | null;
    toolCalls?: LLMToolCall[];
    finishReason?: LLMResponse['finishReason'];
  };
  /** Simulated token usage for this response */
  usage?: LLMTokenUsage;
  /** Maximum number of times this response can be used (default: unlimited) */
  maxUses?: number;
}

// ---------------------------------------------------------------------------
// Recorded call
// ---------------------------------------------------------------------------

export interface MockLlmCall {
  /** Messages sent to the provider */
  messages: LLMMessage[];
  /** Options passed to the provider */
  options?: {
    tools?: LLMTool[];
    systemPrompt?: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
  };
  /** Which response definition matched (-1 if fallback) */
  matchedIndex: number;
  /** The response that was returned */
  response: LLMResponse;
  /** Timestamp of the call */
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Mock provider
// ---------------------------------------------------------------------------

export interface MockLlmProvider extends LLMProvider {
  /** Get all recorded calls */
  getCalls(): MockLlmCall[];
  /** Get total number of calls */
  getCallCount(): number;
  /** Get total simulated tokens across all calls */
  getTotalTokens(): number;
  /** Get token usage breakdown per call */
  getTokenUsage(): LLMTokenUsage[];
  /** Reset call history and usage counters */
  reset(): void;
  /** Get calls that matched a specific response index */
  getCallsForResponse(index: number): MockLlmCall[];
}

const DEFAULT_USAGE: LLMTokenUsage = {
  promptTokens: 50,
  completionTokens: 25,
  totalTokens: 75,
};

const FALLBACK_RESPONSE: LLMResponse = {
  content: '[Mock: no matching response configured]',
  toolCalls: [],
  finishReason: 'stop',
  usage: DEFAULT_USAGE,
};

/**
 * Creates a mock LLM provider with deterministic response matching.
 *
 * Responses are matched in order against the last user message content.
 * First match wins. If no response matches, a fallback response is returned.
 *
 * @param responses - Array of match/response pairs, checked in order
 * @param options - Configuration options
 * @returns A mock provider with call recording and token tracking
 */
export function createMockLlmProvider(
  responses: MockLlmResponse[] = [],
  options?: {
    /** Default token usage when a response doesn't specify usage */
    defaultUsage?: LLMTokenUsage;
    /** Response to return when no match is found (default: generic mock message) */
    fallbackResponse?: Partial<LLMResponse>;
  },
): MockLlmProvider {
  const calls: MockLlmCall[] = [];
  const useCounts = new Map<number, number>();
  const defaultUsage = options?.defaultUsage ?? DEFAULT_USAGE;

  const fallback: LLMResponse = {
    ...FALLBACK_RESPONSE,
    ...(options?.fallbackResponse ?? {}),
    usage: options?.fallbackResponse?.usage ?? defaultUsage,
  };

  function findMatch(lastMessage: string): { index: number; response: MockLlmResponse } | null {
    for (let i = 0; i < responses.length; i++) {
      const def = responses[i];

      // Check max uses
      if (def.maxUses !== undefined) {
        const used = useCounts.get(i) ?? 0;
        if (used >= def.maxUses) continue;
      }

      const matches =
        typeof def.match === 'string'
          ? lastMessage.includes(def.match)
          : def.match.test(lastMessage);

      if (matches) {
        return { index: i, response: def };
      }
    }
    return null;
  }

  return {
    async chat(messages, chatOptions) {
      const lastUserMessage =
        [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';

      const match = findMatch(lastUserMessage);

      let response: LLMResponse;
      let matchedIndex: number;

      if (match) {
        matchedIndex = match.index;
        useCounts.set(matchedIndex, (useCounts.get(matchedIndex) ?? 0) + 1);

        response = {
          content: match.response.response.content ?? null,
          toolCalls: match.response.response.toolCalls ?? [],
          finishReason: match.response.response.finishReason ?? 'stop',
          usage: match.response.usage ?? defaultUsage,
        };
      } else {
        matchedIndex = -1;
        response = { ...fallback };
      }

      calls.push({
        messages: [...messages],
        options: chatOptions,
        matchedIndex,
        response,
        timestamp: Date.now(),
      });

      return response;
    },

    getCalls() {
      return [...calls];
    },

    getCallCount() {
      return calls.length;
    },

    getTotalTokens() {
      return calls.reduce((sum, call) => sum + (call.response.usage?.totalTokens ?? 0), 0);
    },

    getTokenUsage() {
      return calls.map((call) => call.response.usage ?? defaultUsage);
    },

    reset() {
      calls.length = 0;
      useCounts.clear();
    },

    getCallsForResponse(index) {
      return calls.filter((c) => c.matchedIndex === index);
    },
  };
}
