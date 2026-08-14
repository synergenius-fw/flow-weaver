/**
 * @flowWeaver nodeType
 * @durableEffect
 * @output value - Effect result
 */
async function predecessorEffect(
  execute: boolean,
  _operationKey: string,
): Promise<{
  result: { onSuccess: boolean; onFailure: boolean; value: number };
  receipt: { id: string };
}> {
  (globalThis as Record<string, unknown>).__a2_nested_predecessor_called__ = true;
  return {
    result: { onSuccess: execute, onFailure: false, value: 4 },
    receipt: { id: 'effect' },
  };
}

/**
 * @flowWeaver nodeType
 * @durableGate approval
 * @input value - Gate value
 * @output value - Gate result
 */
async function nestedApproval(
  execute: boolean,
  value: number,
): Promise<{ onSuccess: boolean; onFailure: boolean; value: number }> {
  throw new Error(`must not execute: ${execute}:${value}`);
}

/**
 * @flowWeaver workflow
 * @node gate nestedApproval
 * @connect Start.value -> gate.value
 * @connect gate.value -> Exit.value
 */
export async function innerGate(
  execute: boolean,
  params: { value: number },
): Promise<{ onSuccess: boolean; onFailure: boolean; value: number }> {
  throw new Error('generated body was not installed');
}

/**
 * @flowWeaver workflow
 * @node before predecessorEffect
 * @node inner innerGate
 * @connect before.onSuccess -> inner.execute
 * @connect before.value -> inner.value
 * @connect inner.value -> Exit.value
 */
export async function outerWithNestedGate(
  execute: boolean,
  params: Record<string, never>,
): Promise<{ onSuccess: boolean; onFailure: boolean; value: number }> {
  throw new Error('generated body was not installed');
}

/**
 * @flowWeaver workflow
 * @node inner invokeWorkflow [expr: functionId="'innerGate'", payload="{ value: 4 }"]
 * @connect Start.execute -> inner.execute
 * @connect inner.result -> Exit.value
 */
export async function outerWithDynamicGate(
  execute: boolean,
  params: Record<string, never>,
): Promise<{ onSuccess: boolean; onFailure: boolean; value: number }> {
  throw new Error(`generated body was not installed: ${execute}:${String(params)}`);
}
