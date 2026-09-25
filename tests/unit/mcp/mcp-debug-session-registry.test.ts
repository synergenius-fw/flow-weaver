import {
  storeDebugSession,
  getDebugSession,
  removeDebugSession,
  listDebugSessions,
} from '../../../src/mcp/debug-session';
import type { DebugSession } from '../../../src/mcp/debug-session';

function makeFakeSession(overrides: Partial<DebugSession> = {}): DebugSession {
  return {
    debugId: 'test-session-1',
    filePath: '/tmp/workflow.ts',
    controller: {} as DebugSession['controller'],
    executionPromise: Promise.resolve(),
    createdAt: Date.now(),
    ...overrides,
  };
}

describe('debug-session registry', () => {
  beforeEach(() => {
    // Clear all sessions between tests
    for (const s of listDebugSessions()) {
      removeDebugSession(s.debugId);
    }
  });

  it('stores and retrieves a session by debugId', () => {
    const session = makeFakeSession();
    storeDebugSession(session);
    expect(getDebugSession('test-session-1')).toBe(session);
  });

  it('returns undefined for unknown debugId', () => {
    expect(getDebugSession('nonexistent')).toBeUndefined();
  });

  it('removes a session', () => {
    const session = makeFakeSession();
    storeDebugSession(session);
    removeDebugSession('test-session-1');
    expect(getDebugSession('test-session-1')).toBeUndefined();
  });

  it('removing a nonexistent session is a no-op', () => {
    expect(() => removeDebugSession('nope')).not.toThrow();
  });

  it('lists all sessions with the expected fields', () => {
    storeDebugSession(makeFakeSession({ debugId: 'a', workflowName: 'MyFlow' }));
    storeDebugSession(makeFakeSession({ debugId: 'b' }));

    const list = listDebugSessions();
    expect(list).toHaveLength(2);

    const first = list.find((s) => s.debugId === 'a')!;
    expect(first.filePath).toBe('/tmp/workflow.ts');
    expect(first.workflowName).toBe('MyFlow');
    expect(first.createdAt).toBeTypeOf('number');
    expect(first.lastPauseState).toBeUndefined();

    const second = list.find((s) => s.debugId === 'b')!;
    expect(second.workflowName).toBeUndefined();
  });

  it('lists empty array when no sessions exist', () => {
    expect(listDebugSessions()).toEqual([]);
  });

  it('drops sessions older than 30 minutes when a new one is stored, ending their paused runs', () => {
    const resume = vi.fn();
    const old = makeFakeSession({
      debugId: 'abandoned',
      createdAt: Date.now() - 31 * 60 * 1000,
      controller: { resume } as unknown as DebugSession['controller'],
    });
    storeDebugSession(old);
    expect(getDebugSession('abandoned')).toBeDefined();

    storeDebugSession(makeFakeSession({ debugId: 'recent', createdAt: Date.now() - 29 * 60 * 1000 }));
    expect(getDebugSession('abandoned')).toBeUndefined();
    expect(resume).toHaveBeenCalledWith({ type: 'abort' });

    storeDebugSession(makeFakeSession({ debugId: 'new' }));
    expect(listDebugSessions().map((s) => s.debugId).sort()).toEqual(['new', 'recent']);
  });

  it('includes lastPauseState in listing when set', () => {
    const pause = {
      currentNodeId: 'node1',
      phase: 'before' as const,
      position: 0,
      completedNodes: [],
      executionOrder: [],
      breakpoints: [],
      variables: {},
    };
    const session = makeFakeSession({ lastPauseState: pause });
    storeDebugSession(session);

    const list = listDebugSessions();
    expect(list[0].lastPauseState).toEqual(pause);
  });
});
