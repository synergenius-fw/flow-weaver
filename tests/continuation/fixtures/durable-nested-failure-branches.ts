/**
 * @flowWeaver nodeType
 * @durablePure
 * @input value - Value to forward
 * @output value - Forwarded value
 */
function reject(
  execute: boolean,
  value: number,
): { onSuccess: boolean; onFailure: boolean; value: number } {
  return { onSuccess: false, onFailure: execute, value };
}

/**
 * @flowWeaver nodeType
 * @durableGate approval
 * @input value - Value requiring approval
 * @output value - Approved value
 */
async function approveFailure(
  execute: boolean,
  value: number,
): Promise<{ onSuccess: boolean; onFailure: boolean; value: number }> {
  throw new Error(`durable gate implementation must not execute: ${execute}:${value}`);
}

/**
 * @flowWeaver workflow
 * @param value - Inner value
 * @returns value - Approved value
 * @node decision reject
 * @node gate approveFailure
 * @connect Start.value -> decision.value
 * @connect decision.onFailure -> gate.execute
 * @connect decision.value -> gate.value
 * @connect gate.value -> Exit.value
 */
async function innerFailureDecision(
  execute: boolean,
  params: { value: number },
): Promise<{ onSuccess: boolean; onFailure: boolean; value: number }> {
  throw new Error(`generated body was not installed: ${execute}:${params.value}`);
}

/**
 * @flowWeaver workflow
 * @param value - Outer value
 * @returns value - Approved value
 * @node decision reject
 * @node inner innerFailureDecision
 * @connect Start.value -> decision.value
 * @connect decision.onFailure -> inner.execute
 * @connect decision.value -> inner.value
 * @connect inner.value -> Exit.value
 */
export async function nestedFailureBranchGate(
  execute: boolean,
  params: { value: number },
): Promise<{ onSuccess: boolean; onFailure: boolean; value: number }> {
  throw new Error(`generated body was not installed: ${execute}:${params.value}`);
}
