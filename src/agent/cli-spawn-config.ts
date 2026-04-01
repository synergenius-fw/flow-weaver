/**
 * Centralized CLI spawn configuration — single source of truth for all
 * Claude CLI invocations in automation contexts.
 *
 * RULE: Every automated CLI spawn MUST use getCliBaseArgs() or getCliSessionConfig().
 * Never construct CLI args manually. This ensures:
 * - --tools "" (disable all built-in tools)
 * - --strict-mcp-config (prevent user MCP server leakage)
 * - --dangerously-skip-permissions (no permission prompts in automation)
 *
 * Interactive user sessions (e.g., fw init) are exempt — they're the user's
 * own Claude session, not automated workers.
 */

import type { CliSessionOptions } from './types.js';

/**
 * Base CLI args for ALL automated Claude CLI invocations (one-shot and session).
 * Enforces tool isolation and MCP lockdown.
 */
export function getCliBaseArgs(options?: {
  model?: string;
  systemPrompt?: string;
  appendSystemPrompt?: string;
  outputFormat?: 'stream-json' | 'json' | 'text';
  includePartialMessages?: boolean;
  jsonSchema?: string;
}): string[] {
  const args = [
    '-p',
    '--dangerously-skip-permissions',
    // Disable ALL built-in tools — only pack/MCP tools visible to model
    '--tools', '',
    // Prevent user/project MCP servers from leaking into sessions
    '--strict-mcp-config',
  ];

  if (options?.outputFormat) {
    args.push('--output-format', options.outputFormat);
  }
  if (options?.includePartialMessages) {
    args.push('--include-partial-messages');
  }
  if (options?.model) {
    args.push('--model', options.model);
  }
  if (options?.systemPrompt) {
    args.push('--system-prompt', options.systemPrompt);
  }
  if (options?.appendSystemPrompt) {
    args.push('--append-system-prompt', options.appendSystemPrompt);
  }
  if (options?.jsonSchema) {
    args.push('--json-schema', options.jsonSchema);
  }
  return args;
}

/**
 * CLI session options for persistent sessions.
 * Merges caller options with mandatory lockdown config.
 */
export function getCliSessionConfig(options: {
  binPath?: string;
  cwd: string;
  model: string;
  mcpConfigPath?: string;
  disallowedTools?: string[];
  appendSystemPrompt?: string;
  systemPrompt?: string;
}): CliSessionOptions {
  return {
    binPath: options.binPath ?? 'claude',
    cwd: options.cwd,
    model: options.model,
    mcpConfigPath: options.mcpConfigPath,
    disallowedTools: options.disallowedTools,
    // Mandatory lockdown — cannot be overridden by callers
    tools: '',
    strictMcpConfig: true,
    appendSystemPrompt: options.appendSystemPrompt,
    systemPrompt: options.systemPrompt,
  };
}
