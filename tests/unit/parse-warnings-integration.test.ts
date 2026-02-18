/**
 * Integration tests for parse warnings threading.
 *
 * Verifies that warnings from Chevrotain parsers propagate through
 * JSDocParser → AnnotationParser (parseFromString) → API (parseWorkflow)
 * without being lost or converted to console.warn calls.
 */

import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { AnnotationParser } from '../../src/parser';

describe('Parse Warnings Integration', () => {
  let parser: AnnotationParser;
  let warnSpy: MockInstance;

  beforeEach(() => {
    parser = new AnnotationParser();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  describe('parseFromString — valid code', () => {
    it('should return empty warnings array for valid code', () => {
      const code = `
/**
 * @flowWeaver nodeType
 * @input value - The input value
 * @output result - The output
 */
function myNode(params: { value: number }): { result: number } {
  return { result: params.value * 2 };
}

/**
 * @flowWeaver workflow
 * @node n1 myNode
 * @connect Start.value -> n1.value
 * @connect n1.result -> Exit.result
 */
export async function myWorkflow(
  execute: boolean = true,
  params: { value: number }
): Promise<{ onSuccess: boolean; onFailure: boolean; result: number }> {
  throw new Error('Not implemented');
}
`;
      const result = parser.parseFromString(code, 'valid.ts');
      expect(result.warnings).toBeDefined();
      expect(result.warnings).toEqual([]);
      expect(result.errors).toEqual([]);
    });
  });

  describe('parseFromString — malformed @input', () => {
    it('should produce warning for @input with missing closing bracket', () => {
      const code = `
/**
 * @flowWeaver nodeType
 * @input [name
 * @output result
 */
function myNode(params: { name: string }): { result: string } {
  return { result: params.name };
}

/**
 * @flowWeaver workflow
 * @node n1 myNode
 * @connect Start.name -> n1.name
 * @connect n1.result -> Exit.result
 */
export async function myWorkflow(
  execute: boolean = true,
  params: { name: string }
): Promise<{ onSuccess: boolean; onFailure: boolean; result: string }> {
  throw new Error('Not implemented');
}
`;
      const result = parser.parseFromString(code, 'malformed-input.ts');
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some((w) => w.includes('@input') || w.includes('port'))).toBe(true);
    });
  });

  describe('parseFromString — malformed @connect', () => {
    it('should produce warning for incomplete @connect (not throw)', () => {
      const code = `
/**
 * @flowWeaver nodeType
 * @input value
 * @output result
 */
function myNode(params: { value: number }): { result: number } {
  return { result: params.value };
}

/**
 * @flowWeaver workflow
 * @node n1 myNode
 * @connect foo ->
 */
export async function myWorkflow(
  execute: boolean = true,
  params: { value: number }
): Promise<{ onSuccess: boolean; onFailure: boolean; result: number }> {
  throw new Error('Not implemented');
}
`;
      // Should NOT throw — the old behavior was to throw on malformed @connect
      expect(() => parser.parseFromString(code, 'malformed-connect.ts')).not.toThrow();

      const result = parser.parseFromString(code, 'malformed-connect.ts');
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some((w) => w.includes('@connect') || w.includes('connect'))).toBe(
        true
      );
    });
  });

  describe('parseFromString — malformed @position', () => {
    it('should produce warning for non-numeric position coordinates', () => {
      const code = `
/**
 * @flowWeaver nodeType
 * @input value
 * @output result
 */
function myNode(params: { value: number }): { result: number } {
  return { result: params.value };
}

/**
 * @flowWeaver workflow
 * @node n1 myNode
 * @position n1 abc def
 * @connect Start.value -> n1.value
 * @connect n1.result -> Exit.result
 */
export async function myWorkflow(
  execute: boolean = true,
  params: { value: number }
): Promise<{ onSuccess: boolean; onFailure: boolean; result: number }> {
  throw new Error('Not implemented');
}
`;
      const result = parser.parseFromString(code, 'malformed-position.ts');
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some((w) => w.includes('position'))).toBe(true);
    });
  });

  describe('parseFromString — malformed @scope', () => {
    it('should produce warning for scope missing children', () => {
      const code = `
/**
 * @flowWeaver nodeType
 * @input value
 * @output result
 */
function myNode(params: { value: number }): { result: number } {
  return { result: params.value };
}

/**
 * @flowWeaver workflow
 * @node n1 myNode
 * @scope myScope
 * @connect Start.value -> n1.value
 * @connect n1.result -> Exit.result
 */
export async function myWorkflow(
  execute: boolean = true,
  params: { value: number }
): Promise<{ onSuccess: boolean; onFailure: boolean; result: number }> {
  throw new Error('Not implemented');
}
`;
      const result = parser.parseFromString(code, 'malformed-scope.ts');
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some((w) => w.includes('scope'))).toBe(true);
    });
  });

  describe('no console.warn leakage', () => {
    it('should never call console.warn during parsing with malformed annotations', () => {
      const code = `
/**
 * @flowWeaver nodeType
 * @input [broken
 * @output result
 */
function myNode(params: { name: string }): { result: string } {
  return { result: params.name };
}

/**
 * @flowWeaver workflow
 * @node n1 myNode
 * @connect foo ->
 * @position n1 abc def
 * @scope badScope
 */
export async function myWorkflow(
  execute: boolean = true,
  params: { name: string }
): Promise<{ onSuccess: boolean; onFailure: boolean; result: string }> {
  throw new Error('Not implemented');
}
`;
      parser.parseFromString(code, 'all-malformed.ts');
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });
});
