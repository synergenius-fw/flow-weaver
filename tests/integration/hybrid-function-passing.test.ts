/**
 * Hybrid Function Passing E2E Tests
 *
 * Tests the ability to pass functions both directly (internal calls)
 * and via registry IDs (external HTTP calls).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { resolveFunction, type FunctionLike } from '../../src/runtime/parameter-resolver';
import { functionRegistry } from '../../src/runtime/function-registry';
// Import to ensure built-in functions are registered
import '../../src/runtime/builtin-functions';

describe('Hybrid Function Passing E2E', () => {
  // Simulated workflow that accepts function parameter
  function processItems<T>(
    execute: boolean,
    params: { items: T[]; transform: FunctionLike<T, T> }
  ): { results: T[]; onSuccess: boolean } {
    if (!execute) return { results: [], onSuccess: false };

    const { fn } = resolveFunction(params.transform);
    const results = params.items.map(fn) as T[];
    return { results, onSuccess: true };
  }

  it('should work with direct function (internal call)', () => {
    const result = processItems(true, {
      items: ['hello', 'world'],
      transform: (s: string) => s.toUpperCase(), // Direct function
    });

    expect(result.results).toEqual(['HELLO', 'WORLD']);
    expect(result.onSuccess).toBe(true);
  });

  it('should work with registry ID (external call)', () => {
    const result = processItems(true, {
      items: ['hello', 'world'],
      transform: 'string:uppercase', // Registry ID
    });

    expect(result.results).toEqual(['HELLO', 'WORLD']);
    expect(result.onSuccess).toBe(true);
  });

  it('should work with closure capturing local scope', () => {
    const prefix = 'Result: ';

    const result = processItems(true, {
      items: ['a', 'b'],
      transform: (s: string) => prefix + s, // Closure
    });

    expect(result.results).toEqual(['Result: a', 'Result: b']);
  });

  it('should work with partial application', () => {
    // Register a function that takes an object
    if (!functionRegistry.has('string:prefixer')) {
      functionRegistry.register({
        id: 'string:prefixer',
        name: 'Prefixer',
        description: 'Add prefix to string',
        category: 'transform',
        fn: (input: { text: string; prefix: string }) => input.prefix + input.text,
        inputType: 'object',
        outputType: 'string',
      });
    }

    // Simulated workflow accepting partial application
    function processWithTransform(
      execute: boolean,
      params: { items: string[]; transform: FunctionLike<{ text: string }, string> }
    ): { results: string[]; onSuccess: boolean } {
      if (!execute) return { results: [], onSuccess: false };

      const { fn } = resolveFunction(params.transform);
      const results = params.items.map((item) => fn({ text: item }));
      return { results, onSuccess: true };
    }

    const result = processWithTransform(true, {
      items: ['a', 'b'],
      transform: {
        registryId: 'string:prefixer',
        partialArgs: { prefix: '>> ' },
      },
    });

    expect(result.results).toEqual(['>> a', '>> b']);
  });

  it('should not execute when execute is false', () => {
    const result = processItems(false, {
      items: ['hello'],
      transform: (s: string) => s.toUpperCase(),
    });

    expect(result.results).toEqual([]);
    expect(result.onSuccess).toBe(false);
  });
});

describe('Workflow-to-Workflow Function Passing', () => {
  // Workflow B accepts a transform function
  function workflowB(
    execute: boolean,
    params: { items: number[]; transform: FunctionLike<number, number> }
  ): { results: number[]; onSuccess: boolean } {
    if (!execute) return { results: [], onSuccess: false };
    const { fn } = resolveFunction(params.transform);
    return { results: params.items.map(fn), onSuccess: true };
  }

  // Workflow A calls Workflow B with a closure
  function workflowA(
    execute: boolean,
    params: { data: number[]; multiplier: number }
  ): { processed: number[]; onSuccess: boolean } {
    if (!execute) return { processed: [], onSuccess: false };

    // Create closure capturing local variable
    const myTransform = (n: number) => n * params.multiplier;

    // Call workflowB directly - this is how co-located workflows call each other
    const result = workflowB(true, {
      items: params.data,
      transform: myTransform, // Pass closure directly
    });

    return { processed: result.results, onSuccess: true };
  }

  it('should pass closure from workflowA to workflowB', () => {
    const result = workflowA(true, {
      data: [1, 2, 3],
      multiplier: 10,
    });

    // Closure captured multiplier=10
    expect(result.processed).toEqual([10, 20, 30]);
    expect(result.onSuccess).toBe(true);
  });

  it('should preserve closure scope across workflow boundary', () => {
    const externalConfig = { factor: 5, offset: 100 };

    function workflowC(
      execute: boolean,
      params: { values: number[] }
    ): { results: number[]; onSuccess: boolean } {
      if (!execute) return { results: [], onSuccess: false };

      // Closure captures external config
      const complexTransform = (n: number) => n * externalConfig.factor + externalConfig.offset;

      return workflowB(true, {
        items: params.values,
        transform: complexTransform,
      });
    }

    const result = workflowC(true, { values: [1, 2, 3] });
    // (1*5)+100=105, (2*5)+100=110, (3*5)+100=115
    expect(result.results).toEqual([105, 110, 115]);
  });

  it('should work with nested workflow calls', () => {
    // Workflow D calls A which calls B
    function workflowD(
      execute: boolean,
      params: { input: number[] }
    ): { final: number[]; onSuccess: boolean } {
      if (!execute) return { final: [], onSuccess: false };

      const resultA = workflowA(true, {
        data: params.input,
        multiplier: 2,
      });

      // Call B directly with a registry ID
      const resultB = workflowB(true, {
        items: resultA.processed,
        transform: 'number:double',
      });

      return { final: resultB.results, onSuccess: true };
    }

    const result = workflowD(true, { input: [1, 2, 3] });
    // [1, 2, 3] * 2 = [2, 4, 6], then double = [4, 8, 12]
    expect(result.final).toEqual([4, 8, 12]);
  });
});

describe('Mixed Internal/External Function Resolution', () => {
  it('should handle array of mixed function types', () => {
    const transforms: FunctionLike<number, number>[] = [
      (x) => x + 1, // Direct function
      'number:double', // Registry ID
      (x) => x * 3, // Another direct function
    ];

    const input = 5;
    let result = input;

    for (const transform of transforms) {
      const { fn } = resolveFunction(transform);
      result = fn(result);
    }

    // 5 + 1 = 6, 6 * 2 = 12, 12 * 3 = 36
    expect(result).toBe(36);
  });

  it('should correctly identify function source', () => {
    const directFn = (x: number) => x;
    const registryId = 'number:double';

    const resolvedDirect = resolveFunction(directFn);
    const resolvedRegistry = resolveFunction(registryId);

    expect(resolvedDirect.source).toBe('direct');
    expect(resolvedDirect.registryId).toBeUndefined();

    expect(resolvedRegistry.source).toBe('registry');
    expect(resolvedRegistry.registryId).toBe('number:double');
  });
});
