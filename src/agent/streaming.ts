/**
 * StreamJsonParser — parses Claude CLI stream-json NDJSON output into
 * typed StreamEvent values.
 *
 * Extracted from the duplicated parsing logic in platform's claude.ts
 * and cli-session.ts. Handles:
 * - stream_event wrapper unwrapping
 * - content_block lifecycle (text, tool_use, thinking)
 * - Tool argument accumulation (input_json_delta → tool_use_end)
 * - Tool result blocks from CLI's internal tool loop (user events)
 * - Usage tracking from message_start, message_delta, and result
 * - result event as text fallback and turn boundary
 *
 * The parser does NOT decide turn boundaries — consumers (one-shot vs
 * persistent session) handle that differently.
 */

import type { StreamEvent } from './types.js';

export type EventCallback = (event: StreamEvent) => void;

export class StreamJsonParser {
  private hasAssistantText = false;
  private insideToolUse = false;
  private activeToolJsonChunks = new Map<string, { name: string; chunks: string[] }>();

  constructor(private pushEvent: EventCallback) {}

  /** Reset per-turn state. Call before starting a new turn in persistent sessions. */
  reset(): void {
    this.hasAssistantText = false;
    this.insideToolUse = false;
    this.activeToolJsonChunks.clear();
  }

  /** Whether any text_delta events have been emitted this turn. */
  get hasText(): boolean {
    return this.hasAssistantText;
  }

  /**
   * Feed a single NDJSON line (without trailing newline).
   * Parses and emits StreamEvent(s) via the callback.
   */
  feed(line: string): void {
    if (!line.trim()) return;

    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line);
    } catch {
      // Non-JSON line — only use as text if no other source is available
      if (line.trim() && !this.hasAssistantText) {
        this.pushEvent({ type: 'text_delta', text: line });
      }
      return;
    }

    // Unwrap stream_event wrapper (--include-partial-messages wraps API events)
    if (event.type === 'stream_event' && event.event) {
      event = event.event as Record<string, unknown>;
    }

    this.processEvent(event);
  }

  private processEvent(event: Record<string, unknown>): void {
    const block = event.content_block as Record<string, unknown> | undefined;
    const delta = event.delta as Record<string, unknown> | undefined;

    // --- content_block_start ---
    if (event.type === 'content_block_start' && block?.type === 'tool_use') {
      this.insideToolUse = true;
      const id = (block.id as string) || `cli-tool-${Date.now()}`;
      const name = (block.name as string) || 'unknown';
      this.pushEvent({ type: 'tool_use_start', id, name });
      this.activeToolJsonChunks.set(id, { name, chunks: [] });
      return;
    }

    if (event.type === 'content_block_start' && block?.type === 'text') {
      this.insideToolUse = false;
      return;
    }

    // --- content_block_delta ---
    if (event.type === 'content_block_delta' && delta?.type === 'input_json_delta') {
      const lastTool = [...this.activeToolJsonChunks.entries()].pop();
      if (lastTool) lastTool[1].chunks.push((delta.partial_json as string) || '');
      return;
    }

    if (event.type === 'content_block_delta' && delta?.type === 'thinking_delta' && delta?.thinking) {
      this.pushEvent({ type: 'thinking_delta', text: delta.thinking as string });
      return;
    }

    if (event.type === 'content_block_delta' && delta?.text && !this.insideToolUse) {
      this.hasAssistantText = true;
      this.pushEvent({ type: 'text_delta', text: delta.text as string });
      return;
    }

    // --- content_block_stop ---
    if (event.type === 'content_block_stop' && this.insideToolUse) {
      const lastTool = [...this.activeToolJsonChunks.entries()].pop();
      if (lastTool) {
        const [id, { chunks }] = lastTool;
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(chunks.join(''));
        } catch {
          /* malformed */
        }
        this.pushEvent({ type: 'tool_use_end', id, arguments: args });
        this.activeToolJsonChunks.delete(id);
      }
      this.insideToolUse = false;
      return;
    }

    // --- user event with tool_result blocks (CLI's internal tool loop) ---
    if (event.type === 'user' && (event.message as Record<string, unknown>)?.content) {
      const content = (event.message as Record<string, unknown>).content as Array<
        Record<string, unknown>
      >;
      for (const contentBlock of content) {
        if (contentBlock.type === 'tool_result' && contentBlock.tool_use_id) {
          const text = Array.isArray(contentBlock.content)
            ? (contentBlock.content as Array<Record<string, unknown>>)
                .map((c) => (c.text as string) || '')
                .join('')
            : String(contentBlock.content || '');
          this.pushEvent({
            type: 'tool_result',
            id: contentBlock.tool_use_id as string,
            result: text,
            isError: !!contentBlock.is_error,
          });
        }
      }
      return;
    }

    // --- message_start (usage) ---
    if (event.type === 'message_start' && (event.message as Record<string, unknown>)?.usage) {
      const usage = (event.message as Record<string, unknown>).usage as Record<string, number>;
      this.pushEvent({
        type: 'usage',
        promptTokens: usage.input_tokens ?? 0,
        completionTokens: usage.output_tokens ?? 0,
      });
      return;
    }

    // --- message_delta (usage) ---
    if (event.type === 'message_delta' && event.usage) {
      const usage = event.usage as Record<string, number>;
      this.pushEvent({
        type: 'usage',
        promptTokens: 0,
        completionTokens: usage.output_tokens ?? 0,
      });
      return;
    }

    // --- message_stop ---
    if (event.type === 'message_stop') {
      this.pushEvent({ type: 'message_stop', finishReason: 'stop' });
      return;
    }

    // --- result event (CLI turn boundary) ---
    if (event.type === 'result') {
      if (event.is_error) {
        this.pushEvent({ type: 'message_stop', finishReason: 'error' });
        return;
      }
      // result text is a fallback — only use if content_block_delta never fired
      if (event.result && !this.hasAssistantText) {
        this.pushEvent({ type: 'text_delta', text: event.result as string });
      }
      if (event.usage) {
        const usage = event.usage as Record<string, number>;
        this.pushEvent({
          type: 'usage',
          promptTokens: usage.input_tokens ?? 0,
          completionTokens: usage.output_tokens ?? 0,
        });
      }
      this.pushEvent({ type: 'message_stop', finishReason: 'stop' });
      return;
    }

    // --- assistant event (auth failure detection) ---
    if (event.type === 'assistant') {
      if (event.error === 'authentication_failed') {
        this.pushEvent({ type: 'message_stop', finishReason: 'error' });
      }
    }
  }
}
