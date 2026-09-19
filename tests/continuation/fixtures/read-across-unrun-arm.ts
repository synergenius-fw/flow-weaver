/**
 * A convergence node reached from two arms, reading a port from a node that
 * only ran on one of them.
 *
 * `finish` is driven both by `check:fail` -- which is taken before the gate
 * exists -- and by the gate's success arm. On the failure arm `gate` never
 * ran, so it has no execution index, and `finish` still has to read
 * `gate.decision`. The generated reader must treat that as an absent value
 * rather than addressing the node at an undefined index.
 */

/**
 * @flowWeaver nodeType
 * @durablePure
 * @input raw - Raw input
 * @output value - Checked value (on success)
 * @output why - Why it was refused (on failure)
 */
export function check(
  execute: boolean,
  raw: string,
): { onSuccess: boolean; onFailure: boolean; value: string; why: string } {
  if (!execute) return { onSuccess: false, onFailure: false, value: '', why: '' };
  if (raw === 'bad') return { onSuccess: false, onFailure: true, value: '', why: 'refused' };
  return { onSuccess: true, onFailure: false, value: raw, why: '' };
}

/**
 * @flowWeaver nodeType
 * @durableGate approval
 * @input value - Value to approve
 * @output decision - What was decided
 */
export async function gate(
  execute: boolean,
  value: string,
): Promise<{ onSuccess: boolean; onFailure: boolean; decision: string }> {
  throw new Error(`durable gate implementation must not execute: ${execute}:${value}`);
}

/**
 * @flowWeaver nodeType
 * @expression
 * @durablePure
 * @input why - Why it was refused, if it was
 * @input decision - What was decided, if it got that far
 * @output outcome - The account
 */
export function finish(why: string, decision: string | null): { outcome: string } {
  return { outcome: why.length > 0 ? `refused: ${why}` : `decided: ${decision ?? 'none'}` };
}

/**
 * @flowWeaver workflow
 * @param raw - Raw input
 * @returns outcome - The account
 * @node c check
 * @node g gate
 * @node f finish
 * @path Start -> c -> g -> f -> Exit
 * @path c:fail -> f
 * @connect c.why -> f.why
 * @connect g.decision -> f.decision
 */
export async function readAcrossUnrunArm(
  execute: boolean,
  params: { raw: string },
): Promise<{ onSuccess: boolean; onFailure: boolean; outcome: string }> {
  throw new Error('generated body was not installed');
}
