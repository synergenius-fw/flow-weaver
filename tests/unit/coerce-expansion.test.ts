/**
 * Tests for @coerce macro expansion in the parser.
 *
 * The parser expands @coerce macros into synthetic coercion node instances
 * and two connections (source->coercion.value, coercion.result->target).
 * It also injects the corresponding coercion node type into the workflow's
 * nodeTypes array and records a TCoerceMacro in the macros array.
 */

import * as fs from 'fs';
import * as path from 'path';
import { parser } from '../../src/parser';
import type { TCoerceMacro } from '../../src/ast/types';

// Two minimal node types: one produces a string output, the other consumes a number input.
// These give us something to coerce between.
const NODE_TYPES_SOURCE = `
/**
 * @flowWeaver nodeType
 * @output count - string
 */
export function fetchData(execute: boolean): { onSuccess: boolean; onFailure: boolean; count: string } {
  return { onSuccess: execute, onFailure: false, count: '42' };
}

/**
 * @flowWeaver nodeType
 * @input amount - number
 * @output total - number
 */
export function calculate(execute: boolean, amount: number): { onSuccess: boolean; onFailure: boolean; total: number } {
  return { onSuccess: execute, onFailure: false, total: amount * 2 };
}
`;

function writeAndParse(filename: string, source: string) {
  const testFile = path.join(global.testHelpers.outputDir, filename);
  fs.writeFileSync(testFile, source.trim());
  try {
    return parser.parse(testFile);
  } finally {
    try { fs.unlinkSync(testFile); } catch { /* ignore */ }
  }
}

function buildWorkflowSource(coerceLine: string, extraNodeTypes = '', extraAnnotations = '') {
  return `
${NODE_TYPES_SOURCE}
${extraNodeTypes}

/**
 * @flowWeaver workflow
 * @param input - string
 * @returns {number} result - Result
 * @node fetch fetchData
 * @node calc calculate
 * ${coerceLine}
 * ${extraAnnotations}
 * @connect Start.input -> fetch.execute
 * @connect calc.total -> Exit.result
 */
export async function testWorkflow(execute: boolean, params: { input: string }): Promise<{
  onSuccess: boolean; onFailure: boolean; result: number;
}> {
  // @flow-weaver-body
  // @end-flow-weaver-body
}
  `;
}

// =============================================================================
// 1. Coercion target type -> synthetic node type name mapping
// =============================================================================

