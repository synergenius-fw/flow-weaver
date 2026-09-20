/**
 * Persistent CLI session manager that eliminates cold-start delay by keeping
 * the Claude CLI process alive between messages.
 *
 * Instead of spawning a new CLI process per message (~5s cold start + MCP
 * handshake), we spawn once with `--input-format stream-json` and feed
 * messages via stdin. The CLI maintains conversation context internally.
 *
 * KEY LEARNINGS (Claude Code CLI v2.1.76):
 *
 * 1. Stdin message format (NDJSON):
 *    {"type":"user","message":{"role":"user","content":"..."},"parent_tool_use_id":null}
 *
 * 2. The CLI stays alive between messages when stdin is kept open.
 *    Each message gets its own system/init → stream_events → result cycle.
 *
 * 3. Turn boundary: the `result` event marks the end of a CLI turn, NOT
 *    `message_stop` from stream_event.
 *
 * 4. The CLI uses NDJSON for MCP stdio transport (not Content-Length framing).
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { StreamEvent, CliSessionOptions, Logger } from './types.js';
import type { SpawnFn } from './types.js';
import { StreamJsonParser } from './streaming.js';

const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

// Package version included in session fingerprint so cached sessions
// auto-invalidate when the core is updated (e.g. npm update).
let CORE_VERSION = 'unknown';
try {
  const pkgPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../package.json');
  CORE_VERSION = JSON.parse(readFileSync(pkgPath, 'utf-8')).version;
} catch { /* non-fatal */ }

// ---------------------------------------------------------------------------
// CliSession: persistent CLI process
// ---------------------------------------------------------------------------

interface ActiveTurn {
  resolve: () => void;
  events: StreamEvent[];
  done: boolean;
}

export class CliSession {
  readonly sessionId = randomUUID();
  private child: ChildProcess | null = null;
  private alive = false;
  private stderrBuf = '';
  private stdoutBuffer = '';
  private activeTurn: ActiveTurn | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private cleanupFn: (() => void) | null = null;
  private parser: StreamJsonParser;
  private readonly log: Logger | undefined;
  private readonly spawnFn: SpawnFn;
  private readonly idleTimeout: number;
  private readonly opts: CliSessionOptions;

  constructor(options: CliSessionOptions) {
    this.opts = options;
    this.log = options.logger;
    this.spawnFn = options.spawnFn ?? ((cmd: string, args: string[], opts: { cwd: string; stdio: string[]; env: NodeJS.ProcessEnv }) =>
      nodeSpawn(cmd, args, { ...opts, stdio: opts.stdio as ('pipe' | 'inherit' | 'ignore')[] }) as ChildProcess);
    this.idleTimeout = options.idleTimeout ?? DEFAULT_IDLE_TIMEOUT_MS;

    // Parser delegates to pushEvent which routes to activeTurn
    this.parser = new StreamJsonParser((event) => this.pushEvent(event));
  }

  get ready(): boolean {
    return this.alive;
  }

  /**
   * Check if this session was created with equivalent CLI-relevant options.
   * Used by the session cache to detect option drift.
   */
  matchesOptions(other: CliSessionOptions): boolean {
    return CliSession.fingerprint(this.opts) === CliSession.fingerprint(other);
  }

  /**
   * Inject a mock child process for testing.
   * @internal test only
   */
  _injectForTest(child: ChildProcess): void {
    this.child = child;
    this.alive = true;
    this.stderrBuf = '';
    this.stdoutBuffer = '';
    child.stdout!.on('data', (chunk: Buffer) => {
      this.onStdoutData(chunk.toString());
    });
    child.on('exit', () => this.markDead());
    child.on('error', () => this.markDead());
  }

