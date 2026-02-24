import { describe, it, expect, afterEach } from 'vitest';
import { delay } from '../../src/built-in-nodes/delay';
import { waitForEvent } from '../../src/built-in-nodes/wait-for-event';
import { invokeWorkflow } from '../../src/built-in-nodes/invoke-workflow';
import { waitForAgent } from '../../src/built-in-nodes/wait-for-agent';

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>).__fw_mocks__;
});

// ---------------------------------------------------------------------------
// delay
// ---------------------------------------------------------------------------

describe('delay with mocks', () => {
  it('sleeps for real duration when no mocks', async () => {
    const start = Date.now();
    const result = await delay(true, '100ms');
    expect(Date.now() - start).toBeGreaterThanOrEqual(80);
    expect(result).toEqual({ onSuccess: true, onFailure: false, elapsed: true });
  });

  it('skips sleep in fast mode', async () => {
    (globalThis as unknown as Record<string, unknown>).__fw_mocks__ = { fast: true };
    const start = Date.now();
    const result = await delay(true, '10s');
    expect(Date.now() - start).toBeLessThan(50);
    expect(result).toEqual({ onSuccess: true, onFailure: false, elapsed: true });
  });

  it('sleeps normally when mocks set but fast=false', async () => {
    (globalThis as unknown as Record<string, unknown>).__fw_mocks__ = { fast: false };
    const start = Date.now();
    await delay(true, '100ms');
    expect(Date.now() - start).toBeGreaterThanOrEqual(80);
  });

  it('returns inactive when execute=false regardless of mocks', async () => {
    (globalThis as unknown as Record<string, unknown>).__fw_mocks__ = { fast: true };
    const result = await delay(false, '10s');
    expect(result).toEqual({ onSuccess: false, onFailure: false, elapsed: false });
  });
});

// ---------------------------------------------------------------------------
// waitForEvent
// ---------------------------------------------------------------------------

