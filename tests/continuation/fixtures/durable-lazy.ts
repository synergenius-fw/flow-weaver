/**
 * @flowWeaver nodeType
 * @durablePure
 * @pullExecution execute
 * @output value - Lazily produced value
 */
function lazyValue(
  execute: boolean,
): { onSuccess: boolean; onFailure: boolean; value: number } {
  return { onSuccess: execute, onFailure: false, value: 1 };
}

/**
 * @flowWeaver nodeType
 * @durableGate approval
 * @input prompt - Gate prompt
 * @output approved - Approved value
 */
async function approvalGate(
  execute: boolean,
  prompt: string,
): Promise<{ onSuccess: boolean; onFailure: boolean; approved: boolean }> {
  throw new Error(`durable gate implementation must not execute: ${execute}:${prompt}`);
}

/**
 * @flowWeaver workflow
 * @param prompt - Gate prompt
 * @node lazy lazyValue
 * @node gate approvalGate
 * @connect Start.execute -> gate.execute
 * @connect Start.prompt -> gate.prompt
 * @connect gate.approved -> Exit.approved
 */
export async function durableLazy(
  execute: boolean,
  params: { prompt: string },
): Promise<{ onSuccess: boolean; onFailure: boolean; approved: boolean }> {
  throw new Error(`generated body was not installed: ${execute}:${params.prompt}`);
}
