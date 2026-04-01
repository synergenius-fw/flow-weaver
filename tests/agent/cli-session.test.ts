/**
 * Tests for CliSession — persistent CLI session manager.
 *
 * Covers:
 * - PR #312: disallowedTools + systemPrompt flag passing
 * - Phase 1.1: --tools flag (whitelist / disable all built-ins)
 * - Phase 1.2: --append-system-prompt flag
 * - Phase 1.3: Concurrent send() guard
 * - Phase 1.4: Session cache option fingerprint validation
 * - Phase 1.5: Idle timeout cleanup (clearIdleTimer in markDead, unref timers)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { CliSession, getOrCreateCliSession, killAllCliSessions } from '../../src/agent/cli-session.js';
import type { CliSessionOptions } from '../../src/agent/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a mock spawn function that captures args. */
function createMockSpawn() {
  const calls: { cmd: string; args: string[] }[] = [];
  const fn = vi.fn((cmd: string, args: string[]) => {
    calls.push({ cmd, args });
    return {
      stdin: { write: vi.fn(), end: vi.fn(), on: vi.fn() },
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn(),
      kill: vi.fn(),
      pid: 12345,
    };
  });
  return { fn, calls };
}

/** Default options factory. */
function baseOptions(overrides: Partial<CliSessionOptions> = {}): CliSessionOptions {
  const { fn } = createMockSpawn();
  return {
    binPath: 'claude',
    cwd: '/tmp/test',
    model: 'claude-sonnet-4-6',
    spawnFn: fn as any,
    ...overrides,
  };
}

/** Spawn a session and return captured args. */
async function spawnAndGetArgs(options: CliSessionOptions): Promise<string[]> {
  const { fn, calls } = createMockSpawn();
  const session = new CliSession({ ...options, spawnFn: fn as any });
  await session.spawn();
  return calls[0].args;
}

// ---------------------------------------------------------------------------
// PR #312: disallowedTools
// ---------------------------------------------------------------------------

describe('CliSession disallowedTools', () => {
  it('spawn() passes --disallowed-tools to the CLI when set', async () => {
    const args = await spawnAndGetArgs(baseOptions({
      disallowedTools: ['Bash', 'Read', 'Write', 'Edit', 'Glob'],
    }));

    const dtIdx = args.indexOf('--disallowed-tools');
    expect(dtIdx).toBeGreaterThan(-1);
    const dtValue = args[dtIdx + 1];
    expect(dtValue).toContain('Bash');
    expect(dtValue).toContain('Read');
    expect(dtValue).toContain('Write');
    expect(dtValue).toContain('Edit');
    expect(dtValue).toContain('Glob');
  });

  it('spawn() does NOT include --disallowed-tools when not set', async () => {
    const args = await spawnAndGetArgs(baseOptions());
    expect(args).not.toContain('--disallowed-tools');
  });

  it('spawn() does NOT include --disallowed-tools when array is empty', async () => {
    const args = await spawnAndGetArgs(baseOptions({ disallowedTools: [] }));
    expect(args).not.toContain('--disallowed-tools');
  });
});

// ---------------------------------------------------------------------------
// PR #312: systemPrompt
// ---------------------------------------------------------------------------

describe('CliSession --system-prompt', () => {
  it('spawn() passes --system-prompt when option is set', async () => {
    const args = await spawnAndGetArgs(baseOptions({
      systemPrompt: 'You are Weaver. Use ONLY these tools.',
    }));

    const spIdx = args.indexOf('--system-prompt');
    expect(spIdx).toBeGreaterThan(-1);
    expect(args[spIdx + 1]).toContain('You are Weaver');
  });

  it('spawn() does NOT include --system-prompt when not set', async () => {
    const args = await spawnAndGetArgs(baseOptions());
    expect(args).not.toContain('--system-prompt');
  });
});

// ---------------------------------------------------------------------------
// Phase 1.1: --tools flag
// ---------------------------------------------------------------------------