  /**
   * Spawn the CLI process. Must be called before send().
   */
  async spawn(): Promise<void> {
    // Kill existing child to prevent orphaned processes from concurrent spawn
    if (this.child && this.alive) {
      this.child.kill('SIGTERM');
    }

    const { binPath, cwd, env, model, mcpConfigPath } = this.opts;

    const args = [
      '-p',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--include-partial-messages',
      '--verbose',
      '--dangerously-skip-permissions',
      '--permission-mode',
      'bypassPermissions',
      '--setting-sources',
      'user,local',
      '--model',
      model,
    ];

    if (mcpConfigPath) {
      args.push('--mcp-config', mcpConfigPath);
    }
    if (this.opts.strictMcpConfig || mcpConfigPath) {
      args.push('--strict-mcp-config');
    }

    const { disallowedTools, allowedTools, systemPrompt, appendSystemPrompt } = this.opts;
    if (disallowedTools && disallowedTools.length > 0) {
      args.push('--disallowed-tools', disallowedTools.join(','));
    }

    // The current CLI contract uses --allowed-tools. Passing an empty value
    // disables all built-in tools while the strict MCP config remains usable.
    if (allowedTools !== undefined) {
      args.push('--allowed-tools', allowedTools.join(','));
    }

    if (systemPrompt) {
      args.push('--system-prompt', systemPrompt);
    }

    // Phase 1.2: --append-system-prompt flag
    if (appendSystemPrompt) {
      args.push('--append-system-prompt', appendSystemPrompt);
    }

    const spawnResult = this.spawnFn(
      binPath,
      args,
      { cwd, stdio: ['pipe', 'pipe', 'pipe'], env: env ?? process.env },
    );
    const child = 'child' in spawnResult ? spawnResult.child : spawnResult;
    const cleanup = 'cleanup' in spawnResult ? (spawnResult as { cleanup?: () => void }).cleanup : undefined;

    this.child = child;
    this.cleanupFn = cleanup ?? null;
    this.alive = true;
    this.stderrBuf = '';
    this.stdoutBuffer = '';

    child.stderr!.on('data', (chunk: Buffer) => {
      this.stderrBuf += chunk.toString();
    });

    child.stdout!.on('data', (chunk: Buffer) => {
      this.onStdoutData(chunk.toString());
    });

    child.on('exit', (code) => {
      this.log?.info('CLI session process exited', { sessionId: this.sessionId, exitCode: code });
      this.markDead();
    });

    child.on('error', (err) => {
      this.log?.error('CLI session process error', { sessionId: this.sessionId, err });
      this.markDead();
    });

    this.resetIdleTimer();
    this.log?.info('CLI session spawned', { sessionId: this.sessionId, cwd, model });
  }

  /**
   * Send a user message and stream back events.
   * Auto-respawns if the process has died.
   *
   * Phase 1.3: Concurrent send() guard that throws if a previous turn is still active.
   * The activeTurn lock is claimed synchronously BEFORE any async work (spawn)
   * to prevent TOCTOU races.
   */
  async *send(userMessage: string, systemPromptPrefix?: string): AsyncGenerator<StreamEvent> {
    // Phase 1.3: Guard against concurrent sends
    if (this.activeTurn) {
      throw new Error('CliSession: concurrent send() calls are not supported. Previous turn still active.');
    }

    // Claim the turn synchronously BEFORE any await to prevent TOCTOU race
    const turn: ActiveTurn = { resolve: () => {}, events: [], done: false };
    this.activeTurn = turn;

    try {
      if (!this.alive) {
        this.log?.info('CLI session dead, respawning', { sessionId: this.sessionId });
        await this.spawn();
      }

      this.resetIdleTimer();
      this.parser.reset();

      const content = systemPromptPrefix ? `${systemPromptPrefix}\n\n${userMessage}` : userMessage;

      // Write NDJSON message to stdin
      const ndjsonMessage =
        JSON.stringify({
          type: 'user',
          message: { role: 'user', content },
          parent_tool_use_id: null,
        }) + '\n';

      // Track whether this turn saw a 'result' event (definitive turn end)
      let sawResult = false;

      // Wrap pushEvent to suppress intermediate message_stop events.
      // The CLI emits message_stop for each API turn, but the session's turn
      // boundary is the `result` event. Intermediate message_stop events would
      // cause runAgentLoop to exit early (thinking the model stopped), missing
      // later events including the result's usage with total_cost_usd.
      const originalPush = this.pushEvent.bind(this);
      this.parser = new StreamJsonParser((event) => {
        if (event.type === 'message_stop' && !sawResult && event.finishReason !== 'error') {
          // Suppress — not the real turn end. The result event will emit
          // the final message_stop after all usage data is captured.
          // Error stops (e.g. authentication_failed) must pass through
          // so runAgentLoop can detect the failure.
          return;
        }
        originalPush(event);
      });

      // Override parser feed to detect result events for turn completion
      let sawTerminal = false;
      const baseFeed = this.parser.feed.bind(this.parser);
      this.parser.feed = (line: string) => {
        // Check if this line is a turn-ending event before parsing
        try {
          let parsed = JSON.parse(line);
          if (parsed.type === 'stream_event' && parsed.event) parsed = parsed.event;
          if (parsed.type === 'result') {
            sawResult = true;
            sawTerminal = true;
          }
          // authentication_failed is also a terminal event
          if (parsed.type === 'assistant' && parsed.error === 'authentication_failed') {
            sawTerminal = true;
          }
        } catch {
          // Not JSON, let parser handle it
        }
        baseFeed(line);
        if (sawTerminal) {
          this.completeTurn();
        }
      };

      try {
        this.child!.stdin!.write(ndjsonMessage, (err) => {
          if (err) {
            this.log?.error('stdin write error', { sessionId: this.sessionId, err });
            this.markDead();
            turn.done = true;
            turn.resolve();
          }
        });
      } catch (err) {
        this.log?.error('stdin write exception', { sessionId: this.sessionId, err });
        this.markDead();
        throw new Error('CLI session stdin write failed');
      }

      // Yield events as they arrive
      while (!turn.done || turn.events.length > 0) {
        if (turn.events.length > 0) {
          yield turn.events.shift()!;
        } else {
          await new Promise<void>((r) => {
            turn.resolve = r;
            setTimeout(r, 50);
          });
        }
      }

      // Yield any remaining events
      while (turn.events.length > 0) {
        yield turn.events.shift()!;
      }
    } finally {
      // Log how the turn ended for debugging cost/result event issues.
      // If turn.done is false here, the generator was abandoned by the consumer
      // (e.g., for-await broke out) before completeTurn/markDead fired.
      // This means the result event hasn't been processed yet, and any
      // subsequent stdout data (including the result) will be silently dropped
      // because activeTurn is about to be set to null.
      if (!turn.done) {
        process.stderr.write(`\x1b[33m  CliSession: generator abandoned before turn.done (events=${turn.events.length}). Result event will be lost.\x1b[0m\n`);
      }
      this.activeTurn = null;
      this.resetIdleTimer();
    }
  }

