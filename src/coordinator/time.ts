/**
 * The clock, as the coordinator keeps it.
 *
 * The engine never runs a timer: a gate yields and the process is free to
 * go. Two things a run may wait for are a matter of time all the same: a
 * `sleep` node wakes when its duration has passed, and a gate given a
 * `timeout` stops waiting and takes its failure path. The coordinator
 * records when that is (`RunRecord.due`) and `tick()` acts on it; `fw serve`
 * and the console tick every few seconds, `fw_runs` before it lists.
 */
import type { DurableGateKind } from '../runtime/continuation.js';

export interface RunDue {
  /** When the clock acts, ISO 8601. */
  at: string;
  /** `wake`: a sleeping run goes on. `timeout`: the gate takes its failure path. */
  action: 'wake' | 'timeout';
}

const UNITS: Record<string, number> = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };

/**
 * `<number><unit>` with unit `ms`, `s`, `m`, `h` or `d`, as `delay` reads it;
 * `undefined` for anything else, including an empty string.
 */
export function parseDuration(text: unknown): number | undefined {
  if (typeof text !== 'string') return undefined;
  const match = /^\s*(\d+)\s*(ms|s|m|h|d)\s*$/.exec(text);
  if (!match) return undefined;
  return Number(match[1]) * UNITS[match[2]];
}

/**
 * When the clock will move a run that just paused at `gate`, if ever.
 *
 * A `timer` gate wakes after its `duration`. An unreadable duration wakes at
 * once rather than never. Any other gate with a readable `timeout` input and
 * a failure port times out along that port. A timeout on a gate with no
 * failure port is not a deadline: there is nowhere for the run to go.
 */
export function dueFor(
  gate: { kind: DurableGateKind; inputs: Record<string, unknown>; hasFailurePort: boolean },
  now: number = Date.now(),
): RunDue | undefined {
  if (gate.kind === 'timer') {
    const ms = parseDuration(gate.inputs.duration) ?? 0;
    return { at: new Date(now + ms).toISOString(), action: 'wake' };
  }
  const ms = parseDuration(gate.inputs.timeout);
  if (ms === undefined || !gate.hasFailurePort) return undefined;
  return { at: new Date(now + ms).toISOString(), action: 'timeout' };
}
