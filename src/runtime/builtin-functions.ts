/**
 * Built-in Functions for Flow Weaver
 *
 * Registers common utility functions in the global function registry.
 * These functions can be referenced by their string IDs in external HTTP calls.
 */

import { functionRegistry } from './function-registry';

// ============================================================================
// String Transforms
// ============================================================================

functionRegistry.register({
  id: 'string:uppercase',
  name: 'Uppercase',
  description: 'Convert string to uppercase',
  category: 'transform',
  fn: (input: string) => input.toUpperCase(),
  inputType: 'string',
  outputType: 'string',
  examples: [{ input: 'hello', output: 'HELLO' }],
});

functionRegistry.register({
  id: 'string:lowercase',
  name: 'Lowercase',
  description: 'Convert string to lowercase',
  category: 'transform',
  fn: (input: string) => input.toLowerCase(),
  inputType: 'string',
  outputType: 'string',
  examples: [{ input: 'HELLO', output: 'hello' }],
});

functionRegistry.register({
  id: 'string:trim',
  name: 'Trim',
  description: 'Remove whitespace from both ends of a string',
  category: 'transform',
  fn: (input: string) => input.trim(),
  inputType: 'string',
  outputType: 'string',
  examples: [{ input: '  hello  ', output: 'hello' }],
});

functionRegistry.register({
  id: 'string:truncate',
  name: 'Truncate',
  description: 'Truncate string to specified length with ellipsis',
  category: 'transform',
  fn: (input: { text: string; maxLength: number; suffix?: string }) => {
    const { text, maxLength, suffix = '...' } = input;
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength - suffix.length) + suffix;
  },
  inputType: 'object',
  outputType: 'string',
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string' },
      maxLength: { type: 'number' },
      suffix: { type: 'string', default: '...' },
    },
    required: ['text', 'maxLength'],
  },
  examples: [
    { input: { text: 'Hello World', maxLength: 8 }, output: 'Hello...' },
  ],
});

functionRegistry.register({
  id: 'string:split',
  name: 'Split',
  description: 'Split string by delimiter',
  category: 'transform',
  fn: (input: { text: string; delimiter: string }) => input.text.split(input.delimiter),
  inputType: 'object',
  outputType: 'array',
  examples: [
    { input: { text: 'a,b,c', delimiter: ',' }, output: ['a', 'b', 'c'] },
  ],
});

functionRegistry.register({
  id: 'string:join',
  name: 'Join',
  description: 'Join array elements with delimiter',
  category: 'transform',
  fn: (input: { items: string[]; delimiter: string }) => input.items.join(input.delimiter),
  inputType: 'object',
  outputType: 'string',
  examples: [
    { input: { items: ['a', 'b', 'c'], delimiter: ',' }, output: 'a,b,c' },
  ],
});

functionRegistry.register({
  id: 'string:prefix',
  name: 'Prefix',
  description: 'Add prefix to string',
  category: 'transform',
  fn: (input: { text: string; prefix: string }) => input.prefix + input.text,
  inputType: 'object',
  outputType: 'string',
  examples: [
    { input: { text: 'world', prefix: 'hello ' }, output: 'hello world' },
  ],
});

functionRegistry.register({
  id: 'string:suffix',
  name: 'Suffix',
  description: 'Add suffix to string',
  category: 'transform',
  fn: (input: { text: string; suffix: string }) => input.text + input.suffix,
  inputType: 'object',
  outputType: 'string',
  examples: [
    { input: { text: 'hello', suffix: ' world' }, output: 'hello world' },
  ],
});

// ============================================================================
// Number Transforms
// ============================================================================

functionRegistry.register({
  id: 'number:double',
  name: 'Double',
  description: 'Double a number',
  category: 'transform',
  fn: (input: number) => input * 2,
  inputType: 'number',
  outputType: 'number',
  examples: [{ input: 5, output: 10 }],
});

