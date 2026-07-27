/**
 * @flowWeaver nodeType
 * @durableGate approval
 * @durableEffect
 * @input value - Approval input
 * @output value - Approval output
 */
async function conflictingApproval(
  execute: boolean,
  value: number,
): Promise<{ onSuccess: boolean; onFailure: boolean; value: number }> {
  throw new Error(`must not execute: ${execute}:${value}`);
}

/**
 * @flowWeaver workflow
 * @node gate conflictingApproval
 * @connect Start.value -> gate.value
 * @connect gate.value -> Exit.value
 */
export async function localConflict(
  execute: boolean,
  params: { value: number },
): Promise<{ onSuccess: boolean; onFailure: boolean; value: number }> {
  throw new Error('generated body was not installed');
}
