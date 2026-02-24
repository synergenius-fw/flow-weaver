/**
 * Tests that @coerce macros survive the parse -> annotationGenerator.generate() cycle.
 *
 * The annotation generator must:
 * - Emit @coerce lines for each coerce macro
 * - Skip synthetic COERCION node type definitions (variant === 'COERCION')
 * - Skip synthetic coercion instances (IDs in the coerceInstanceIds set)
 * - Mark connections to/from coercion instances as covered (not emitted as @connect)
 */

import * as fs from 'fs';
import * as path from 'path';
import { parser } from '../../src/parser';
import { annotationGenerator } from '../../src/annotation-generator';

const NODE_TYPES_SOURCE = `
/**
 * @flowWeaver nodeType
 * @input count
 * @output count
 */
export async function fetchData(execute: boolean, count: number) {
  return { onSuccess: true, onFailure: false, count: 42 };
}

/**
 * @flowWeaver nodeType
 * @input amount
 * @output total
 */
export async function calculate(execute: boolean, amount: number) {
  return { onSuccess: true, onFailure: false, total: amount * 2 };
}

/**
 * @flowWeaver nodeType
 * @input label
 * @output message
 */
export async function display(execute: boolean, label: string) {
  return { onSuccess: true, onFailure: false, message: label };
}

/**
 * @flowWeaver nodeType
 * @input value
 * @output text
 */
export async function formatValue(execute: boolean, value: unknown) {
  return { onSuccess: true, onFailure: false, text: String(value) };
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

describe('@coerce round-trip', () => {
  it('preserves @coerce in generated annotations', () => {
    const source = `
${NODE_TYPES_SOURCE}

/**
 * @flowWeaver workflow
 * @node fetch fetchData
 * @node calc calculate
 * @coerce c1 fetch.count -> calc.amount as number
 * @connect calc.total -> Exit.result
 * @param input
 * @returns result
 */
export async function coerceWorkflow(
  execute: boolean,
  params: { input: number }
): Promise<{ onSuccess: boolean; onFailure: boolean; result: number }> {
  // @flow-weaver-body
  // @end-flow-weaver-body
}
    `;

    const result = writeAndParse('coerce-roundtrip-basic.ts', source);
    expect(result.warnings.filter(w => w.includes('coerce'))).toHaveLength(0);

    const wf = result.workflows[0];
    expect(wf).toBeDefined();

    const annotations = annotationGenerator.generate(wf, { includeComments: false });

    expect(annotations).toContain('@coerce c1 fetch.count -> calc.amount as number');
  });

  it('does not emit synthetic __fw_ instance as @node', () => {
    const source = `
${NODE_TYPES_SOURCE}

/**
 * @flowWeaver workflow
 * @node fetch fetchData
 * @node calc calculate
 * @coerce c1 fetch.count -> calc.amount as number
 * @connect calc.total -> Exit.result
 * @param input
 * @returns result
 */
export async function coerceNoSyntheticNode(
  execute: boolean,
  params: { input: number }
): Promise<{ onSuccess: boolean; onFailure: boolean; result: number }> {
  // @flow-weaver-body
  // @end-flow-weaver-body
}
    `;

    const result = writeAndParse('coerce-roundtrip-no-synthetic.ts', source);
    const wf = result.workflows[0];
    expect(wf).toBeDefined();

    // Confirm the synthetic instance exists in the AST
    const syntheticInstance = wf.instances.find(i => i.id === 'c1');
    expect(syntheticInstance).toBeDefined();
    expect(syntheticInstance!.nodeType).toBe('__fw_toNumber');

    const annotations = annotationGenerator.generate(wf, { includeComments: false });

    // The synthetic instance must NOT appear as a @node line
    expect(annotations).not.toContain('@node c1 __fw_toNumber');
    expect(annotations).not.toContain('@node c1 __fw_');
  });

  it('does not emit synthetic connections as @connect', () => {
    const source = `
${NODE_TYPES_SOURCE}

