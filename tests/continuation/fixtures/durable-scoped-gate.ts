/**
 * @flowWeaver nodeType
 * @durablePure
 * @input items - Items to process
 * @output start scope:iteration - Iteration start
 * @output item scope:iteration - Current item
 * @input success scope:iteration - Iteration success
 * @input approved scope:iteration - Approval result
 * @output results - Approval results
 */
async function concurrentOwner(
  execute: boolean,
  items: string[],
  iteration: (start: boolean, item: string) => Promise<{
    success: boolean;
    approved: boolean;
  }>,
): Promise<{ onSuccess: boolean; onFailure: boolean; results: boolean[] }> {
  if (!execute) return { onSuccess: false, onFailure: false, results: [] };
  const results = await Promise.all(items.map((item) => iteration(true, item)));
  return {
    onSuccess: true,
    onFailure: false,
    results: results.map((result) => result.approved),
  };
}

/**
 * @flowWeaver nodeType
 * @durableGate approval
 * @input prompt - Approval prompt
 * @output approved - Approval result
 */
async function scopedApproval(
  execute: boolean,
  prompt: string,
): Promise<{ onSuccess: boolean; onFailure: boolean; approved: boolean }> {
  throw new Error(`durable gate implementation must not execute: ${execute}:${prompt}`);
}

/**
 * @flowWeaver workflow
 * @param items - Items to process
 * @returns results - Approval results
 * @node owner concurrentOwner
 * @node gate scopedApproval owner.iteration
 * @connect Start.execute -> owner.execute
 * @connect Start.items -> owner.items
 * @connect owner.start:iteration -> gate.execute
 * @connect owner.item:iteration -> gate.prompt
 * @connect gate.approved -> owner.approved:iteration
 * @connect gate.onSuccess -> owner.success:iteration
 * @connect owner.results -> Exit.results
 */
export async function durableScopedGate(
  execute: boolean,
  params: { items: string[] },
): Promise<{
  onSuccess: boolean;
  onFailure: boolean;
  results: boolean[];
}> {
  throw new Error(`generated body was not installed: ${execute}:${String(params)}`);
}
