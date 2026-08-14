/**
 * @flowWeaver nodeType
 * @durableEffect
 * @output value - Effect value
 */
async function committedEffect(
  execute: boolean,
  _operationKey: string,
): Promise<{
  result: { onSuccess: boolean; onFailure: boolean; value: number };
  receipt: { id: string };
}> {
  (globalThis as Record<string, unknown>).__a2_effect_gate_called__ = true;
  return {
    result: { onSuccess: execute, onFailure: false, value: 4 },
    receipt: { id: 'effect' },
  };
}

/**
 * @flowWeaver nodeType
 * @durableGate approval
 * @input value - Gate value
 * @output value - Approved value
 */
async function approvalGate(
  execute: boolean,
  value: number,
): Promise<{ onSuccess: boolean; onFailure: boolean; value: number }> {
  throw new Error(`durable gate implementation must not execute: ${execute}:${value}`);
}

/**
 * @flowWeaver workflow
 * @node effect committedEffect
 * @node gate approvalGate
 * @connect effect.onSuccess -> gate.execute
 * @connect effect.value -> gate.value
 * @connect gate.value -> Exit.value
 */
export async function durableEffectGate(
  execute: boolean,
  params: Record<string, never>,
): Promise<{ onSuccess: boolean; onFailure: boolean; value: number }> {
  throw new Error(`generated body was not installed: ${execute}:${String(params)}`);
}