describe('waitForEvent with mocks', () => {
  it('returns mock data when event name matches', async () => {
    (globalThis as unknown as Record<string, unknown>).__fw_mocks__ = {
      events: { 'app/expense.approved': { expenseId: '123', amount: 500 } },
    };
    const result = await waitForEvent(true, 'app/expense.approved');
    expect(result).toEqual({
      onSuccess: true,
      onFailure: false,
      eventData: { expenseId: '123', amount: 500 },
    });
  });

  it('returns onFailure when mocks active but event not found', async () => {
    (globalThis as unknown as Record<string, unknown>).__fw_mocks__ = {
      events: { 'app/other-event': { data: 'x' } },
    };
    const result = await waitForEvent(true, 'app/expense.approved');
    expect(result).toEqual({
      onSuccess: false,
      onFailure: true,
      eventData: {},
    });
  });

  it('returns onFailure when mocks active with empty events', async () => {
    (globalThis as unknown as Record<string, unknown>).__fw_mocks__ = { events: {} };
    const result = await waitForEvent(true, 'app/expense.approved');
    expect(result).toEqual({
      onSuccess: false,
      onFailure: true,
      eventData: {},
    });
  });

  it('returns onFailure when mocks active with no events key', async () => {
    (globalThis as unknown as Record<string, unknown>).__fw_mocks__ = {};
    const result = await waitForEvent(true, 'app/expense.approved');
    expect(result).toEqual({
      onSuccess: false,
      onFailure: true,
      eventData: {},
    });
  });

  it('uses original no-op behavior when no mocks', async () => {
    const result = await waitForEvent(true, 'app/expense.approved');
    expect(result).toEqual({
      onSuccess: true,
      onFailure: false,
      eventData: {},
    });
  });

  it('returns inactive when execute=false', async () => {
    (globalThis as unknown as Record<string, unknown>).__fw_mocks__ = {
      events: { 'app/test': { data: 'x' } },
    };
    const result = await waitForEvent(false, 'app/test');
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
    (globalThis as unknown as Record<string, unknown>).__fw_mocks__ = {
      invocations: { 'payment/process': { transactionId: 'tx-456' } },
    };
    const result = await invokeWorkflow(true, 'payment/process', { amount: 100 });
    expect(result).toEqual({
      onSuccess: true,
      onFailure: false,
      result: { transactionId: 'tx-456' },
    });
  });

  it('returns onFailure when functionId not found in mocks', async () => {
    (globalThis as unknown as Record<string, unknown>).__fw_mocks__ = {
      invocations: { 'other/function': { data: 'x' } },
    };
    const result = await invokeWorkflow(true, 'payment/process', {});
    expect(result).toEqual({
      onSuccess: false,
      onFailure: true,
      result: {},
    });
  });

  it('returns onFailure when mocks active with no invocations key', async () => {
    (globalThis as unknown as Record<string, unknown>).__fw_mocks__ = {};
    const result = await invokeWorkflow(true, 'payment/process', {});
    expect(result).toEqual({
      onSuccess: false,
      onFailure: true,
      result: {},
    });
  });

  it('uses original no-op behavior when no mocks', async () => {
    const result = await invokeWorkflow(true, 'payment/process', {});
    expect(result).toEqual({
      onSuccess: true,
      onFailure: false,
      result: {},
    });
  });

  it('returns inactive when execute=false', async () => {
    (globalThis as unknown as Record<string, unknown>).__fw_mocks__ = {
      invocations: { 'payment/process': { ok: true } },
    };
    const result = await invokeWorkflow(false, 'payment/process', {});
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
    (globalThis as unknown as Record<string, unknown>).__fw_mocks__ = {
      agents: { 'human-reviewer': { approved: true, note: 'LGTM' } },
    };
    const result = await waitForAgent(true, 'human-reviewer', { data: 'test' });
    expect(result).toEqual({
      onSuccess: true,
      onFailure: false,
      agentResult: { approved: true, note: 'LGTM' },
    });
  });

  it('returns onFailure when agentId not found in mocks', async () => {
    (globalThis as unknown as Record<string, unknown>).__fw_mocks__ = {
      agents: { 'other-agent': { data: 'x' } },
    };
    const result = await waitForAgent(true, 'human-reviewer', {});
    expect(result).toEqual({
      onSuccess: false,
      onFailure: true,
      agentResult: {},
    });
  });

  it('returns onFailure when mocks active with empty agents', async () => {
    (globalThis as unknown as Record<string, unknown>).__fw_mocks__ = { agents: {} };
    const result = await waitForAgent(true, 'human-reviewer', {});
    expect(result).toEqual({
      onSuccess: false,
      onFailure: true,
      agentResult: {},
    });
  });

  it('uses original no-op behavior when no mocks', async () => {
    const result = await waitForAgent(true, 'human-reviewer', {});
    expect(result).toEqual({
      onSuccess: true,
      onFailure: false,
      agentResult: {},
    });
  });

  it('returns inactive when execute=false', async () => {
    (globalThis as unknown as Record<string, unknown>).__fw_mocks__ = {
      agents: { 'human-reviewer': { approved: true } },
    };
    const result = await waitForAgent(false, 'human-reviewer', {});
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
    (globalThis as unknown as Record<string, unknown>).__fw_mocks__ = {
      events: { 'app/approved': { id: '1' } },
      invocations: { 'svc/fn': { ok: true } },
      fast: true,
    };

    const start = Date.now();
    const [delayResult, eventResult, invokeResult] = await Promise.all([
      delay(true, '1h'),
      waitForEvent(true, 'app/approved'),
      invokeWorkflow(true, 'svc/fn', {}),
    ]);
    expect(Date.now() - start).toBeLessThan(50);

    expect(delayResult).toEqual({ onSuccess: true, onFailure: false, elapsed: true });
    expect(eventResult.eventData).toEqual({ id: '1' });
    expect(invokeResult.result).toEqual({ ok: true });
  });

  it('multiple events for different nodes', async () => {
    (globalThis as unknown as Record<string, unknown>).__fw_mocks__ = {
      events: {
        'app/approved': { id: '1' },
        'app/payment.confirmed': { txId: 'tx-789' },
      },
    };

    const [r1, r2, r3] = await Promise.all([
      waitForEvent(true, 'app/approved'),
      waitForEvent(true, 'app/payment.confirmed'),
      waitForEvent(true, 'app/unknown'), // not in mocks
    ]);

    expect(r1.onSuccess).toBe(true);
    expect(r1.eventData).toEqual({ id: '1' });
    expect(r2.onSuccess).toBe(true);
    expect(r2.eventData).toEqual({ txId: 'tx-789' });
    expect(r3.onSuccess).toBe(false);
    expect(r3.onFailure).toBe(true);
  });
});