functionRegistry.register({
  id: 'number:round',
  name: 'Round',
  description: 'Round a number to specified decimal places',
  category: 'transform',
  fn: (input: { value: number; decimals?: number }) => {
    const { value, decimals = 0 } = input;
    const factor = Math.pow(10, decimals);
    return Math.round(value * factor) / factor;
  },
  inputType: 'object',
  outputType: 'number',
  examples: [
    { input: { value: 3.14159, decimals: 2 }, output: 3.14 },
  ],
});

functionRegistry.register({
  id: 'number:clamp',
  name: 'Clamp',
  description: 'Clamp a number between min and max values',
  category: 'transform',
  fn: (input: { value: number; min: number; max: number }) => {
    const { value, min, max } = input;
    return Math.min(Math.max(value, min), max);
  },
  inputType: 'object',
  outputType: 'number',
  inputSchema: {
    type: 'object',
    properties: {
      value: { type: 'number' },
      min: { type: 'number' },
      max: { type: 'number' },
    },
    required: ['value', 'min', 'max'],
  },
  examples: [
    { input: { value: 150, min: 0, max: 100 }, output: 100 },
    { input: { value: -10, min: 0, max: 100 }, output: 0 },
    { input: { value: 50, min: 0, max: 100 }, output: 50 },
  ],
});

functionRegistry.register({
  id: 'number:abs',
  name: 'Absolute',
  description: 'Get absolute value of a number',
  category: 'transform',
  fn: (input: number) => Math.abs(input),
  inputType: 'number',
  outputType: 'number',
  examples: [{ input: -5, output: 5 }],
});

functionRegistry.register({
  id: 'number:negate',
  name: 'Negate',
  description: 'Negate a number',
  category: 'transform',
  fn: (input: number) => -input,
  inputType: 'number',
  outputType: 'number',
  examples: [{ input: 5, output: -5 }],
});

// ============================================================================
// Array Transforms
// ============================================================================

functionRegistry.register({
  id: 'array:first',
  name: 'First',
  description: 'Get first element of array',
  category: 'transform',
  fn: <T>(input: T[]) => input[0],
  inputType: 'array',
  outputType: 'any',
  examples: [{ input: [1, 2, 3], output: 1 }],
});

functionRegistry.register({
  id: 'array:last',
  name: 'Last',
  description: 'Get last element of array',
  category: 'transform',
  fn: <T>(input: T[]) => input[input.length - 1],
  inputType: 'array',
  outputType: 'any',
  examples: [{ input: [1, 2, 3], output: 3 }],
});

functionRegistry.register({
  id: 'array:reverse',
  name: 'Reverse',
  description: 'Reverse array order',
  category: 'transform',
  fn: <T>(input: T[]) => [...input].reverse(),
  inputType: 'array',
  outputType: 'array',
  examples: [{ input: [1, 2, 3], output: [3, 2, 1] }],
});

functionRegistry.register({
  id: 'array:unique',
  name: 'Unique',
  description: 'Remove duplicate elements from array',
  category: 'transform',
  fn: <T>(input: T[]) => [...new Set(input)],
  inputType: 'array',
  outputType: 'array',
  examples: [{ input: [1, 2, 2, 3, 3, 3], output: [1, 2, 3] }],
});

functionRegistry.register({
  id: 'array:flatten',
  name: 'Flatten',
  description: 'Flatten nested arrays by one level',
  category: 'transform',
  fn: <T>(input: T[][]) => input.flat(),
  inputType: 'array',
  outputType: 'array',
  examples: [{ input: [[1, 2], [3, 4]], output: [1, 2, 3, 4] }],
});

functionRegistry.register({
  id: 'array:sort',
  name: 'Sort',
  description: 'Sort array elements',
  category: 'transform',
  fn: <T>(input: T[]) => [...input].sort(),
  inputType: 'array',
  outputType: 'array',
  examples: [{ input: [3, 1, 2], output: [1, 2, 3] }],
});

functionRegistry.register({
  id: 'array:length',
  name: 'Length',
  description: 'Get array length',
  category: 'transform',
  fn: <T>(input: T[]) => input.length,
  inputType: 'array',
  outputType: 'number',
  examples: [{ input: [1, 2, 3], output: 3 }],
});

// ============================================================================
// Object Transforms
// ============================================================================

