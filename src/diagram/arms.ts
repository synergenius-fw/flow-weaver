/**
 * Keeping a branch arm next to the gate it leaves.
 *
 * Rows reach `buildLanes` in flattened source order, and only a loop body is
 * pulled inline after its owner. A failure arm stays wherever it was
 * declared, so `router:fail -> fallback` lands four rows below `router` with
 * the happy path in between and the fail line drawn straight through steps
 * that have nothing to do with it. On the weaver-bot topology that is two
 * fail lines and a return line in flight at once, none of them grouped.
 *
 * This reorders the rows so an arm's own chain follows its gate, and reports
 * the span each arm occupies so the renderer can band it the way it bands a
 * scope body.
 *
 * A pure pass over the flat row list, run before lanes are assigned, so the
 * lane and merge logic underneath is untouched.
 */

/** What the ordering needs to know about a step. The process model has all of it. */
export interface ArmStep {
  id: string;
  /** Which of its owner's scopes this step sits in, when the owner has several. */
  inScope?: string | null;
  children: ArmStep[];
  successTo: string[];
  failureTo: string[];
  reads: Array<{ from: string }>;
  produces: Array<{ to: string[] }>;
  entered: Array<{ from: string; arm: 'ok' | 'fail' }>;
  pull?: boolean;
}

/** A row before lanes are assigned. */
export interface FlatRow<S extends ArmStep = ArmStep> {
  id: string;
  step: S | null;
  depth: number;
  owner: string | null;
}

/**
 * The rows one gate's failure arm owns, for the band behind them.
 *
 * Only the failure arm is recorded: the success arm is the trunk carrying on,
 * which needs no band of its own.
 */
export interface ArmSpan {
  /** The gate the arm leaves. */
  gate: string;
  /** Row ids, in order. A failure that fans out contributes each strand. */
  ids: string[];
}

/**
 * A step reached through its data rather than through control flow.
 *
 * The same rule `buildLanes` applies, kept here so this pass agrees with the
 * pull pass about which rows it must not touch.
 */
function demandDriven(step: ArmStep): boolean {
  if (step.pull) return true;
  const wired = step.entered.length > 0 || step.successTo.length > 0 || step.failureTo.length > 0;
  return !wired && (step.reads.length > 0 || step.produces.length > 0);
}

/**
 * The rows reachable from `head` that belong to this arm alone.
 *
 * An arm ends where it rejoins the process: the first step something outside
 * the arm also reaches. `merge` in the weaver-bot topology is entered by
 * `process` inside the arm and by `gate:fail` outside it, so it is the join
 * and stays on the trunk -- claiming it would drag the rest of the workflow
 * into the arm behind it.
 */
function armChain<S extends ArmStep>(
  head: string,
  gate: string,
  ctx: {
    byId: Map<string, FlatRow<S>>;
    enteredBy: Map<string, Set<string>>;
    claimed: Set<string>;
    pulled: Set<string>;
  },
  gateOwner: string | null,
  gateScope: string | null,
): string[] {
  const { byId, enteredBy, claimed, pulled } = ctx;
  const gateStep = byId.get(gate)?.step;
  const chain: string[] = [];
  const seen = new Set<string>([gate]);
  let cur: string | undefined = head;

  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const row = byId.get(cur);
    if (!row?.step) break;
    // Already part of another arm, or placed by the pull pass: leave it.
    if (claimed.has(cur) || pulled.has(cur)) break;
    // A gate inside a loop body branches within that body, so its arm is
    // ordered like any other -- but only among its own siblings. An arm that
    // left the scope would be lifted out of the band it belongs to and drawn
    // as if it ran once, not once per item.
    if (row.owner !== gateOwner || (row.step.inScope ?? null) !== gateScope) break;
    // A join: reached from outside this arm. The gate itself counts as
    // outside when it arrives down its *other* arm.
    const otherArm = cur !== head
      && !!gateStep
      && [...gateStep.successTo, ...gateStep.failureTo].includes(cur);
    const from = enteredBy.get(cur) ?? new Set<string>();
    if (otherArm || [...from].some((f) => f !== gate && !chain.includes(f))) break;

    chain.push(cur);
    // A step that forks again ends the simple chain; its own arms are ordered
    // on their own turn, once this one is placed.
    const next = [...row.step.successTo, ...row.step.failureTo];
    cur = next.length === 1 ? next[0] : undefined;
  }
  return chain;
}

/**
 * Reorder `flat` so each gate's failure arm sits directly beneath it.
 *
 * Gates are taken in row order, so an outer gate is served before the gates
 * nested inside its arm and the two never fight over a row.
 */
