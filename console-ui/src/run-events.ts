/**
 * Folding a run's trace into what the console shows, one event at a time.
 *
 * A step inside a scope body runs once per item, and the engine numbers each
 * pass with its `executionIndex`. Each pass is kept whole -- its status, its
 * times, what it read and produced, its error -- and the step's summary is
 * the latest pass plus the count and the passes' time added up. Keyed by
 * step alone, the second invoice's values vanished under the third's and a
 * body step's duration spanned every pass of every other step in between.
 */

export interface Pass { index: number; status: string; start?: number; end?: number; values: Record<string, unknown>; error?: string }
export interface StepSummary { status: string; start?: number; end?: number; count: number; total: number }

/** What a trace folds into. `RunState` in the client extends this. */
export interface RunTrace {
  states: Record<string, StepSummary>;
  passes: Record<string, Pass[]>;
  /** The latest value of every `step.port`, whatever the pass. */
  values: Record<string, unknown>;
  /** The latest error of every step, whatever the pass. */
  errors: Record<string, string>;
  /**
   * Every value by `step.port` and execution index, including a scope
   * owner's scoped outputs, which are set once per body pass under the
   * body's index while the owner has one pass of its own.
   */
  indexed: Record<string, Record<number, unknown>>;
  result?: unknown;
}

export const emptyTrace = (): RunTrace => ({ states: {}, passes: {}, values: {}, errors: {}, indexed: {} });

/** A value a step produced on one pass, or the latest when no pass is named or it had none then. */
export function valueAt(r: RunTrace, id: string, port: string, index?: number): unknown {
  if (index !== undefined) {
    const p = r.passes[id]?.find((x) => x.index === index);
    if (p && port in p.values) return p.values[port];
    const by = r.indexed[`${id}.${port}`];
    if (by && index in by) return by[index];
  }
  return r.values[`${id}.${port}`];
}

/**
 * The pass of a step an event belongs to. Only a status change opens a
 * pass: a scope owner's scoped outputs are set once per body pass, with
 * the body's index, while the owner itself runs once -- those values go to
 * the owner's latest pass rather than inventing passes it never had.
 */
function passFor(r: RunTrace, id: string, index: number | undefined, open: boolean): Pass {
  const list = (r.passes[id] ??= []);
  const last = list.length ? list[list.length - 1] : undefined;
  const i = index ?? last?.index ?? 0;
  let p = list.find((x) => x.index === i);
  if (!p && !open && last) return last;
  if (!p) { p = { index: i, status: '', values: {} }; list.push(p); list.sort((a, b) => a.index - b.index); }
  return p;
}

function summarize(r: RunTrace, id: string, latest: Pass): void {
  const list = r.passes[id] ?? [latest];
  // `!= null`, not truthiness: a trace stamped from zero has a start of 0.
  const total = list.reduce((sum, p) => sum + (p.start != null && p.end != null ? p.end - p.start : 0), 0);
  r.states[id] = { status: latest.status, start: latest.start, end: latest.end, count: list.length, total };
}

const ENDED = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED']);

/** Apply one trace event, stamped `t`, to the trace. */
export function applyEvent(r: RunTrace, t: number, e: any): void {
  if (e.type === 'STATUS_CHANGED') {
    const p = passFor(r, e.id, e.executionIndex, true);
    p.status = e.status;
    // A gate is RUNNING twice: before it yields and when the resume re-enters it.
    if (e.status === 'RUNNING') p.start ??= t;
    if (ENDED.has(e.status)) p.end = t;
    summarize(r, e.id, p);
  } else if (e.type === 'VARIABLE_SET') {
    const id = e.identifier?.id, port = e.identifier?.portName;
    if (id && port) {
      r.values[`${id}.${port}`] = e.value;
      passFor(r, id, e.identifier.executionIndex, false).values[port] = e.value;
      if (typeof e.identifier.executionIndex === 'number') (r.indexed[`${id}.${port}`] ??= {})[e.identifier.executionIndex] = e.value;
    }
  } else if (e.type === 'LOG_ERROR') {
    r.errors[e.id] = e.error;
    passFor(r, e.id, e.executionIndex, false).error = e.error;
  } else if (e.type === 'WORKFLOW_COMPLETED' && e.result !== undefined) {
    r.result = e.result;
  }
}

/** The pass to open a step on: the one that failed, else the last. */
export function defaultPass(passes: Pass[]): number | undefined {
  if (!passes.length) return undefined;
  return (passes.find((p) => p.status === 'FAILED' || p.error) ?? passes[passes.length - 1]).index;
}