functionRegistry.register({
  id: 'object:pick',
  name: 'Pick',
  description: 'Pick specified keys from object',
  category: 'transform',
  fn: (input: { obj: Record<string, unknown>; keys: string[] }) => {
    const { obj, keys } = input;
    const result: Record<string, unknown> = {};
    for (const key of keys) {
      if (key in obj) {
        result[key] = obj[key];
      }
    }
    return result;
  },
  inputType: 'object',
  outputType: 'object',
  examples: [
    { input: { obj: { a: 1, b: 2, c: 3 }, keys: ['a', 'c'] }, output: { a: 1, c: 3 } },
  ],
});

functionRegistry.register({
  id: 'object:omit',
  name: 'Omit',
  description: 'Omit specified keys from object',
  category: 'transform',
  fn: (input: { obj: Record<string, unknown>; keys: string[] }) => {
    const { obj, keys } = input;
    const keySet = new Set(keys);
    const result: Record<string, unknown> = {};
    for (const key in obj) {
      if (!keySet.has(key)) {
        result[key] = obj[key];
      }
    }
    return result;
  },
  inputType: 'object',
  outputType: 'object',
  examples: [
    { input: { obj: { a: 1, b: 2, c: 3 }, keys: ['b'] }, output: { a: 1, c: 3 } },
  ],
});

functionRegistry.register({
  id: 'object:get',
  name: 'Get',
  description: 'Get value at path from object',
  category: 'transform',
  fn: (input: { obj: Record<string, unknown>; path: string }) => {
    const { obj, path } = input;
    const keys = path.split('.');
    let current: unknown = obj;
    for (const key of keys) {
      if (current === null || current === undefined) return undefined;
      current = (current as Record<string, unknown>)[key];
    }
    return current;
  },
  inputType: 'object',
  outputType: 'any',
  examples: [
    { input: { obj: { a: { b: { c: 42 } } }, path: 'a.b.c' }, output: 42 },
  ],
});

functionRegistry.register({
  id: 'object:keys',
  name: 'Keys',
  description: 'Get object keys',
  category: 'transform',
  fn: (input: Record<string, unknown>) => Object.keys(input),
  inputType: 'object',
  outputType: 'array',
  examples: [
    { input: { a: 1, b: 2 }, output: ['a', 'b'] },
  ],
});

functionRegistry.register({
  id: 'object:values',
  name: 'Values',
  description: 'Get object values',
  category: 'transform',
  fn: (input: Record<string, unknown>) => Object.values(input),
  inputType: 'object',
  outputType: 'array',
  examples: [
    { input: { a: 1, b: 2 }, output: [1, 2] },
  ],
});

// ============================================================================
// Filters
// ============================================================================

functionRegistry.register({
  id: 'filter:truthy',
  name: 'Truthy',
  description: 'Filter to only truthy values',
  category: 'filter',
  fn: <T>(input: T[]) => input.filter(Boolean),
  inputType: 'array',
  outputType: 'array',
  examples: [{ input: [0, 1, '', 'hello', null, true], output: [1, 'hello', true] }],
});

functionRegistry.register({
  id: 'filter:nonEmpty',
  name: 'Non-Empty',
  description: 'Filter out empty strings and arrays',
  category: 'filter',
  fn: <T>(input: T[]) =>
    input.filter((x) => {
      if (typeof x === 'string') return x.length > 0;
      if (Array.isArray(x)) return x.length > 0;
      return true;
    }),
  inputType: 'array',
  outputType: 'array',
  examples: [{ input: ['hello', '', 'world', []], output: ['hello', 'world'] }],
});

functionRegistry.register({
  id: 'filter:greaterThan',
  name: 'Greater Than',
  description: 'Filter numbers greater than threshold',
  category: 'filter',
  fn: (input: { items: number[]; threshold: number }) =>
    input.items.filter((n) => n > input.threshold),
  inputType: 'object',
  outputType: 'array',
  examples: [
    { input: { items: [1, 5, 10, 15], threshold: 7 }, output: [10, 15] },
  ],
});

