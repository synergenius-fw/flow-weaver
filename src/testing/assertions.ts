/**
 * Fluent assertion helpers for agent workflow test results.
 *
 * Usage:
 * ```typescript
 * import { expectAgentResult } from 'flow-weaver/testing';
 *
 * const result = await myAgentWorkflow(true, { query: 'hello' });
 *
 * expectAgentResult(result)
 *   .toHaveSucceeded()
 *   .toHaveOutput('answer', 'hello world')
 *   .toNotHaveOutput('error');
 * ```
 */

import type { MockLlmProvider, MockLlmCall } from './mock-llm';

// ---------------------------------------------------------------------------
// Agent result assertions
// ---------------------------------------------------------------------------

export interface AgentResultAssertions {
  /** Assert the workflow completed successfully (onSuccess === true) */
  toHaveSucceeded(): AgentResultAssertions;
  /** Assert the workflow failed (onFailure === true) */
  toHaveFailed(): AgentResultAssertions;
  /** Assert a specific output port has a value */
  toHaveOutput(portName: string, expectedValue?: unknown): AgentResultAssertions;
  /** Assert a specific output port is absent, null, or undefined */
  toNotHaveOutput(portName: string): AgentResultAssertions;
}

/**
 * Create fluent assertions for an agent workflow result.
 *
 * @param result - The workflow result object (record of output port values)
 */
export function expectAgentResult(
  result: Record<string, unknown>,
): AgentResultAssertions {
  const assertions: AgentResultAssertions = {
    toHaveSucceeded() {
      if (result.onSuccess !== true) {
        throw new Error(
          `Expected workflow to succeed (onSuccess === true), but got onSuccess=${result.onSuccess}, onFailure=${result.onFailure}`,
        );
      }
      return assertions;
    },

    toHaveFailed() {
      if (result.onFailure !== true) {
        throw new Error(
          `Expected workflow to fail (onFailure === true), but got onSuccess=${result.onSuccess}, onFailure=${result.onFailure}`,
        );
      }
      return assertions;
    },

    toHaveOutput(portName, expectedValue?) {
      if (!(portName in result)) {
        throw new Error(
          `Expected output port '${portName}' to exist, but result only has: ${Object.keys(result).join(', ')}`,
        );
      }
      if (result[portName] === null || result[portName] === undefined) {
        throw new Error(
          `Expected output port '${portName}' to have a value, but got ${result[portName]}`,
        );
      }
      if (expectedValue !== undefined) {
        const actual = result[portName];
        const expected = expectedValue;
        if (typeof expected === 'object' && expected !== null) {
          // Deep comparison for objects
          if (JSON.stringify(actual) !== JSON.stringify(expected)) {
            throw new Error(
              `Expected output '${portName}' to equal ${JSON.stringify(expected)}, but got ${JSON.stringify(actual)}`,
            );
          }
        } else if (actual !== expected) {
          throw new Error(
            `Expected output '${portName}' to equal ${JSON.stringify(expected)}, but got ${JSON.stringify(actual)}`,
          );
        }
      }
      return assertions;
    },

    toNotHaveOutput(portName) {
      if (portName in result && result[portName] !== null && result[portName] !== undefined) {
        throw new Error(
          `Expected output port '${portName}' to be absent or null, but got ${JSON.stringify(result[portName])}`,
        );
      }
      return assertions;
    },
  };

  return assertions;
}

// ---------------------------------------------------------------------------
// Mock LLM call assertions
// ---------------------------------------------------------------------------

export interface MockLlmAssertions {
  /** Assert the LLM was called exactly N times */
  toHaveBeenCalledTimes(n: number): MockLlmAssertions;
  /** Assert at least one call included a tool call with the given name */
  toHaveUsedTool(toolName: string): MockLlmAssertions;
  /** Assert no call included a tool call with the given name */
  toNotHaveUsedTool(toolName: string): MockLlmAssertions;
  /** Assert total tokens are below a budget */
  toHaveTokenUsageBelow(maxTokens: number): MockLlmAssertions;
  /** Assert a specific call's messages contain a message matching a pattern */
  toHaveReceivedMessage(pattern: string | RegExp, callIndex?: number): MockLlmAssertions;
}

/**
 * Create fluent assertions for a mock LLM provider's recorded calls.
 *
 * @param mockLlm - The mock provider to assert against
 */
export function expectMockLlm(mockLlm: MockLlmProvider): MockLlmAssertions {
  const assertions: MockLlmAssertions = {
    toHaveBeenCalledTimes(n) {
      const actual = mockLlm.getCallCount();
      if (actual !== n) {
        throw new Error(`Expected LLM to be called ${n} time(s), but was called ${actual} time(s)`);
      }
      return assertions;
    },

    toHaveUsedTool(toolName) {
      const calls = mockLlm.getCalls();
      const found = calls.some((call) =>
        call.response.toolCalls.some((tc) => tc.name === toolName),
      );
      if (!found) {
        const usedTools = [
          ...new Set(
            calls.flatMap((c) => c.response.toolCalls.map((tc) => tc.name)),
          ),
        ];
        throw new Error(
          `Expected tool '${toolName}' to have been used, but only these tools were used: ${usedTools.length > 0 ? usedTools.join(', ') : '(none)'}`,
        );
      }
      return assertions;
    },

    toNotHaveUsedTool(toolName) {
      const calls = mockLlm.getCalls();
      const found = calls.some((call) =>
        call.response.toolCalls.some((tc) => tc.name === toolName),
      );
      if (found) {
        throw new Error(`Expected tool '${toolName}' to NOT have been used, but it was`);
      }
      return assertions;
    },

    toHaveTokenUsageBelow(maxTokens) {
      const total = mockLlm.getTotalTokens();
      if (total > maxTokens) {
        throw new Error(
          `Expected token usage below ${maxTokens}, but total was ${total}`,
        );
      }
      return assertions;
    },

    toHaveReceivedMessage(pattern, callIndex?) {
      const calls = mockLlm.getCalls();
      const targetCalls = callIndex !== undefined ? [calls[callIndex]] : calls;

      if (callIndex !== undefined && !calls[callIndex]) {
        throw new Error(
          `Expected call at index ${callIndex}, but only ${calls.length} calls were recorded`,
        );
      }

      const found = targetCalls.some((call) =>
        call?.messages.some((msg) => {
          if (typeof pattern === 'string') {
            return msg.content.includes(pattern);
          }
          return pattern.test(msg.content);
        }),
      );

      if (!found) {
        const scope = callIndex !== undefined ? `call #${callIndex}` : 'any call';
        throw new Error(
          `Expected ${scope} to contain a message matching ${pattern}, but none matched`,
        );
      }
      return assertions;
    },
  };

  return assertions;
}
