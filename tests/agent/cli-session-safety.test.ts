/**
 * Tests for CliSession safety:
 * - mcpConfigPath excluded from fingerprint (different paths = same session)
 * - Active turn protection (refuse to kill mid-conversation)
 *
 * ROOT CAUSE: Multiple createSessionProvider calls for the same projectDir
 * created new MCP bridges with different temp paths. getOrCreateCliSession
 * saw a fingerprint mismatch and killed the active orchestrator session,
 * losing the result event with costUsd.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CliSession, getOrCreateCliSession, killAllCliSessions } from '../../src/agent/cli-session.js';
import type { CliSessionOptions } from '../../src/agent/types.js';

function makeOpts(overrides: Partial<CliSessionOptions> = {}): CliSessionOptions {
  return {
    binPath: 'claude',
    cwd: '/tmp/test',
    model: 'claude-sonnet-4-6',
    allowedTools: [],
    strictMcpConfig: true,
    appendSystemPrompt: 'test',
    ...overrides,
  };
}

describe('CliSession fingerprint (mcpConfigPath excluded)', () => {
  beforeEach(() => {
    // Kill all sessions between tests
    killAllCliSessions();
  });

  it('same options with different mcpConfigPath returns SAME session', () => {
    const opts1 = makeOpts({ mcpConfigPath: '/tmp/bridge-aaa/mcp-config.json' });
    const opts2 = makeOpts({ mcpConfigPath: '/tmp/bridge-bbb/mcp-config.json' });

    const session1 = getOrCreateCliSession('test-fp-1', opts1);
    // Make session1 look alive so the cache check proceeds
    (session1 as any).alive = true;

    const session2 = getOrCreateCliSession('test-fp-1', opts2);

    // Same session, not killed and recreated
    expect(session2.sessionId).toBe(session1.sessionId);
  });

  it('different model creates a NEW session', () => {
    const opts1 = makeOpts({ model: 'claude-sonnet-4-6' });
    const opts2 = makeOpts({ model: 'claude-opus-4-6' });

    const session1 = getOrCreateCliSession('test-fp-2', opts1);
    (session1 as any).alive = true;

    const session2 = getOrCreateCliSession('test-fp-2', opts2);

    // Different session, because model is a semantic option
    expect(session2.sessionId).not.toBe(session1.sessionId);
  });

  it('different appendSystemPrompt creates a NEW session', () => {
    const opts1 = makeOpts({ appendSystemPrompt: 'prompt-A' });
    const opts2 = makeOpts({ appendSystemPrompt: 'prompt-B' });

    const session1 = getOrCreateCliSession('test-fp-3', opts1);
    (session1 as any).alive = true;

    const session2 = getOrCreateCliSession('test-fp-3', opts2);

    expect(session2.sessionId).not.toBe(session1.sessionId);
  });
});

describe('CliSession active turn protection', () => {
  beforeEach(() => {
    killAllCliSessions();
  });

  it('kill() with active turn logs warning to stderr', () => {
    const opts = makeOpts();
    const session = getOrCreateCliSession('test-active-1', opts);

    // Simulate an active turn
    (session as any).activeTurn = { resolve: () => {}, events: [], done: false };
    (session as any).alive = true;

    const captured: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation((...args: any[]) => {
      captured.push(String(args[0]));
      return true;
    });
    session.kill();
    spy.mockRestore();

    expect(captured.some(c => c.includes('active turn') && c.includes('data loss'))).toBe(true);
  });

  it('kill() fires onSessionKilled callback with active turn info', () => {
    const opts = makeOpts();
    const session = getOrCreateCliSession('test-active-2', opts);

    (session as any).activeTurn = { resolve: () => {}, events: [{ type: 'text_delta' }], done: false };
    (session as any).alive = true;

    const killInfo: any[] = [];
    session.onSessionKilled = (info) => killInfo.push(info);

    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    session.kill();
    spy.mockRestore();

    expect(killInfo).toHaveLength(1);
    expect(killInfo[0].hadActiveTurn).toBe(true);
    expect(killInfo[0].eventsInTurn).toBe(1);
  });

  it('getOrCreateCliSession refuses to kill session with active turn on fingerprint mismatch', () => {
    const opts1 = makeOpts({ model: 'claude-sonnet-4-6' });
    const session1 = getOrCreateCliSession('test-active-3', opts1);

    // Simulate active turn
    (session1 as any).activeTurn = { resolve: () => {}, events: [], done: false };
    (session1 as any).alive = true;

    const captured: string[] = [];
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation((...args: any[]) => {
      captured.push(String(args[0]));
      return true;
    });

    // Different model would normally kill and recreate
    const opts2 = makeOpts({ model: 'claude-opus-4-6' });
    const session2 = getOrCreateCliSession('test-active-3', opts2);

    spy.mockRestore();

    // Should return the EXISTING session, not a new one
    expect(session2.sessionId).toBe(session1.sessionId);

    // Should have logged a warning
    expect(captured.some(c => c.includes('active turn') && /reusing/i.test(c))).toBe(true);
  });

  it('hasActiveTurn returns correct state', () => {
    const opts = makeOpts();
    const session = getOrCreateCliSession('test-active-4', opts);

    expect(session.hasActiveTurn).toBe(false);

    (session as any).activeTurn = { resolve: () => {}, events: [], done: false };
    expect(session.hasActiveTurn).toBe(true);

    (session as any).activeTurn.done = true;
    expect(session.hasActiveTurn).toBe(false);

    (session as any).activeTurn = null;
    expect(session.hasActiveTurn).toBe(false);
  });
});