describe('CliSession --tools flag', () => {
  it('spawn() passes --tools "" to disable all built-in tools', async () => {
    const args = await spawnAndGetArgs(baseOptions({ tools: '' }));

    const idx = args.indexOf('--tools');
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe('');
  });

  it('spawn() passes --tools with whitelist', async () => {
    const args = await spawnAndGetArgs(baseOptions({ tools: 'Read,Edit' }));

    const idx = args.indexOf('--tools');
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe('Read,Edit');
  });

  it('spawn() does NOT include --tools when not set', async () => {
    const args = await spawnAndGetArgs(baseOptions());
    expect(args).not.toContain('--tools');
  });
});

// ---------------------------------------------------------------------------
// --strict-mcp-config flag
// ---------------------------------------------------------------------------

describe('CliSession --strict-mcp-config flag', () => {
  it('spawn() passes --strict-mcp-config when mcpConfigPath is set', async () => {
    const args = await spawnAndGetArgs(baseOptions({ mcpConfigPath: '/tmp/mcp.json' }));
    expect(args).toContain('--strict-mcp-config');
    expect(args).toContain('--mcp-config');
  });

  it('spawn() passes --strict-mcp-config when strictMcpConfig is true (no mcpConfigPath)', async () => {
    const args = await spawnAndGetArgs(baseOptions({ strictMcpConfig: true }));
    expect(args).toContain('--strict-mcp-config');
    expect(args).not.toContain('--mcp-config');
  });

  it('spawn() does NOT pass --strict-mcp-config when neither mcpConfigPath nor strictMcpConfig set', async () => {
    const args = await spawnAndGetArgs(baseOptions());
    expect(args).not.toContain('--strict-mcp-config');
  });

  it('spawn() passes both --mcp-config and --strict-mcp-config when both options set', async () => {
    const args = await spawnAndGetArgs(baseOptions({ mcpConfigPath: '/tmp/mcp.json', strictMcpConfig: true }));
    const mcpIdx = args.indexOf('--mcp-config');
    const strictIdx = args.indexOf('--strict-mcp-config');
    expect(mcpIdx).toBeGreaterThan(-1);
    expect(strictIdx).toBeGreaterThan(-1);
    expect(args[mcpIdx + 1]).toBe('/tmp/mcp.json');
  });
});

// ---------------------------------------------------------------------------
// Phase 1.2: --append-system-prompt flag
// ---------------------------------------------------------------------------

describe('CliSession --append-system-prompt flag', () => {
  it('spawn() passes --append-system-prompt when set', async () => {
    const args = await spawnAndGetArgs(baseOptions({
      appendSystemPrompt: 'You are Weaver, an AI workflow bot.',
    }));

    const idx = args.indexOf('--append-system-prompt');
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe('You are Weaver, an AI workflow bot.');
  });

  it('spawn() does NOT include --append-system-prompt when not set', async () => {
    const args = await spawnAndGetArgs(baseOptions());
    expect(args).not.toContain('--append-system-prompt');
  });

  it('spawn() passes BOTH --system-prompt and --append-system-prompt when both set', async () => {
    const args = await spawnAndGetArgs(baseOptions({
      systemPrompt: 'Custom base prompt.',
      appendSystemPrompt: 'Extra instructions.',
    }));

    expect(args).toContain('--system-prompt');
    expect(args).toContain('--append-system-prompt');

    const spIdx = args.indexOf('--system-prompt');
    expect(args[spIdx + 1]).toBe('Custom base prompt.');

    const apIdx = args.indexOf('--append-system-prompt');
    expect(args[apIdx + 1]).toBe('Extra instructions.');
  });
});

// ---------------------------------------------------------------------------
// Phase 1.3: Concurrent send() guard
// ---------------------------------------------------------------------------

