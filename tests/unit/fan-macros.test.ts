/**
 * Tests for @fanOut and @fanIn macro support.
 * These macros expand to multiple @connect lines for common fan-out/fan-in patterns.
 */

import * as fs from 'fs';
import * as path from 'path';
import { parseFanOutLine, parseFanInLine } from '../../src/chevrotain-parser/fan-parser';
import { parser } from '../../src/parser';
import { annotationGenerator } from '../../src/annotation-generator';
import type { TFanOutMacro, TFanInMacro } from '../../src/ast/types';

// Shared node types for expansion tests
const NODE_TYPES_SOURCE = `
/**
 * @flowWeaver nodeType
 * @input data - unknown
 * @output result - unknown
 */
export async function processA(execute: boolean, data: unknown) {
  return { onSuccess: true, onFailure: false, result: data };
}

/**
 * @flowWeaver nodeType
 * @input data - unknown
 * @output result - unknown
 */
export async function processB(execute: boolean, data: unknown) {
  return { onSuccess: true, onFailure: false, result: data };
}

/**
 * @flowWeaver nodeType
 * @input data - unknown
 * @output result - unknown
 */
export async function processC(execute: boolean, data: unknown) {
  return { onSuccess: true, onFailure: false, result: data };
}

/**
 * @flowWeaver nodeType
 * @input items - unknown[]
 * @output merged - unknown
 */
export async function aggregate(execute: boolean, items: unknown[]) {
  return { onSuccess: true, onFailure: false, merged: items };
}
`;

function writeAndParse(filename: string, source: string) {
  const testFile = path.join(global.testHelpers.outputDir, filename);
  fs.writeFileSync(testFile, source.trim());
  try {
    const result = parser.parse(testFile);
    return result;
  } finally {
    try { fs.unlinkSync(testFile); } catch { /* ignore */ }
  }
}

describe('Fan macro parser', () => {
  describe('@fanOut', () => {
    it('should parse source.port -> target1, target2, target3', () => {
      const warnings: string[] = [];
      const result = parseFanOutLine('@fanOut Start.data -> a, b, c', warnings);
      expect(result).not.toBeNull();
      expect(result!.source).toEqual({ node: 'Start', port: 'data' });
      expect(result!.targets).toEqual([
        { node: 'a' },
        { node: 'b' },
        { node: 'c' },
      ]);
      expect(warnings).toHaveLength(0);
    });

    it('should parse with explicit target ports', () => {
      const warnings: string[] = [];
      const result = parseFanOutLine('@fanOut Start.data -> a.input1, b.input2', warnings);
      expect(result).not.toBeNull();
      expect(result!.source).toEqual({ node: 'Start', port: 'data' });
      expect(result!.targets).toEqual([
        { node: 'a', port: 'input1' },
        { node: 'b', port: 'input2' },
      ]);
    });

    it('should reject missing targets', () => {
      const warnings: string[] = [];
      const result = parseFanOutLine('@fanOut Start.data ->', warnings);
      expect(result).toBeNull();
    });

    it('should accept single target', () => {
      const warnings: string[] = [];
      const result = parseFanOutLine('@fanOut Start.data -> a', warnings);
      expect(result).not.toBeNull();
    });
  });

  describe('@fanIn', () => {
    it('should parse source1.port, source2.port -> target.port', () => {
      const warnings: string[] = [];
      const result = parseFanInLine('@fanIn a.result, b.result, c.result -> merge.inputs', warnings);
      expect(result).not.toBeNull();
      expect(result!.sources).toEqual([
        { node: 'a', port: 'result' },
        { node: 'b', port: 'result' },
        { node: 'c', port: 'result' },
      ]);
      expect(result!.target).toEqual({ node: 'merge', port: 'inputs' });
      expect(warnings).toHaveLength(0);
    });

    it('should parse sources without explicit ports', () => {
      const warnings: string[] = [];
      const result = parseFanInLine('@fanIn a, b, c -> merge.data', warnings);
      expect(result).not.toBeNull();
      expect(result!.sources).toEqual([
        { node: 'a' },
        { node: 'b' },
        { node: 'c' },
      ]);
      expect(result!.target).toEqual({ node: 'merge', port: 'data' });
    });

    it('should reject missing sources', () => {
      const warnings: string[] = [];
      const result = parseFanInLine('@fanIn -> merge.data', warnings);
      expect(result).toBeNull();
    });
  });
});

