/**
 * Full path test: CliSession → CliSessionProvider (with bridge) → runAgentLoop
 * Verifies costUsd flows through the entire chain.
 *
 * This is the EXACT path the orchestrator uses in the bench.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { CliSession, getOrCreateCliSession } from '../../src/agent/cli-session.js';
import { createMcpBridge } from '../../src/agent/mcp-bridge.js';
import { getCliSessionConfig } from '../../src/agent/cli-spawn-config.js';
import { runAgentLoop } from '../../src/agent/agent-loop.js';
import type { AgentProvider, AgentMessage, ToolDefinition, StreamEvent, StreamOptions, McpBridge, ToolEvent } from '../../src/agent/types.js';
import { joinSplitPrompt } from '../../src/agent/types.js';

// This is a live credentialed compatibility probe, not a deterministic unit
// test. Presence of a `claude` binary is not a capability contract: it may be
// unauthenticated, a different CLI generation, or point at a user account.
// Requiring an explicit opt-in keeps normal CI and developer test runs from
// hanging/retrying against ambient credentials.
const runLiveClaudeProbe = process.env['FLOW_WEAVER_RUN_CLI_COST_TEST'] === '1';

// Minimal CliSessionProvider replica — same logic as pack-weaver's
const TOOL_USE_EVENT_TYPES = new Set(['tool_use_start', 'tool_use_delta', 'tool_use_end']);

class TestCliSessionProvider implements AgentProvider {
  private sentCount = 0;
  constructor(
    private session: CliSession,
    private bridge: McpBridge,
  ) {}

  async *stream(messages: AgentMessage[], _tools: ToolDefinition[], options?: StreamOptions): AsyncGenerator<StreamEvent> {
    if (!this.session.ready) await this.session.spawn();

    if (options?.executor) {
      this.bridge.setHandlers(options.executor, options.onToolEvent);
    }

    const newMessages = messages.slice(this.sentCount);
    this.sentCount = messages.length;

    const prompt = newMessages
      .map(m => {
        if (m.role === 'user') return typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
        if (m.role === 'tool') return `Tool result (${m.toolCallId}): ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`;
        return '';
      })
      .filter(Boolean)
      .join('\n');

    if (!prompt) return;

    const splitPrompt = this.sentCount <= messages.length ? options?.systemPrompt : undefined;
    const systemPromptStr = splitPrompt ? joinSplitPrompt(splitPrompt) : undefined;

    for await (const event of this.session.send(prompt, systemPromptStr)) {
      if (TOOL_USE_EVENT_TYPES.has(event.type)) continue; // bridge handled
      yield event;
    }
  }
}

let bridge: McpBridge | null = null;
let session: CliSession | null = null;

afterEach(() => {
  session?.kill();
  bridge?.cleanup();
  session = null;
  bridge = null;
});

describe.skipIf(!runLiveClaudeProbe)('CliSessionProvider + bridge + runAgentLoop → costUsd', () => {
  it('result.usage.costUsd > 0 through full provider chain', async () => {
    const tools: ToolDefinition[] = [
      { name: 'done', description: 'Done', inputSchema: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] } },
    ];

    const executor = async (_name: string, _args: Record<string, unknown>) => ({ result: 'ok', isError: false });

    bridge = await createMcpBridge(tools, executor);
    session = new CliSession(getCliSessionConfig({
      cwd: process.cwd(),
      model: 'claude-sonnet-4-6',
      mcpConfigPath: bridge.configPath,
      appendSystemPrompt: 'Call done immediately with summary "test".',
    }));
    await session.spawn();

    const provider = new TestCliSessionProvider(session, bridge);

    const toolEvents: ToolEvent[] = [];
    const result = await runAgentLoop(
      provider,
      tools,
      executor,
      [{ role: 'user', content: 'Call done.' }],
      {
        systemPrompt: { prefix: 'Call done immediately.', suffix: '' },
        maxIterations: 5,
        onToolEvent: (e) => toolEvents.push(e),
      },
    );

    expect(result.success).toBe(true);
    expect(result.usage.costUsd).toBeGreaterThan(0);
    expect(typeof result.usage.costUsd).toBe('number');
    expect(result.usage.cacheReadTokens).toBeTypeOf('number');
    expect(result.usage.cacheCreationTokens).toBeTypeOf('number');
  }, 60_000);
});