describe('@coerce macro expansion', () => {
  describe('creates synthetic instance with correct nodeType mapping', () => {
    it('as string -> __fw_toString', () => {
      const source = buildWorkflowSource('@coerce c1 fetch.count -> calc.amount as string');
      const result = writeAndParse('coerce-as-string.ts', source);
      const wf = result.workflows[0];
      expect(wf).toBeDefined();

      const synth = wf.instances.find((i) => i.id === 'c1');
      expect(synth).toBeDefined();
      expect(synth!.nodeType).toBe('__fw_toString');
    });

    it('as number -> __fw_toNumber', () => {
      const source = buildWorkflowSource('@coerce c1 fetch.count -> calc.amount as number');
      const result = writeAndParse('coerce-as-number.ts', source);
      const wf = result.workflows[0];
      expect(wf).toBeDefined();

      const synth = wf.instances.find((i) => i.id === 'c1');
      expect(synth).toBeDefined();
      expect(synth!.nodeType).toBe('__fw_toNumber');
    });

    it('as boolean -> __fw_toBoolean', () => {
      const source = buildWorkflowSource('@coerce c1 fetch.count -> calc.amount as boolean');
      const result = writeAndParse('coerce-as-boolean.ts', source);
      const wf = result.workflows[0];
      expect(wf).toBeDefined();

      const synth = wf.instances.find((i) => i.id === 'c1');
      expect(synth).toBeDefined();
      expect(synth!.nodeType).toBe('__fw_toBoolean');
    });

    it('as json -> __fw_toJSON', () => {
      const source = buildWorkflowSource('@coerce c1 fetch.count -> calc.amount as json');
      const result = writeAndParse('coerce-as-json.ts', source);
      const wf = result.workflows[0];
      expect(wf).toBeDefined();

      const synth = wf.instances.find((i) => i.id === 'c1');
      expect(synth).toBeDefined();
      expect(synth!.nodeType).toBe('__fw_toJSON');
    });

    it('as object -> __fw_parseJSON', () => {
      const source = buildWorkflowSource('@coerce c1 fetch.count -> calc.amount as object');
      const result = writeAndParse('coerce-as-object.ts', source);
      const wf = result.workflows[0];
      expect(wf).toBeDefined();

      const synth = wf.instances.find((i) => i.id === 'c1');
      expect(synth).toBeDefined();
      expect(synth!.nodeType).toBe('__fw_parseJSON');
    });
  });

  // ===========================================================================
  // 2. Two connections: source->value, result->target
  // ===========================================================================

  describe('creates two connections through the coercion node', () => {
    it('wires source.port -> coercion.value and coercion.result -> target.port', () => {
      const source = buildWorkflowSource('@coerce c1 fetch.count -> calc.amount as number');
      const result = writeAndParse('coerce-connections.ts', source);
      const wf = result.workflows[0];
      expect(wf).toBeDefined();

      const inbound = wf.connections.find(
        (c) => c.from.node === 'fetch' && c.from.port === 'count' && c.to.node === 'c1' && c.to.port === 'value'
      );
      expect(inbound).toBeDefined();

      const outbound = wf.connections.find(
        (c) => c.from.node === 'c1' && c.from.port === 'result' && c.to.node === 'calc' && c.to.port === 'amount'
      );
      expect(outbound).toBeDefined();
    });
  });

  // ===========================================================================
  // 3. Macro stored in workflow.macros
  // ===========================================================================

  describe('stores macro in workflow.macros', () => {
    it('records a TCoerceMacro with correct fields', () => {
      const source = buildWorkflowSource('@coerce c1 fetch.count -> calc.amount as number');
      const result = writeAndParse('coerce-macro-record.ts', source);
      const wf = result.workflows[0];
      expect(wf).toBeDefined();
      expect(wf.macros).toBeDefined();

      const coerceMacro = wf.macros!.find((m) => m.type === 'coerce') as TCoerceMacro | undefined;
      expect(coerceMacro).toBeDefined();
      expect(coerceMacro!.instanceId).toBe('c1');
      expect(coerceMacro!.source).toEqual({ node: 'fetch', port: 'count' });
      expect(coerceMacro!.target).toEqual({ node: 'calc', port: 'amount' });
      expect(coerceMacro!.targetType).toBe('number');
    });
  });

  // ===========================================================================
  // 4. Multiple @coerce macros in the same workflow
  // ===========================================================================

  describe('multiple coerce macros in the same workflow', () => {
    it('expands each macro independently', () => {
      // Add a third node type so we have more ports to coerce between.
      const extraNodeType = `
/**
 * @flowWeaver nodeType
 * @input value - boolean
 * @output flag - boolean
 */
export function checkFlag(execute: boolean, value: boolean): { onSuccess: boolean; onFailure: boolean; flag: boolean } {
  return { onSuccess: execute, onFailure: false, flag: value };
}
`;
      const source = `
${NODE_TYPES_SOURCE}
${extraNodeType}

/**
 * @flowWeaver workflow
 * @param input - string
 * @returns {boolean} result - Result
 * @node fetch fetchData
 * @node calc calculate
 * @node chk checkFlag
 * @coerce c1 fetch.count -> calc.amount as number
 * @coerce c2 calc.total -> chk.value as boolean
 * @connect Start.input -> fetch.execute
 * @connect chk.flag -> Exit.result
 */
export async function multiCoerceWorkflow(execute: boolean, params: { input: string }): Promise<{
  onSuccess: boolean; onFailure: boolean; result: boolean;
}> {
  // @flow-weaver-body
  // @end-flow-weaver-body
}
`;
      const result = writeAndParse('coerce-multi.ts', source);
      const wf = result.workflows[0];
      expect(wf).toBeDefined();

      // Both synthetic instances should exist
      expect(wf.instances.find((i) => i.id === 'c1')).toBeDefined();
      expect(wf.instances.find((i) => i.id === 'c2')).toBeDefined();

      // Both macros recorded
      const coerceMacros = (wf.macros || []).filter((m) => m.type === 'coerce') as TCoerceMacro[];
      expect(coerceMacros).toHaveLength(2);
      expect(coerceMacros[0].instanceId).toBe('c1');
      expect(coerceMacros[0].targetType).toBe('number');
      expect(coerceMacros[1].instanceId).toBe('c2');
      expect(coerceMacros[1].targetType).toBe('boolean');

      // Four connections created (2 per coerce)
      const c1Inbound = wf.connections.find(
        (c) => c.from.node === 'fetch' && c.from.port === 'count' && c.to.node === 'c1'
      );
      const c1Outbound = wf.connections.find(
        (c) => c.from.node === 'c1' && c.from.port === 'result' && c.to.node === 'calc'
      );
      const c2Inbound = wf.connections.find(
        (c) => c.from.node === 'calc' && c.from.port === 'total' && c.to.node === 'c2'
      );
      const c2Outbound = wf.connections.find(
        (c) => c.from.node === 'c2' && c.from.port === 'result' && c.to.node === 'chk'
      );
      expect(c1Inbound).toBeDefined();
      expect(c1Outbound).toBeDefined();
      expect(c2Inbound).toBeDefined();
      expect(c2Outbound).toBeDefined();
    });
  });

  // ===========================================================================
  // 5. Coercion node type injected into workflow.nodeTypes (variant COERCION)
  // ===========================================================================

  describe('injects coercion node type into workflow.nodeTypes', () => {
    it('adds the synthetic node type with variant COERCION', () => {
      const source = buildWorkflowSource('@coerce c1 fetch.count -> calc.amount as number');
      const result = writeAndParse('coerce-nodetype-inject.ts', source);
      const wf = result.workflows[0];
      expect(wf).toBeDefined();

      const coercionType = wf.nodeTypes.find((nt) => nt.functionName === '__fw_toNumber');
      expect(coercionType).toBeDefined();
      expect(coercionType!.variant).toBe('COERCION');
      expect(coercionType!.inputs).toHaveProperty('value');
      expect(coercionType!.outputs).toHaveProperty('result');
    });

    it('does not duplicate node type when two coerce macros use the same target type', () => {
      // Two coercions both targeting number: only one __fw_toNumber node type should exist.
      const extraNodeType = `
/**
 * @flowWeaver nodeType
 * @input value - number
 * @output doubled - number
 */
export function doubler(execute: boolean, value: number): { onSuccess: boolean; onFailure: boolean; doubled: number } {
  return { onSuccess: execute, onFailure: false, doubled: value * 2 };
}
`;
      const source = `
${NODE_TYPES_SOURCE}
${extraNodeType}

/**
 * @flowWeaver workflow
 * @param input - string
 * @returns {number} result - Result
 * @node fetch fetchData
 * @node calc calculate
 * @node dbl doubler
 * @coerce c1 fetch.count -> calc.amount as number
 * @coerce c2 fetch.count -> dbl.value as number
 * @connect Start.input -> fetch.execute
 * @connect calc.total -> Exit.result
 */
export async function dedupeCoerceWorkflow(execute: boolean, params: { input: string }): Promise<{
  onSuccess: boolean; onFailure: boolean; result: number;
}> {
  // @flow-weaver-body
  // @end-flow-weaver-body
}
`;
      const result = writeAndParse('coerce-dedup-type.ts', source);
      const wf = result.workflows[0];
      expect(wf).toBeDefined();

      const toNumberTypes = wf.nodeTypes.filter((nt) => nt.functionName === '__fw_toNumber');
      expect(toNumberTypes).toHaveLength(1);
    });
  });

  // ===========================================================================
  // 6. Error: source node doesn't exist
  // ===========================================================================

  describe('error when source node does not exist', () => {
    it('reports error for unknown source instance', () => {
      const source = buildWorkflowSource('@coerce c1 nonexistent.count -> calc.amount as number');
      const result = writeAndParse('coerce-err-src.ts', source);

      const coerceErrors = result.errors.filter((e) => e.includes('@coerce'));
      expect(coerceErrors.length).toBeGreaterThan(0);
      expect(coerceErrors.some((e) => e.includes('source node') && e.includes('nonexistent'))).toBe(true);
    });
  });

  // ===========================================================================
  // 7. Error: instance ID conflicts with existing node
  // ===========================================================================

  describe('error when instance ID conflicts with existing node', () => {
    it('reports error when coerce ID matches an existing instance', () => {
      // Use "fetch" as the coerce instance ID — it already exists as a node instance.
      const source = buildWorkflowSource('@coerce fetch fetch.count -> calc.amount as number');
      const result = writeAndParse('coerce-err-dup.ts', source);

      const coerceErrors = result.errors.filter((e) => e.includes('@coerce'));
      expect(coerceErrors.length).toBeGreaterThan(0);
      expect(coerceErrors.some((e) => e.includes('already exists') && e.includes('fetch'))).toBe(true);
    });
  });
});