functionRegistry.register({
  id: 'filter:lessThan',
  name: 'Less Than',
  description: 'Filter numbers less than threshold',
  category: 'filter',
  fn: (input: { items: number[]; threshold: number }) =>
    input.items.filter((n) => n < input.threshold),
  inputType: 'object',
  outputType: 'array',
  examples: [
    { input: { items: [1, 5, 10, 15], threshold: 7 }, output: [1, 5] },
  ],
});

// ============================================================================
// Validators
// ============================================================================

functionRegistry.register({
  id: 'validate:email',
  name: 'Email',
  description: 'Validate email address format',
  category: 'validate',
  fn: (input: string) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(input);
  },
  inputType: 'string',
  outputType: 'boolean',
  examples: [
    { input: 'test@example.com', output: true },
    { input: 'invalid', output: false },
  ],
});

functionRegistry.register({
  id: 'validate:url',
  name: 'URL',
  description: 'Validate URL format',
  category: 'validate',
  fn: (input: string) => {
    try {
      new URL(input);
      return true;
    } catch {
      return false;
    }
  },
  inputType: 'string',
  outputType: 'boolean',
  examples: [
    { input: 'https://example.com', output: true },
    { input: 'not-a-url', output: false },
  ],
});

functionRegistry.register({
  id: 'validate:nonEmpty',
  name: 'Non-Empty',
  description: 'Validate string is not empty',
  category: 'validate',
  fn: (input: string) => input.trim().length > 0,
  inputType: 'string',
  outputType: 'boolean',
  examples: [
    { input: 'hello', output: true },
    { input: '', output: false },
    { input: '   ', output: false },
  ],
});

functionRegistry.register({
  id: 'validate:numeric',
  name: 'Numeric',
  description: 'Validate string is numeric',
  category: 'validate',
  fn: (input: string) => !isNaN(Number(input)) && input.trim() !== '',
  inputType: 'string',
  outputType: 'boolean',
  examples: [
    { input: '123', output: true },
    { input: '12.34', output: true },
    { input: 'abc', output: false },
  ],
});

// ============================================================================
// Formatters
// ============================================================================

functionRegistry.register({
  id: 'format:json',
  name: 'JSON',
  description: 'Format value as JSON string',
  category: 'format',
  fn: (input: unknown) => JSON.stringify(input, null, 2),
  inputType: 'any',
  outputType: 'string',
  examples: [
    { input: { a: 1 }, output: '{\n  "a": 1\n}' },
  ],
});

functionRegistry.register({
  id: 'format:jsonCompact',
  name: 'JSON Compact',
  description: 'Format value as compact JSON string',
  category: 'format',
  fn: (input: unknown) => JSON.stringify(input),
  inputType: 'any',
  outputType: 'string',
  examples: [
    { input: { a: 1 }, output: '{"a":1}' },
  ],
});

functionRegistry.register({
  id: 'format:date',
  name: 'Date',
  description: 'Format date to ISO string or custom format',
  category: 'format',
  fn: (input: Date | string | number) => {
    const date = input instanceof Date ? input : new Date(input);
    return date.toISOString();
  },
  inputType: 'any',
  outputType: 'string',
  examples: [
    { input: '2024-01-15', output: '2024-01-15T00:00:00.000Z' },
  ],
});

functionRegistry.register({
  id: 'format:currency',
  name: 'Currency',
  description: 'Format number as currency',
  category: 'format',
  fn: (input: { value: number; currency?: string; locale?: string }) => {
    const { value, currency = 'USD', locale = 'en-US' } = input;
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(value);
  },
  inputType: 'object',
  outputType: 'string',
  examples: [
    { input: { value: 1234.56 }, output: '$1,234.56' },
  ],
});

functionRegistry.register({
  id: 'format:percentage',
  name: 'Percentage',
  description: 'Format number as percentage',
  category: 'format',
  fn: (input: { value: number; decimals?: number }) => {
    const { value, decimals = 0 } = input;
    return `${(value * 100).toFixed(decimals)}%`;
  },
  inputType: 'object',
  outputType: 'string',
  examples: [
    { input: { value: 0.75 }, output: '75%' },
    { input: { value: 0.756, decimals: 1 }, output: '75.6%' },
  ],
});
