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

describe('ExecutionContext debugger event methods', () => {
  it('sendStatusChangedEvent emits when debugger is present', () => {
    const dbg = makeDebugger();
    const ctx = new GeneratedExecutionContext(true, dbg);

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
    const ctx = new GeneratedExecutionContext(true);
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
    const ctx = new GeneratedExecutionContext(true, dbg);

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
    const ctx = new GeneratedExecutionContext(true);
    ctx.sendLogErrorEvent({
      nodeTypeName: 'Fetch',
      id: 'fetch1',
      executionIndex: 0,
      error: 'timeout',
    });
  });

  it('sendWorkflowCompletedEvent emits when debugger is present', () => {
    const dbg = makeDebugger();
    const ctx = new GeneratedExecutionContext(true, dbg);

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
    const ctx = new GeneratedExecutionContext(true, dbg);

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
    const ctx = new GeneratedExecutionContext(true, dbg);

    ctx.sendWorkflowCompletedEvent({
      executionIndex: 0,
      status: 'CANCELLED',
    });

    expect(dbg.events).toHaveLength(1);
    const event = dbg.events[0] as { type: string; status: string };
    expect(event.status).toBe('CANCELLED');
  });

  it('sendWorkflowCompletedEvent is a no-op without debugger', () => {
    const ctx = new GeneratedExecutionContext(true);
    ctx.sendWorkflowCompletedEvent({
      executionIndex: 0,
      status: 'SUCCEEDED',
    });
  });

  it('sendStatusChangedEvent includes scope and side when provided', () => {
    const dbg = makeDebugger();
    const ctx = new GeneratedExecutionContext(true, dbg);

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

describe('ExecutionContext serialize', () => {
  it('resolves function values to concrete values', () => {
    const ctx = new GeneratedExecutionContext(true);
    const idx = ctx.addExecution('node1');
    ctx.setVariable(
      { id: 'node1', portName: 'result', executionIndex: idx },
      () => 42,
    );

    const serialized = ctx.serialize();
    expect(serialized.variables['node1:result:0']).toBe(42);
  });

  it('keeps the raw value when function invocation throws', () => {
    const ctx = new GeneratedExecutionContext(true);
    const idx = ctx.addExecution('node1');
    const badFn = () => {
      throw new Error('boom');
    };
    ctx.setVariable(
      { id: 'node1', portName: 'result', executionIndex: idx },
      badFn,
    );

    const serialized = ctx.serialize();
    // When function throws, serialize stores the function itself
    expect(typeof serialized.variables['node1:result:0']).toBe('function');
  });

  it('serializes non-function values directly', () => {
    const ctx = new GeneratedExecutionContext(true);
    const idx = ctx.addExecution('node1');
    ctx.setVariable(
      { id: 'node1', portName: 'data', executionIndex: idx },
      { key: 'value' },
    );

    const serialized = ctx.serialize();
    expect(serialized.variables['node1:data:0']).toEqual({ key: 'value' });
  });

  it('includes execution info and counts', () => {
    const ctx = new GeneratedExecutionContext(true);
    const idx1 = ctx.addExecution('node1');
    const idx2 = ctx.addExecution('node2');

    const serialized = ctx.serialize();
    expect(serialized.executionCounter).toBe(2);
    expect(Object.keys(serialized.executions).length).toBe(2);
  });
});
