/**
 * Shared types for the agent loop, providers, and MCP bridge.
 *
 * All types are pure — no runtime imports, no side effects.
 */

import type { ChildProcess } from 'node:child_process';

// ---------------------------------------------------------------------------
// Stream events (canonical union — adopted from platform)
// ---------------------------------------------------------------------------

export type StreamEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'thinking_delta'; text: string }
  | { type: 'tool_use_start'; id: string; name: string }
  | { type: 'tool_use_delta'; id: string; partialJson: string }
  | { type: 'tool_use_end'; id: string; arguments: Record<string, unknown> }
  | { type: 'tool_result'; id: string; result: string; isError: boolean }
  | { type: 'message_stop'; finishReason: 'stop' | 'tool_calls' | 'length' | 'error' }
  | { type: 'usage'; promptTokens: number; completionTokens: number };

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export interface AgentMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string | Array<Record<string, unknown>>;
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  toolCallId?: string;
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: { type: string; properties: Record<string, unknown>; required?: string[] };
}

export type ToolExecutor = (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ result: string; isError: boolean }>;

export interface ToolEvent {
  type: 'tool_call_start' | 'tool_call_result';
  name: string;
  args?: Record<string, unknown>;
  result?: string;
  isError?: boolean;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export interface StreamOptions {
  systemPrompt?: string;
  model?: string;
  maxTokens?: number;
  signal?: AbortSignal;
  /** Tool executor for providers that handle tool loops internally (e.g. CLI via MCP). */
  executor?: ToolExecutor;
  /** Event callback for tool events from internal tool loops. */
  onToolEvent?: (event: ToolEvent) => void;
  /** Per-request timeout in milliseconds (overrides provider default). */
  timeout?: number;
}

export interface AgentProvider {
  stream(
    messages: AgentMessage[],
    tools: ToolDefinition[],
    options?: StreamOptions,
  ): AsyncGenerator<StreamEvent>;
}

// ---------------------------------------------------------------------------
// MCP Bridge
// ---------------------------------------------------------------------------

export interface McpBridge {
  /** Path to the MCP config JSON file — pass to --mcp-config */
  configPath: string;
  /** Update the executor and event callback for a new request */
  setHandlers: (executor: ToolExecutor, onToolEvent?: (event: ToolEvent) => void) => void;
  /** Tear down the socket server and remove temp files */
  cleanup: () => void;
}

// ---------------------------------------------------------------------------
// Agent loop
// ---------------------------------------------------------------------------

export interface AgentLoopOptions {
  systemPrompt?: string;
  maxIterations?: number;
  maxTokens?: number;
  model?: string;
  signal?: AbortSignal;
  onToolEvent?: (event: ToolEvent) => void;
  onStreamEvent?: (event: StreamEvent) => void;
  logger?: Logger;
}

export interface AgentLoopResult {
  success: boolean;
  summary: string;
  messages: AgentMessage[];
  toolCallCount: number;
  usage: { promptTokens: number; completionTokens: number };
}

// ---------------------------------------------------------------------------
// CLI provider options
// ---------------------------------------------------------------------------

export type SpawnFn = (
  command: string,
  args: string[],
  options: { cwd: string; stdio: string[]; env: NodeJS.ProcessEnv },
) => ChildProcess | { child: ChildProcess; cleanup?: () => void };

export interface ClaudeCliProviderOptions {
  /** Absolute path to the claude binary. Defaults to 'claude' (found via PATH). */
  binPath?: string;
  /** Working directory for the CLI process. */
  cwd?: string;
  /** Environment variables for the CLI process. */
  env?: NodeJS.ProcessEnv;
  /** Model override. */
  model?: string;
  /** Pre-configured MCP config path (skips auto-bridge creation). */
  mcpConfigPath?: string;
  /** Custom spawn function. Defaults to child_process.spawn. */
  spawnFn?: SpawnFn;
  /** CLI timeout in milliseconds. Defaults to 120000. */
  timeout?: number;
  /** Disable specific built-in tools (e.g. ['Read', 'Edit', 'Write', 'Bash'] to force MCP tools). */
  disallowedTools?: string[];
}

// ---------------------------------------------------------------------------
// CLI session options
// ---------------------------------------------------------------------------

export interface CliSessionOptions {
  /** Absolute path to the claude binary. */
  binPath: string;
  /** Working directory for the CLI process. */
  cwd: string;
  /** Environment variables for the CLI process. */
  env?: NodeJS.ProcessEnv;
  /** Model to use. */
  model: string;
  /** Pre-configured MCP config path. */
  mcpConfigPath?: string;
  /** Custom spawn function. Defaults to child_process.spawn. */
  spawnFn?: SpawnFn;
  /** Idle timeout in milliseconds. Defaults to 600000 (10 minutes). */
  idleTimeout?: number;
  /** Logger instance. */
  logger?: Logger;
}

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

export interface Logger {
  info(msg: string, data?: unknown): void;
  warn(msg: string, data?: unknown): void;
  error(msg: string, data?: unknown): void;
}
