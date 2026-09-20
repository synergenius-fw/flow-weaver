/**
 * The process model: a workflow read as steps, pauses and arms rather than
 * boxes and arrows. It must come from the same facts the engine uses --
 * topological order, control edges, gate classification -- so what is
 * shown is what would run.
 */
import { describe, it, expect } from 'vitest';
import { parser } from '../../../src/parser';
import { buildProcessModel } from '../../../src/diagram/process-view';

const GATED = `
/** @flowWeaver nodeType @expression */
function prepare(value: number): { value: number } { return { value: value * 2 }; }
/**
 * @flowWeaver nodeType
 * @durableGate approval
 * @input value - Value
 * @output value - Approved value
 */
async function approve(execute: boolean, value: number): Promise<{ onSuccess: boolean; onFailure: boolean; value: number }> { throw new Error('gate'); }
/**
 * @flowWeaver nodeType
 * @durablePure
 * @input value - Value
 * @output result - Result
 * @output reason - Why it was refused
 */
function check(execute: boolean, value: number): { onSuccess: boolean; onFailure: boolean; result: number; reason: string } {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0, reason: '' };
  return value > 0 ? { onSuccess: true, onFailure: false, result: value, reason: '' } : { onSuccess: false, onFailure: true, result: 0, reason: 'neg' };
}
/**
 * @flowWeaver nodeType @expression @durablePure
 * @input result - Result
 * @input reason - Reason
 * @output outcome - Outcome
 */
function report(result: number, reason: string): { outcome: string } { return { outcome: reason || String(result) }; }
/**
 * @flowWeaver workflow
 * @param value - Input
 * @returns outcome - Outcome
 * @node prep prepare
 * @node check check
 * @node approve approve
 * @node report report
 * @path Start -> prep -> check -> approve -> report -> Exit
 * @path check:fail -> report
 * @connect check.result -> report.result
 * @connect check.reason -> report.reason
 */
export async function gated(execute: boolean, params: { value: number }): Promise<{ onSuccess: boolean; onFailure: boolean; outcome: string }> {
  throw new Error('not compiled');
}
`;

const FANOUT = `
/** @flowWeaver nodeType @expression */
function a(text: string): { score: number } { return { score: text.length }; }
/** @flowWeaver nodeType @expression */
function b(text: string): { score: number } { return { score: 1 }; }
/**
 * @flowWeaver nodeType @expression
 * @input x - From a
 * @input y - From b
 * @output total - Total
 */
function merge(x: number, y: number): { total: number } { return { total: x + y }; }
/**
 * @flowWeaver workflow
 * @param text - Input
 * @returns total - Total
 * @node a a
 * @node b b
 * @node merge merge
 * @connect Start.execute -> a.execute
 * @connect Start.execute -> b.execute
 * @connect Start.text -> a.text
 * @connect Start.text -> b.text
 * @connect a.onSuccess -> merge.execute
 * @connect b.onSuccess -> merge.execute
 * @connect a.score -> merge.x
 * @connect b.score -> merge.y
 * @connect merge.onSuccess -> Exit.onSuccess
 * @connect merge.total -> Exit.total
 */
export function fanout(execute: boolean, params: { text: string }): { onSuccess: boolean; onFailure: boolean; total: number } {
  throw new Error('not compiled');
}
`;

function modelOf(source: string) {
  const parsed = parser.parseFromString(source);
  expect(parsed.errors).toEqual([]);
  return buildProcessModel(parsed.workflows[0]);
}

describe('buildProcessModel', () => {
  it('lays a gated chain out as one stage per step, splitting segments at the pause', () => {
    const m = modelOf(GATED);
    expect(m.steps.map((s) => s.id)).toEqual(['prep', 'check', 'approve', 'report']);
    expect(m.steps.map((s) => s.stage)).toEqual([1, 2, 3, 4]);
    expect(m.segments).toBe(2);
    const approve = m.steps.find((s) => s.id === 'approve')!;
    expect(approve.kind).toBe('pause');
    expect(approve.gate).toBe('approval');
    expect(approve.segment).toBe(0);
    expect(m.steps.find((s) => s.id === 'report')!.segment).toBe(1);
  });

  it('records the failure arm and the convergence it creates', () => {
    const m = modelOf(GATED);
    const check = m.steps.find((s) => s.id === 'check')!;
    expect(check.failureTo).toEqual(['report']);
    const report = m.steps.find((s) => s.id === 'report')!;
    expect(report.entered).toEqual(
      expect.arrayContaining([
        { from: 'approve', arm: 'ok' },
        { from: 'check', arm: 'fail' },
      ]),
    );
  });

  it('puts fan-out siblings on one stage as lanes and the join after them', () => {
    const m = modelOf(FANOUT);
    const byId = Object.fromEntries(m.steps.map((s) => [s.id, s]));
    expect(byId.a.stage).toBe(1);
    expect(byId.b.stage).toBe(1);
    expect(byId.merge.stage).toBe(2);
    expect(m.startTo.sort()).toEqual(['a', 'b']);
    expect(byId.merge.reads.map((r) => `${r.port}<${r.from}.${r.fromPort}`).sort()).toEqual(['x<a.score', 'y<b.score']);
  });

  it('describes what a gate shows its resolver and what it takes back', () => {
    const approve = modelOf(GATED).steps.find((s) => s.id === 'approve')!;
    expect(approve.gateInputs).toEqual(['value']);
    expect(approve.gateOutputs).toEqual(['value']);
  });
});
