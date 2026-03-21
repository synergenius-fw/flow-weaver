/**
 * OpenAI-compatible API provider — works with any service that speaks
 * the OpenAI chat completions API: OpenAI, Groq, Together, Ollama, etc.
 *
 * No SDK dependency. Uses only Node.js native fetch + SSE parsing.
 * Converts OpenAI's delta format to the canonical StreamEvent union.
 */

import type { AgentProvider, AgentMessage, ToolDefinition, StreamEvent, StreamOptions } from '../types.js';

export interface OpenAICompatProviderOptions {
  apiKey: string;
  model?: string;
  maxTokens?: number;
  /** Base URL for the API (default: https://api.openai.com). Include /v1 if needed. */
  baseUrl?: string;
}

export class OpenAICompatProvider implements AgentProvider {
  private apiKey: string;
  private model: string;
  private maxTokens: number;
  private baseUrl: string;

  constructor(options: OpenAICompatProviderOptions) {
    if (!options.apiKey) {
      throw new Error('OpenAICompatProvider requires an API key');
    }
    this.apiKey = options.apiKey;
    this.model = options.model ?? 'gpt-4o';
    this.maxTokens = options.maxTokens ?? 4096;
    this.baseUrl = (options.baseUrl ?? 'https://api.openai.com').replace(/\/+$/, '');
  }

  async *stream(
    messages: AgentMessage[],
    tools: ToolDefinition[],
    options?: StreamOptions,
  ): AsyncGenerator<StreamEvent> {
    const model = options?.model ?? this.model;
    const maxTokens = options?.maxTokens ?? this.maxTokens;

    // Build OpenAI-format messages
    const apiMessages = messages.map((m) => formatMessage(m));

    // Build OpenAI-format tools
    const apiTools = tools.length > 0
      ? tools.map((t) => ({
          type: 'function' as const,
          function: {
            name: t.name,
            description: t.description,
            parameters: t.inputSchema,
          },
        }))
      : undefined;

    const body: Record<string, unknown> = {
      model,
      messages: [
        ...(options?.systemPrompt ? [{ role: 'system', content: options.systemPrompt }] : []),
        ...apiMessages,
      ],
      max_tokens: maxTokens,
      stream: true,
    };

    if (apiTools && apiTools.length > 0) {
      body.tools = apiTools;
    }

    // Determine the completions endpoint
    const url = this.baseUrl.includes('/v1/')
      ? `${this.baseUrl}chat/completions`
      : `${this.baseUrl}/v1/chat/completions`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: options?.signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      yield { type: 'text_delta', text: `OpenAI API error ${response.status}: ${errText.slice(0, 300)}` };
      yield { type: 'message_stop', finishReason: 'error' };
      return;
    }

    if (!response.body) {
      yield { type: 'message_stop', finishReason: 'error' };
      return;
    }

    // Parse SSE stream
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let hasToolCalls = false;

    // Track active tool calls (OpenAI sends incremental deltas by index)
    const activeToolCalls = new Map<number, { id: string; name: string; argsJson: string }>();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') {
            // Flush any pending tool calls
            for (const [, tc] of activeToolCalls) {
              let args: Record<string, unknown> = {};
              try { args = JSON.parse(tc.argsJson); } catch { /* malformed */ }
              yield { type: 'tool_use_end', id: tc.id, arguments: args };
            }
            yield { type: 'message_stop', finishReason: hasToolCalls ? 'tool_calls' : 'stop' };
            return;
          }

          let parsed: Record<string, unknown>;
          try { parsed = JSON.parse(data); } catch { continue; }

          // Extract usage if present
          if (parsed.usage) {
            const usage = parsed.usage as Record<string, number>;
            yield {
              type: 'usage',
              promptTokens: usage.prompt_tokens ?? 0,
              completionTokens: usage.completion_tokens ?? 0,
            };
          }

          const choices = parsed.choices as Array<Record<string, unknown>> | undefined;
          if (!choices || choices.length === 0) continue;

          const choice = choices[0];
          const delta = choice.delta as Record<string, unknown> | undefined;
          if (!delta) continue;

          // Text content
          if (delta.content && typeof delta.content === 'string') {
            yield { type: 'text_delta', text: delta.content };
          }

          // Tool calls
          const toolCalls = delta.tool_calls as Array<Record<string, unknown>> | undefined;
          if (toolCalls) {
            for (const tc of toolCalls) {
              const index = (tc.index as number) ?? 0;
              const fn = tc.function as Record<string, unknown> | undefined;

              if (tc.id) {
                // New tool call
                hasToolCalls = true;
                const name = fn?.name ? String(fn.name) : 'unknown';
                activeToolCalls.set(index, { id: String(tc.id), name, argsJson: '' });
                yield { type: 'tool_use_start', id: String(tc.id), name };
              }

              // Accumulate function arguments
              if (fn?.arguments && typeof fn.arguments === 'string') {
                const existing = activeToolCalls.get(index);
                if (existing) {
                  existing.argsJson += fn.arguments;
                  yield { type: 'tool_use_delta', id: existing.id, partialJson: fn.arguments };
                }
              }
            }
          }

          // Finish reason
          if (choice.finish_reason === 'tool_calls') {
            hasToolCalls = true;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    // If we got here without [DONE], flush
    for (const [, tc] of activeToolCalls) {
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(tc.argsJson); } catch { /* malformed */ }
      yield { type: 'tool_use_end', id: tc.id, arguments: args };
    }
    yield { type: 'message_stop', finishReason: hasToolCalls ? 'tool_calls' : 'stop' };
  }
}

function formatMessage(m: AgentMessage): Record<string, unknown> {
  if (m.role === 'tool') {
    return {
      role: 'tool',
      tool_call_id: m.toolCallId,
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    };
  }

  if (m.role === 'assistant' && m.toolCalls?.length) {
    return {
      role: 'assistant',
      content: typeof m.content === 'string' && m.content ? m.content : null,
      tool_calls: m.toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
      })),
    };
  }

  return {
    role: m.role,
    content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
  };
}

export function createOpenAICompatProvider(options: OpenAICompatProviderOptions): OpenAICompatProvider {
  return new OpenAICompatProvider(options);
}