  /** Whether a send() call is currently active. */
  get hasActiveTurn(): boolean {
    return this.activeTurn !== null && !this.activeTurn.done;
  }

  /**
   * Kill the CLI process.
   */
  kill(): void {
    if (this.hasActiveTurn) {
      process.stderr.write(`\x1b[31m  ✗ CliSession.kill() called with active turn, so data loss will occur (session=${this.sessionId.slice(0, 8)})\x1b[0m\n`);
      this._onSessionKilled?.({ sessionId: this.sessionId, hadActiveTurn: true, eventsInTurn: this.activeTurn!.events.length });
    }
    this.clearIdleTimer();
    if (this.child && this.alive) {
      this.log?.info('Killing CLI session', { sessionId: this.sessionId });
      this.child.kill('SIGTERM');
      // Phase 1.5: unref the SIGKILL fallback timer so it doesn't keep Node alive
      const sigkillTimer = setTimeout(() => {
        if (this.child && !this.child.killed) {
          this.child.kill('SIGKILL');
        }
      }, 2000);
      sigkillTimer.unref();
    }
    this.markDead();
  }

  /** Callback for session kill events — wire to audit logging. */
  private _onSessionKilled?: (info: { sessionId: string; hadActiveTurn: boolean; eventsInTurn: number }) => void;

