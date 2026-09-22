/**
 * A bounded, sequential durable loop: each iteration pauses at an approval
 * gate. The loop carries a visible attempt limit (`maxItems`), so the durable
 * closure validator accepts it, and the iteration ordinal is reconstructed from
 * committed continuation state on resume — a run that dies mid-loop resumes at
 * the same iteration rather than restarting at 0.
 *
 * This is the ReAct / tool-use agent shape reduced to its durable essentials.
 *
 * @flowWeaver nodeType
 * @durablePure
 * @input items - Items to process
 * @input [maxItems] - Maximum iterations (visible attempt limit)
 * @output start scope:iteration - Iteration start
 * @output item scope:iteration - Current item
 * @input success scope:iteration - Iteration success
 * @input approved scope:iteration - Approval result for the item
 * @output results - Per-item approvals, in order
 */
async function boundedOwner(
  execute: boolean,
  items: string[],
  maxItems: number = 10,
  iteration: (start: boolean, item: string) => Promise<{
    success: boolean;
    approved: boolean;
  }>,
): Promise<{ onSuccess: boolean; onFailure: boolean; results: boolean[] }> {
  if (!execute) return { onSuccess: false, onFailure: false, results: [] };
  const results: boolean[] = [];
  const bound = Math.min(items.length, maxItems);
  // Sequential: each iteration may pause at the gate, and the next iteration
  // only begins once the previous one has resolved.
  for (let i = 0; i < bound; i++) {
    const outcome = await iteration(true, items[i]!);
    results.push(outcome.approved);
  }
  return { onSuccess: true, onFailure: false, results };
}

/**
 * @flowWeaver nodeType
 * @durableGate approval
 * @input prompt - Approval prompt for the current item
 * @output approved - Approval result
 */
async function itemApproval(
  execute: boolean,
  prompt: string,
): Promise<{ onSuccess: boolean; onFailure: boolean; approved: boolean }> {
  throw new Error(`durable gate implementation must not execute: ${execute}:${prompt}`);
}

/**
 * @flowWeaver workflow
 * @param items - Items to process
 * @param [maxItems] - Maximum iterations
 * @returns results - Per-item approvals
 * @node owner boundedOwner
 * @node gate itemApproval owner.iteration
 * @connect Start.execute -> owner.execute
 * @connect Start.items -> owner.items
 * @connect Start.maxItems -> owner.maxItems
 * @connect owner.start:iteration -> gate.execute
 * @connect owner.item:iteration -> gate.prompt
 * @connect gate.approved -> owner.approved:iteration
 * @connect gate.onSuccess -> owner.success:iteration
 * @connect owner.results -> Exit.results
 */
export async function durableBoundedLoop(
  execute: boolean,
  params: { items: string[]; maxItems?: number },
): Promise<{
  onSuccess: boolean;
  onFailure: boolean;
  results: boolean[];
}> {
  throw new Error(`generated body was not installed: ${execute}:${String(params)}`);
}
