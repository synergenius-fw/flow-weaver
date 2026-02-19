/**
 * Parameter Resolver for Flow Weaver
 *
 * Resolves function-like parameters to executable functions.
 * Supports:
 * - Direct functions (passed through)
 * - Registry IDs (looked up in function registry)
 * - Partial application (registry ID with pre-bound arguments)
 */

import { functionRegistry } from './function-registry';

/**
 * A function-like parameter that can be:
 * - A direct function
 * - A string registry ID
 * - An object with registry ID and partial arguments
 */
export type FunctionLike<TIn, TOut> =
  | ((input: TIn) => TOut | Promise<TOut>) // Direct function
  | string // Registry ID
  | { registryId: string; partialArgs?: Partial<TIn> }; // With partial application

/**
 * Result of resolving a function parameter
 */
export interface ResolvedFunction<TIn, TOut> {
  fn: (input: TIn) => TOut | Promise<TOut>;
  source: 'direct' | 'registry';
  registryId?: string;
}

/**
 * Resolve a function-like parameter to an executable function
 *
 * @param param - The function-like parameter to resolve
 * @returns The resolved function with metadata
 * @throws Error if registry ID is not found
 *
 * @example
 * // Direct function
 * const resolved = resolveFunction((x: number) => x * 2);
 * resolved.fn(5); // 10
 *
 * @example
 * // Registry ID
 * const resolved = resolveFunction('string:uppercase');
 * resolved.fn('hello'); // 'HELLO'
 *
 * @example
 * // Partial application
 * const resolved = resolveFunction({
 *   registryId: 'math:clamp',
 *   partialArgs: { min: 0, max: 100 }
 * });
 * resolved.fn({ value: 150 }); // 100
 */
export function resolveFunction<TIn, TOut>(
  param: FunctionLike<TIn, TOut>
): ResolvedFunction<TIn, TOut> {
  // Direct function - pass through
  if (typeof param === 'function') {
    return {
      fn: param,
      source: 'direct',
    };
  }

  // String registry ID
  if (typeof param === 'string') {
    const fn = functionRegistry.get<TIn, TOut>(param);
    if (!fn) {
      throw new Error(`Function '${param}' not found in registry`);
    }
    return {
      fn,
      source: 'registry',
      registryId: param,
    };
  }

  // Object with registry ID and optional partial args
  if (typeof param === 'object' && param !== null && 'registryId' in param) {
    const fn = functionRegistry.get<TIn, TOut>(param.registryId);
    if (!fn) {
      throw new Error(`Function '${param.registryId}' not found in registry`);
    }

    // If partial args provided, create wrapper that merges them
    if (param.partialArgs) {
      const partialArgs = param.partialArgs;
      const wrappedFn = (input: TIn): TOut | Promise<TOut> => {
        // Merge partial args with input (input takes precedence for conflicting keys)
        const mergedInput =
          typeof input === 'object' && input !== null
            ? { ...partialArgs, ...input }
            : input;
        return fn(mergedInput as TIn);
      };

      return {
        fn: wrappedFn,
        source: 'registry',
        registryId: param.registryId,
      };
    }

    return {
      fn,
      source: 'registry',
      registryId: param.registryId,
    };
  }

  throw new Error(`Invalid function parameter: ${JSON.stringify(param)}`);
}

/**
 * Check if a value is a function-like parameter
 */
export function isFunctionLike(value: unknown): value is FunctionLike<unknown, unknown> {
  if (typeof value === 'function') return true;
  if (typeof value === 'string') return true;
  if (
    typeof value === 'object' &&
    value !== null &&
    'registryId' in value &&
    typeof (value as { registryId: unknown }).registryId === 'string'
  ) {
    return true;
  }
  return false;
}

/**
 * Try to resolve a function, returning undefined if not found
 */
export function tryResolveFunction<TIn, TOut>(
  param: FunctionLike<TIn, TOut>
): ResolvedFunction<TIn, TOut> | undefined {
  try {
    return resolveFunction(param);
  } catch {
    return undefined;
  }
}
