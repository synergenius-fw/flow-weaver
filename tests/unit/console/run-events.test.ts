/**
 * A step in a scope body runs once per item. The console keeps each pass:
 * before this, a body step's duration spanned every other step's passes in
 * between, and only the last item's values survived.
 */
import { describe, it, expect } from 'vitest';
import { applyEvent, emptyTrace, defaultPass, valueAt } from '../../../console-ui/src/run-events';

const status = (id: string, executionIndex: number, status: string) => ({ type: 'STATUS_CHANGED', id, executionIndex, status });
const set = (id: string, executionIndex: number, portName: string, value: unknown) => ({ type: 'VARIABLE_SET', identifier: { id, portName, executionIndex }, value });

describe('applyEvent', () => {
  it('keeps one pass per execution, and adds their time up rather than spanning them', () => {
    const r = emptyTrace();
    // rate then flag, three times: rate#0 0-2, flag#0 2-5, rate#1 5-7, flag#1 7-10, rate#2 10-12, flag#2 12-15
    let t = 0;
    for (let i = 0; i < 3; i++) {
      applyEvent(r, t, status('rate', i, 'RUNNING')); applyEvent(r, t, set('rate', i, 'rated', { id: 'inv' + i }));
      applyEvent(r, t + 2, status('rate', i, 'SUCCEEDED'));
      applyEvent(r, t + 2, status('flag', i, 'RUNNING')); applyEvent(r, t + 5, status('flag', i, 'SUCCEEDED'));
      t += 5;
    }
    expect(r.states.rate).toEqual({ status: 'SUCCEEDED', start: 10, end: 12, count: 3, total: 6 });
    expect(r.states.flag.total).toBe(9);
    expect(r.passes.rate.map((p) => p.values.rated)).toEqual([{ id: 'inv0' }, { id: 'inv1' }, { id: 'inv2' }]);
    // The flat view still answers with the latest, as before.
    expect(r.values['rate.rated']).toEqual({ id: 'inv2' });
  });

  it('puts an error on the pass that threw and leaves the others clean', () => {
    const r = emptyTrace();
    applyEvent(r, 0, status('rate', 0, 'RUNNING')); applyEvent(r, 1, status('rate', 0, 'SUCCEEDED'));
    applyEvent(r, 1, status('rate', 1, 'RUNNING')); applyEvent(r, 2, { type: 'LOG_ERROR', id: 'rate', executionIndex: 1, error: 'no rate for XYZ' }); applyEvent(r, 2, status('rate', 1, 'FAILED'));
    expect(r.passes.rate[0].error).toBeUndefined();
    expect(r.passes.rate[1]).toMatchObject({ status: 'FAILED', error: 'no rate for XYZ' });
    expect(r.errors.rate).toBe('no rate for XYZ');
    expect(defaultPass(r.passes.rate)).toBe(1);
  });

  it('does not give a scope owner a pass per item: its scoped outputs carry the body index but it ran once', () => {
    const r = emptyTrace();
    applyEvent(r, 0, status('loop', 0, 'RUNNING'));
    for (let i = 0; i < 3; i++) {
      applyEvent(r, i, set('loop', i, 'invoice', { id: 'inv' + i }));
      applyEvent(r, i, status('rate', i, 'RUNNING')); applyEvent(r, i + 1, status('rate', i, 'SUCCEEDED'));
    }
    applyEvent(r, 3, status('loop', 0, 'SUCCEEDED'));
    expect(r.states.loop.count).toBe(1);
    expect(r.states.rate.count).toBe(3);
    // The owner keeps the latest scoped value, as the flat view does...
    expect(r.passes.loop[0].values.invoice).toEqual({ id: 'inv2' });
    // ...and what it handed each body pass is still there by index, so pass 2 of the body shows the second invoice.
    expect(valueAt(r, 'loop', 'invoice', 1)).toEqual({ id: 'inv1' });
    expect(valueAt(r, 'loop', 'invoice', 7)).toEqual({ id: 'inv2' });
    expect(valueAt(r, 'loop', 'invoice')).toEqual({ id: 'inv2' });
  });

  it('treats a gate re-entered on resume as the same pass, keeping its first start', () => {
    const r = emptyTrace();
    applyEvent(r, 10, status('approve', 0, 'RUNNING'));
    applyEvent(r, 500, status('approve', 0, 'RUNNING'));
    applyEvent(r, 520, status('approve', 0, 'SUCCEEDED'));
    expect(r.states.approve).toEqual({ status: 'SUCCEEDED', start: 10, end: 520, count: 1, total: 510 });
  });

  it('files a value or error without an index under the latest pass', () => {
    const r = emptyTrace();
    applyEvent(r, 0, status('x', 0, 'RUNNING')); applyEvent(r, 1, status('x', 0, 'SUCCEEDED'));
    applyEvent(r, 1, status('x', 1, 'RUNNING'));
    applyEvent(r, 2, { type: 'VARIABLE_SET', identifier: { id: 'x', portName: 'out' }, value: 7 });
    expect(r.passes.x[1].values.out).toBe(7);
    expect(defaultPass(r.passes.x)).toBe(1);
    expect(defaultPass([])).toBeUndefined();
  });
});
