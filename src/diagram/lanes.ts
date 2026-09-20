/**
 * Lane layout for the process spine, in the manner of a git graph.
 *
 * Rows are steps in process order (a loop body follows its owner, a pulled
 * step sits just before its consumer). Lane 0 is the trunk. An edge whose
 * target is not the next continuation branches out to a free lane at its
 * source row, holds that lane, and merges back at its target row. That is
 * enough to show failure arms, loop bodies, fan-out/fan-in and pull edges
 * without a general graph layout.
 *
 * The console draws this live and the SVG renderer draws it still; both
 * take the picture from here, so the two never disagree about the shape.
 */

/** What the layout needs to know about a step; the process model has all of it. */
export interface LaneStep {
  id: string;
  /** `[pullExecution:]` declared: the step runs when something reads it. */
  pull?: boolean;
  /** The scope this step owns, when it has children. */
  scope?: string | null;
  reads: Array<{ from: string }>;
  produces: Array<{ to: string[] }>;
  children: LaneStep[];
  entered: Array<{ from: string; arm: 'ok' | 'fail' }>;
  successTo: string[];
  failureTo: string[];
}

export interface LaneModel {
  steps: LaneStep[];
  startTo: string[];
  exitFrom: Array<{ from: string; arm: 'ok' | 'fail' }>;
}

/** A lane holding a tile must fit one; a lane carrying only edges need not. */
const TILE_LANE = 26;
/** Only wide enough to tell two lines apart. */
const EDGE_LANE = 11;
/** Space between the last lane and the step labels. */
const GUTTER_PAD = 12;

export type EdgeKind = 'ok' | 'fail' | 'loop' | 'return' | 'pull';
export interface LaneRow<S extends LaneStep = LaneStep> { id: string; step: S | null; depth: number; lane: number; owner: string | null }
export interface LaneEdge { from: string; to: string; kind: EdgeKind; fromLane: number; lane: number; toLane: number }
/**
 * The rows a scope owner's body occupies: drawn as one band behind them, so
 * the reader sees where the body starts and ends and whose it is, not only
 * that the rows are indented.
 */
export interface LaneScope { owner: string; scope: string | null; first: number; last: number; depth: number; lane: number }
export interface LaneGraph<S extends LaneStep = LaneStep> {
  rows: LaneRow<S>[];
  edges: LaneEdge[];
  /** One per owner with a body, outer scopes first. */
  scopes: LaneScope[];
  lanes: number;
  index: Record<string, number>;
  /** Centre x of each lane. A lane carrying only edges is narrower than one holding tiles. */
  laneX: number[];
  /** Width of the whole gutter, i.e. where the step labels begin. */
  gutter: number;
}

/**
 * A step reached through its data rather than through control flow.
 *
 * `[pullExecution:]` declares this, but a node wired with `@connect` alone
 * is the same thing in practice: `incident-triage`'s `record` runs on both
 * gate arms precisely because nothing wires its `execute`. Either way it is
 * off the trunk, and its data edges are the only thing attaching it to the
 * process -- without them the tile floats, indented against nothing.
 */
export function demandDriven(step: LaneStep | null | undefined): boolean {
  if (!step) return false;
  if (step.pull) return true;
  const wired = step.entered.length > 0 || step.successTo.length > 0 || step.failureTo.length > 0;
  return !wired && (step.reads.length > 0 || step.produces.length > 0);
}

