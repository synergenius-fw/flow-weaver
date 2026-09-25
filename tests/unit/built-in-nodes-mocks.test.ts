import { describe, it, expect, afterEach } from 'vitest';
import { delay, parseDuration } from '../../src/built-in-nodes/delay';
import { parseDuration as coordinatorParseDuration } from '../../src/coordinator/time';
import { waitForEvent } from '../../src/built-in-nodes/wait-for-event';
import { invokeWorkflow } from '../../src/built-in-nodes/invoke-workflow';
import { waitForAgent } from '../../src/built-in-nodes/wait-for-agent';
import { sleep } from '../../src/built-in-nodes/sleep';
import type { FwMockConfig } from '../../src/built-in-nodes/mock-types';
import { createNestedWorkflowRuntime, type NodeExecutionRuntime, type WorkflowRuntime } from '../../src/runtime/durable-execution';

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
    createNestedRuntime: (workflowId: string) => createNestedWorkflowRuntime(runtime, workflowId, nodeId, 0, 0),
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

  it('reads a duration with the same function the coordinator clock uses', () => {
    expect(coordinatorParseDuration).toBe(parseDuration);
    expect(parseDuration('500ms')).toBe(500);
    expect(parseDuration('30s')).toBe(30_000);
    expect(parseDuration(' 2h ')).toBe(7_200_000);
    expect(parseDuration('3d')).toBe(259_200_000);
    for (const bad of ['', 'soon', '5 weeks', 42, null, undefined, '1.5h']) {
      expect(parseDuration(bad)).toBeUndefined();
    }
  });

  it('refuses a wait longer than setTimeout can hold instead of returning at once', async () => {
    const start = Date.now();
    await expect(runDelay(true, '30d')).rejects.toThrow(/longer than setTimeout can wait/);
    await expect(runDelay(true, '99999999999999999999ms')).rejects.toThrow(/longer than setTimeout can wait/);
    expect(Date.now() - start).toBeLessThan(200);
  });
});

// ---------------------------------------------------------------------------
// The gates: waitForEvent, waitForAgent, sleep
//
// A compiled workflow never calls these bodies; the generator emits a durable
// gate in their place and the engine answers it from the mocks (pinned in
// tests/unit/coordinator/coordinator-mocks.test.ts and coordinator-time.test.ts).
// The bodies fail closed, mocks or not.
// ---------------------------------------------------------------------------

describe('gate bodies fail closed', () => {
  it('waitForEvent throws even when the mocks would answer the gate', async () => {
    mocks = { events: { 'app/expense.approved': { expenseId: '123' } } };
    await expect(runWaitForEvent(true, 'app/expense.approved')).rejects.toThrow(
      'requires a generated durable input gate',
    );
    mocks = undefined;
    await expect(runWaitForEvent(true, 'app/expense.approved')).rejects.toThrow(
      'requires a generated durable input gate',
    );
  });

  it('waitForAgent throws even when the mocks would answer the gate', async () => {
    mocks = { agents: { 'human-reviewer': { approved: true } } };
    await expect(runWaitForAgent(true, 'human-reviewer', {})).rejects.toThrow(
      'requires a generated durable agent gate',
    );
    mocks = undefined;
    await expect(runWaitForAgent(true, 'human-reviewer', {})).rejects.toThrow(
      'requires a generated durable agent gate',
    );
  });

  it('sleep throws even under fast mocks', async () => {
    mocks = { fast: true };
    await expect(sleep(true, '3d', nodeRuntime('sleep'))).rejects.toThrow(
      'requires a generated durable timer gate',
    );
  });

  it('each returns inactive when execute=false', async () => {
    mocks = { events: { 'app/test': { data: 'x' } }, agents: { a: { ok: true } }, fast: true };
    expect(await runWaitForEvent(false, 'app/test')).toEqual({ onSuccess: false, onFailure: false, eventData: {} });
    expect(await runWaitForAgent(false, 'a', {})).toEqual({ onSuccess: false, onFailure: false, agentResult: {} });
    expect(await sleep(false, '1s', nodeRuntime('sleep'))).toEqual({ onSuccess: false, onFailure: false, wokeAt: '' });
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
// combined mocks
// ---------------------------------------------------------------------------

describe('combined mocks', () => {
  it('handles invocations + fast simultaneously', async () => {
    mocks = {
      invocations: { 'svc/fn': { ok: true } },
      fast: true,
    };

    const start = Date.now();
    const [delayResult, invokeResult] = await Promise.all([
      runDelay(true, '1h'),
      runInvokeWorkflow(true, 'svc/fn', {}),
    ]);
    expect(Date.now() - start).toBeLessThan(50);

    expect(delayResult).toEqual({
      onSuccess: true,
      onFailure: false,
      elapsed: true,
    });
    expect(invokeResult.result).toEqual({ ok: true });
  });
});
