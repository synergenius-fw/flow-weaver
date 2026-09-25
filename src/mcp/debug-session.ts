/**
 * In-memory registry for active debug sessions.
 * Tracks execution-scoped DebugController state for live developer sessions.
 */

import type { DebugController, DebugPauseState } from '../runtime/debug-controller.js';

export interface DebugSession {
  debugId: string;
  filePath: string;
  workflowName?: string;
  controller: DebugController;
  /** The still-pending execution promise. Resolves when workflow completes. */
  executionPromise: Promise<unknown>;
  /** When the session started. One older than `DEBUG_SESSION_MAX_AGE_MS` is dropped. */
  createdAt: number;
  /** Most recent pause state (updated on each pause) */
  lastPauseState?: DebugPauseState;
}

const debugSessions = new Map<string, DebugSession>();

/** A session this old is taken as abandoned: nothing else ever ends one that is never stepped to the end. */
const DEBUG_SESSION_MAX_AGE_MS = 30 * 60 * 1000;

/**
 * Drop abandoned sessions. Each is paused mid-run, so it is aborted too:
 * its execution then ends and the executor removes its temp files.
 */
function sweepAbandoned(now: number): void {
  for (const [debugId, session] of debugSessions) {
    if (now - session.createdAt <= DEBUG_SESSION_MAX_AGE_MS) continue;
    debugSessions.delete(debugId);
    try { session.controller.resume({ type: 'abort' }); } catch { /* already ended */ }
  }
}

export function storeDebugSession(session: DebugSession): void {
  const candidate = session as DebugSession & Record<string, unknown>;
  if (
    Object.hasOwn(candidate, 'continuation') ||
    Object.hasOwn(candidate, 'gate') ||
    Object.hasOwn(candidate, 'gateId')
  ) {
    throw new Error(
      'Live debug sessions cannot retain durable continuation or gate state',
    );
  }
  sweepAbandoned(Date.now());
  debugSessions.set(session.debugId, session);
}

export function getDebugSession(debugId: string): DebugSession | undefined {
  return debugSessions.get(debugId);
}

export function removeDebugSession(debugId: string): void {
  debugSessions.delete(debugId);
}

export function listDebugSessions(): Array<{
  debugId: string;
  filePath: string;
  workflowName?: string;
  createdAt: number;
  lastPauseState?: DebugPauseState;
}> {
  return Array.from(debugSessions.values()).map((session) => ({
    debugId: session.debugId,
    filePath: session.filePath,
    workflowName: session.workflowName,
    createdAt: session.createdAt,
    lastPauseState: session.lastPauseState,
  }));
}
