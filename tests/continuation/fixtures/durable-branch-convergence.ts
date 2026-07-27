/**
 * @flowWeaver nodeType
 * @durablePure
 */
function decision(
  execute: boolean,
): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: execute, onFailure: !execute };
}

/**
 * @flowWeaver nodeType
 * @durableGate approval
 * @output approved - Approved value
 */
async function approvalGate(
  execute: boolean,
): Promise<{ onSuccess: boolean; onFailure: boolean; approved: boolean }> {
  throw new Error(`durable gate implementation must not execute: ${execute}`);
}

/**
 * @flowWeaver workflow
 * @node branch decision
 * @node gate approvalGate
 * @connect Start.execute -> branch.execute
 * @connect branch.onSuccess -> gate.execute
 * @connect branch.onFailure -> gate.execute
 * @connect gate.approved -> Exit.approved
 */
export async function durableBranchConvergence(
  execute: boolean,
  params: Record<string, never>,
): Promise<{ onSuccess: boolean; onFailure: boolean; approved: boolean }> {
  throw new Error(`generated body was not installed: ${execute}:${String(params)}`);
}
