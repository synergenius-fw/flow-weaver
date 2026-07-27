import { describe, it, expect, afterEach } from 'vitest';
import { delay } from '../../src/built-in-nodes/delay';
import { waitForEvent } from '../../src/built-in-nodes/wait-for-event';
import { invokeWorkflow } from '../../src/built-in-nodes/invoke-workflow';
import { waitForAgent } from '../../src/built-in-nodes/wait-for-agent';
import type { FwMockConfig } from '../../src/built-in-nodes/mock-types';
import { createNestedWorkflowRuntime, type NodeExecutionRuntime } from '../../src/runtime/durable-execution';

let mocks: FwMockConfig | undefined;
afterEach(() => {
  mocks = undefined;
});

function nodeRuntime(nodeId: string): NodeExecutionRuntime {
  const runtime = testHelpers.createRuntime('builtInMocks', { mocks });
  return {
    nodeId,
    runtime,
    recursionDepth: 0,
    createNestedRuntime: (workflowId: string) => createNestedWorkflowRuntime(runtime, workflowId, nodeId, 0),
  };
}

function runDelay(execute: boolean, duration: string) {
  return delay(execute, duration, undefined, nodeRuntime('delay'));
}

function runWaitForEvent(execute: boolean, eventName: string) {
  return waitForEvent(execute, eventName, undefined, undefined, nodeRuntime('waitForEvent'));
}

function runInvokeWorkflow(execute: boolean, functionId: string, payload: object) {
  return invokeWorkflow(execute, functionId, payload, undefined, undefined, nodeRuntime('invokeWorkflow'));
}

function runWaitForAgent(execute: boolean, agentId: string, context: object) {
  return waitForAgent(execute, agentId, context, undefined, undefined, nodeRuntime('waitForAgent'));
}

// ---------------------------------------------------------------------------
// delay
// ---------------------------------------------------------------------------

describe('delay with mocks', () => {
  it('sleeps for real duration when no mocks', async () => {
    const start = Date.now();
    const result = await runDelay(true, '100ms');
    expect(Date.now() - start).toBeGreaterThanOrEqual(80);
    expect(result).toEqual({
      onSuccess: true,
      onFailure: false,
      elapsed: true,
    });
  });

  it('skips sleep in fast mode', async () => {
    mocks = { fast: true };
    const start = Date.now();
    const result = await runDelay(true, '10s');
    expect(Date.now() - start).toBeLessThan(50);
    expect(result).toEqual({
      onSuccess: true,
      onFailure: false,
      elapsed: true,
    });
  });

  it('sleeps normally when mocks set but fast=false', async () => {
    mocks = { fast: false };
    const start = Date.now();
    await runDelay(true, '100ms');
    expect(Date.now() - start).toBeGreaterThanOrEqual(80);
  });

  it('returns inactive when execute=false regardless of mocks', async () => {
    mocks = { fast: true };
    const result = await runDelay(false, '10s');
    expect(result).toEqual({
      onSuccess: false,
      onFailure: false,
      elapsed: false,
    });
  });
});

// ---------------------------------------------------------------------------
// waitForEvent
// ---------------------------------------------------------------------------

describe('waitForEvent with mocks', () => {
  it('returns mock data when event name matches', async () => {
    mocks = {
      events: { 'app/expense.approved': { expenseId: '123', amount: 500 } },
    };
    const result = await runWaitForEvent(true, 'app/expense.approved');
    expect(result).toEqual({
      onSuccess: true,
      onFailure: false,
      eventData: { expenseId: '123', amount: 500 },
    });
  });

  it('returns onFailure when mocks active but event not found', async () => {
    mocks = {
      events: { 'app/other-event': { data: 'x' } },
    };
    const result = await runWaitForEvent(true, 'app/expense.approved');
    expect(result).toEqual({
      onSuccess: false,
      onFailure: true,
      eventData: {},
    });
  });

  it('returns onFailure when mocks active with empty events', async () => {
    mocks = { events: {} };
    const result = await runWaitForEvent(true, 'app/expense.approved');
    expect(result).toEqual({
      onSuccess: false,
      onFailure: true,
      eventData: {},
    });
  });

  it('returns onFailure when mocks active with no events key', async () => {
    mocks = {};
    const result = await runWaitForEvent(true, 'app/expense.approved');
    expect(result).toEqual({
      onSuccess: false,
      onFailure: true,
      eventData: {},
    });
  });

  it('uses original no-op behavior when no mocks', async () => {
    const result = await runWaitForEvent(true, 'app/expense.approved');
    expect(result).toEqual({
      onSuccess: true,
      onFailure: false,
      eventData: {},
    });
  });

  it('returns inactive when execute=false', async () => {
    mocks = {
      events: { 'app/test': { data: 'x' } },
    };
    const result = await runWaitForEvent(false, 'app/test');
    expect(result).toEqual({
      onSuccess: false,
      onFailure: false,
      eventData: {},
    });
  });
});

// ---------------------------------------------------------------------------
// invokeWorkflow
// ---------------------------------------------------------------------------

