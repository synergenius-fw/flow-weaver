/**
 * Platform AI provider — routes AI calls through the Flow Weaver platform.
 * Uses the platform's AI credits, no local API key needed.
 * Connects to POST /ai-chat/stream and parses SSE events.
 */

import type { AgentProvider, AgentMessage, ToolDefinition, StreamEvent, StreamOptions } from '../types.js';

export interface PlatformProviderOptions {
  /** JWT token or API key for platform auth */
  token: string;
  /** Platform base URL */
  platformUrl: string;
  /** Model override (optional — platform selects default) */
  model?: string;
}

export class PlatformProvider implements AgentProvider {
  private token: string;
  private baseUrl: string;
  private model: string | undefined;

  constructor(options: PlatformProviderOptions) {
    if (!options.token) throw new Error('PlatformProvider requires a token');
    if (!options.platformUrl) throw new Error('PlatformProvider requires a platformUrl');
    this.token = options.token;
    this.baseUrl = options.platformUrl.replace(/\/+$/, '');
    this.model = options.model;
  }

  async *stream(
    messages: AgentMessage[],
    _tools: ToolDefinition[],
    options?: StreamOptions,
  ): AsyncGenerator<StreamEvent> {
    // Format the last user message as the prompt
    // The platform's agent loop handles tools internally
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
    const message = lastUserMsg
      ? (typeof lastUserMsg.content === 'string' ? lastUserMsg.content : JSON.stringify(lastUserMsg.content))
      : '';

    if (!message) {
      yield { type: 'message_stop', finishReason: 'stop' };
      return;
    }

    const isApiKey = this.token.startsWith('fw_');
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(isApiKey
        ? { 'X-API-Key': this.token }
        : { Authorization: `Bearer ${this.token}` }),
    };

    const body: Record<string, unknown> = { message };
    if (options?.systemPrompt) {
      // Platform doesn't accept system prompt directly via API — embed in message
      body.message = `[System context: ${options.systemPrompt.slice(0, 2000)}]\n\n${message}`;
    }

    const response = await fetch(`${this.baseUrl}/ai-chat/stream`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: options?.signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      yield { type: 'text_delta', text: `Platform error ${response.status}: ${errText.slice(0, 300)}` };
      yield { type: 'message_stop', finishReason: 'error' };
      return;
    }

    if (!response.body) {
      yield { type: 'message_stop', finishReason: 'error' };
      return;
    }

    // Parse SSE stream from platform
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          let event: Record<string, unknown>;
          try { event = JSON.parse(line.slice(6)); } catch { continue; }

          // Map platform SSE events to canonical StreamEvent
          switch (event.type) {
            case 'text_delta':
              yield { type: 'text_delta', text: String(event.content ?? '') };
              break;

            case 'thinking_delta':
              yield { type: 'thinking_delta', text: String(event.content ?? '') };
              break;

            case 'tool_call_start':
              yield {
                type: 'tool_use_start',
                id: String(event.toolCallId ?? ''),
                name: String(event.name ?? ''),
              };
              break;

            case 'tool_call_result':
              yield {
                type: 'tool_result',
                id: String(event.toolCallId ?? ''),
                result: String(event.result ?? ''),
                isError: !!event.isError,
              };
              break;

            case 'usage':
              yield {
                type: 'usage',
                promptTokens: (event.promptTokens as number) ?? 0,
                completionTokens: (event.completionTokens as number) ?? 0,
              };
              break;

            case 'done':
              yield { type: 'message_stop', finishReason: 'stop' };
              return;

            case 'error':
              yield { type: 'text_delta', text: `Error: ${event.message ?? 'Unknown error'}` };
              yield { type: 'message_stop', finishReason: 'error' };
              return;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    yield { type: 'message_stop', finishReason: 'stop' };
  }
}

export function createPlatformProvider(options: PlatformProviderOptions): PlatformProvider {
  return new PlatformProvider(options);
}