/**
 * @flowWeaver workflow
 * @node fetch fetchData
 * @node calc calculate
 * @coerce c1 fetch.count -> calc.amount as number
 * @connect calc.total -> Exit.result
 * @param input
 * @returns result
 */
export async function coerceNoSyntheticConn(
  execute: boolean,
  params: { input: number }
): Promise<{ onSuccess: boolean; onFailure: boolean; result: number }> {
  // @flow-weaver-body
  // @end-flow-weaver-body
}
    `;

    const result = writeAndParse('coerce-roundtrip-no-conn.ts', source);
    const wf = result.workflows[0];
    expect(wf).toBeDefined();

    // The parser should have created two synthetic connections through c1
    const toCoercion = wf.connections.filter(c => c.to.node === 'c1');
    const fromCoercion = wf.connections.filter(c => c.from.node === 'c1');
    expect(toCoercion.length).toBeGreaterThanOrEqual(1);
    expect(fromCoercion.length).toBeGreaterThanOrEqual(1);

    const annotations = annotationGenerator.generate(wf, { includeComments: false });

    // Neither the upstream nor downstream synthetic connections should appear
    expect(annotations).not.toContain('@connect fetch.count -> c1.value');
    expect(annotations).not.toContain('@connect c1.result -> calc.amount');
  });

  it('preserves multiple @coerce macros', () => {
    const source = `
${NODE_TYPES_SOURCE}

/**
 * @flowWeaver workflow
 * @node fetch fetchData
 * @node calc calculate
 * @node disp display
 * @coerce c1 fetch.count -> calc.amount as number
 * @coerce c2 calc.total -> disp.label as string
 * @connect disp.message -> Exit.result
 * @param input
 * @returns result
 */
export async function coerceMultiple(
  execute: boolean,
  params: { input: number }
): Promise<{ onSuccess: boolean; onFailure: boolean; result: string }> {
  // @flow-weaver-body
  // @end-flow-weaver-body
}
    `;

    const result = writeAndParse('coerce-roundtrip-multi.ts', source);
    expect(result.warnings.filter(w => w.includes('coerce'))).toHaveLength(0);

    const wf = result.workflows[0];
    expect(wf).toBeDefined();

    const annotations = annotationGenerator.generate(wf, { includeComments: false });

    // Both coerce macros must be present
    expect(annotations).toContain('@coerce c1 fetch.count -> calc.amount as number');
    expect(annotations).toContain('@coerce c2 calc.total -> disp.label as string');

    // No synthetic nodes or connections for either
    expect(annotations).not.toContain('@node c1');
    expect(annotations).not.toContain('@node c2');
    expect(annotations).not.toContain('@connect fetch.count -> c1.value');
    expect(annotations).not.toContain('@connect c1.result -> calc.amount');
    expect(annotations).not.toContain('@connect calc.total -> c2.value');
    expect(annotations).not.toContain('@connect c2.result -> disp.label');
  });

  it('still emits non-coerce connections as @connect', () => {
    const source = `
${NODE_TYPES_SOURCE}

/**
 * @flowWeaver workflow
 * @node fetch fetchData
 * @node calc calculate
 * @node fmt formatValue
 * @coerce c1 fetch.count -> calc.amount as number
 * @connect calc.total -> fmt.value
 * @connect fmt.text -> Exit.result
 * @param input
 * @returns result
 */
export async function coerceWithRegularConn(
  execute: boolean,
  params: { input: number }
): Promise<{ onSuccess: boolean; onFailure: boolean; result: string }> {
  // @flow-weaver-body
  // @end-flow-weaver-body
}
    `;

    const result = writeAndParse('coerce-roundtrip-mixed.ts', source);
    const wf = result.workflows[0];
    expect(wf).toBeDefined();

    const annotations = annotationGenerator.generate(wf, { includeComments: false });

    // The coerce macro should be present
    expect(annotations).toContain('@coerce c1 fetch.count -> calc.amount as number');

    // Regular connections should still be emitted
    expect(annotations).toContain('@connect calc.total -> fmt.value');
    expect(annotations).toContain('@connect fmt.text -> Exit.result');
  });
});
