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
  | { type: 'usage'; promptTokens: number; completionTokens: number; cacheReadTokens?: number; cacheCreationTokens?: number; costUsd?: number };

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
// System prompt
// ---------------------------------------------------------------------------

/**
 * Split system prompt for Anthropic API cache optimization.
 *
 * The prefix (stable FW knowledge) is cached across calls via cache_control.
 * The suffix (per-task context) varies per call but rides on the cached prefix.
 *
 * Providers that support structured system blocks (Anthropic) use both parts.
 * Providers that only accept strings (CLI, OpenAI, platform) concatenate them.
 */
export interface SplitPrompt {
  /** Stable prefix — identical across calls. Cacheable. */
  prefix: string;
  /** Dynamic suffix — varies per task/call. Not cached. */
  suffix: string;
}

/** Convert a SplitPrompt to a single string (for providers that don't support blocks). */
export function joinSplitPrompt(prompt: SplitPrompt): string {
  if (!prompt.suffix) return prompt.prefix;
  return prompt.prefix + '\n\n' + prompt.suffix;
}

/**
 * Strip MCP server prefix from a tool name.
 * The CLI registers MCP tools as mcp__<server>__<tool> but internal code
 * uses unprefixed names. Call this before any tool name comparison.
 */
export function stripMcpToolPrefix(name: string): string {
  return name.replace(/^mcp__[a-zA-Z0-9_-]+__/, '');
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export interface StreamOptions {
  systemPrompt?: SplitPrompt;
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

/** Context passed to the onTurnEnd callback after each agent loop iteration. */
export interface TurnEndContext {
  /** Current iteration number (0-based). */
  iteration: number;
  /** Maximum iterations configured. */
  maxIterations: number;
  /** Full conversation history up to this point. */
  messages: ReadonlyArray<AgentMessage>;
  /** Total tool calls executed so far. */
  toolCallCount: number;
  /** Cumulative token usage. */
  usage: { promptTokens: number; completionTokens: number };
  /** true if the model stopped calling tools (final turn). */
  isFinalTurn: boolean;
}

/** Result from the onTurnEnd callback. */
export interface TurnEndResult {
  /** If false, abort the agent loop early. */
  continue?: boolean;
  /** Optional message to inject into the conversation (steering nudge). */
  injectMessage?: string;
}

export interface AgentLoopOptions {
  systemPrompt?: SplitPrompt;
  maxIterations?: number;
  maxTokens?: number;
  model?: string;
  signal?: AbortSignal;
  onToolEvent?: (event: ToolEvent) => void;
  onStreamEvent?: (event: StreamEvent) => void;
  /** Called after each agent loop iteration (between turns and on final turn). */
  onTurnEnd?: (context: TurnEndContext) => Promise<TurnEndResult | void>;
  logger?: Logger;
}

export interface AgentLoopResult {
  success: boolean;
  summary: string;
  messages: AgentMessage[];
  toolCallCount: number;
  usage: { promptTokens: number; completionTokens: number; cacheReadTokens: number; cacheCreationTokens: number; costUsd: number };
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
  /**
   * The only tools the CLI may use, as `--allowed-tools`. An empty list
   * switches every built-in tool off, leaving just the bridged ones -- the
   * lockdown an unattended run needs (see `cli-spawn-config.ts`).
   */
  allowedTools?: string[];
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
  /** When true, ignore user/project MCP servers — only use --mcp-config if provided. */
  strictMcpConfig?: boolean;
  /** Disable specific built-in tools (e.g. ['Read', 'Edit', 'Write', 'Bash'] to force MCP tools). */
  disallowedTools?: string[];
  /**
   * Built-in tools permitted through the Claude CLI's --allowed-tools option.
   * An empty array disables every built-in tool. MCP tools remain governed by
   * the explicit --mcp-config and --strict-mcp-config boundary.
   */
  allowedTools?: string[];
  /** System prompt passed to the CLI via --system-prompt. Overrides the default Claude Code prompt. */
  systemPrompt?: string;
  /**
   * Appended to the active system prompt via --append-system-prompt.
   * Keeps Claude Code's built-in guidance and adds custom instructions.
   * WARNING: If used with systemPrompt, appends to the custom prompt (not the default).
   * Built-in Claude Code guidance is lost when systemPrompt is set.
   */
  appendSystemPrompt?: string;
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
