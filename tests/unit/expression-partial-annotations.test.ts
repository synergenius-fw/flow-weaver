/**
 * Annotating one port of an @expression node must not un-infer the others.
 *
 * The orientation says: add @input/@output only to override the inference --
 * a description, a rename, an order, a merge strategy -- never to restate it.
 * The parser used to treat any explicit data port as "the author listed the
 * ports", skip inference, and silently drop every unannotated parameter and
 * return field. The first symptom was a workflow-level UNKNOWN_TARGET_PORT on
 * a port that plainly exists in the function signature.
 *
 * Rule: when every explicit port names something the signature has, the
 * explicit ports are overlaid on the inferred set. When the explicit list
 * names something the signature does not have -- a rename, a virtual port --
 * the author is describing the interface themselves, and the explicit list
 * stands as before.
 */
import { describe, it, expect } from 'vitest';
import { parser } from '../../src/parser';
import { validateWorkflow } from '../../src/api/validate';

const SOURCE = `
/**
 * @flowWeaver nodeType
 * @expression
 * @input a [mergeStrategy:FIRST] - The first operand, from whichever arm ran
 */
export function add(a: number, b: number): { sum: number; note: string } {
  return { sum: a + b, note: 'x' };
}

/**
 * @flowWeaver nodeType
 * @expression
 * @output sum - Only the sum is described
 */
export function add2(a: number, b: number): { sum: number; note: string } {
  return { sum: a + b, note: 'x' };
}

/**
 * The author names the ports themselves: \`value\` is not a parameter, so this
 * is a rename and the explicit list is the interface.
 *
 * @flowWeaver nodeType
 * @expression
 * @input value - Renamed
 * @output result - Renamed
 */
export function renamed(val: number): number {
  return val;
}

/**
 * @flowWeaver workflow
 * @param a - A
 * @param b - B
 * @returns sum - Sum
 * @node n add
 * @node m add2
 * @path Start -> n -> m -> Exit
 * @connect Start.b -> n.b
 * @connect Start.b -> m.b
 * @connect n.sum -> m.a
 */
export function wf(execute: boolean, params: { a: number; b: number }): { onSuccess: boolean; onFailure: boolean; sum: number } {
  throw new Error('generated body was not installed');
}
`;

describe('partial annotations on @expression nodes', () => {
  const parsed = parser.parseFromString(SOURCE);
  const type = (name: string) => parsed.nodeTypes.find((nt) => nt.functionName === name)!;

  it('parses cleanly', () => {
    expect(parsed.errors).toEqual([]);
  });

  it('keeps the unannotated inputs and applies the annotation to the named one', () => {
    const add = type('add');
    expect(Object.keys(add.inputs)).toEqual(['a', 'b', 'execute']);
    expect(add.inputs.a.mergeStrategy).toBe('FIRST');
    expect(add.inputs.a.label).toBe('The first operand, from whichever arm ran');
    expect(add.inputs.a.dataType).toBe('NUMBER');
    expect(add.inputs.b.dataType).toBe('NUMBER');
    expect(Object.keys(add.outputs)).toEqual(['sum', 'note', 'onSuccess', 'onFailure']);
  });

  it('keeps the unannotated outputs and applies the annotation to the named one', () => {
    const add2 = type('add2');
    expect(Object.keys(add2.inputs)).toEqual(['a', 'b', 'execute']);
    expect(Object.keys(add2.outputs)).toEqual(['sum', 'note', 'onSuccess', 'onFailure']);
    expect(add2.outputs.sum.label).toBe('Only the sum is described');
    expect(add2.outputs.note.dataType).toBe('STRING');
  });

  it('leaves an explicit list that renames ports as the interface, unchanged', () => {
    const renamed = type('renamed');
    expect(Object.keys(renamed.inputs)).toEqual(['value', 'execute']);
    expect(Object.keys(renamed.outputs)).toEqual(['result', 'onSuccess', 'onFailure']);
  });

  it('lets the workflow wire the ports the signature has', () => {
    const result = validateWorkflow(parsed.workflows[0]);
    expect(result.errors.map((e) => (typeof e === 'string' ? e : e.code))).toEqual([]);
  });
});
