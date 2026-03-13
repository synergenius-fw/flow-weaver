/**
 * Additional coverage for trigger-cancel-parser.ts: edge cases for
 * parse error handling, empty inputs, grammar serialization, and
 * the throttle parser.
 */
import { describe, it, expect } from 'vitest';
import {
  parseTriggerLine,
  parseCancelOnLine,
  parseRetriesLine,
  parseTimeoutLine,
  parseThrottleLine,
  getTriggerCancelGrammar,
} from '../../src/chevrotain-parser/trigger-cancel-parser';

describe('parseTriggerLine edge cases', () => {
  it('returns null for empty string', () => {
    const w: string[] = [];
    expect(parseTriggerLine('', w)).toBeNull();
  });

  it('returns null for @trigger with no event or cron (CI/CD style)', () => {
    const w: string[] = [];
    // @trigger with no event=/cron= should return null so domain-specific
    // handlers can process it
    expect(parseTriggerLine('@trigger push', w)).toBeNull();
  });

  it('returns null for @trigger alone (no assignments)', () => {
    const w: string[] = [];
    expect(parseTriggerLine('@trigger', w)).toBeNull();
  });
});

describe('parseCancelOnLine edge cases', () => {
  it('returns null for empty string', () => {
    const w: string[] = [];
    expect(parseCancelOnLine('', w)).toBeNull();
  });

  it('returns null for non-cancelOn input', () => {
    const w: string[] = [];
    expect(parseCancelOnLine('@trigger event="x"', w)).toBeNull();
  });

  it('warns on parse error and returns null', () => {
    const w: string[] = [];
    // Missing event= value should cause a parse error
    const result = parseCancelOnLine('@cancelOn', w);
    expect(result).toBeNull();
    expect(w.length).toBeGreaterThan(0);
    expect(w[0]).toContain('Failed to parse cancelOn');
  });

  it('parses with all options (event, match, timeout)', () => {
    const w: string[] = [];
    const result = parseCancelOnLine(
      '@cancelOn event="app/user.deleted" match="data.userId" timeout="1h"',
      w,
    );
    expect(result).toEqual({
      event: 'app/user.deleted',
      match: 'data.userId',
      timeout: '1h',
    });
    expect(w).toHaveLength(0);
  });

  it('parses with event and match only', () => {
    const w: string[] = [];
    const result = parseCancelOnLine(
      '@cancelOn event="app/user.deleted" match="data.userId"',
      w,
    );
    expect(result).toEqual({
      event: 'app/user.deleted',
      match: 'data.userId',
    });
  });

  it('parses with event and timeout only', () => {
    const w: string[] = [];
    const result = parseCancelOnLine(
      '@cancelOn event="app/user.deleted" timeout="30m"',
      w,
    );
    expect(result).toEqual({
      event: 'app/user.deleted',
      timeout: '30m',
    });
  });
});

describe('parseRetriesLine edge cases', () => {
  it('returns null for empty string', () => {
    const w: string[] = [];
    expect(parseRetriesLine('', w)).toBeNull();
  });

  it('returns null for non-retries input', () => {
    const w: string[] = [];
    expect(parseRetriesLine('@timeout "30m"', w)).toBeNull();
  });

  it('warns on parse error (missing integer)', () => {
    const w: string[] = [];
    const result = parseRetriesLine('@retries', w);
    expect(result).toBeNull();
    expect(w.length).toBeGreaterThan(0);
    expect(w[0]).toContain('Failed to parse retries');
  });

  it('parses valid retries value', () => {
    const w: string[] = [];
    const result = parseRetriesLine('@retries 5', w);
    expect(result).toEqual({ retries: 5 });
    expect(w).toHaveLength(0);
  });
});

describe('parseTimeoutLine edge cases', () => {
  it('returns null for empty string', () => {
    const w: string[] = [];
    expect(parseTimeoutLine('', w)).toBeNull();
  });

  it('returns null for non-timeout input', () => {
    const w: string[] = [];
    expect(parseTimeoutLine('@retries 3', w)).toBeNull();
  });

  it('warns on parse error (missing string value)', () => {
    const w: string[] = [];
    const result = parseTimeoutLine('@timeout', w);
    expect(result).toBeNull();
    expect(w.length).toBeGreaterThan(0);
    expect(w[0]).toContain('Failed to parse timeout');
  });

  it('parses valid timeout value', () => {
    const w: string[] = [];
    const result = parseTimeoutLine('@timeout "30m"', w);
    expect(result).toEqual({ timeout: '30m' });
    expect(w).toHaveLength(0);
  });
});

describe('parseThrottleLine', () => {
  it('returns null for empty string', () => {
    const w: string[] = [];
    expect(parseThrottleLine('', w)).toBeNull();
  });

  it('returns null for non-throttle input', () => {
    const w: string[] = [];
    expect(parseThrottleLine('@retries 3', w)).toBeNull();
  });

  it('warns on parse error (missing limit)', () => {
    const w: string[] = [];
    const result = parseThrottleLine('@throttle', w);
    expect(result).toBeNull();
    expect(w.length).toBeGreaterThan(0);
    expect(w[0]).toContain('Failed to parse throttle');
  });

  it('parses limit only', () => {
    const w: string[] = [];
    const result = parseThrottleLine('@throttle limit=10', w);
    expect(result).toEqual({ limit: 10 });
    expect(w).toHaveLength(0);
  });

  it('parses limit and period', () => {
    const w: string[] = [];
    const result = parseThrottleLine('@throttle limit=5 period="1m"', w);
    expect(result).toEqual({ limit: 5, period: '1m' });
    expect(w).toHaveLength(0);
  });
});

describe('getTriggerCancelGrammar', () => {
  it('returns serialized grammar productions', () => {
    const grammar = getTriggerCancelGrammar();
    expect(grammar).toBeDefined();
    // Should be an array or object of grammar rules
    expect(typeof grammar).not.toBe('undefined');
  });
});