describe('invokeWorkflow with mocks', () => {
  it('returns mock result when functionId matches', async () => {
    mocks = {
      invocations: { 'payment/process': { transactionId: 'tx-456' } },
    };
    const result = await runInvokeWorkflow(true, 'payment/process', {
      amount: 100,
    });
    expect(result).toEqual({
      onSuccess: true,
      onFailure: false,
      result: { transactionId: 'tx-456' },
    });
  });

  it('returns onFailure when functionId not found in mocks', async () => {
    mocks = {
      invocations: { 'other/function': { data: 'x' } },
    };
    const result = await runInvokeWorkflow(true, 'payment/process', {});
    expect(result).toEqual({
      onSuccess: false,
      onFailure: true,
      result: {},
    });
  });

  it('returns onFailure when mocks active with no invocations key', async () => {
    mocks = {};
    const result = await runInvokeWorkflow(true, 'payment/process', {});
    expect(result).toEqual({
      onSuccess: false,
      onFailure: true,
      result: {},
    });
  });

  it('uses original no-op behavior when no mocks', async () => {
    const result = await runInvokeWorkflow(true, 'payment/process', {});
    expect(result).toEqual({
      onSuccess: true,
      onFailure: false,
      result: {},
    });
  });

  it('returns inactive when execute=false', async () => {
    mocks = {
      invocations: { 'payment/process': { ok: true } },
    };
    const result = await runInvokeWorkflow(false, 'payment/process', {});
    expect(result).toEqual({
      onSuccess: false,
      onFailure: false,
      result: {},
    });
  });
});

// ---------------------------------------------------------------------------
// waitForAgent
// ---------------------------------------------------------------------------

describe('waitForAgent with mocks', () => {
  it('returns mock result when agentId matches', async () => {
    mocks = {
      agents: { 'human-reviewer': { approved: true, note: 'LGTM' } },
    };
    const result = await runWaitForAgent(true, 'human-reviewer', {
      data: 'test',
    });
    expect(result).toEqual({
      onSuccess: true,
      onFailure: false,
      agentResult: { approved: true, note: 'LGTM' },
    });
  });

  it('returns onFailure when agentId not found in mocks', async () => {
    mocks = {
      agents: { 'other-agent': { data: 'x' } },
    };
    const result = await runWaitForAgent(true, 'human-reviewer', {});
    expect(result).toEqual({
      onSuccess: false,
      onFailure: true,
      agentResult: {},
    });
  });

  it('returns onFailure when mocks active with empty agents', async () => {
    mocks = { agents: {} };
    const result = await runWaitForAgent(true, 'human-reviewer', {});
    expect(result).toEqual({
      onSuccess: false,
      onFailure: true,
      agentResult: {},
    });
  });

  it('fails closed without a generated durable gate or mock', async () => {
    await expect(runWaitForAgent(true, 'human-reviewer', {})).rejects.toThrow(
      'requires a generated durable agent gate',
    );
  });

  it('returns inactive when execute=false', async () => {
    mocks = {
      agents: { 'human-reviewer': { approved: true } },
    };
    const result = await runWaitForAgent(false, 'human-reviewer', {});
    expect(result).toEqual({
      onSuccess: false,
      onFailure: false,
      agentResult: {},
    });
  });
});

// ---------------------------------------------------------------------------
// combined mocks
// ---------------------------------------------------------------------------

describe('combined mocks', () => {
  it('handles events + invocations + fast simultaneously', async () => {
    mocks = {
      events: { 'app/approved': { id: '1' } },
      invocations: { 'svc/fn': { ok: true } },
      fast: true,
    };

    const start = Date.now();
    const [delayResult, eventResult, invokeResult] = await Promise.all([
      runDelay(true, '1h'),
      runWaitForEvent(true, 'app/approved'),
      runInvokeWorkflow(true, 'svc/fn', {}),
    ]);
    expect(Date.now() - start).toBeLessThan(50);

    expect(delayResult).toEqual({
      onSuccess: true,
      onFailure: false,
      elapsed: true,
    });
    expect(eventResult.eventData).toEqual({ id: '1' });
    expect(invokeResult.result).toEqual({ ok: true });
  });

  it('multiple events for different nodes', async () => {
    mocks = {
      events: {
        'app/approved': { id: '1' },
        'app/payment.confirmed': { txId: 'tx-789' },
      },
    };

    const [r1, r2, r3] = await Promise.all([
      runWaitForEvent(true, 'app/approved'),
      runWaitForEvent(true, 'app/payment.confirmed'),
      runWaitForEvent(true, 'app/unknown'), // not in mocks
    ]);

    expect(r1.onSuccess).toBe(true);
    expect(r1.eventData).toEqual({ id: '1' });
    expect(r2.onSuccess).toBe(true);
    expect(r2.eventData).toEqual({ txId: 'tx-789' });
    expect(r3.onSuccess).toBe(false);
    expect(r3.onFailure).toBe(true);
  });
});