describe('Fan macro expansion', () => {
  it('should expand @fanOut to multiple connections', () => {
    const source = `
${NODE_TYPES_SOURCE}

/**
 * @flowWeaver workflow
 * @param data - unknown
 * @returns {unknown} result - Result
 * @node a processA
 * @node b processB
 * @node c processC
 * @fanOut Start.data -> a, b, c
 * @connect a.result -> Exit.result
 */
export async function fanOutWorkflow(execute: boolean, params: { data: unknown }): Promise<{
  onSuccess: boolean; onFailure: boolean; result: unknown;
}> {
  // @flow-weaver-body
  // @end-flow-weaver-body
}
    `;

    const result = writeAndParse('fan-out-expansion.ts', source);
    expect(result.warnings.filter(w => w.includes('fanOut'))).toHaveLength(0);
    const wf = result.workflows[0];
    expect(wf).toBeDefined();

    // @fanOut Start.data -> a, b, c should create 3 connections
    const fanConnections = wf.connections.filter(
      (c) => c.from.node === 'Start' && c.from.port === 'data'
    );
    expect(fanConnections).toHaveLength(3);
    expect(fanConnections.map((c) => c.to.node).sort()).toEqual(['a', 'b', 'c']);
    // Target ports should default to source port name
    expect(fanConnections.every((c) => c.to.port === 'data')).toBe(true);
  });

  it('should expand @fanOut with explicit target ports', () => {
    const source = `
${NODE_TYPES_SOURCE}

/**
 * @flowWeaver workflow
 * @param data - unknown
 * @returns {unknown} result - Result
 * @node a processA
 * @node b processB
 * @fanOut Start.data -> a.data, b.data
 * @connect a.result -> Exit.result
 */
export async function fanOutExplicit(execute: boolean, params: { data: unknown }): Promise<{
  onSuccess: boolean; onFailure: boolean; result: unknown;
}> {
  // @flow-weaver-body
  // @end-flow-weaver-body
}
    `;

    const result = writeAndParse('fan-out-explicit.ts', source);
    const wf = result.workflows[0];
    expect(wf).toBeDefined();

    const fanConnections = wf.connections.filter(
      (c) => c.from.node === 'Start' && c.from.port === 'data'
    );
    expect(fanConnections).toHaveLength(2);
    expect(fanConnections[0].to.port).toBe('data');
    expect(fanConnections[1].to.port).toBe('data');
  });

  it('should expand @fanIn to multiple connections', () => {
    const source = `
${NODE_TYPES_SOURCE}

/**
 * @flowWeaver workflow
 * @param data - unknown
 * @returns {unknown} merged - Result
 * @node a processA
 * @node b processB
 * @node c processC
 * @node agg aggregate
 * @connect Start.data -> a.data
 * @connect Start.data -> b.data
 * @connect Start.data -> c.data
 * @fanIn a.result, b.result, c.result -> agg.items
 * @connect agg.merged -> Exit.merged
 */
export async function fanInWorkflow(execute: boolean, params: { data: unknown }): Promise<{
  onSuccess: boolean; onFailure: boolean; merged: unknown;
}> {
  // @flow-weaver-body
  // @end-flow-weaver-body
}
    `;

    const result = writeAndParse('fan-in-expansion.ts', source);
    const wf = result.workflows[0];
    expect(wf).toBeDefined();

    // @fanIn should create 3 connections to agg.items
    const fanConnections = wf.connections.filter(
      (c) => c.to.node === 'agg' && c.to.port === 'items'
    );
    expect(fanConnections).toHaveLength(3);
    expect(fanConnections.map((c) => c.from.node).sort()).toEqual(['a', 'b', 'c']);
  });

  it('should store fan macros on workflow AST', () => {
    const source = `
${NODE_TYPES_SOURCE}

/**
 * @flowWeaver workflow
 * @param data - unknown
 * @returns {unknown} result - Result
 * @node a processA
 * @node b processB
 * @fanOut Start.data -> a, b
 * @connect a.result -> Exit.result
 */
export async function macroStorage(execute: boolean, params: { data: unknown }): Promise<{
  onSuccess: boolean; onFailure: boolean; result: unknown;
}> {
  // @flow-weaver-body
  // @end-flow-weaver-body
}
    `;

    const result = writeAndParse('fan-macro-storage.ts', source);
    const wf = result.workflows[0];
    expect(wf).toBeDefined();

    expect(wf.macros).toBeDefined();
    const fanOutMacro = wf.macros!.find((m) => m.type === 'fanOut') as TFanOutMacro | undefined;
    expect(fanOutMacro).toBeDefined();
    expect(fanOutMacro!.source).toEqual({ node: 'Start', port: 'data' });
    expect(fanOutMacro!.targets).toHaveLength(2);
  });
});

