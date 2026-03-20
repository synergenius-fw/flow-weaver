/**
 * @synergenius/flow-weaver/agent
 *
 * Provider-agnostic agent loop with MCP bridge for tool execution.
 * Two built-in providers: Anthropic API (raw fetch) and Claude CLI.
 */

// Types
export type {
  StreamEvent,
  AgentMessage,
  AgentProvider,
  ToolDefinition,
  ToolExecutor,
  ToolEvent,
  McpBridge,
  AgentLoopOptions,
  AgentLoopResult,
  StreamOptions,
  SpawnFn,
  ClaudeCliProviderOptions,
  CliSessionOptions,
  Logger,
} from './types.js';

// Agent loop
export { runAgentLoop } from './agent-loop.js';

// Providers
export { AnthropicProvider, createAnthropicProvider } from './providers/anthropic.js';
export type { AnthropicProviderOptions } from './providers/anthropic.js';
export { ClaudeCliProvider, createClaudeCliProvider } from './providers/claude-cli.js';

// MCP bridge
export { createMcpBridge } from './mcp-bridge.js';

// CLI session (warm persistent sessions)
export {
  CliSession,
  getOrCreateCliSession,
  killCliSession,
  killAllCliSessions,
} from './cli-session.js';

// Env utilities
export { buildSafeEnv, buildSafeSpawnOpts, MINIMAL_PATH, ENV_ALLOWLIST } from './env-allowlist.js';

// Stream parser (for custom providers)
export { StreamJsonParser } from './streaming.js';
