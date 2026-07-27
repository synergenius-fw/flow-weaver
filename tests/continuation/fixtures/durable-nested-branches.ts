/**
 * @flowWeaver nodeType
 * @durablePure
 * @input value - Value to forward
 * @output value - Forwarded value
 */
function choose(
  execute: boolean,
  value: number,
): { onSuccess: boolean; onFailure: boolean; value: number } {
  return { onSuccess: execute, onFailure: false, value };
}

/**
 * @flowWeaver nodeType
 * @durableGate approval
 * @input value - Value requiring approval
 * @output value - Approved value
 */
async function approve(
  execute: boolean,
  value: number,
): Promise<{ onSuccess: boolean; onFailure: boolean; value: number }> {
  throw new Error(`durable gate implementation must not execute: ${execute}:${value}`);
}

/**
 * @flowWeaver workflow
 * @param value - Inner value
 * @returns value - Approved value
 * @node decision choose
 * @node gate approve
 * @connect Start.value -> decision.value
 * @connect decision.onSuccess -> gate.execute
 * @connect decision.value -> gate.value
 * @connect gate.value -> Exit.value
 */
async function innerDecision(
  execute: boolean,
  params: { value: number },
): Promise<{ onSuccess: boolean; onFailure: boolean; value: number }> {
  throw new Error(`generated body was not installed: ${execute}:${params.value}`);
}

/**
 * @flowWeaver workflow
 * @param value - Outer value
 * @returns value - Approved value
 * @node decision choose
 * @node inner innerDecision
 * @connect Start.value -> decision.value
 * @connect decision.onSuccess -> inner.execute
 * @connect decision.value -> inner.value
 * @connect inner.value -> Exit.value
 */
export async function nestedBranchGate(
  execute: boolean,
  params: { value: number },
): Promise<{ onSuccess: boolean; onFailure: boolean; value: number }> {
  throw new Error(`generated body was not installed: ${execute}:${params.value}`);
}
