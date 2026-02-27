/**
 * In-memory registry for active debug sessions.
 * Mirrors the pattern of run-registry.ts but tracks DebugController state
 * instead of AgentChannel state.
 */

import type { DebugController, DebugPauseState } from '../runtime/debug-controller.js';

export interface DebugSession {
  debugId: string;
  filePath: string;
  workflowName?: string;
  controller: DebugController;
  /** The still-pending execution promise. Resolves when workflow completes. */
  executionPromise: Promise<unknown>;
  createdAt: number;
  /** Temp files to clean up when the session ends. */
  tmpFiles: string[];
  /** Most recent pause state (updated on each pause) */
  lastPauseState?: DebugPauseState;
}

const debugSessions = new Map<string, DebugSession>();

export function storeDebugSession(session: DebugSession): void {
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
