/**
 * The console draws a workflow the way a git client draws history: lane 0 is
 * the trunk, and anything that is not the next continuation takes a lane of
 * its own and merges back.
 *
 * Each case here is a picture that was wrong on screen first. Greedy lane
 * assignment drew a loop body on the trunk (reading as if the loop were
 * skipped), a failure arm as a straight line indistinguishable from normal
 * flow, and -- after any branch -- the whole spine drifting one lane right
 * for the rest of the workflow.
 */
import { describe, it, expect } from 'vitest';
import { buildLanes as buildGraph } from '../../../src/diagram/lanes';
import type { Model, Step } from '../../../console-ui/src/state';

function step(id: string, over: Partial<Step> = {}): Step {
  return {
    id, label: id, type: id, kind: 'step', gate: null, scope: null, inScope: null, pure: false,
    expression: false, pull: false, stage: 0, reads: [], exprs: [], produces: [],
    children: [], entered: [], successTo: [], failureTo: [], gateInputs: [],
    gateOutputs: [], description: '', ...over,
  };
}

const model = (steps: Step[], over: Partial<Model> = {}): Model => ({
  name: 'wf', steps, startTo: [steps[0]?.id].filter(Boolean) as string[],
  exitFrom: [{ from: steps[steps.length - 1].id, arm: 'ok' }], ...over,
});

const laneOf = (g: ReturnType<typeof buildGraph>, id: string) =>
  g.rows.find((r) => r.id === id)!.lane;
const edge = (g: ReturnType<typeof buildGraph>, from: string, to: string) =>
  g.edges.find((e) => e.from === from && e.to === to);

