/**
 * A sequential loop whose body reaches a durable gate but which declares no
 * attempt limit. The durable closure validator must refuse it: without a
 * visible bound, a resumed run could diverge on replay. Contrast with
 * durable-bounded-loop.ts, which adds `maxItems` and is accepted.
 *
 * @flowWeaver nodeType
 * @durablePure
 * @input items - Items to process
 * @output start scope:iteration - Iteration start
 * @output item scope:iteration - Current item
 * @input success scope:iteration - Iteration success
 * @input approved scope:iteration - Approval result
 * @output results - Per-item approvals
 */
async function unboundedOwner(
  execute: boolean,
  items: string[],
  iteration: (start: boolean, item: string) => Promise<{
    success: boolean;
    approved: boolean;
  }>,
): Promise<{ onSuccess: boolean; onFailure: boolean; results: boolean[] }> {
  if (!execute) return { onSuccess: false, onFailure: false, results: [] };
  const results: boolean[] = [];
  for (const item of items) {
    const outcome = await iteration(true, item);
    results.push(outcome.approved);
  }
  return { onSuccess: true, onFailure: false, results };
}

/**
 * @flowWeaver nodeType
 * @durableGate approval
 * @input prompt - Approval prompt
 * @output approved - Approval result
 */
async function unboundedApproval(
  execute: boolean,
  prompt: string,
): Promise<{ onSuccess: boolean; onFailure: boolean; approved: boolean }> {
  throw new Error(`durable gate implementation must not execute: ${execute}:${prompt}`);
}

/**
 * @flowWeaver workflow
 * @param items - Items to process
 * @returns results - Per-item approvals
 * @node owner unboundedOwner
 * @node gate unboundedApproval owner.iteration
 * @connect Start.execute -> owner.execute
 * @connect Start.items -> owner.items
 * @connect owner.start:iteration -> gate.execute
 * @connect owner.item:iteration -> gate.prompt
 * @connect gate.approved -> owner.approved:iteration
 * @connect gate.onSuccess -> owner.success:iteration
 * @connect owner.results -> Exit.results
 */
export async function durableUnboundedLoop(
  execute: boolean,
  params: { items: string[] },
): Promise<{
  onSuccess: boolean;
  onFailure: boolean;
  results: boolean[];
}> {
  throw new Error(`generated body was not installed: ${execute}:${String(params)}`);
}
