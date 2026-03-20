/**
 * Provider-agnostic agent loop — streams LLM responses, collects tool calls,
 * executes them via a caller-provided executor, and iterates.
 *
 * The loop never touches provider internals. Adding a new provider (Codex,
 * Gemini, etc.) requires zero loop changes — just implement AgentProvider.
 */

import type {
  AgentProvider,
  AgentMessage,
  ToolDefinition,
  ToolExecutor,
  StreamEvent,
  AgentLoopOptions,
  AgentLoopResult,
} from './types.js';

const DEFAULT_MAX_ITERATIONS = 15;
const TOOL_RESULT_CAP = 10_000; // bytes

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
  let toolCallCount = 0;

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    if (signal?.aborted) {
      return buildResult(false, 'Aborted', conversation, toolCallCount, totalPromptTokens, totalCompletionTokens);
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
    });

    for await (const event of stream) {
      onStreamEvent?.(event);

      switch (event.type) {
        case 'text_delta':
          text += event.text;
          break;

        case 'tool_use_start':
          activeToolNames.set(event.id, event.name);
          break;

        case 'tool_use_delta':
          // Partial JSON — tracked by provider, nothing to do here
          break;

        case 'tool_use_end':
          collectedToolCalls.push({
            id: event.id,
            name: activeToolNames.get(event.id) ?? 'unknown',
            arguments: event.arguments,
          });
          activeToolNames.delete(event.id);
          break;

        case 'usage':
          totalPromptTokens += event.promptTokens;
          totalCompletionTokens += event.completionTokens;
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
      return buildResult(
        finishReason !== 'error',
        text || 'Task completed',
        conversation,
        toolCallCount,
        totalPromptTokens,
        totalCompletionTokens,
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
        result = err instanceof Error ? err.message : String(err);
        isError = true;
      }

      onToolEvent?.({ type: 'tool_call_result', name: tc.name, result: result.slice(0, 200), isError });

      // Add tool result to conversation (cap size to prevent context overflow)
      conversation.push({
        role: 'tool',
        content: result.slice(0, TOOL_RESULT_CAP),
        toolCallId: tc.id,
      });
    }
  }

  return buildResult(
    false,
    `Reached max iterations (${maxIterations})`,
    conversation,
    toolCallCount,
    totalPromptTokens,
    totalCompletionTokens,
  );
}

function buildResult(
  success: boolean,
  summary: string,
  messages: AgentMessage[],
  toolCallCount: number,
  promptTokens: number,
  completionTokens: number,
): AgentLoopResult {
  return {
    success,
    summary,
    messages,
    toolCallCount,
    usage: { promptTokens, completionTokens },
  };
}
