/**
 * Mock Approval Provider for deterministic human-approval workflow testing.
 *
 * Mirrors the mock LLM provider pattern — pattern matching on prompts,
 * call recording, and configurable responses.
 *
 * Usage in vitest/jest tests:
 * ```typescript
 * import { createMockApprovalProvider } from 'flow-weaver/testing';
 *
 * const mockApproval = createMockApprovalProvider([
 *   { match: /expense/, response: { approved: true, reviewer: 'alice' } },
 *   { match: /delete/, response: { approved: false, response: 'Too risky' } },
 *   { match: /./, response: { approved: true } },
 * ]);
 *
 * // Inject globally for compiled workflows
 * (globalThis as unknown as { __fw_approval_provider__?: ApprovalProvider })
 *   .__fw_approval_provider__ = mockApproval;
 *
 * // After test
 * expect(mockApproval.getCallCount()).toBe(2);
 * ```
 */

// ---------------------------------------------------------------------------
// Types (mirror the approval types used in templates)
// ---------------------------------------------------------------------------

export interface ApprovalRequest {
  id: string;
  prompt: string;
  context?: Record<string, unknown>;
  timeout?: string;
}

export interface ApprovalResult {
  approved: boolean;
  response?: string;
  reviewer?: string;
}

export interface ApprovalProvider {
  requestApproval(request: ApprovalRequest): Promise<ApprovalResult>;
}

// ---------------------------------------------------------------------------
// Mock response definition
// ---------------------------------------------------------------------------

export interface MockApprovalResponse {
  /** Pattern to match against the approval prompt. String = includes check, RegExp = test. */
  match: string | RegExp;
  /** The result to return when matched */
  response: ApprovalResult;
  /** Maximum number of times this response can be used (default: unlimited) */
  maxUses?: number;
}

// ---------------------------------------------------------------------------
// Recorded call
// ---------------------------------------------------------------------------

export interface MockApprovalCall {
  /** The approval request that was made */
  request: ApprovalRequest;
  /** Which response definition matched (-1 if fallback) */
  matchedIndex: number;
  /** The result that was returned */
  result: ApprovalResult;
  /** Timestamp of the call */
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Mock provider
// ---------------------------------------------------------------------------

export interface MockApprovalProvider extends ApprovalProvider {
  /** Get all recorded calls */
  getCalls(): MockApprovalCall[];
  /** Get total number of calls */
  getCallCount(): number;
  /** Reset call history and usage counters */
  reset(): void;
  /** Get calls that matched a specific response index */
  getCallsForResponse(index: number): MockApprovalCall[];
}

const FALLBACK_RESULT: ApprovalResult = {
  approved: false,
  response: '[Mock: no matching approval response configured]',
};

/**
 * Creates a mock approval provider with deterministic response matching.
 *
 * Responses are matched in order against the approval request prompt.
 * First match wins. If no response matches, a fallback result is returned.
 *
 * @param responses - Array of match/response pairs, checked in order
 * @param options - Configuration options
 * @returns A mock provider with call recording
 */
export function createMockApprovalProvider(
  responses: MockApprovalResponse[] = [],
  options?: {
    /** Response to return when no match is found */
    fallbackResponse?: ApprovalResult;
  },
): MockApprovalProvider {
  const calls: MockApprovalCall[] = [];
  const useCounts = new Map<number, number>();

  const fallback: ApprovalResult = options?.fallbackResponse ?? FALLBACK_RESULT;

  function findMatch(prompt: string): { index: number; response: MockApprovalResponse } | null {
    for (let i = 0; i < responses.length; i++) {
      const def = responses[i];

      // Check max uses
      if (def.maxUses !== undefined) {
        const used = useCounts.get(i) ?? 0;
        if (used >= def.maxUses) continue;
      }

      const matches =
        typeof def.match === 'string'
          ? prompt.includes(def.match)
          : def.match.test(prompt);

      if (matches) {
        return { index: i, response: def };
      }
    }
    return null;
  }

  return {
    async requestApproval(request) {
      const match = findMatch(request.prompt);

      let result: ApprovalResult;
      let matchedIndex: number;

      if (match) {
        matchedIndex = match.index;
        useCounts.set(matchedIndex, (useCounts.get(matchedIndex) ?? 0) + 1);
        result = { ...match.response.response };
      } else {
        matchedIndex = -1;
        result = { ...fallback };
      }

      calls.push({
        request: { ...request },
        matchedIndex,
        result,
        timestamp: Date.now(),
      });

      return result;
    },

    getCalls() {
      return [...calls];
    },

    getCallCount() {
      return calls.length;
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
