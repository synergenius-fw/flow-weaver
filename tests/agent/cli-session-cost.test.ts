/**
 * Verifies the persistent session's exact Claude CLI boundary and that the
 * terminal result event is not lost behind an intermediate message_stop.
 *
 * This is deliberately deterministic. Ambient CLI credentials and network
 * availability are not a test contract. The opt-in live provider probe covers
 * those separately. Here we exercise the production spawn adapter, stdin
 * framing, stdout parser, turn boundary, and cost projection as one unit.
 */

import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CliSession } from '../../src/agent/cli-session.js';
import { getCliSessionConfig } from '../../src/agent/cli-spawn-config.js';
import type { SpawnFn, StreamEvent } from '../../src/agent/types.js';

let session: CliSession | null = null;

afterEach(() => {
  session?.kill();
  session = null;
});

describe('CliSession current CLI contract and result cost', () => {
  it('uses --allowed-tools only and yields terminal cost after an intermediate stop', async () => {
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    const childEvents = new EventEmitter();
    const stdinWrite = vi.fn((_data: string, callback?: (error?: Error | null) => void) => {
      callback?.(null);
      queueMicrotask(() => {
        stdout.emit('data', Buffer.from(`${JSON.stringify({
          type: 'stream_event',
          event: { type: 'message_stop' },
        })}\n`));
        stdout.emit('data', Buffer.from(`${JSON.stringify({
          type: 'result',
          is_error: false,
          result: 'done',
          total_cost_usd: 0.0042,
          usage: {
            input_tokens: 21,
            output_tokens: 8,
            cache_read_input_tokens: 3,
            cache_creation_input_tokens: 2,
          },
        })}\n`));
      });
      return true;
    });

    const child = Object.assign(childEvents, {
      stdin: { write: stdinWrite, end: vi.fn(), on: vi.fn() },
      stdout,
      stderr,
      kill: vi.fn(() => true),
      pid: 12345,
      killed: false,
    }) as unknown as ChildProcess;
    const spawnFn = vi.fn<SpawnFn>(() => child);

    session = new CliSession({
      ...getCliSessionConfig({
        cwd: process.cwd(),
        model: 'claude-sonnet-4-6',
        mcpConfigPath: '/tmp/flow-weaver-test-mcp.json',
        appendSystemPrompt: 'Call done immediately.',
      }),
      spawnFn,
    });
    await session.spawn();

    const args = spawnFn.mock.calls[0]?.[1] as string[];
    const allowedToolsIndex = args.indexOf('--allowed-tools');
    expect(allowedToolsIndex).toBeGreaterThan(-1);
    expect(args[allowedToolsIndex + 1]).toBe('');
    expect(args).not.toContain('--tools');
    expect(args).toContain('--strict-mcp-config');

    const events: StreamEvent[] = [];
    for await (const event of session.send('Call done.')) events.push(event);

    expect(stdinWrite).toHaveBeenCalledOnce();
    expect(JSON.parse(stdinWrite.mock.calls[0]?.[0] as string)).toMatchObject({
      type: 'user',
      message: { role: 'user', content: 'Call done.' },
      parent_tool_use_id: null,
    });

    const stops = events.filter((event) => event.type === 'message_stop');
    expect(stops).toEqual([{ type: 'message_stop', finishReason: 'stop' }]);
    expect(events).toContainEqual({
      type: 'usage',
      promptTokens: 21,
      completionTokens: 8,
      cacheReadTokens: 3,
      cacheCreationTokens: 2,
      costUsd: 0.0042,
    });
  });
});
