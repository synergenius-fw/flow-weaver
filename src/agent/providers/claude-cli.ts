/**
 * Claude CLI provider — spawns the Claude Code CLI with stream-json output
 * and MCP bridge for tool execution.
 *
 * Adapted from platform's streamClaudeCliChat. Platform-specific dependencies
 * (spawnSandboxed, getBinPath, config) are replaced with injectable options.
 */

import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import type {
  AgentProvider,
  AgentMessage,
  ToolDefinition,
  StreamEvent,
  StreamOptions,
  ClaudeCliProviderOptions,
  SpawnFn,
} from '../types.js';
import { StreamJsonParser } from '../streaming.js';
import { createMcpBridge } from '../mcp-bridge.js';

export class ClaudeCliProvider implements AgentProvider {
  private binPath: string;
  private cwd: string;
  private env: NodeJS.ProcessEnv;
  private model: string | undefined;
  private mcpConfigPath: string | undefined;
  private spawnFn: SpawnFn;
  private timeout: number;

  constructor(options: ClaudeCliProviderOptions = {}) {
    this.binPath = options.binPath ?? 'claude';
    this.cwd = options.cwd ?? process.cwd();
    this.env = options.env ?? process.env;
    this.model = options.model;
    this.mcpConfigPath = options.mcpConfigPath;
    this.spawnFn = options.spawnFn ?? ((cmd: string, args: string[], opts: { cwd: string; stdio: string[]; env: NodeJS.ProcessEnv }) =>
      nodeSpawn(cmd, args, { ...opts, stdio: opts.stdio as ('pipe' | 'inherit' | 'ignore')[] }) as ChildProcess);
    this.timeout = options.timeout ?? 600_000;
  }

  async *stream(
    messages: AgentMessage[],
    tools: ToolDefinition[],
    options?: StreamOptions,
  ): AsyncGenerator<StreamEvent> {
    const model = options?.model ?? this.model;

    // Format messages into a single prompt for -p mode
    const prompt = formatPrompt(messages);
    const systemPrompt = options?.systemPrompt;

    // Set up MCP bridge for tool access if tools are provided and no config given
    let bridge: Awaited<ReturnType<typeof createMcpBridge>> | null = null;
    let mcpConfigPath = this.mcpConfigPath;

    if (tools.length > 0 && !mcpConfigPath) {
      // Create MCP bridge with real executor so CLI tool calls go through our
      // safety guards (path traversal, shrink detection, shell blocklist, etc.)
      const executor = options?.executor ?? (async () => ({ result: 'Tool executor not provided', isError: true }));
      bridge = await createMcpBridge(
        tools,
        executor,
        options?.onToolEvent,
      );
      mcpConfigPath = bridge.configPath;
    }

    const args = [
      '-p',
      '--verbose',
      '--output-format',
      'stream-json',
      '--include-partial-messages',
      '--setting-sources',
      'user,local',
      '--dangerously-skip-permissions',
      '--permission-mode',
      'bypassPermissions',
      ...(systemPrompt ? ['--system-prompt', systemPrompt] : []),
      ...(mcpConfigPath ? ['--mcp-config', mcpConfigPath, '--strict-mcp-config'] : []),
      ...(model ? ['--model', model] : []),
    ];

    // Spawn the CLI process
    const spawnResult = this.spawnFn(
      this.binPath,
      args,
      { cwd: this.cwd, stdio: ['pipe', 'pipe', 'pipe'], env: this.env },
    );
    const child = 'child' in spawnResult ? spawnResult.child : spawnResult;
    const spawnCleanup = 'cleanup' in spawnResult ? (spawnResult as { cleanup?: () => void }).cleanup : undefined;

    const signal = options?.signal;
    if (signal) {
      signal.addEventListener(
        'abort',
        () => {
          child.kill('SIGTERM');
          setTimeout(() => {
            if (!child.killed) child.kill('SIGKILL');
          }, 2000);
        },
        { once: true },
      );
    }

    // Timeout — per-request override or provider default
    const timeout = options?.timeout ?? this.timeout;
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
    }, timeout);

    child.stdin!.write(prompt);
    child.stdin!.end();

    // Collect events from the parser
    const events: StreamEvent[] = [];
    let done = false;

    const parser = new StreamJsonParser((event) => {
      events.push(event);
    });

    let stderrBuf = '';
    child.stderr!.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString();
    });

    let stdoutBuffer = '';
    child.stdout!.on('data', (chunk: Buffer) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() || '';
      for (const line of lines) {
        parser.feed(line);
      }
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      // Process remaining buffer
      if (stdoutBuffer.trim()) {
        parser.feed(stdoutBuffer);
      }
      if (code !== 0 && !parser.hasText && stderrBuf.trim()) {
        events.push({ type: 'text_delta', text: `Claude CLI error: ${stderrBuf.trim().slice(0, 500)}` });
      }
      if (!events.some((e) => e.type === 'message_stop')) {
        events.push({ type: 'message_stop', finishReason: code === 0 ? 'stop' : 'error' });
      }
      done = true;
    });

    child.on('error', () => {
      clearTimeout(timer);
      events.push({ type: 'message_stop', finishReason: 'error' });
      done = true;
    });

    // Yield events as they become available
    try {
      while (!done || events.length > 0) {
        if (events.length > 0) {
          yield events.shift()!;
        } else {
          await new Promise((r) => setTimeout(r, 10));
        }
      }
    } finally {
      bridge?.cleanup();
      spawnCleanup?.();
    }
  }
}

/**
 * Format agent messages into a single prompt string for the CLI's -p mode.
 */
function formatPrompt(messages: AgentMessage[]): string {
  const parts: string[] = [];
  for (const msg of messages) {
    if (msg.role === 'user') {
      parts.push(`User: ${typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)}\n`);
    } else if (msg.role === 'assistant') {
      parts.push(`Assistant: ${typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)}\n`);
    } else if (msg.role === 'tool') {
      parts.push(`Tool result (${msg.toolCallId}): ${typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)}\n`);
    }
  }
  return parts.join('\n');
}

export function createClaudeCliProvider(options?: ClaudeCliProviderOptions): ClaudeCliProvider {
  return new ClaudeCliProvider(options);
}