describe('CliSession concurrent send() guard', () => {
  function createLiveSession(): CliSession {
    // Create a session with a mock child that has EventEmitter stdout
    const { fn } = createMockSpawn();
    const session = new CliSession(baseOptions({ spawnFn: fn as any }));

    // Inject a mock child process with real EventEmitter for stdout
    const child = new EventEmitter() as any;
    child.stdin = {
      write: vi.fn((_data: string, cb?: (err?: Error) => void) => { cb?.(); }),
      end: vi.fn(),
      on: vi.fn(),
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn();
    child.killed = false;
    child.pid = 99999;
    session._injectForTest(child);

    return session;
  }

  it('throws when send() is called while a previous send() is in progress', async () => {
    const session = createLiveSession();

    // Start first send — it will block waiting for result event
    const gen1 = session.send('first message');
    // Drive the generator to start (hits the first yield point / await)
    const firstNext = gen1.next();

    // Second send while first is in progress should throw
    const gen2 = session.send('second message');
    await expect(gen2.next()).rejects.toThrow('concurrent send()');

    // Clean up — complete the first turn
    session.kill();
    // Drain first generator
    try { await firstNext; } catch { /* killed */ }
  });

  it('allows sequential send() calls (second after first completes)', async () => {
    const session = createLiveSession();

    // We need to complete the first send by emitting a result event
    const child = (session as any).child;

    // Start first send
    const gen1 = session.send('first message');

    // Emit result event to complete the turn
    setTimeout(() => {
      child.stdout.emit('data', Buffer.from(JSON.stringify({ type: 'result', result: 'ok' }) + '\n'));
    }, 10);

    // Drain first generator
    for await (const _event of gen1) { /* consume */ }

    // Second send should work fine
    const gen2 = session.send('second message');

    // Complete second turn too
    setTimeout(() => {
      child.stdout.emit('data', Buffer.from(JSON.stringify({ type: 'result', result: 'ok' }) + '\n'));
    }, 10);

    for await (const _event of gen2) { /* consume */ }

    session.kill();
  });

  it('claims activeTurn synchronously before await spawn()', async () => {
    // If the session is dead, send() must set activeTurn BEFORE calling spawn().
    // This prevents a second send() from passing the guard during the async spawn.
    //
    // We verify by checking that immediately after calling send() on a dead session,
    // a second send() throws — proving activeTurn was set before the async spawn.
    const { fn } = createMockSpawn();
    const session = new CliSession(baseOptions({ spawnFn: fn as any }));
    // Session is NOT alive (never spawned), so send() will call spawn()

    // Start first send — spawn runs synchronously from the mock
    const gen1 = session.send('msg1');
    // Drive generator to first yield (past the spawn)
    const p1 = gen1.next();

    // Second send should throw because activeTurn was claimed by gen1
    const gen2 = session.send('msg2');
    await expect(gen2.next()).rejects.toThrow('concurrent send()');

    session.kill();
    try { await p1; } catch { /* killed */ }
  });
});

// ---------------------------------------------------------------------------
// Phase 1.4: Session cache option fingerprint
// ---------------------------------------------------------------------------

describe('CliSession matchesOptions()', () => {
  it('returns true when CLI-relevant options match', () => {
    const opts = baseOptions({ model: 'claude-sonnet-4-6', tools: '' });
    const session = new CliSession(opts);
    expect(session.matchesOptions(opts)).toBe(true);
  });

  it('returns false when model differs', () => {
    const opts = baseOptions({ model: 'claude-sonnet-4-6' });
    const session = new CliSession(opts);
    expect(session.matchesOptions({ ...opts, model: 'claude-opus-4-6' })).toBe(false);
  });

  it('returns false when tools differs', () => {
    const opts = baseOptions({ tools: '' });
    const session = new CliSession(opts);
    expect(session.matchesOptions({ ...opts, tools: 'Read,Edit' })).toBe(false);
  });

  it('returns false when disallowedTools differs', () => {
    const opts = baseOptions({ disallowedTools: ['Bash'] });
    const session = new CliSession(opts);
    expect(session.matchesOptions({ ...opts, disallowedTools: ['Bash', 'Read'] })).toBe(false);
  });
});

describe('getOrCreateCliSession cache with option validation', () => {
  afterEach(() => {
    killAllCliSessions();
  });

  it('returns cached session when options match', async () => {
    const opts = baseOptions({ model: 'claude-sonnet-4-6' });
    const s1 = getOrCreateCliSession('key1', opts);
    await s1.spawn();
    const s2 = getOrCreateCliSession('key1', opts);
    expect(s2.sessionId).toBe(s1.sessionId);
  });

  it('kills and recreates session when model changes', async () => {
    const opts = baseOptions({ model: 'claude-sonnet-4-6' });
    const s1 = getOrCreateCliSession('key2', opts);
    await s1.spawn();
    const s1Id = s1.sessionId;

    const s2 = getOrCreateCliSession('key2', { ...opts, model: 'claude-opus-4-6' });
    expect(s2.sessionId).not.toBe(s1Id);
    expect(s1.ready).toBe(false); // old session was killed
  });

  it('kills and recreates session when disallowedTools change', async () => {
    const opts = baseOptions({ disallowedTools: [] });
    const s1 = getOrCreateCliSession('key3', opts);
    await s1.spawn();
    const s1Id = s1.sessionId;

    const s2 = getOrCreateCliSession('key3', { ...opts, disallowedTools: ['Bash'] });
    expect(s2.sessionId).not.toBe(s1Id);
  });

  it('kills and recreates session when tools change', async () => {
    const opts = baseOptions({ tools: '' });
    const s1 = getOrCreateCliSession('key4', opts);
    await s1.spawn();
    const s1Id = s1.sessionId;

    const s2 = getOrCreateCliSession('key4', { ...opts, tools: 'Read' });
    expect(s2.sessionId).not.toBe(s1Id);
  });
});

// ---------------------------------------------------------------------------
// Phase 1.5: Idle timeout cleanup
// ---------------------------------------------------------------------------

describe('CliSession idle timeout cleanup', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    killAllCliSessions();
  });

  it('markDead() clears the idle timer (process crash does not leave dangling timer)', async () => {
    const { fn } = createMockSpawn();
    const session = new CliSession(baseOptions({
      spawnFn: fn as any,
      idleTimeout: 60_000,
    }));
    await session.spawn();

    // Session is alive, idle timer is set
    expect(session.ready).toBe(true);

    // Simulate process crash — markDead is called via the 'exit' handler
    // Access the child's 'on' mock to find the exit callback
    const child = (session as any).child;
    const exitCb = (fn as any).mock.results[0].value.on.mock.calls
      .find((c: any[]) => c[0] === 'exit')?.[1];

    // If we can't get exit callback, trigger via kill which calls markDead
    if (exitCb) {
      exitCb(1);
    } else {
      session.kill();
    }

    // After markDead, the idle timer should be cleared.
    // Advancing time past the idle timeout should NOT call kill() again.
    // If timer was NOT cleared, this would cause an error or double-kill.
    const killSpy = vi.spyOn(session, 'kill');
    vi.advanceTimersByTime(120_000);
    // kill should not have been called by the timer (it was cleared)
    expect(killSpy).not.toHaveBeenCalled();
  });

  it('idle timer is unref()d so it does not keep Node.js alive', async () => {
    // We verify by checking that setTimeout().unref() was called.
    const unrefSpy = vi.fn();
    const originalSetTimeout = globalThis.setTimeout;

    // Mock setTimeout to track unref calls
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(
      (fn: any, ms?: number) => {
        const timer = originalSetTimeout(fn, ms);
        const origUnref = timer.unref.bind(timer);
        timer.unref = () => { unrefSpy(); return origUnref(); };
        return timer;
      }
    );

    const { fn } = createMockSpawn();
    const session = new CliSession(baseOptions({
      spawnFn: fn as any,
      idleTimeout: 60_000,
    }));
    await session.spawn();

    // The idle timer set during spawn should have called unref()
    expect(unrefSpy).toHaveBeenCalled();

    session.kill();
    setTimeoutSpy.mockRestore();
  });

  it('SIGKILL fallback timer in kill() is unref()d', async () => {
    const unrefCalls: number[] = [];
    const originalSetTimeout = globalThis.setTimeout;

    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(
      (fn: any, ms?: number) => {
        const timer = originalSetTimeout(fn, ms);
        const origUnref = timer.unref.bind(timer);
        timer.unref = () => {
          unrefCalls.push(ms ?? 0);
          return origUnref();
        };
        return timer;
      }
    );

    const { fn } = createMockSpawn();
    const session = new CliSession(baseOptions({ spawnFn: fn as any }));
    await session.spawn();

    const unrefCountBefore = unrefCalls.length;
    session.kill();

    // kill() creates a 2000ms SIGKILL timer — it should also be unref'd
    const sigkillUnrefs = unrefCalls.slice(unrefCountBefore).filter(ms => ms === 2000);
    expect(sigkillUnrefs.length).toBeGreaterThan(0);

    setTimeoutSpy.mockRestore();
  });
});
