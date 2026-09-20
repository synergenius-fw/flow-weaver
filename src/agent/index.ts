/**
 * @synergenius/flow-weaver/agent
 *
 * Provider-agnostic agent loop with MCP bridge for tool execution.
 * Built-in providers: Anthropic API, Claude CLI, OpenAI-compatible (GPT-4o, Groq, Ollama, etc).
 */

// Types
export type {
  SplitPrompt,
  TurnEndContext,
  TurnEndResult,
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

// Prompt utilities
export { joinSplitPrompt, stripMcpToolPrefix } from './types.js';

// Agent loop
export { runAgentLoop } from './agent-loop.js';

// Providers
export { AnthropicProvider, createAnthropicProvider } from './providers/anthropic.js';
export type { AnthropicProviderOptions } from './providers/anthropic.js';
export { ClaudeCliProvider, createClaudeCliProvider } from './providers/claude-cli.js';
export { OpenAICompatProvider, createOpenAICompatProvider } from './providers/openai-compat.js';
export type { OpenAICompatProviderOptions } from './providers/openai-compat.js';

// MCP bridge
export { createMcpBridge } from './mcp-bridge.js';

// CLI session (warm persistent sessions)
export {
  CliSession,
  getOrCreateCliSession,
  killCliSession,
  killAllCliSessions,
} from './cli-session.js';

// CLI spawn configuration (centralized lockdown for automated sessions)
export { getCliBaseArgs, getCliSessionConfig } from './cli-spawn-config.js';

// Env utilities
export { buildSafeEnv, buildSafeSpawnOpts, MINIMAL_PATH, ENV_ALLOWLIST } from './env-allowlist.js';

// Stream parser (for custom providers)
export { StreamJsonParser } from './streaming.js';

// Agent profiles (.flowweaver/agents.yaml) and answering a durable agent gate
export {
  loadAgentProfiles,
  saveAgentProfiles,
  validateProfile,
  profileForGate,
  readiness,
  keyEnvOf,
  agentsFile,
  STARTER_AGENTS_YAML,
  DEFAULT_MODEL,
  DEFAULT_MAX_ITERATIONS,
  SUGGESTED_MODELS,
} from './profiles.js';
export type { AgentProfile, AgentProfiles, AgentProviderKind, Readiness } from './profiles.js';
export { answerGate, tryProfile, providerFor, answerTool, fieldToJsonSchema, systemPromptFor, userMessageFor, answerFromText, SUBMIT_TOOL, REJECT_TOOL } from './gate.js';
export type { GateToAnswer, GateWorkflow, GateOutcome, GateUsage, AgentGateEvent, GateAgentResult, AnswerGateOptions, TryResult } from './gate.js';

