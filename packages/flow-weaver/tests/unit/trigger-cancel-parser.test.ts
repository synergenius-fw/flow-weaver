/**
 * Tests for the trigger-cancel Chevrotain parser.
 *
 * Tests parseTriggerLine, parseCancelOnLine, parseRetriesLine, parseTimeoutLine, parseThrottleLine.
 */

import { describe, it, expect } from 'vitest';
import {
  parseTriggerLine,
  parseCancelOnLine,
  parseRetriesLine,
  parseTimeoutLine,
  parseThrottleLine,
} from '../../src/chevrotain-parser';

describe('parseTriggerLine', () => {
  it('parses event trigger', () => {
    const w: string[] = [];
    const result = parseTriggerLine('@trigger event="agent/request"', w);
    expect(result).toEqual({ event: 'agent/request' });
    expect(w).toHaveLength(0);
  });

  it('parses cron trigger', () => {
    const w: string[] = [];
    const result = parseTriggerLine('@trigger cron="0 9 * * *"', w);
    expect(result).toEqual({ cron: '0 9 * * *' });
    expect(w).toHaveLength(0);
  });

  it('parses both event and cron on same line', () => {
    const w: string[] = [];
    const result = parseTriggerLine('@trigger event="agent/request" cron="0 9 * * *"', w);
    expect(result).toEqual({ event: 'agent/request', cron: '0 9 * * *' });
    expect(w).toHaveLength(0);
  });

  it('warns on invalid cron expression', () => {
    const w: string[] = [];
    const result = parseTriggerLine('@trigger cron="not-a-cron"', w);
    expect(result).not.toBeNull();
    expect(w.length).toBeGreaterThan(0);
    expect(w[0]).toContain('Invalid cron');
  });

  it('returns null for non-trigger input', () => {
    const w: string[] = [];
    const result = parseTriggerLine('@connect a.b -> c.d', w);
    expect(result).toBeNull();
  });
});

describe('parseCancelOnLine', () => {
  it('parses event only', () => {
    const w: string[] = [];
    const result = parseCancelOnLine('@cancelOn event="app/user.deleted"', w);
    expect(result).toEqual({ event: 'app/user.deleted' });
    expect(w).toHaveLength(0);
  });

  it('parses event with match', () => {
    const w: string[] = [];
    const result = parseCancelOnLine('@cancelOn event="app/user.deleted" match="data.userId"', w);
    expect(result).toEqual({ event: 'app/user.deleted', match: 'data.userId' });
    expect(w).toHaveLength(0);
  });

  it('parses event with match and timeout', () => {
    const w: string[] = [];
    const result = parseCancelOnLine('@cancelOn event="x" match="data.id" timeout="1h"', w);
    expect(result).toEqual({ event: 'x', match: 'data.id', timeout: '1h' });
    expect(w).toHaveLength(0);
  });
});

describe('parseRetriesLine', () => {
  it('parses integer value', () => {
    const w: string[] = [];
    const result = parseRetriesLine('@retries 5', w);
    expect(result).toEqual({ retries: 5 });
    expect(w).toHaveLength(0);
  });

  it('warns on negative value', () => {
    const w: string[] = [];
    const result = parseRetriesLine('@retries -1', w);
    expect(result).not.toBeNull();
    expect(w.length).toBeGreaterThan(0);
    expect(w[0]).toContain('non-negative');
  });
});

describe('parseTimeoutLine', () => {
  it('parses quoted duration', () => {
    const w: string[] = [];
    const result = parseTimeoutLine('@timeout "30m"', w);
    expect(result).toEqual({ timeout: '30m' });
    expect(w).toHaveLength(0);
  });

  it('parses long duration', () => {
    const w: string[] = [];
    const result = parseTimeoutLine('@timeout "2h"', w);
    expect(result).toEqual({ timeout: '2h' });
    expect(w).toHaveLength(0);
  });
});

describe('parseThrottleLine', () => {
  it('parses limit and period', () => {
    const w: string[] = [];
    const result = parseThrottleLine('@throttle limit=3 period="1m"', w);
    expect(result).toEqual({ limit: 3, period: '1m' });
    expect(w).toHaveLength(0);
  });

  it('parses limit only (period optional)', () => {
    const w: string[] = [];
    const result = parseThrottleLine('@throttle limit=10', w);
    expect(result).toEqual({ limit: 10 });
    expect(w).toHaveLength(0);
  });
});
