/**
 * Built-in Functions Tests
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { functionRegistry } from '../../src/runtime/function-registry';
// Import to ensure built-in functions are registered
import '../../src/runtime/builtin-functions';

describe('Built-in Functions', () => {
  describe('String transforms', () => {
    it('string:uppercase', () => {
      const fn = functionRegistry.get<string, string>('string:uppercase');
      expect(fn).toBeDefined();
      expect(fn!('hello')).toBe('HELLO');
      expect(fn!('Hello World')).toBe('HELLO WORLD');
    });

    it('string:lowercase', () => {
      const fn = functionRegistry.get<string, string>('string:lowercase');
      expect(fn).toBeDefined();
      expect(fn!('HELLO')).toBe('hello');
      expect(fn!('Hello World')).toBe('hello world');
    });

    it('string:trim', () => {
      const fn = functionRegistry.get<string, string>('string:trim');
      expect(fn).toBeDefined();
      expect(fn!('  hello  ')).toBe('hello');
      expect(fn!('\t\nhello\n\t')).toBe('hello');
    });

    it('string:truncate', () => {
      const fn = functionRegistry.get<{ text: string; maxLength: number; suffix?: string }, string>(
        'string:truncate'
      );
      expect(fn).toBeDefined();
      expect(fn!({ text: 'Hello World', maxLength: 8 })).toBe('Hello...');
      expect(fn!({ text: 'Hi', maxLength: 10 })).toBe('Hi');
      expect(fn!({ text: 'Hello World', maxLength: 8, suffix: '---' })).toBe('Hello---');
    });

    it('string:split', () => {
      const fn = functionRegistry.get<{ text: string; delimiter: string }, string[]>('string:split');
      expect(fn).toBeDefined();
      expect(fn!({ text: 'a,b,c', delimiter: ',' })).toEqual(['a', 'b', 'c']);
    });

    it('string:join', () => {
      const fn = functionRegistry.get<{ items: string[]; delimiter: string }, string>('string:join');
      expect(fn).toBeDefined();
      expect(fn!({ items: ['a', 'b', 'c'], delimiter: ',' })).toBe('a,b,c');
    });

    it('string:prefix', () => {
      const fn = functionRegistry.get<{ text: string; prefix: string }, string>('string:prefix');
      expect(fn).toBeDefined();
      expect(fn!({ text: 'world', prefix: 'hello ' })).toBe('hello world');
    });

    it('string:suffix', () => {
      const fn = functionRegistry.get<{ text: string; suffix: string }, string>('string:suffix');
      expect(fn).toBeDefined();
      expect(fn!({ text: 'hello', suffix: ' world' })).toBe('hello world');
    });
  });

  describe('Number transforms', () => {
    it('number:double', () => {
      const fn = functionRegistry.get<number, number>('number:double');
      expect(fn).toBeDefined();
      expect(fn!(5)).toBe(10);
      expect(fn!(-3)).toBe(-6);
    });

    it('number:round', () => {
      const fn = functionRegistry.get<{ value: number; decimals?: number }, number>('number:round');
      expect(fn).toBeDefined();
      expect(fn!({ value: 3.14159, decimals: 2 })).toBe(3.14);
      expect(fn!({ value: 3.5 })).toBe(4);
    });

    it('number:clamp', () => {
      const fn = functionRegistry.get<{ value: number; min: number; max: number }, number>(
        'number:clamp'
      );
      expect(fn).toBeDefined();
      expect(fn!({ value: 150, min: 0, max: 100 })).toBe(100);
      expect(fn!({ value: -10, min: 0, max: 100 })).toBe(0);
      expect(fn!({ value: 50, min: 0, max: 100 })).toBe(50);
    });

    it('number:abs', () => {
      const fn = functionRegistry.get<number, number>('number:abs');
      expect(fn).toBeDefined();
      expect(fn!(-5)).toBe(5);
      expect(fn!(5)).toBe(5);
    });

    it('number:negate', () => {
      const fn = functionRegistry.get<number, number>('number:negate');
      expect(fn).toBeDefined();
      expect(fn!(5)).toBe(-5);
      expect(fn!(-5)).toBe(5);
    });
  });

  describe('Array transforms', () => {
    it('array:first', () => {
      const fn = functionRegistry.get<unknown[], unknown>('array:first');
      expect(fn).toBeDefined();
      expect(fn!([1, 2, 3])).toBe(1);
      expect(fn!([])).toBeUndefined();
    });

    it('array:last', () => {
      const fn = functionRegistry.get<unknown[], unknown>('array:last');
      expect(fn).toBeDefined();
      expect(fn!([1, 2, 3])).toBe(3);
      expect(fn!([])).toBeUndefined();
    });

    it('array:reverse', () => {
      const fn = functionRegistry.get<unknown[], unknown[]>('array:reverse');
      expect(fn).toBeDefined();
      expect(fn!([1, 2, 3])).toEqual([3, 2, 1]);
      // Should not mutate original
      const original = [1, 2, 3];
      fn!(original);
      expect(original).toEqual([1, 2, 3]);
    });

    it('array:unique', () => {
      const fn = functionRegistry.get<unknown[], unknown[]>('array:unique');
      expect(fn).toBeDefined();
      expect(fn!([1, 2, 2, 3, 3, 3])).toEqual([1, 2, 3]);
      expect(fn!(['a', 'b', 'a'])).toEqual(['a', 'b']);
    });

    it('array:flatten', () => {
      const fn = functionRegistry.get<unknown[][], unknown[]>('array:flatten');
      expect(fn).toBeDefined();
      expect(fn!([[1, 2], [3, 4]])).toEqual([1, 2, 3, 4]);
    });

    it('array:sort', () => {
      const fn = functionRegistry.get<unknown[], unknown[]>('array:sort');
      expect(fn).toBeDefined();
      expect(fn!([3, 1, 2])).toEqual([1, 2, 3]);
    });

    it('array:length', () => {
      const fn = functionRegistry.get<unknown[], number>('array:length');
      expect(fn).toBeDefined();
      expect(fn!([1, 2, 3])).toBe(3);
      expect(fn!([])).toBe(0);
    });
  });

  describe('Object transforms', () => {
    it('object:pick', () => {
      const fn = functionRegistry.get<
        { obj: Record<string, unknown>; keys: string[] },
        Record<string, unknown>
      >('object:pick');
      expect(fn).toBeDefined();
      expect(fn!({ obj: { a: 1, b: 2, c: 3 }, keys: ['a', 'c'] })).toEqual({ a: 1, c: 3 });
    });

    it('object:omit', () => {
      const fn = functionRegistry.get<
        { obj: Record<string, unknown>; keys: string[] },
        Record<string, unknown>
      >('object:omit');
      expect(fn).toBeDefined();
      expect(fn!({ obj: { a: 1, b: 2, c: 3 }, keys: ['b'] })).toEqual({ a: 1, c: 3 });
    });

    it('object:get', () => {
      const fn = functionRegistry.get<{ obj: Record<string, unknown>; path: string }, unknown>(
        'object:get'
      );
      expect(fn).toBeDefined();
      expect(fn!({ obj: { a: { b: { c: 42 } } }, path: 'a.b.c' })).toBe(42);
      expect(fn!({ obj: { a: 1 }, path: 'b.c' })).toBeUndefined();
    });

    it('object:keys', () => {
      const fn = functionRegistry.get<Record<string, unknown>, string[]>('object:keys');
      expect(fn).toBeDefined();
      expect(fn!({ a: 1, b: 2 })).toEqual(['a', 'b']);
    });

    it('object:values', () => {
      const fn = functionRegistry.get<Record<string, unknown>, unknown[]>('object:values');
      expect(fn).toBeDefined();
      expect(fn!({ a: 1, b: 2 })).toEqual([1, 2]);
    });
  });

  describe('Filters', () => {
    it('filter:truthy', () => {
      const fn = functionRegistry.get<unknown[], unknown[]>('filter:truthy');
      expect(fn).toBeDefined();
      expect(fn!([0, 1, '', 'hello', null, true, false])).toEqual([1, 'hello', true]);
    });

    it('filter:nonEmpty', () => {
      const fn = functionRegistry.get<unknown[], unknown[]>('filter:nonEmpty');
      expect(fn).toBeDefined();
      expect(fn!(['hello', '', 'world', []])).toEqual(['hello', 'world']);
    });

    it('filter:greaterThan', () => {
      const fn = functionRegistry.get<{ items: number[]; threshold: number }, number[]>(
        'filter:greaterThan'
      );
      expect(fn).toBeDefined();
      expect(fn!({ items: [1, 5, 10, 15], threshold: 7 })).toEqual([10, 15]);
    });

    it('filter:lessThan', () => {
      const fn = functionRegistry.get<{ items: number[]; threshold: number }, number[]>(
        'filter:lessThan'
      );
      expect(fn).toBeDefined();
      expect(fn!({ items: [1, 5, 10, 15], threshold: 7 })).toEqual([1, 5]);
    });
  });

  describe('Validators', () => {
    it('validate:email', () => {
      const fn = functionRegistry.get<string, boolean>('validate:email');
      expect(fn).toBeDefined();
      expect(fn!('test@example.com')).toBe(true);
      expect(fn!('invalid')).toBe(false);
      expect(fn!('user@domain.co.uk')).toBe(true);
    });

    it('validate:url', () => {
      const fn = functionRegistry.get<string, boolean>('validate:url');
      expect(fn).toBeDefined();
      expect(fn!('https://example.com')).toBe(true);
      expect(fn!('http://localhost:3000')).toBe(true);
      expect(fn!('not-a-url')).toBe(false);
    });

    it('validate:nonEmpty', () => {
      const fn = functionRegistry.get<string, boolean>('validate:nonEmpty');
      expect(fn).toBeDefined();
      expect(fn!('hello')).toBe(true);
      expect(fn!('')).toBe(false);
      expect(fn!('   ')).toBe(false);
    });

    it('validate:numeric', () => {
      const fn = functionRegistry.get<string, boolean>('validate:numeric');
      expect(fn).toBeDefined();
      expect(fn!('123')).toBe(true);
      expect(fn!('12.34')).toBe(true);
      expect(fn!('abc')).toBe(false);
      expect(fn!('')).toBe(false);
    });
  });

  describe('Formatters', () => {
    it('format:json', () => {
      const fn = functionRegistry.get<unknown, string>('format:json');
      expect(fn).toBeDefined();
      expect(fn!({ a: 1 })).toBe('{\n  "a": 1\n}');
    });

    it('format:jsonCompact', () => {
      const fn = functionRegistry.get<unknown, string>('format:jsonCompact');
      expect(fn).toBeDefined();
      expect(fn!({ a: 1 })).toBe('{"a":1}');
    });

    it('format:date', () => {
      const fn = functionRegistry.get<Date | string | number, string>('format:date');
      expect(fn).toBeDefined();
      const result = fn!('2024-01-15');
      expect(result).toContain('2024-01-15');
    });

    it('format:currency', () => {
      const fn = functionRegistry.get<
        { value: number; currency?: string; locale?: string },
        string
      >('format:currency');
      expect(fn).toBeDefined();
      const result = fn!({ value: 1234.56 });
      expect(result).toContain('1,234.56');
    });

    it('format:percentage', () => {
      const fn = functionRegistry.get<{ value: number; decimals?: number }, string>(
        'format:percentage'
      );
      expect(fn).toBeDefined();
      expect(fn!({ value: 0.75 })).toBe('75%');
      expect(fn!({ value: 0.756, decimals: 1 })).toBe('75.6%');
    });
  });

  describe('Registry completeness', () => {
    it('should have all expected categories', () => {
      const transforms = functionRegistry.list('transform');
      const filters = functionRegistry.list('filter');
      const validators = functionRegistry.list('validate');
      const formatters = functionRegistry.list('format');

      expect(transforms.length).toBeGreaterThan(0);
      expect(filters.length).toBeGreaterThan(0);
      expect(validators.length).toBeGreaterThan(0);
      expect(formatters.length).toBeGreaterThan(0);
    });

    it('should have metadata for all functions', () => {
      const all = functionRegistry.list();

      for (const fn of all) {
        expect(fn.id).toBeDefined();
        expect(fn.name).toBeDefined();
        expect(fn.description).toBeDefined();
        expect(fn.category).toBeDefined();
        expect(fn.inputType).toBeDefined();
        expect(fn.outputType).toBeDefined();
      }
    });
  });
});