export function orderArms<S extends ArmStep>(
  flat: Array<FlatRow<S>>,
  exitFrom: Array<{ from: string; arm: 'ok' | 'fail' }> = [],
): { flat: Array<FlatRow<S>>; arms: ArmSpan[] } {
  const byId = new Map(flat.map((r) => [r.id, r]));
  const enteredBy = new Map<string, Set<string>>();
  const enter = (to: string, from: string) =>
    (enteredBy.get(to) ?? enteredBy.set(to, new Set()).get(to)!).add(from);
  for (const r of flat) {
    if (!r.step) continue;
    for (const t of [...r.step.successTo, ...r.step.failureTo]) enter(t, r.id);
  }
  // A step wired straight to Exit leaves through the workflow's own exit
  // ports, not through a `successTo`. Without this the arm holding it looks
  // like it owns whatever follows, and the join is swallowed by one arm.
  for (const e of exitFrom) enter('Exit', e.from);

  // A pulled step runs when something reads it, so it belongs beside its
  // consumer rather than in control-flow order. `buildLanes` places it in a
  // pass of its own; moving it here would only fight that pass, so an arm
  // neither claims one nor counts one as the outside world.
  const pulled = new Set(flat.filter((r) => r.step && demandDriven(r.step)).map((r) => r.id));

  const claimed = new Set<string>();
  const arms: ArmSpan[] = [];
  const ctx = { byId, enteredBy, claimed, pulled };

  for (const gateRow of flat) {
    const s = gateRow.step;
    if (!s?.failureTo.length) continue;
    // Only a real fork is worth moving: a step whose failure goes somewhere
    // its success does not.
    if (!s.failureTo.some((t) => !s.successTo.includes(t))) continue;

    // Only the failure arm is collected. The success arm is the trunk
    // carrying on: it needs no band, and claiming its rows only risked
    // swallowing the join beyond them.
    const gateScope = s.inScope ?? null;
    const chains: string[][] = [];
    for (const head of s.failureTo) {
      if (s.successTo.includes(head)) continue;
      const chain = armChain(head, s.id, ctx, gateRow.owner, gateScope);
      if (!chain.length) continue;
      for (const id of chain) claimed.add(id);
      chains.push(chain);
    }
    // A failure that fans out is one detour with several strands, not several
    // detours: they go under the gate together, under a single band, rather
    // than as a stack of one-row bands each repeating the gate's name.
    if (chains.length) arms.push({ gate: s.id, ids: chains.flat() });
  }

  // A step several gates fail into belongs to none of them, so no arm claims
  // it and it keeps the place it was declared in -- which, once the arms have
  // moved, can be above gates that fail into it, drawing their fail edges
  // backwards up the page. It sinks to just past its last consumer instead.
  const shared = flat.filter((r) => {
    if (!r.step || claimed.has(r.id) || pulled.has(r.id)) return false;
    const from = [...(enteredBy.get(r.id) ?? [])];
    return from.length > 1 && from.every((f) => byId.get(f)?.step?.failureTo.includes(r.id));
  });

  // An arm sits directly under its gate, so the detour is read and dismissed
  // before the eye follows the trunk on. An arm that branches again goes after
  // the gate's success step instead: it is a piece of process in its own
  // right, not a digression, and directly under the gate it buries the happy
  // path beneath its whole error subtree.
  //
  // What matters is whether the arm forks, not how many rows it spans. Length
  // alone inverted the picture between two workflows a single step apart, and
  // putting every failure arm last simply undid the reordering -- `router`'s
  // success arm is two steps, so its failure arm landed back where it started.
  const forks = (a: ArmSpan) => arms.some((b) => b !== a && a.ids.includes(b.gate));

  let out = [...flat];
  for (const span of arms) {
    const rows = span.ids.map((id) => out.find((r) => r.id === id)).filter((r): r is FlatRow<S> => !!r);
    if (!rows.length) continue;
    out = out.filter((r) => !span.ids.includes(r.id));
    const at = out.findIndex((r) => r.id === span.gate);
    if (at < 0) continue;
    let insert = at + 1;
    if (forks(span)) {
      // Step over the gate's own success continuation, so the trunk keeps the
      // row immediately under the gate.
      const gate = byId.get(span.gate)?.step;
      while (insert < out.length && gate?.successTo.includes(out[insert].id)) insert++;
    }
    out.splice(insert, 0, ...rows);
  }

  for (const r of shared) {
    const at = out.findIndex((x) => x.id === r.id);
    const consumers = [...(enteredBy.get(r.id) ?? [])];
    const last = Math.max(...consumers.map((c) => out.findIndex((x) => x.id === c)));
    if (at < 0 || last < 0 || last < at) continue;
    const [row] = out.splice(at, 1);
    // `last` shifted left by the removal, so this lands just after it.
    out.splice(last, 0, row);
  }

  return { flat: out, arms };
}
