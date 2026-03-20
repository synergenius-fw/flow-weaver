/**
 * Persistent CLI session manager — eliminates cold-start delay by keeping
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
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import type { StreamEvent, CliSessionOptions, Logger } from './types.js';
import type { SpawnFn } from './types.js';
import { StreamJsonParser } from './streaming.js';

const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

// ---------------------------------------------------------------------------
// CliSession — persistent CLI process
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

  constructor(private readonly options: CliSessionOptions) {
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
   * Inject a mock child process for testing.
   * @internal — test only
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
    const { binPath, cwd, env, model, mcpConfigPath } = this.options;

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
      args.push('--mcp-config', mcpConfigPath, '--strict-mcp-config');
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
   */
  async *send(userMessage: string, systemPromptPrefix?: string): AsyncGenerator<StreamEvent> {
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

    const turn: ActiveTurn = { resolve: () => {}, events: [], done: false };
    this.activeTurn = turn;

    // Track whether this turn saw a 'result' event (definitive turn end)
    let sawResult = false;

    // Wrap pushEvent to detect result-driven message_stop as turn end
    const originalPush = this.pushEvent.bind(this);
    this.parser = new StreamJsonParser((event) => {
      // The result event emits message_stop — but in session mode,
      // we need to detect it as the turn boundary
      if (event.type === 'message_stop' && !sawResult) {
        // This is a stream_event message_stop (API turn), not CLI turn end.
        // Push it but don't complete the turn.
        originalPush(event);
        return;
      }
      originalPush(event);
    });

    // Override parser feed to detect result events for turn completion
    const baseFeed = this.parser.feed.bind(this.parser);
    this.parser.feed = (line: string) => {
      // Check if this line is a result event before parsing
      try {
        let parsed = JSON.parse(line);
        if (parsed.type === 'stream_event' && parsed.event) parsed = parsed.event;
        if (parsed.type === 'result') {
          sawResult = true;
        }
      } catch {
        // Not JSON, let parser handle it
      }
      baseFeed(line);
      if (sawResult) {
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

    this.activeTurn = null;
    this.resetIdleTimer();
  }

  /**
   * Kill the CLI process.
   */
  kill(): void {
    this.clearIdleTimer();
    if (this.child && this.alive) {
      this.log?.info('Killing CLI session', { sessionId: this.sessionId });
      this.child.kill('SIGTERM');
      setTimeout(() => {
        if (this.child && !this.child.killed) {
          this.child.kill('SIGKILL');
        }
      }, 2000);
    }
    this.markDead();
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

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
    this.alive = false;
    this.cleanupFn?.();
    this.cleanupFn = null;
    if (this.activeTurn && !this.activeTurn.done) {
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
 */
export function getOrCreateCliSession(
  key: string,
  options: CliSessionOptions,
): CliSession {
  const existing = sessions.get(key);
  if (existing && existing.ready) {
    return existing;
  }

  // Kill stale session if present
  if (existing) {
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
