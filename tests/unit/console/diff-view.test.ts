/**
 * Two versions of a workflow as one marked picture: the union keeps a
 * removed step where it was, an added step where it now runs, and the
 * marks and lists say which is which.
 */
import { describe, it, expect } from 'vitest';
import { parser } from '../../../src/parser';
import { buildDiffView } from '../../../src/console/diff-view';

const NODES = `
/** @flowWeaver nodeType @expression
 * @input v - Value
 * @output v - Value */
export function a(v: number): { v: number } { return { v }; }
/** @flowWeaver nodeType @expression
 * @input v - Value
 * @output v - Value */
export function b(v: number): { v: number } { return { v }; }
/** @flowWeaver nodeType @expression
 * @input v - Value
 * @output v - Value */
export function c(v: number): { v: number } { return { v }; }
/** @flowWeaver nodeType
 * @input v - Value
 * @output v - Value
 * @output reason - Why */
export function guard(execute: boolean, v: number): { onSuccess: boolean; onFailure: boolean; v: number; reason: string } {
  return { onSuccess: execute, onFailure: false, v, reason: '' };
}
/** @flowWeaver nodeType @expression
 * @input v - Value
 * @output v - Value */
export function report(v: number): { v: number } { return { v }; }
`;
const wf = (body: string, returns = ' * @returns v - Value\n', type = 'v: number') => `${NODES}
/**
 * @flowWeaver workflow
 * @param v - Value
${returns}${body} */
export function flow(execute: boolean, params: { v: number }): { onSuccess: boolean; onFailure: boolean; ${type} } { throw new Error('x'); }
`;

// before: Start -> one -> two -> three -> Exit
const BEFORE = wf(` * @node one a
 * @node two b
 * @node three c
 * @path Start -> one -> two -> three -> Exit
`);
// after: two removed, a guard added with a failure arm to a report, one's expression changed
const AFTER = wf(` * @node one a [expr: v="params.v"]
 * @node three c
 * @node check guard
 * @node fin report
 * @path Start -> one -> check -> three -> Exit
 * @path check:fail -> fin -> Exit
`);

const parse = (src: string) => { const p = parser.parseFromString(src); expect(p.errors).toEqual([]); return p.workflows[0]; };

describe('buildDiffView', () => {
  const view = buildDiffView(parse(BEFORE), parse(AFTER));

  it('names what was added, removed and changed', () => {
    expect(view.identical).toBe(false);
    expect(view.marks.removed).toEqual(['two']);
    expect(view.marks.added.sort()).toEqual(['check', 'fin']);
    expect(view.marks.changed).toContain('one');
    expect(view.steps.find((s) => s.id === 'one')?.detail).toContain('expressions changed');
    expect(view.reasons.length).toBeGreaterThan(0);
  });

  it('marks control edges that came and went, and lists data wiring without marking it', () => {
    const added = view.marks.edgesAdded.map((e) => e.join('>'));
    const removed = view.marks.edgesRemoved.map((e) => e.join('>'));
    expect(added).toEqual(expect.arrayContaining(['one>check', 'check>three', 'check>fin', 'fin>Exit']));
    expect(removed).toEqual(expect.arrayContaining(['one>two', 'two>three']));
    const fail = view.wiring.find((x) => x.from === 'check' && x.to === 'fin');
    expect(fail).toMatchObject({ change: 'added', kind: 'fail' });
    expect(fail?.label).toContain('on failure');
    // `@path` also wired data by name; those show in the list as data, not on the picture.
    expect(view.wiring.some((x) => x.kind === 'data')).toBe(true);
    expect(added.some((k) => k.includes('.'))).toBe(false);
  });

  it('lays both versions out as one process, with the removed step still in its place', () => {
    expect(view.model).not.toBeNull();
    const order = view.model!.steps.map((s) => s.id);
    // one, then the removed two and the new check both before three, then three; fin hangs off the arm.
    expect(order.indexOf('one')).toBeLessThan(order.indexOf('two'));
    expect(order.indexOf('two')).toBeLessThan(order.indexOf('three'));
    expect(order.indexOf('check')).toBeLessThan(order.indexOf('three'));
    expect(order).toContain('fin');
    // The removed step comes with what a row needs to draw it.
    expect(view.nodes.two).toMatchObject({ id: 'two', type: 'b', label: 'B', expression: true });
    expect(view.nodes.one).toBeUndefined();
  });

  it('says so when nothing changed, and notices the contract', () => {
    const same = buildDiffView(parse(BEFORE), parse(BEFORE));
    expect(same.identical).toBe(true);
    expect(same.steps).toEqual([]);
    expect(same.marks.added).toEqual([]);
    const contract = buildDiffView(parse(BEFORE), parse(wf(` * @node one a
 * @node two b
 * @node three c
 * @path Start -> one -> two -> three -> Exit
 * @connect three.v -> Exit.note
`, ' * @returns v - Value\n * @returns note - A note\n', 'v: number; note: number')));
    expect(contract.contract).toEqual([{ side: 'out', name: 'note', change: 'added', detail: expect.any(String) }]);
  });
});