  /** Register a callback that fires when this session is killed. */
  set onSessionKilled(cb: ((info: { sessionId: string; hadActiveTurn: boolean; eventsInTurn: number }) => void) | undefined) {
    this._onSessionKilled = cb;
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /**
   * Compute a fingerprint of CLI-relevant options for cache comparison.
   * Field order is significant for JSON.stringify comparison.
   * Add new CLI-relevant fields here when they're added to CliSessionOptions.
   *
   * NOTE: mcpConfigPath is EXCLUDED. It's an ephemeral temp path that changes
   * on every createMcpBridge() call. Including it causes fingerprint mismatches
   * that kill active sessions mid-turn when a second provider is created for
   * the same project (e.g., orchestrator + worker sharing the same projectDir).
   * The MCP bridge is swapped per-request via setHandlers() — the config path
   * is only needed at spawn time, not for session identity.
   */
  private static fingerprint(options: CliSessionOptions): string {
    return JSON.stringify({
      _coreVersion: CORE_VERSION, // auto-invalidate cache on core update
      model: options.model,
      // mcpConfigPath deliberately excluded — see comment above
      strictMcpConfig: options.strictMcpConfig,
      disallowedTools: options.disallowedTools,
      allowedTools: options.allowedTools,
      systemPrompt: options.systemPrompt,
      appendSystemPrompt: options.appendSystemPrompt,
    });
  }

  private pushEvent(event: StreamEvent): void {
    if (!this.activeTurn) return;
    this.activeTurn.events.push(event);
    this.activeTurn.resolve();
  }

  private completeTurn(): void {
    if (!this.activeTurn) return;
    this.activeTurn.done = true;
    this.activeTurn.resolve();
  }

  private markDead(): void {
    // Phase 1.5: Clear idle timer to prevent dangling timer on process crash
    this.clearIdleTimer();
    this.alive = false;
    this.cleanupFn?.();
    this.cleanupFn = null;
    if (this.activeTurn && !this.activeTurn.done) {
      // KNOWN ISSUE: On long orchestrator runs (many MCP tool calls), the CLI
      // process can die before emitting the `result` event. This means:
      // - costUsd from total_cost_usd is lost (stays 0)
      // - cacheReadTokens / cacheCreationTokens are lost
      // - The turn ends via markDead instead of completeTurn
      // When this happens, consumers should fall back to cost-update events
      // from the global usage callback for accurate cost tracking.
      // See: project_costUsd_bench_issue.md in memory for full investigation.
      const eventCount = this.activeTurn.events.length;
      const hasResult = this.activeTurn.events.some((e) => e.type === 'usage' && (e as Record<string, unknown>).costUsd != null);
      if (!hasResult) {
        const lastStderr = this.stderrBuf.slice(-500);
        this.log?.warn('CLI session died before result event, so costUsd will be 0', {
          sessionId: this.sessionId,
          eventsInTurn: eventCount,
          lastStderr: lastStderr || '(empty)',
        });
        // Always log to stderr so it's visible in bench output
        process.stderr.write(`\x1b[33m  CLI session died before result event (${eventCount} events buffered). costUsd will be 0. stderr: ${lastStderr.slice(0, 200)}\x1b[0m\n`);
      }
      if (!this.activeTurn.events.some((e) => e.type === 'message_stop')) {
        this.activeTurn.events.push({ type: 'message_stop', finishReason: 'error' });
      }
      this.activeTurn.done = true;
      this.activeTurn.resolve();
    }
  }

  private onStdoutData(data: string): void {
    this.stdoutBuffer += data;
    const lines = this.stdoutBuffer.split('\n');
    this.stdoutBuffer = lines.pop() || '';
    for (const line of lines) {
      this.parser.feed(line);
    }
  }

  private resetIdleTimer(): void {
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      this.log?.info('CLI session idle timeout, killing', { sessionId: this.sessionId });
      this.kill();
    }, this.idleTimeout);
    // Phase 1.5: unref so idle timer doesn't keep Node alive on shutdown
    this.idleTimer.unref();
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }
}

// ---------------------------------------------------------------------------
// Session manager — cache keyed by identifier
// ---------------------------------------------------------------------------

const sessions = new Map<string, CliSession>();

/**
 * Get an existing session or create a new one.
 * Phase 1.4: Validates that cached sessions have matching CLI-relevant options.
 * If options changed on the same key, the old session is killed and recreated.
 *
 * SAFETY: Refuses to kill a session with an active turn. This prevents data
 * loss when multiple providers share the same session key (e.g., orchestrator
 * and worker both using projectDir as key). If the fingerprint doesn't match
 * but the session has an active turn, we return the existing session and log
 * a warning — better to reuse a session with slightly different options than
 * to kill an active conversation and lose costUsd/result data.
 */
export function getOrCreateCliSession(
  key: string,
  options: CliSessionOptions,
): CliSession {
  const existing = sessions.get(key);
  if (existing && existing.ready) {
    // Phase 1.4: Check if CLI-relevant options match
    if (existing.matchesOptions(options)) {
      return existing;
    }
    // Options changed, but REFUSE to kill if there's an active turn
    if (existing.hasActiveTurn) {
      process.stderr.write(`\x1b[33m  getOrCreateCliSession: fingerprint mismatch on key "${key}" but session has active turn. Reusing existing session to prevent data loss\x1b[0m\n`);
      return existing;
    }
    // No active turn, so it is safe to kill and recreate
    process.stderr.write(`\x1b[2m  [session-cache] killing session for key "${key}", fingerprint changed\x1b[0m\n`);
    existing.kill();
    sessions.delete(key);
  } else if (existing) {
    // Kill stale (dead) session
    existing.kill();
    sessions.delete(key);
  }

  const session = new CliSession(options);
  sessions.set(key, session);
  return session;
}

/**
 * Kill a specific session.
 */
export function killCliSession(key: string): void {
  const session = sessions.get(key);
  if (session) {
    session.kill();
    sessions.delete(key);
  }
}

/**
 * Kill all CLI sessions (for shutdown).
 */
export function killAllCliSessions(): void {
  for (const [, session] of sessions) {
    session.kill();
  }
  sessions.clear();
}