export function buildLanes<S extends LaneStep>(model: { steps: S[]; startTo: string[]; exitFrom: LaneModel['exitFrom'] }): LaneGraph<S> {
  // 1. rows in process order, loop bodies inline after their owner
  const flat: Array<{ id: string; step: S | null; depth: number; owner: string | null }> = [{ id: 'Start', step: null, depth: 0, owner: null }];
  const visit = (steps: S[], depth: number, owner: string | null) => {
    for (const s of steps) { flat.push({ id: s.id, step: s, depth, owner }); visit(s.children as S[], depth + 1, s.id); }
  };
  visit(model.steps, 0, null);
  flat.push({ id: 'Exit', step: null, depth: 0, owner: null });

  // 2. a pulled step moves to just before its first consumer
  const byId = new Map(flat.map((r) => [r.id, r]));
  for (const r of [...flat]) {
    if (!demandDriven(r.step)) continue;
    const consumers = new Set(r.step!.produces.flatMap((p) => p.to));
    const at = flat.findIndex((x) => x.id === r.id);
    const target = flat.findIndex((x, i) => i !== at && consumers.has(x.id));
    if (target < 0) continue;
    flat.splice(at, 1);
    flat.splice(target > at ? target - 1 : target, 0, r);
  }
  const index: Record<string, number> = {};
  flat.forEach((r, i) => { index[r.id] = i; });

  // 3. edges
  const raw: Array<{ from: string; to: string; kind: EdgeKind }> = [];
  const seen = new Set<string>();
  const suppressed = new Set<string>();
  const add = (from: string, to: string, kind: EdgeKind) => {
    if (!(to in index) || !(from in index) || index[to] <= index[from]) return;
    const k = `${from}>${to}`;
    if (seen.has(k)) return;
    seen.add(k); raw.push({ from, to, kind });
  };
  const all: S[] = [];
  const collect = (steps: S[]) => steps.forEach((s) => { all.push(s); collect(s.children as S[]); });
  collect(model.steps);
  const onDemand = (id: string): boolean => demandDriven(byId.get(id)?.step ?? null);

  for (const to of model.startTo) if (!onDemand(to)) add('Start', to, 'ok');
  for (const s of all) {
    if (s.children.length) {
      const kids = s.children;
      add(s.id, kids[0].id, 'loop');
      const kidIds = new Set(kids.map((k) => k.id));
      for (const k of kids) {
        for (const t of k.successTo) if (kidIds.has(t)) add(k.id, t, 'ok');
        for (const t of k.failureTo) if (kidIds.has(t)) add(k.id, t, 'fail');
      }
      const last = kids.filter((k) => !k.successTo.some((t) => kidIds.has(t)));
      for (const k of last) for (const t of s.successTo) add(k.id, t, 'return');
      // The body's return edge carries the flow onward, so the owner's own
      // success edge would duplicate it as a second line straight through
      // the body -- which reads as skipping the loop. Drop it.
      if (last.length) for (const t of s.successTo) suppressed.add(`${s.id}>${t}`);
    }
    if (onDemand(s.id)) {
      // Draw what actually attaches it: the values it reads, and where they go.
      for (const r of s.reads) add(r.from, s.id, 'pull');
      for (const c of new Set(s.produces.flatMap((p) => p.to))) add(s.id, c, 'pull');
      continue;
    }
    for (const t of s.successTo) if (!onDemand(t)) add(s.id, t, 'ok');
    for (const t of s.failureTo) if (!onDemand(t)) add(s.id, t, 'fail');
  }
  for (const e of model.exitFrom) add(e.from, 'Exit', e.arm === 'fail' ? 'fail' : 'ok');

  const kept = raw.filter((e) => !(e.kind === 'ok' && suppressed.has(`${e.from}>${e.to}`)));
  raw.length = 0;
  raw.push(...kept);

  // 4. lanes: held[lane] = id of the row that will land on it (or null)
  const held: Array<string | null> = [];
  const free = (not?: number) => {
    let i = held.findIndex((h, idx) => h === null && idx !== not);
    if (i < 0) { i = held.length; held.push(null); }
    return i;
  };
  const edgeLane = new Map<string, number>();
  const rowLane: Record<string, number> = {};
  const ownerLane = new Map<string, number>();
  const outgoing = new Map<string, typeof raw>();
  for (const e of raw) { (outgoing.get(e.from) ?? outgoing.set(e.from, []).get(e.from)!).push(e); }

  for (const r of flat) {
    const mine = held.map((h, i) => (h === r.id ? i : -1)).filter((i) => i >= 0);
    for (const i of mine) held[i] = null;
    // A row sits on the lane its incoming edge arrives on, so a loop body
    // stays indented. Where several edges converge the row is where branches
    // rejoin, so it takes the leftmost of them -- and if nothing else is in
    // flight by then, the trunk itself, rather than leaving the rest of the
    // workflow shifted one lane right for good.
    const converges = mine.length > 1;
    const backToTrunk = converges && held.every((h) => h === null);
    const lane = mine.length ? (backToTrunk ? 0 : Math.min(...mine)) : free();
    rowLane[r.id] = lane;
    // Every row inside this scope remembers the lane its owner sat on, so
    // the return edge out of the body comes back to it.
    if (r.step?.children.length) {
      const mark = (steps: LaneStep[]) => steps.forEach((c) => { ownerLane.set(c.id, lane); mark(c.children); });
      mark(r.step.children);
    }

    const outs = (outgoing.get(r.id) ?? []).slice().sort((a, b) => index[a.to] - index[b.to]);
    // The trunk continues on this lane. Prefer the edge to the very next row:
    // an edge that merely lands nearest (`build -> Exit` when `finish` sits
    // between them) would take the trunk and push the real continuation into
    // a branch lane, inverting the picture.
    const nextRow = flat[index[r.id] + 1]?.id;
    // Only an ordinary continuation may stay on this lane. A `loop` edge
    // enters a body and a `fail` edge leaves the happy path: both must take
    // a lane of their own, or the body and the arm are drawn as the trunk
    // and stop reading as a branch at all.
    const trunkish = outs.filter((e) => e.kind === 'ok' || e.kind === 'return' || e.kind === 'pull');
    const primary = trunkish.find((e) => e.to === nextRow) ?? trunkish[0];
    for (const e of outs) {
      // `loop` and `fail` always leave this lane, even when it is free: a
      // body must read as nested and an arm as a branch, never as the trunk
      // carrying on. A `return` is the opposite -- the body rejoining the
      // process -- so it goes back to the lane its scope owner was on.
      const branches = e.kind === 'loop' || e.kind === 'fail';
      const owner = e.kind === 'return' ? ownerLane.get(r.id) : undefined;
      const l = owner ?? (e === primary && !branches ? lane : free(branches ? lane : undefined));
      held[l] = e.to;
      edgeLane.set(`${e.from}>${e.to}`, l);
    }
  }

  const rows: LaneRow<S>[] = flat.map((r) => ({ ...r, lane: rowLane[r.id] }));
  const edges: LaneEdge[] = raw.map((e) => ({ ...e, fromLane: rowLane[e.from], lane: edgeLane.get(`${e.from}>${e.to}`)!, toLane: rowLane[e.to] }));
  const lanes = Math.max(1, ...rows.map((r) => r.lane + 1), ...edges.map((e) => e.lane + 1));

  // A lane that only carries edges needs room for a line, not for a tile.
  // Giving every lane tile width pushed the step labels right by the whole
  // gutter -- 111px on a workflow whose tiles all sit on the trunk.
  const holdsTile = new Array<boolean>(lanes).fill(false);
  for (const r of rows) holdsTile[r.lane] = true;
  const laneXs: number[] = [];
  let x = 0;
  for (let i = 0; i < lanes; i++) {
    const half = holdsTile[i] ? TILE_LANE / 2 : EDGE_LANE / 2;
    x += half;
    laneXs.push(x);
    x += half;
  }
  // The band behind each body: from its first row to its last descendant's,
  // starting at the leftmost lane a body row sits on. A pulled child that
  // moved beside its consumer stretches the band to wherever it went.
  const scopes: LaneScope[] = [];
  for (const r of rows) {
    if (!r.step?.children.length) continue;
    const ids: string[] = [];
    const gather = (steps: LaneStep[]) => steps.forEach((c) => { ids.push(c.id); gather(c.children); });
    gather(r.step.children);
    const idx = ids.map((id) => index[id]).filter((i) => i !== undefined);
    if (!idx.length) continue;
    scopes.push({ owner: r.id, scope: r.step.scope ?? null, first: Math.min(...idx), last: Math.max(...idx), depth: r.depth, lane: Math.min(...idx.map((i) => rows[i].lane)) });
  }

  return { rows, edges, scopes, lanes, index, laneX: laneXs, gutter: x + GUTTER_PAD };
}

/** SVG path for one edge given row centre y positions and a lane x function. */
export function edgePath(e: LaneEdge, y: (id: string) => number, x: (lane: number) => number): string {
  const y0 = y(e.from), y1 = y(e.to);
  const x0 = x(e.fromLane), xl = x(e.lane), x1 = x(e.toLane);
  const r = Math.min(16, Math.max(6, (y1 - y0) / 4));
  let d = `M ${x0} ${y0}`;
  if (xl !== x0) d += ` C ${x0} ${y0 + r}, ${xl} ${y0 + r}, ${xl} ${y0 + 2 * r}`;
  const bottom = xl !== x1 ? y1 - 2 * r : y1;
  d += ` L ${xl} ${bottom}`;
  if (xl !== x1) d += ` C ${xl} ${y1 - r}, ${x1} ${y1 - r}, ${x1} ${y1}`;
  return d;
}
