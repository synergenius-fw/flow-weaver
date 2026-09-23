/**
 * @path Comma-Separated Paths Tests
 *
 * Tests that @path annotations accept comma-separated parallel paths in a
 * single tag, e.g.:
 *   @path Start -> A -> C -> Exit, Start -> B -> C
 *
 * This is syntactic sugar for multiple @path tags.
 */

import { describe, it, expect } from 'vitest';
import { parsePathLine } from '../../src/chevrotain-parser/path-parser';
import { AnnotationParser } from '../../src/parser/annotation-parser';

// =============================================================================
// 1. Chevrotain Parser - comma-separated paths
// =============================================================================

describe('@path comma-separated paths - Chevrotain parser', () => {
  it('should parse two comma-separated paths', () => {
    const warnings: string[] = [];
    const results = parsePathLine(
      '@path Start -> A -> C -> Exit, Start -> B -> C',
      warnings,
    );

    expect(warnings).toHaveLength(0);
    expect(results).not.toBeNull();
    expect(Array.isArray(results)).toBe(true);
    expect(results!).toHaveLength(2);

    expect(results![0].steps).toEqual([
      { node: 'Start' },
      { node: 'A' },
      { node: 'C' },
      { node: 'Exit' },
    ]);
    expect(results![1].steps).toEqual([
      { node: 'Start' },
      { node: 'B' },
      { node: 'C' },
    ]);
  });

  it('should parse three comma-separated paths', () => {
    const warnings: string[] = [];
    const results = parsePathLine(
      '@path Start -> A -> Exit, Start -> B -> Exit, Start -> C -> Exit',
      warnings,
    );

    expect(warnings).toHaveLength(0);
    expect(results).not.toBeNull();
    expect(results!).toHaveLength(3);
  });

  it('should handle route suffixes in comma-separated paths', () => {
    const warnings: string[] = [];
    const results = parsePathLine(
      '@path Start -> router:ok -> handler -> Exit, Start -> router:fail -> escalate -> Exit',
      warnings,
    );

    expect(warnings).toHaveLength(0);
    expect(results).not.toBeNull();
    expect(results!).toHaveLength(2);
    expect(results![0].steps[1]).toEqual({ node: 'router', route: 'ok' });
    expect(results![1].steps[1]).toEqual({ node: 'router', route: 'fail' });
  });

  it('should still return an array for a single path (no commas)', () => {
    const warnings: string[] = [];
    const results = parsePathLine('@path Start -> A -> Exit', warnings);

    expect(warnings).toHaveLength(0);
    expect(results).not.toBeNull();
    expect(Array.isArray(results)).toBe(true);
    expect(results!).toHaveLength(1);
    expect(results![0].steps).toHaveLength(3);
  });
});

// =============================================================================
// 2. JSDoc Parser Integration - comma-separated paths
// =============================================================================

describe('@path comma-separated paths - JSDoc integration', () => {
  it('should expand a single comma-separated @path into multiple path macros', () => {
    const source = `
/** @flowWeaver node */
declare function enrichCompany(form: Record<string, unknown>): Record<string, unknown>;

/** @flowWeaver node */
declare function enrichContact(form: Record<string, unknown>): Record<string, unknown>;

/** @flowWeaver node */
declare function scoreLead(company: Record<string, unknown>, contact: Record<string, unknown>): number;

/**
 * @flowWeaver workflow @autoConnect
 * @node enrichCompany enrichCompany
 * @node enrichContact enrichContact
 * @node scoreLead scoreLead
 * @path Start -> enrichCompany -> scoreLead -> Exit, Start -> enrichContact -> scoreLead
 */
export async function parallelTest() {
  throw new Error('Not implemented');
}
`;
    const parser = new AnnotationParser();
    const result = parser.parseFromString(source);

    expect(result.errors).toHaveLength(0);
    const workflow = result.workflows[0];

    // Should create parallel fork: Start -> enrichCompany AND Start -> enrichContact
    const startConnections = workflow.connections.filter(
      (c) => c.from.node === 'Start' && c.from.port === 'execute',
    );
    expect(startConnections).toHaveLength(2);

    const targetNodes = startConnections.map((c) => c.to.node).sort();
    expect(targetNodes).toEqual(['enrichCompany', 'enrichContact']);
  });

  it('comma-separated @path should produce same result as multiple @path tags', () => {
    const commaSource = `
/** @flowWeaver node */
declare function A(x: Record<string, unknown>): Record<string, unknown>;
/** @flowWeaver node */
declare function B(x: Record<string, unknown>): Record<string, unknown>;
/** @flowWeaver node */
declare function C(x: Record<string, unknown>): Record<string, unknown>;

/**
 * @flowWeaver workflow @autoConnect
 * @node a A
 * @node b B
 * @node c C
 * @path Start -> a -> c -> Exit, Start -> b -> c
 */
export async function commaVersion() { throw new Error('Not implemented'); }
`;

    const multiSource = `
/** @flowWeaver node */
declare function A(x: Record<string, unknown>): Record<string, unknown>;
/** @flowWeaver node */
declare function B(x: Record<string, unknown>): Record<string, unknown>;
/** @flowWeaver node */
declare function C(x: Record<string, unknown>): Record<string, unknown>;

/**
 * @flowWeaver workflow @autoConnect
 * @node a A
 * @node b B
 * @node c C
 * @path Start -> a -> c -> Exit
 * @path Start -> b -> c
 */
export async function multiVersion() { throw new Error('Not implemented'); }
`;

    const parser = new AnnotationParser();
    const commaResult = parser.parseFromString(commaSource);
    const multiResult = parser.parseFromString(multiSource);

    expect(commaResult.errors).toHaveLength(0);
    expect(multiResult.errors).toHaveLength(0);

    const commaWf = commaResult.workflows[0];
    const multiWf = multiResult.workflows[0];

    // Same number of connections
    expect(commaWf.connections.length).toBe(multiWf.connections.length);

    // Same connection topology
    const normalize = (c: { from: { node: string; port: string }; to: { node: string; port: string } }) =>
      `${c.from.node}.${c.from.port}->${c.to.node}.${c.to.port}`;

    const commaConns = commaWf.connections.map(normalize).sort();
    const multiConns = multiWf.connections.map(normalize).sort();
    expect(commaConns).toEqual(multiConns);
  });
});
