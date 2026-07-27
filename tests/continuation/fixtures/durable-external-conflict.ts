/**
 * @flowWeaver workflow
 * @node effect externalEffect
 * @node gate externalGate
 * @connect Start.value -> effect.value
 * @connect effect.onSuccess -> gate.execute
 * @connect effect.value -> gate.value
 * @connect gate.value -> Exit.value
 */
export async function externalConflict(
  execute: boolean,
  params: { value: number },
): Promise<{ onSuccess: boolean; onFailure: boolean; value: number }> {
  throw new Error('generated body was not installed');
}
