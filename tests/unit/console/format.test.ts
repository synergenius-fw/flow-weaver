/**
 * Durations and relative times as a person reads them. A waiting run once
 * showed `84880.0 s`.
 */
import { describe, it, expect } from 'vitest';
import { ms, ago } from '../../../console-ui/src/format';

describe('ms', () => {
  it('scales from milliseconds to hours', () => {
    expect(ms(0.4)).toBe('<1 ms');
    expect(ms(12)).toBe('12 ms');
    expect(ms(2750)).toBe('2.75 s');
    expect(ms(13_200)).toBe('13.2 s');
    expect(ms(84_880)).toBe('1m 25s');
    expect(ms(84_880_000)).toBe('23h 35m');
    expect(ms(null)).toBe('');
  });
});

describe('ago', () => {
  it('says seconds, minutes, hours, days', () => {
    const t = Date.now();
    expect(ago(t - 5_000)).toBe('5s ago');
    expect(ago(t - 5 * 60_000)).toBe('5m ago');
    expect(ago(t - 25 * 3_600_000)).toBe('1d ago');
    expect(ago(t - 2 * 3_600_000)).toBe('2h ago');
  });
});
