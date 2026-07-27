/**
 * @flowWeaver nodeType
 * @input value - Potentially effectful input
 * @output value - Potentially effectful output
 */
async function unknownExternalEffect(
  execute: boolean,
  value: number,
): Promise<{ onSuccess: boolean; onFailure: boolean; value: number }> {
  (globalThis as Record<string, unknown>).__a2_unclassified_effect_called__ = true;
  return { onSuccess: execute, onFailure: false, value };
}

/**
 * @flowWeaver nodeType
 * @durableGate approval
 * @input value - Approval input
 * @output value - Approval output
 */
async function approval(
  execute: boolean,
  value: number,
): Promise<{ onSuccess: boolean; onFailure: boolean; value: number }> {
  throw new Error(`durable gate must not execute: ${execute}:${value}`);
}

/**
 * @flowWeaver workflow
 * @node unknown unknownExternalEffect
 * @node gate approval
 * @connect Start.value -> unknown.value
 * @connect unknown.onSuccess -> gate.execute
 * @connect unknown.value -> gate.value
 * @connect gate.value -> Exit.value
 */
export async function unsafeBeforeGate(
  execute: boolean,
  params: { value: number },
): Promise<{ onSuccess: boolean; onFailure: boolean; value: number }> {
  throw new Error('generated body was not installed');
}