describe('Fan macro round-trip', () => {
  it('should preserve @fanOut in generated annotations', () => {
    const source = `
${NODE_TYPES_SOURCE}

/**
 * @flowWeaver workflow
 * @param data - unknown
 * @returns {unknown} result - Result
 * @node a processA
 * @node b processB
 * @node c processC
 * @fanOut Start.data -> a, b, c
 * @connect a.result -> Exit.result
 */
export async function roundTrip(execute: boolean, params: { data: unknown }): Promise<{
  onSuccess: boolean; onFailure: boolean; result: unknown;
}> {
  // @flow-weaver-body
  // @end-flow-weaver-body
}
    `;

    const result = writeAndParse('fan-round-trip.ts', source);
    const wf = result.workflows[0];
    expect(wf).toBeDefined();

    const annotations = annotationGenerator.generate(wf, { includeComments: false });

    // The @fanOut macro should be preserved
    expect(annotations).toContain('@fanOut Start.data -> a, b, c');

    // Connections covered by the macro should NOT appear as @connect
    expect(annotations).not.toContain('@connect Start.data -> a.data');
    expect(annotations).not.toContain('@connect Start.data -> b.data');
    expect(annotations).not.toContain('@connect Start.data -> c.data');
  });

  it('should preserve @fanIn in generated annotations', () => {
    const source = `
${NODE_TYPES_SOURCE}

/**
 * @flowWeaver workflow
 * @param data - unknown
 * @returns {unknown} merged - Result
 * @node a processA
 * @node b processB
 * @node c processC
 * @node agg aggregate
 * @connect Start.data -> a.data
 * @connect Start.data -> b.data
 * @connect Start.data -> c.data
 * @fanIn a.result, b.result, c.result -> agg.items
 * @connect agg.merged -> Exit.merged
 */
export async function roundTripFanIn(execute: boolean, params: { data: unknown }): Promise<{
  onSuccess: boolean; onFailure: boolean; merged: unknown;
}> {
  // @flow-weaver-body
  // @end-flow-weaver-body
}
    `;

    const result = writeAndParse('fan-round-trip-in.ts', source);
    const wf = result.workflows[0];
    expect(wf).toBeDefined();

    const annotations = annotationGenerator.generate(wf, { includeComments: false });

    // The @fanIn macro should be preserved
    expect(annotations).toContain('@fanIn a.result, b.result, c.result -> agg.items');

    // Connections covered by the macro should NOT appear as @connect
    expect(annotations).not.toContain('@connect a.result -> agg.items');
    expect(annotations).not.toContain('@connect b.result -> agg.items');
    expect(annotations).not.toContain('@connect c.result -> agg.items');
  });
});
