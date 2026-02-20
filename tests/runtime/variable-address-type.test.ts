/**
 * Tests that VariableAddress supports scope/side properties
 * and that setVariable forwards them to debug events.
 */

import { describe, expect, it, vi } from 'vitest';
import { GeneratedExecutionContext } from '../../src/runtime/ExecutionContext';
import type { TDebugger } from '../../src/runtime/events';

describe('VariableAddress scope/side support', () => {
  it('should accept scope and side properties on setVariable address', () => {
    const ctx = new GeneratedExecutionContext(false);
    const idx = ctx.addExecution('node1');

    // This should compile without errors — scope and side are valid
    ctx.setVariable(
      {
        id: 'node1',
        portName: 'value',
        executionIndex: idx,
        nodeTypeName: 'container',
        scope: 'attempt',
        side: 'start',
      },
      42
    );

    const value = ctx.getVariable({
      id: 'node1',
      portName: 'value',
      executionIndex: idx,
    });
    expect(value).toBe(42);
  });

  it('should forward scope and side to debug VARIABLE_SET event', () => {
    const events: unknown[] = [];
    const debugger_: TDebugger = {
      sendEvent: (event: unknown) => events.push(event),
      innerFlowInvocation: false,
    };

    const ctx = new GeneratedExecutionContext(false, debugger_);
    const idx = ctx.addExecution('node1');

    ctx.setVariable(
      {
        id: 'node1',
        portName: 'value',
        executionIndex: idx,
        nodeTypeName: 'container',
        scope: 'attempt',
        side: 'start',
      },
      42
    );

    expect(events).toHaveLength(1);
    const event = events[0] as {
      type: string;
      identifier: { scope?: string; side?: string };
    };
    expect(event.type).toBe('VARIABLE_SET');
    expect(event.identifier.scope).toBe('attempt');
    expect(event.identifier.side).toBe('start');
  });

  it('should accept side: exit', () => {
    const ctx = new GeneratedExecutionContext(false);
    const idx = ctx.addExecution('node1');

    // side: 'exit' should also be valid
    ctx.setVariable(
      {
        id: 'node1',
        portName: 'value',
        executionIndex: idx,
        nodeTypeName: 'container',
        scope: 'attempt',
        side: 'exit',
      },
      99
    );

    const value = ctx.getVariable({
      id: 'node1',
      portName: 'value',
      executionIndex: idx,
    });
    expect(value).toBe(99);
  });
});