describe('lane layout', () => {
  it('keeps a straight workflow on one lane', () => {
    const g = buildGraph(
      model([step('a', { successTo: ['b'] }), step('b', { successTo: [] })]),
    );
    expect(g.lanes).toBe(1);
    expect(g.rows.map((r) => r.lane)).toEqual([0, 0, 0, 0]); // Start, a, b, Exit
  });

  it('gives a failure arm its own lane, never the trunk', () => {
    // `a` fails to `c`, skipping `b`. The arm must not be drawn as the trunk
    // carrying on, which is how it reads when it stays on lane 0.
    const g = buildGraph(
      model([
        step('a', { successTo: ['b'], failureTo: ['c'] }),
        step('b', { successTo: ['c'] }),
        step('c'),
      ]),
    );
    expect(edge(g, 'a', 'b')!.lane).toBe(0);
    expect(edge(g, 'a', 'c')!.lane).toBeGreaterThan(0);
    expect(edge(g, 'a', 'c')!.kind).toBe('fail');
  });

  it('indents a scope body and returns the trunk afterwards', () => {
    const body = step('inner', { successTo: [] });
    const g = buildGraph(
      model([
        step('loop', { kind: 'loop', scope: 'line', successTo: ['after'], children: [body] }),
        step('after'),
      ]),
    );
    // The body sits off the trunk...
    expect(laneOf(g, 'inner')).toBeGreaterThan(0);
    expect(edge(g, 'loop', 'inner')!.kind).toBe('loop');
    // ...and what follows the loop is back on it.
    expect(laneOf(g, 'after')).toBe(0);
    expect(laneOf(g, 'Exit')).toBe(0);
  });

  it('reports the rows each scope body occupies, so a band can be drawn behind them', () => {
    const inner = step('deep', { successTo: [] });
    const g = buildGraph(
      model([
        step('loop', { kind: 'loop', scope: 'line', successTo: ['after'], children: [
          step('rate', { successTo: ['flag'] }),
          step('flag', { kind: 'loop', scope: 'each', successTo: [], children: [inner] }),
        ] }),
        step('after'),
      ]),
    );
    // Start, loop, rate, flag, deep, after, Exit
    expect(g.scopes).toEqual([
      { owner: 'loop', scope: 'line', first: 2, last: 4, depth: 0, lane: expect.any(Number) },
      { owner: 'flag', scope: 'each', first: 4, last: 4, depth: 1, lane: expect.any(Number) },
    ]);
    // The band starts where the body's tiles sit, off the trunk.
    expect(g.scopes[0].lane).toBeGreaterThan(0);
    expect(g.scopes[1].lane).toBeGreaterThanOrEqual(g.scopes[0].lane);
    expect(buildGraph(model([step('a')])).scopes).toEqual([]);
  });

  it('does not draw the owner and its body as two parallel lines', () => {
    // The body's `return` edge already carries the flow onward. The owner's
    // own success edge would be a second line straight through the body.
    const body = step('inner', { successTo: [] });
    const g = buildGraph(
      model([
        step('loop', { kind: 'loop', scope: 'line', successTo: ['after'], children: [body] }),
        step('after'),
      ]),
    );
    expect(edge(g, 'loop', 'after')).toBeUndefined();
    expect(edge(g, 'inner', 'after')!.kind).toBe('return');
  });

  it('moves a pulled node beside the consumer that needs it', () => {
    // Declared first, but it runs on demand: it belongs next to its reader,
    // not at the head of the process.
    const g = buildGraph(
      model([
        step('rates', { pull: true, produces: [{ port: 'rates', to: ['use'] }] }),
        step('first', { successTo: ['use'] }),
        step('use'),
      ], { startTo: ['first'] }),
    );
    const order = g.rows.map((r) => r.id);
    expect(order.indexOf('rates')).toBeGreaterThan(order.indexOf('first'));
    expect(order.indexOf('rates')).toBeLessThan(order.indexOf('use'));
    expect(edge(g, 'rates', 'use')!.kind).toBe('pull');
  });

  it('hands the trunk to the real continuation, not merely the nearest row', () => {
    // `build -> Exit` and `build -> finish` both leave `build`, and `finish`
    // sits between them. Sorting by row index alone gave Exit the trunk and
    // pushed the real continuation into a branch lane, inverting the picture.
    const g = buildGraph(
      model([
        step('build', { successTo: ['finish'] }),
        step('finish', { successTo: [] }),
      ], { exitFrom: [{ from: 'build', arm: 'ok' }, { from: 'finish', arm: 'ok' }] }),
    );
    expect(edge(g, 'build', 'finish')!.lane).toBe(0);
    expect(laneOf(g, 'finish')).toBe(0);
  });

  it('returns to the trunk once nothing else is in flight', () => {
    // Two arms converge on `end`: it belongs on the trunk, not on whichever
    // branch lane happened to be assigned first.
    const g = buildGraph(
      model([
        step('a', { successTo: ['b'], failureTo: ['end'] }),
        step('b', { successTo: ['end'], failureTo: ['end'] }),
        step('end'),
      ]),
    );
    expect(laneOf(g, 'end')).toBe(0);
    expect(laneOf(g, 'Exit')).toBe(0);
  });

  it('attaches a step that is wired only by data', () => {
    // `incident-triage`'s `record` has no control wiring at all -- that is
    // deliberate, so it runs on both arms of a gate -- and reaching it is
    // what `@connect` does. Drawn with no edges it was a tile indented
    // against nothing: off the trunk, attached to neither side.
    const g = buildGraph(
      model([
        step('signoff', { successTo: [], produces: [{ port: 'decision', to: ['record'] }] }),
        step('record', {
          reads: [{ port: 'decision', from: 'signoff', fromPort: 'decision' }],
          produces: [{ port: 'outcome', to: ['Exit'] }],
        }),
      ], { startTo: ['signoff'], exitFrom: [{ from: 'signoff', arm: 'ok' }] }),
    );
    // Both halves are drawn: what it reads, and where the value goes.
    expect(edge(g, 'signoff', 'record')).toMatchObject({ kind: 'pull' });
    expect(edge(g, 'record', 'Exit')).toMatchObject({ kind: 'pull' });
    // Whatever lane it lands on, it is reachable -- no tile floating with
    // no line touching it, which is what made the indentation meaningless.
    expect(g.edges.some((e) => e.to === 'record')).toBe(true);
  });

  it('keeps a failure arm beside the gate it leaves', () => {
    // The weaver-bot topology: `router:fail -> fallback` while the happy path
    // runs on through `context` and `gate`. Declared in source order the arm
    // landed four rows below its gate, and the fail line was drawn straight
    // through three steps that have nothing to do with it.
    const g = buildGraph(
      model([
        step('router', { successTo: ['context'], failureTo: ['fallback'] }),
        step('context', { successTo: ['gate'] }),
        step('gate', { successTo: ['process'], failureTo: ['merge'] }),
        step('process', { successTo: ['merge'] }),
        step('fallback', { successTo: ['report'] }),
        step('merge', { successTo: ['report'] }),
        step('report'),
      ], { exitFrom: [{ from: 'report', arm: 'ok' }] }),
    );
    expect(g.index.fallback - g.index.router).toBe(1);
    // The join belongs to neither arm, so it stays on the trunk.
    expect(laneOf(g, 'merge')).toBe(0);
  });

  it('reports the rows a failure arm occupies, so a band can be drawn behind them', () => {
    const g = buildGraph(
      model([
        step('fetch', { successTo: ['parse'], failureTo: ['backoff'] }),
        step('parse', { successTo: ['done'] }),
        step('backoff', { successTo: ['refetch'] }),
        step('refetch', { successTo: ['parse'] }),
        step('done'),
      ], { exitFrom: [{ from: 'done', arm: 'ok' }] }),
    );
    const arm = g.arms.find((a) => a.gate === 'fetch')!;
    expect(g.rows.slice(arm.first, arm.last + 1).map((r) => r.id)).toEqual(['backoff', 'refetch']);
    expect(arm.lane).toBeGreaterThan(0);
    expect(buildGraph(model([step('a')])).arms).toEqual([]);
  });

  it('keeps a failure arm beside its gate however long the arm is', () => {
    // Ordering on the arm's length inverted the picture between two workflows
    // a single step apart: at two rows the arm sat above the happy path, at
    // three it jumped below it. Length is not what makes an arm a digression.
    const chain = (n: number) => {
      const ids = Array.from({ length: n }, (_, i) => `a${i}`);
      return buildGraph(
        model([
          step('g', { successTo: ['happy'], failureTo: ['a0'] }),
          step('happy', { successTo: ['end'] }),
          ...ids.map((id, i) => step(id, { successTo: [ids[i + 1] ?? 'end'] })),
          step('end'),
        ], { startTo: ['g'], exitFrom: [{ from: 'end', arm: 'ok' }] }),
      );
    };
    for (const n of [1, 2, 3, 4]) {
      const g = chain(n);
      expect(g.index.a0 - g.index.g).toBe(1);
    }
  });

  it('draws a failure that fans out as one band, not one per target', () => {
    // Three strands of the same detour. A band each stacked three one-row
    // bands under the gate, every one of them repeating its name.
    const g = buildGraph(
      model([
        step('g', { successTo: ['ok1'], failureTo: ['e1', 'e2', 'e3'] }),
        step('ok1', { successTo: ['j'] }),
        step('e1', { successTo: ['j'] }),
        step('e2', { successTo: ['j'] }),
        step('e3', { successTo: ['j'] }),
        step('j'),
      ], { startTo: ['g'], exitFrom: [{ from: 'j', arm: 'ok' }] }),
    );
    expect(g.arms.filter((a) => a.gate === 'g')).toHaveLength(1);
    const arm = g.arms.find((a) => a.gate === 'g')!;
    expect(g.rows.slice(arm.first, arm.last + 1).map((r) => r.id)).toEqual(['e1', 'e2', 'e3']);
  });

  it('leaves the join beyond a gate out of its arm', () => {
    // `end` is reached by the success step and by a pulled node, so it belongs
    // to neither arm. Claiming it stretched the span over the join and the
    // pulled row beyond it.
    const g = buildGraph(
      model([
        step('g', { successTo: ['ok1'], failureTo: ['handler'] }),
        step('ok1', { successTo: ['end'] }),
        step('cfg', { pull: true, produces: [{ port: 'cfg', to: ['end'] }] }),
        step('handler', { successTo: ['end'] }),
        step('end'),
      ], { startTo: ['g'], exitFrom: [{ from: 'end', arm: 'ok' }] }),
    );
    const arm = g.arms.find((a) => a.gate === 'g')!;
    expect(g.rows.slice(arm.first, arm.last + 1).map((r) => r.id)).toEqual(['handler']);
  });

  it('does not bury the happy path under an arm that branches again', () => {
    // An arm with a gate of its own is a piece of process, not a digression.
    // Above the trunk it pushes the happy path below the whole error subtree,
    // and the eye meets the errors first.
    const g = buildGraph(
      model([
        step('g', { successTo: ['happy'], failureTo: ['sub'] }),
        step('happy', { successTo: ['end'] }),
        step('sub', { successTo: ['subOk'], failureTo: ['subErr'] }),
        step('subOk', { successTo: ['end'] }),
        step('subErr', { successTo: ['end'] }),
        step('end'),
      ], { exitFrom: [{ from: 'end', arm: 'ok' }] }),
    );
    expect(g.index.happy).toBeLessThan(g.index.sub);
    expect(laneOf(g, 'happy')).toBe(0);
  });

  it('keeps a failure arm inside a scope body off the trunk', () => {
    // The arm runs once per item like its siblings. Taking lane 0 because it
    // happened to be free drew it as the trunk, and dragged the band behind
    // the body out to the trunk with it, swallowing the owner above.
    const g = buildGraph(
      model([
        step('loop', { kind: 'loop', scope: 'item', successTo: ['after'], children: [
          step('check', { successTo: ['keep'], failureTo: ['drop'] }),
          step('keep'),
          step('drop'),
        ] }),
        step('after'),
      ]),
    );
    expect(laneOf(g, 'drop')).toBeGreaterThan(0);
    expect(g.scopes[0].lane).toBeGreaterThan(0);
  });

  it('gives each scope of a multi-scope owner its own band', () => {
    // A node type may declare several scopes, each a callback it drives, and
    // the children of all of them arrive in one list. Banding them together
    // named only the first scope and claimed the others' rows were its.
    const g = buildGraph(
      model([
        step('branch', { kind: 'loop', scope: 'then', successTo: ['end'], children: [
          step('t1', { inScope: 'then', successTo: ['t2'] }),
          step('t2', { inScope: 'then' }),
          step('e1', { inScope: 'else' }),
        ] }),
        step('end'),
      ]),
    );
    expect(g.scopes.map((s) => s.scope)).toEqual(['then', 'else']);
    const band = (scope: string) => g.scopes.find((s) => s.scope === scope)!;
    expect(g.rows.slice(band('then').first, band('then').last + 1).map((r) => r.id)).toEqual(['t1', 't2']);
    expect(g.rows.slice(band('else').first, band('else').last + 1).map((r) => r.id)).toEqual(['e1']);
  });

  it('sinks a step several gates fail into below the last of them', () => {
    // `reject` belongs to no single arm, so no arm claims it and it keeps the
    // place it was declared in. Once the arms moved that was above `approve`,
    // whose fail edge was then drawn backwards up the page.
    const g = buildGraph(
      model([
        step('intake', { successTo: ['approve'], failureTo: ['reject'] }),
        step('reject'),
        step('approve', { successTo: ['publish'], failureTo: ['reject'] }),
        step('publish'),
      ], { startTo: ['intake'], exitFrom: [{ from: 'publish', arm: 'ok' }] }),
    );
    expect(g.index.reject).toBeGreaterThan(g.index.approve);
    for (const e of g.edges) expect(g.index[e.to]).toBeGreaterThan(g.index[e.from]);
  });

  it('never points an edge backwards', () => {
    // Rows are laid out in process order. An edge to an earlier row would be
    // drawn as a line going up the page.
    const body = step('inner', { successTo: [] });
    const g = buildGraph(
      model([
        step('a', { successTo: ['loop'], failureTo: ['end'] }),
        step('loop', { kind: 'loop', scope: 's', successTo: ['end'], children: [body] }),
        step('end'),
      ]),
    );
    for (const e of g.edges) expect(g.index[e.to]).toBeGreaterThan(g.index[e.from]);
  });
});
