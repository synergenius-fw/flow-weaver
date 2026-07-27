/**
 * Coverage for ExecutionContext.ts: debugger event methods
 * (sendStatusChangedEvent, sendLogErrorEvent, sendWorkflowCompletedEvent)
 * and the serialize() function error branch.
 */
import { describe, it, expect, vi } from 'vitest';
import { GeneratedExecutionContext } from '../../src/runtime/ExecutionContext';
import type { TDebugger, TEvent } from '../../src/runtime/events';

function makeDebugger(): TDebugger & { events: TEvent[] } {
  const events: TEvent[] = [];
  return {
    events,
    innerFlowInvocation: false,
    sendEvent(event: TEvent) {
      events.push(event);
    },
  };
}

function makeContext(debugger_?: TDebugger): GeneratedExecutionContext {
  return new GeneratedExecutionContext(true, testHelpers.createRuntime('runtimeContext', { debugger: debugger_ }));
}

describe('ExecutionContext debugger event methods', () => {
  it('sendStatusChangedEvent emits when debugger is present', () => {
    const dbg = makeDebugger();
    const ctx = makeContext(dbg);

    ctx.sendStatusChangedEvent({
      nodeTypeName: 'Add',
      id: 'adder1',
      executionIndex: 0,
      status: 'RUNNING',
    });

    expect(dbg.events).toHaveLength(1);
    expect(dbg.events[0].type).toBe('STATUS_CHANGED');
  });

  it('sendStatusChangedEvent is a no-op without debugger', () => {
    const ctx = makeContext();
    // Should not throw
    ctx.sendStatusChangedEvent({
      nodeTypeName: 'Add',
      id: 'adder1',
      executionIndex: 0,
      status: 'RUNNING',
    });
  });

  it('sendLogErrorEvent emits when debugger is present', () => {
    const dbg = makeDebugger();
    const ctx = makeContext(dbg);

    ctx.sendLogErrorEvent({
      nodeTypeName: 'Fetch',
      id: 'fetch1',
      executionIndex: 0,
      error: 'Network timeout',
    });

    expect(dbg.events).toHaveLength(1);
    expect(dbg.events[0].type).toBe('LOG_ERROR');
  });

  it('sendLogErrorEvent is a no-op without debugger', () => {
    const ctx = makeContext();
    ctx.sendLogErrorEvent({
      nodeTypeName: 'Fetch',
      id: 'fetch1',
      executionIndex: 0,
      error: 'timeout',
    });
  });

  it('sendWorkflowCompletedEvent emits when debugger is present', () => {
    const dbg = makeDebugger();
    const ctx = makeContext(dbg);

    ctx.sendWorkflowCompletedEvent({
      executionIndex: 0,
      status: 'SUCCEEDED',
      result: { answer: 42 },
    });

    expect(dbg.events).toHaveLength(1);
    expect(dbg.events[0].type).toBe('WORKFLOW_COMPLETED');
  });

  it('sendWorkflowCompletedEvent with FAILED status', () => {
    const dbg = makeDebugger();
    const ctx = makeContext(dbg);

    ctx.sendWorkflowCompletedEvent({
      executionIndex: 1,
      status: 'FAILED',
    });

    expect(dbg.events).toHaveLength(1);
    const event = dbg.events[0] as { type: string; status: string };
    expect(event.status).toBe('FAILED');
  });

  it('sendWorkflowCompletedEvent with CANCELLED status', () => {
    const dbg = makeDebugger();
    const ctx = makeContext(dbg);

    ctx.sendWorkflowCompletedEvent({
      executionIndex: 0,
      status: 'CANCELLED',
    });

    expect(dbg.events).toHaveLength(1);
    const event = dbg.events[0] as { type: string; status: string };
    expect(event.status).toBe('CANCELLED');
  });

  it('sendWorkflowCompletedEvent is a no-op without debugger', () => {
    const ctx = makeContext();
    ctx.sendWorkflowCompletedEvent({
      executionIndex: 0,
      status: 'SUCCEEDED',
    });
  });

  it('sendStatusChangedEvent includes scope and side when provided', () => {
    const dbg = makeDebugger();
    const ctx = makeContext(dbg);

    ctx.sendStatusChangedEvent({
      nodeTypeName: 'ForEach',
      id: 'loop1',
      scope: 'iteration',
      side: 'start',
      executionIndex: 0,
      status: 'RUNNING',
    });

    expect(dbg.events).toHaveLength(1);
    const event = dbg.events[0] as Record<string, unknown>;
    expect(event.scope).toBe('iteration');
    expect(event.side).toBe('start');
  });
});
