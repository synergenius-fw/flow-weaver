/**
 * @flowWeaver nodeType
 * @durableGate approval
 * @input value - First value
 * @output value - First resolved value
 */
async function firstApproval(
  execute: boolean,
  value: number,
): Promise<{ onSuccess: boolean; onFailure: boolean; value: number }> {
  throw new Error(`first durable gate implementation must not execute: ${execute}:${value}`);
}

/**
 * @flowWeaver nodeType
 * @durableGate input
 * @input value - Second value
 * @output value - Second resolved value
 */
async function secondInput(
  execute: boolean,
  value: number,
): Promise<{ onSuccess: boolean; onFailure: boolean; value: number }> {
  throw new Error(`second durable gate implementation must not execute: ${execute}:${value}`);
}

/**
 * @flowWeaver workflow
 * @param value - Initial value
 * @returns value - Final value
 * @node first firstApproval
 * @node second secondInput
 * @connect Start.value -> first.value
 * @connect first.value -> second.value
 * @connect second.value -> Exit.value
 */
export async function durableTwoGates(
  execute: boolean,
  params: { value: number },
): Promise<{ onSuccess: boolean; onFailure: boolean; value: number }> {
  throw new Error(`generated body was not installed: ${execute}:${params.value}`);
}
