/**
 * @flowWeaver nodeType
 * @durableGate approval
 * @input prompt - Approval prompt
 * @output approved - Approved value
 */
async function firstGate(
  execute: boolean,
  prompt: string,
): Promise<{ onSuccess: boolean; onFailure: boolean; approved: boolean }> {
  throw new Error(`durable gate implementation must not execute: ${execute}:${prompt}`);
}

/**
 * @flowWeaver nodeType
 * @durableEffect
 * @output value - Effect value
 */
async function lateEffect(
  execute: boolean,
  _operationKey: string,
): Promise<{
  result: { onSuccess: boolean; onFailure: boolean; value: number };
  receipt: { id: string };
}> {
  (globalThis as Record<string, unknown>).__a2_late_parallel_effect_called__ = true;
  return {
    result: { onSuccess: execute, onFailure: false, value: 7 },
    receipt: { id: 'late-effect' },
  };
}

/**
 * @flowWeaver workflow
 * @param prompt - Gate prompt
 * @returns approved - Gate result
 * @returns value - Effect result
 * @node gate firstGate
 * @node effect lateEffect
 * @connect Start.execute -> gate.execute
 * @connect Start.execute -> effect.execute
 * @connect Start.prompt -> gate.prompt
 * @connect gate.approved -> Exit.approved
 * @connect effect.value -> Exit.value
 */
export async function durableParallel(
  execute: boolean,
  params: { prompt: string },
): Promise<{
  onSuccess: boolean;
  onFailure: boolean;
  approved: boolean;
  value: number;
}> {
  throw new Error(`generated body was not installed: ${execute}:${String(params)}`);
}
