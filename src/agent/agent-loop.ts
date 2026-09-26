/**
 * Provider-agnostic agent loop. It streams LLM responses, collects tool calls,
 * executes them via a caller-provided executor, and iterates.
 *
 * The loop never touches provider internals. Adding a new provider (Codex,
 * Gemini, etc.) requires zero loop changes: just implement AgentProvider.
 */

import type {
  AgentProvider,
  AgentMessage,
  ToolDefinition,
  ToolExecutor,
  AgentLoopOptions,
  AgentLoopResult,
} from './types.js';
import { getErrorMessage } from '../utils/error-utils.js';

const DEFAULT_MAX_ITERATIONS = 15;
const TOOL_RESULT_CAP = 10_000; // characters

/** A tool result within the cap, with a note saying what was left out. */
export function truncateToolResult(result: string, cap = TOOL_RESULT_CAP): string {
  if (result.length <= cap) return result;
  return `${result.slice(0, cap)}\n[truncated: ${result.length - cap} more characters]`;
}

export async function runAgentLoop(
  provider: AgentProvider,
  tools: ToolDefinition[],
  executor: ToolExecutor,
  messages: AgentMessage[],
  options?: AgentLoopOptions,
): Promise<AgentLoopResult> {
  const maxIterations = options?.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const signal = options?.signal;
  const onStreamEvent = options?.onStreamEvent;
  const onToolEvent = options?.onToolEvent;

  const conversation: AgentMessage[] = [...messages];
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let totalCacheReadTokens = 0;
  let totalCacheCreationTokens = 0;
  let totalCostUsd = 0;
  let toolCallCount = 0;

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    if (signal?.aborted) {
      return buildResult(false, 'Aborted', conversation, toolCallCount, totalPromptTokens, totalCompletionTokens, totalCacheReadTokens, totalCacheCreationTokens, totalCostUsd);
    }

    // Stream from provider
    let text = '';
    let finishReason: 'stop' | 'tool_calls' | 'length' | 'error' = 'stop';
    const collectedToolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];
    const activeToolNames = new Map<string, string>();

    const stream = provider.stream(conversation, tools, {
      systemPrompt: options?.systemPrompt,
      model: options?.model,
      maxTokens: options?.maxTokens,
      signal,
      executor,
      onToolEvent,
    });

    for await (const event of stream) {
      onStreamEvent?.(event);

      switch (event.type) {
        case 'text_delta':
          text += event.text;
          break;

        case 'thinking_delta':
          // Reasoning reaches the caller through onStreamEvent above; it is
          // not part of the assistant message kept in the conversation.
          break;

        case 'tool_use_start':
          activeToolNames.set(event.id, event.name);
          break;

        case 'tool_use_delta':
          // Partial JSON, tracked by provider, nothing to do here
          break;

        case 'tool_use_end':
          collectedToolCalls.push({
            id: event.id,
            name: activeToolNames.get(event.id) ?? 'unknown',
            arguments: event.arguments,
          });
          activeToolNames.delete(event.id);
          break;

        case 'tool_result':
          // CLI handled tool internally via MCP, so count it
          toolCallCount++;
          break;

        case 'usage':
          totalPromptTokens += event.promptTokens;
          totalCompletionTokens += event.completionTokens;
          totalCacheReadTokens += event.cacheReadTokens ?? 0;
          totalCacheCreationTokens += event.cacheCreationTokens ?? 0;
          if (event.costUsd != null) totalCostUsd = event.costUsd; // last value = cumulative from CLI
          break;

        case 'message_stop':
          finishReason = event.finishReason;
          break;
      }
    }

    // Add assistant message to conversation
    if (collectedToolCalls.length > 0) {
      conversation.push({
        role: 'assistant',
        content: text || '',
        toolCalls: collectedToolCalls,
      });
    } else if (text) {
      conversation.push({ role: 'assistant', content: text });
    }

    // If no tool calls, we're done
    if (finishReason !== 'tool_calls' || collectedToolCalls.length === 0) {
      // Final turn hook
      if (options?.onTurnEnd) {
        await options.onTurnEnd({
          iteration,
          maxIterations,
          messages: conversation,
          toolCallCount,
          usage: { promptTokens: totalPromptTokens, completionTokens: totalCompletionTokens },
          isFinalTurn: true,
        });
      }
      return buildResult(
        finishReason !== 'error',
        text || 'Task completed',
        conversation,
        toolCallCount,
        totalPromptTokens,
        totalCompletionTokens,
        totalCacheReadTokens,
        totalCacheCreationTokens,
        totalCostUsd,
      );
    }

    // Execute tool calls and add results to conversation
    for (const tc of collectedToolCalls) {
      if (signal?.aborted) break;

      toolCallCount++;
      onToolEvent?.({ type: 'tool_call_start', name: tc.name, args: tc.arguments });

      let result: string;
      let isError: boolean;
      try {
        const res = await executor(tc.name, tc.arguments);
        result = res.result;
        isError = res.isError;
      } catch (err) {
        result = getErrorMessage(err);
        isError = true;
      }

      onToolEvent?.({ type: 'tool_call_result', name: tc.name, args: tc.arguments, result: result.slice(0, 200), isError });

      // Add tool result to conversation, capped so one result cannot fill the
      // context. The model is told when a result was cut, and by how much.
      conversation.push({
        role: 'tool',
        content: truncateToolResult(result),
        toolCallId: tc.id,
      });
    }

    // Between-turns hook, runs after tool execution, before next LLM call
    if (options?.onTurnEnd) {
      const turnResult = await options.onTurnEnd({
        iteration,
        maxIterations,
        messages: conversation,
        toolCallCount,
        usage: { promptTokens: totalPromptTokens, completionTokens: totalCompletionTokens },
        isFinalTurn: false,
      });
      if (turnResult?.continue === false) {
        return buildResult(
          true,
          turnResult.injectMessage ?? 'Stopped by hook',
          conversation,
          toolCallCount,
          totalPromptTokens,
          totalCompletionTokens,
          totalCacheReadTokens,
          totalCacheCreationTokens,
          totalCostUsd,
        );
      }
      if (turnResult?.injectMessage) {
        conversation.push({ role: 'user', content: turnResult.injectMessage });
      }
    }
  }

  return buildResult(
    false,
    `Reached max iterations (${maxIterations})`,
    conversation,
    toolCallCount,
    totalPromptTokens,
    totalCompletionTokens,
    totalCacheReadTokens,
    totalCacheCreationTokens,
    totalCostUsd,
  );
}

function buildResult(
  success: boolean,
  summary: string,
  messages: AgentMessage[],
  toolCallCount: number,
  promptTokens: number,
  completionTokens: number,
  cacheReadTokens: number = 0,
  cacheCreationTokens: number = 0,
  costUsd: number = 0,
): AgentLoopResult {
  return {
    success,
    summary,
    messages,
    toolCallCount,
    usage: { promptTokens, completionTokens, cacheReadTokens, cacheCreationTokens, costUsd },
  };
}
