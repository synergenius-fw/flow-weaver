/**
 * Verifies that CliSession.send() yields usage events with costUsd
 * from the CLI's result event. Uses a real CLI process.
 *
 * This test catches:
 * - Intermediate message_stop not suppressed (costUsd never reached)
 * - StreamJsonParser not extracting total_cost_usd
 * - CliSession not yielding the result event's usage
 */

import { describe, it, expect, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { CliSession } from '../../src/agent/cli-session.js';
import { createMcpBridge } from '../../src/agent/mcp-bridge.js';
import { getCliSessionConfig } from '../../src/agent/cli-spawn-config.js';
import type { StreamEvent, McpBridge } from '../../src/agent/types.js';

// Skip in CI — requires a real `claude` CLI binary with valid credentials
const hasClaude = (() => { try { execSync('which claude', { stdio: 'ignore' }); return true; } catch { return false; } })();

let bridge: McpBridge | null = null;
let session: CliSession | null = null;

afterEach(() => {
  session?.kill();
  bridge?.cleanup();
  session = null;
  bridge = null;
});

describe.skipIf(!hasClaude)('CliSession cost from CLI result event', () => {
  it('yields usage event with costUsd > 0 from result event', async () => {
    const tools = [
      { name: 'done', description: 'Done', inputSchema: { type: 'object' as const, properties: { summary: { type: 'string' } }, required: ['summary'] as const } },
    ];

    bridge = await createMcpBridge(tools, async () => ({ result: 'ok', isError: false }));

    const opts = getCliSessionConfig({
      cwd: process.cwd(),
      model: 'claude-sonnet-4-6',
      mcpConfigPath: bridge.configPath,
      appendSystemPrompt: 'Call done immediately with summary "test".',
    });

    session = new CliSession(opts);
    await session.spawn();

    const usageEvents: StreamEvent[] = [];
    let messageStopCount = 0;

    for await (const event of session.send('Call done.')) {
      if (event.type === 'usage') usageEvents.push(event);
      if (event.type === 'message_stop') messageStopCount++;
    }

    // Only ONE message_stop (intermediate ones suppressed)
    expect(messageStopCount).toBe(1);

    // At least one usage event should have costUsd
    const withCost = usageEvents.filter(e => (e as any).costUsd != null && (e as any).costUsd > 0);
    expect(withCost.length).toBeGreaterThan(0);

    const lastCost = withCost[withCost.length - 1] as any;
    expect(lastCost.costUsd).toBeGreaterThan(0);
    expect(typeof lastCost.costUsd).toBe('number');
  }, 60_000);
});
