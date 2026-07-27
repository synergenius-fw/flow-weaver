/**
 * @flowWeaver nodeType
 * @durablePure
 * @input value - Value to prepare
 * @output prepared - Prepared value
 */
function prepare(
  execute: boolean,
  value: number,
): { onSuccess: boolean; onFailure: boolean; prepared: number } {
  return {
    onSuccess: execute,
    onFailure: false,
    prepared: value * 2,
  };
}

/**
 * @flowWeaver nodeType
 * @durableGate approval
 * @input value - Value requiring approval
 * @output value - Approved value
 */
async function waitForApproval(
  execute: boolean,
  value: number,
): Promise<{ onSuccess: boolean; onFailure: boolean; value: number }> {
  throw new Error(`durable gate implementation must not execute: ${execute}:${value}`);
}

/**
 * @flowWeaver nodeType
 * @durablePure
 * @input value - Approved value
 * @output result - Final value
 */
function finish(
  execute: boolean,
  value: number,
): { onSuccess: boolean; onFailure: boolean; result: number } {
  return {
    onSuccess: execute,
    onFailure: false,
    result: value + 1,
  };
}

/**
 * @flowWeaver workflow
 * @param value - Input value
 * @returns result - Final value
 * @node prepared prepare
 * @node approval waitForApproval
 * @node finished finish
 * @connect Start.value -> prepared.value
 * @connect prepared.onSuccess -> approval.execute
 * @connect prepared.prepared -> approval.value
 * @connect approval.onSuccess -> finished.execute
 * @connect approval.value -> finished.value
 * @connect finished.result -> Exit.result
 */
export async function durableApproval(
  execute: boolean,
  params: { value: number },
): Promise<{ onSuccess: boolean; onFailure: boolean; result: number }> {
  throw new Error('generated body was not installed');
}
