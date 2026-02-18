/**
 * Parameter Resolver Unit Tests
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  resolveFunction,
  isFunctionLike,
  tryResolveFunction,
  type FunctionLike,
} from '../../src/runtime/parameter-resolver';
import { functionRegistry, FunctionRegistry } from '../../src/runtime/function-registry';

describe('resolveFunction', () => {
  // Save original registry state
  let originalSize: number;

  beforeAll(() => {
    originalSize = functionRegistry.size;

    // Register test functions
    if (!functionRegistry.has('string:upper')) {
      functionRegistry.register({
        id: 'string:upper',
        name: 'Uppercase',
        description: 'Convert to uppercase',
        category: 'transform',
        fn: (s: string) => s.toUpperCase(),
        inputType: 'string',
        outputType: 'string',
      });
    }

    if (!functionRegistry.has('math:clamp')) {
      functionRegistry.register({
        id: 'math:clamp',
        name: 'Clamp',
        description: 'Clamp a number',
        category: 'transform',
        fn: (input: { value: number; min: number; max: number }) =>
          Math.min(Math.max(input.value, input.min), input.max),
        inputType: 'object',
        outputType: 'number',
      });
    }
  });

  it('should pass through direct functions', () => {
    const directFn = (x: number) => x * 2;
    const resolved = resolveFunction(directFn);

    expect(resolved.source).toBe('direct');
    expect(resolved.fn(5)).toBe(10);
    expect(resolved.registryId).toBeUndefined();
  });

  it('should resolve string IDs from registry', () => {
    const resolved = resolveFunction<string, string>('string:upper');

    expect(resolved.source).toBe('registry');
    expect(resolved.registryId).toBe('string:upper');
    expect(resolved.fn('hello')).toBe('HELLO');
  });

  it('should handle partial application', () => {
    const resolved = resolveFunction({
      registryId: 'math:clamp',
      partialArgs: { min: 0, max: 100 },
    });

    expect(resolved.source).toBe('registry');
    expect(resolved.registryId).toBe('math:clamp');

    // The partial args should be merged with input
    const result = resolved.fn({ value: 150 } as any);
    expect(result).toBe(100);
  });

  it('should throw for unknown registry ID', () => {
    expect(() => resolveFunction('unknown:fn')).toThrow(/not found/);
  });

  it('should throw for invalid function parameter', () => {
    expect(() => resolveFunction(123 as any)).toThrow(/Invalid function parameter/);
    expect(() => resolveFunction(null as any)).toThrow(/Invalid function parameter/);
  });

  it('should work with arrow functions', () => {
    const arrow = (s: string) => s.split('').reverse().join('');
    const resolved = resolveFunction(arrow);

    expect(resolved.source).toBe('direct');
    expect(resolved.fn('hello')).toBe('olleh');
  });

  it('should work with async functions', async () => {
    const asyncFn = async (x: number) => {
      await new Promise((r) => setTimeout(r, 10));
      return x * 3;
    };

    const resolved = resolveFunction(asyncFn);
    expect(resolved.source).toBe('direct');

    const result = await resolved.fn(4);
    expect(result).toBe(12);
  });

  it('should work with closures', () => {
    const multiplier = 5;
    const closureFn = (x: number) => x * multiplier;

    const resolved = resolveFunction(closureFn);
    expect(resolved.fn(3)).toBe(15);
  });

  it('should handle registry ID without partial args', () => {
    const resolved = resolveFunction({ registryId: 'string:upper' });

    expect(resolved.source).toBe('registry');
    expect(resolved.registryId).toBe('string:upper');
    expect(resolved.fn('test')).toBe('TEST');
  });
});

describe('isFunctionLike', () => {
  it('should return true for functions', () => {
    expect(isFunctionLike(() => {})).toBe(true);
    expect(isFunctionLike(function () {})).toBe(true);
    expect(isFunctionLike(async () => {})).toBe(true);
  });

  it('should return true for strings', () => {
    expect(isFunctionLike('string:upper')).toBe(true);
    expect(isFunctionLike('')).toBe(true);
  });

  it('should return true for registry ID objects', () => {
    expect(isFunctionLike({ registryId: 'string:upper' })).toBe(true);
    expect(isFunctionLike({ registryId: 'math:clamp', partialArgs: { min: 0 } })).toBe(true);
  });

  it('should return false for invalid types', () => {
    expect(isFunctionLike(123)).toBe(false);
    expect(isFunctionLike(null)).toBe(false);
    expect(isFunctionLike(undefined)).toBe(false);
    expect(isFunctionLike({})).toBe(false);
    expect(isFunctionLike({ foo: 'bar' })).toBe(false);
  });
});

describe('tryResolveFunction', () => {
  it('should return resolved function for valid input', () => {
    const result = tryResolveFunction((x: number) => x);
    expect(result).toBeDefined();
    expect(result!.source).toBe('direct');
  });

  it('should return undefined for invalid input', () => {
    const result = tryResolveFunction('nonexistent:function');
    expect(result).toBeUndefined();
  });
});
