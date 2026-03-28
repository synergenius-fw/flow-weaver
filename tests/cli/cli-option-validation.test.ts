/**
 * TDD tests for CLI option validation.
 *
 * Ensures options with numeric parsers reject invalid values.
 */

import { describe, it, expect } from 'vitest';
import { parseIntStrict } from '../../src/cli/utils/parse-int-strict';

describe('parseIntStrict', () => {
  it('parses valid integers', () => {
    expect(parseIntStrict('42')).toBe(42);
    expect(parseIntStrict('0')).toBe(0);
    expect(parseIntStrict('100')).toBe(100);
  });

  it('parses negative integers', () => {
    expect(parseIntStrict('-1')).toBe(-1);
  });

  it('throws on non-numeric strings', () => {
    expect(() => parseIntStrict('abc')).toThrow(/not a valid number/i);
    expect(() => parseIntStrict('')).toThrow(/not a valid number/i);
    expect(() => parseIntStrict('12abc')).toThrow(/not a valid number/i);
  });

  it('throws on float strings', () => {
    expect(() => parseIntStrict('3.14')).toThrow(/not a valid number/i);
  });

  it('throws on special values', () => {
    expect(() => parseIntStrict('NaN')).toThrow(/not a valid number/i);
    expect(() => parseIntStrict('Infinity')).toThrow(/not a valid number/i);
  });
});
