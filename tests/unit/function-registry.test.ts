/**
 * Function Registry Unit Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { FunctionRegistry, functionRegistry } from '../../src/runtime/function-registry';

describe('FunctionRegistry', () => {
  let registry: FunctionRegistry;

  beforeEach(() => {
    registry = new FunctionRegistry();
  });

  it('should register and retrieve functions', () => {
    registry.register({
      id: 'test:double',
      name: 'Double',
      description: 'Double a number',
      category: 'transform',
      fn: (n: number) => n * 2,
      inputType: 'number',
      outputType: 'number',
    });

    const fn = registry.get<number, number>('test:double');
    expect(fn).toBeDefined();
    expect(fn!(5)).toBe(10);
  });

  it('should return undefined for unknown ID', () => {
    expect(registry.get('unknown')).toBeUndefined();
  });

  it('should check if function exists', () => {
    registry.register({
      id: 'test:exists',
      name: 'Exists',
      description: 'Test function',
      category: 'custom',
      fn: () => true,
      inputType: 'void',
      outputType: 'boolean',
    });

    expect(registry.has('test:exists')).toBe(true);
    expect(registry.has('test:missing')).toBe(false);
  });

  it('should list functions by category', () => {
    registry.register({
      id: 'test:transform1',
      name: 'Transform 1',
      description: 'First transform',
      category: 'transform',
      fn: (x: number) => x + 1,
      inputType: 'number',
      outputType: 'number',
    });

    registry.register({
      id: 'test:transform2',
      name: 'Transform 2',
      description: 'Second transform',
      category: 'transform',
      fn: (x: number) => x * 2,
      inputType: 'number',
      outputType: 'number',
    });

    registry.register({
      id: 'test:filter1',
      name: 'Filter 1',
      description: 'First filter',
      category: 'filter',
      fn: (arr: number[]) => arr.filter((x) => x > 0),
      inputType: 'array',
      outputType: 'array',
    });

    const transforms = registry.list('transform');
    expect(transforms).toHaveLength(2);
    expect(transforms.every((f) => f.category === 'transform')).toBe(true);

    const filters = registry.list('filter');
    expect(filters).toHaveLength(1);
    expect(filters[0].id).toBe('test:filter1');

    const all = registry.list();
    expect(all).toHaveLength(3);
  });

  it('should return metadata without fn', () => {
    registry.register({
      id: 'test:meta',
      name: 'Meta Test',
      description: 'Test metadata',
      category: 'custom',
      fn: () => 'secret',
      inputType: 'void',
      outputType: 'string',
    });

    const metadata = registry.getMetadata('test:meta');
    expect(metadata).toBeDefined();
    expect(metadata!.id).toBe('test:meta');
    expect(metadata!.name).toBe('Meta Test');
    expect(metadata!.description).toBe('Test metadata');
    expect((metadata as any).fn).toBeUndefined();
  });

  it('should throw when registering duplicate ID', () => {
    registry.register({
      id: 'test:duplicate',
      name: 'First',
      description: 'First registration',
      category: 'custom',
      fn: () => 1,
      inputType: 'void',
      outputType: 'number',
    });

    expect(() => {
      registry.register({
        id: 'test:duplicate',
        name: 'Second',
        description: 'Second registration',
        category: 'custom',
        fn: () => 2,
        inputType: 'void',
        outputType: 'number',
      });
    }).toThrow("Function with ID 'test:duplicate' is already registered");
  });

  it('should clear all functions', () => {
    registry.register({
      id: 'test:clear1',
      name: 'Clear 1',
      description: 'To be cleared',
      category: 'custom',
      fn: () => 1,
      inputType: 'void',
      outputType: 'number',
    });

    registry.register({
      id: 'test:clear2',
      name: 'Clear 2',
      description: 'To be cleared',
      category: 'custom',
      fn: () => 2,
      inputType: 'void',
      outputType: 'number',
    });

    expect(registry.size).toBe(2);
    registry.clear();
    expect(registry.size).toBe(0);
    expect(registry.has('test:clear1')).toBe(false);
  });

  it('should support async functions', async () => {
    registry.register({
      id: 'test:async',
      name: 'Async Test',
      description: 'Async function',
      category: 'transform',
      fn: async (x: number) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return x * 2;
      },
      inputType: 'number',
      outputType: 'number',
    });

    const fn = registry.get<number, Promise<number>>('test:async');
    const result = await fn!(5);
    expect(result).toBe(10);
  });

  it('should include examples in metadata', () => {
    registry.register({
      id: 'test:examples',
      name: 'Examples Test',
      description: 'With examples',
      category: 'transform',
      fn: (x: number) => x * 2,
      inputType: 'number',
      outputType: 'number',
      examples: [
        { input: 5, output: 10 },
        { input: 3, output: 6 },
      ],
    });

    const metadata = registry.getMetadata('test:examples');
    expect(metadata?.examples).toHaveLength(2);
    expect(metadata?.examples![0]).toEqual({ input: 5, output: 10 });
  });
});

describe('Global functionRegistry', () => {
  it('should be a singleton', () => {
    // The global registry should have built-in functions from builtin-functions.ts
    // when imported
    expect(functionRegistry).toBeInstanceOf(FunctionRegistry);
  });
});
