/**
 * Anthropic API provider — streams messages via raw fetch + SSE parsing.
 * No SDK dependency. Uses only Node.js native fetch (available since Node 18).
 *
 * Adapted from pack-weaver's streamAnthropicWithTools.
 */

import type { AgentProvider, AgentMessage, ToolDefinition, StreamEvent, StreamOptions } from '../types.js';

export interface AnthropicProviderOptions {
  apiKey: string;
  model?: string;
  maxTokens?: number;
  baseUrl?: string;
}

export class AnthropicProvider implements AgentProvider {
  private apiKey: string;
  private model: string;
  private maxTokens: number;
  private baseUrl: string;

  constructor(options: AnthropicProviderOptions) {
    if (!options.apiKey) {
      throw new Error('AnthropicProvider requires an API key');
    }
    this.apiKey = options.apiKey;
    this.model = options.model ?? 'claude-sonnet-4-20250514';
    this.maxTokens = options.maxTokens ?? 8192;
    this.baseUrl = options.baseUrl ?? 'https://api.anthropic.com';
  }

  async *stream(
    messages: AgentMessage[],
    tools: ToolDefinition[],
    options?: StreamOptions,
  ): AsyncGenerator<StreamEvent> {
    const model = options?.model ?? this.model;
    const maxTokens = options?.maxTokens ?? this.maxTokens;

    // Build Anthropic API request body
    const apiMessages = messages.map((m) => {
      if (m.role === 'tool') {
        return {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: m.toolCallId, content: m.content }],
        };
      }
      if (m.role === 'assistant' && m.toolCalls?.length) {
        const blocks: Array<Record<string, unknown>> = [];
        if (m.content) blocks.push({ type: 'text', text: m.content });
        for (const tc of m.toolCalls) {
          blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.arguments });
        }
        return { role: 'assistant', content: blocks };
      }
      return { role: m.role, content: m.content };
    });

    const apiTools = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
    }));

    const body = JSON.stringify({
      model,
      max_tokens: maxTokens,
      stream: true,
      ...(options?.systemPrompt ? { system: options.systemPrompt } : {}),
      messages: apiMessages,
      ...(apiTools.length > 0 ? { tools: apiTools } : {}),
    });

    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2025-04-15',
        'content-type': 'application/json',
      },
      body,
      signal: options?.signal ?? AbortSignal.timeout(300_000),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Anthropic API error ${response.status}: ${err.slice(0, 200)}`);
    }

    if (!response.body) throw new Error('No response body');

    // Parse SSE stream
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const activeToolUses = new Map<number, { id: string; name: string; jsonChunks: string[] }>();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6).trim();
          if (jsonStr === '[DONE]') continue;

          let event: Record<string, unknown>;
          try {
            event = JSON.parse(jsonStr);
          } catch {
            continue;
          }

          const eventType = event.type as string;

          if (eventType === 'content_block_start') {
            const block = event.content_block as { type: string; id?: string; name?: string };
            const index = event.index as number;
            if (block.type === 'tool_use' && block.id && block.name) {
              activeToolUses.set(index, { id: block.id, name: block.name, jsonChunks: [] });
              yield { type: 'tool_use_start', id: block.id, name: block.name };
            }
          }

          if (eventType === 'content_block_delta') {
            const delta = event.delta as Record<string, unknown>;
            const index = event.index as number;

            if (delta.type === 'text_delta' && delta.text) {
              yield { type: 'text_delta', text: delta.text as string };
            }
            if (delta.type === 'thinking_delta' && delta.thinking) {
              yield { type: 'thinking_delta', text: delta.thinking as string };
            }
            if (delta.type === 'input_json_delta' && delta.partial_json !== undefined) {
              const active = activeToolUses.get(index);
              if (active) {
                active.jsonChunks.push(delta.partial_json as string);
                yield { type: 'tool_use_delta', id: active.id, partialJson: delta.partial_json as string };
              }
            }
          }

          if (eventType === 'content_block_stop') {
            const index = event.index as number;
            const active = activeToolUses.get(index);
            if (active) {
              activeToolUses.delete(index);
              let args: Record<string, unknown> = {};
              try {
                args = JSON.parse(active.jsonChunks.join(''));
              } catch {
                /* malformed */
              }
              yield { type: 'tool_use_end', id: active.id, arguments: args };
            }
          }

          if (eventType === 'message_start' && (event.message as Record<string, unknown>)?.usage) {
            const usage = (event.message as Record<string, unknown>).usage as Record<string, number>;
            yield {
              type: 'usage',
              promptTokens: usage.input_tokens ?? 0,
              completionTokens: usage.output_tokens ?? 0,
            };
          }

          if (eventType === 'message_delta') {
            const delta = event.delta as Record<string, unknown> | undefined;
            if (event.usage) {
              const usage = event.usage as Record<string, number>;
              yield {
                type: 'usage',
                promptTokens: 0,
                completionTokens: usage.output_tokens ?? 0,
              };
            }
            if (delta?.stop_reason === 'tool_use') {
              yield { type: 'message_stop', finishReason: 'tool_calls' };
            } else if (delta?.stop_reason === 'end_turn') {
              yield { type: 'message_stop', finishReason: 'stop' };
            } else if (delta?.stop_reason === 'max_tokens') {
              yield { type: 'message_stop', finishReason: 'length' };
            } else if (delta?.stop_reason) {
              yield { type: 'message_stop', finishReason: 'stop' };
            }
          }

          if (eventType === 'error') {
            const errObj = event.error as { message?: string };
            throw new Error(`Anthropic stream error: ${errObj?.message ?? 'unknown'}`);
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}

export function createAnthropicProvider(options: AnthropicProviderOptions): AnthropicProvider {
  return new AnthropicProvider(options);
}
