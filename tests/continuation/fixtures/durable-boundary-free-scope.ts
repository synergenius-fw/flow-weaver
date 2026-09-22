/**
 * A workflow that HAS a durable gate, and also has a scoped loop — but the gate
 * sits on the main flow, not inside the scope. The scope body never reaches a
 * durable boundary, so it never yields and never needs a resume-safe iteration
 * bound. The validator must accept it even though it has no attempt limit: a
 * boundary-free scope was never the unsafe case the old blanket refusal caught.
 *
 * @flowWeaver nodeType
 * @durablePure
 * @input items - Items to double
 * @output start scope:pass - Iteration start
 * @output item scope:pass - Current item
 * @input success scope:pass - Iteration success
 * @input doubled scope:pass - Doubled value
 * @output total - Sum of doubled values
 */
async function summingOwner(
  execute: boolean,
  items: number[],
  pass: (start: boolean, item: number) => Promise<{
    success: boolean;
    doubled: number;
  }>,
): Promise<{ onSuccess: boolean; onFailure: boolean; total: number }> {
  if (!execute) return { onSuccess: false, onFailure: false, total: 0 };
  let total = 0;
  for (const item of items) {
    const outcome = await pass(true, item);
    total += outcome.doubled;
  }
  return { onSuccess: true, onFailure: false, total };
}

/**
 * A pure per-item transform. No gate, no effect: the scope body is boundary-free.
 *
 * @flowWeaver nodeType
 * @durablePure
 * @input value - Value to double
 * @output doubled - Doubled value
 */
async function doubler(
  execute: boolean,
  value: number,
): Promise<{ onSuccess: boolean; onFailure: boolean; doubled: number }> {
  if (!execute) return { onSuccess: false, onFailure: false, doubled: 0 };
  return { onSuccess: true, onFailure: false, doubled: value * 2 };
}

/**
 * The durable gate lives on the main flow, after the loop completes.
 *
 * @flowWeaver nodeType
 * @durableGate approval
 * @input prompt - Approval prompt
 * @output approved - Approval result
 */
async function finalApproval(
  execute: boolean,
  prompt: string,
): Promise<{ onSuccess: boolean; onFailure: boolean; approved: boolean }> {
  throw new Error(`durable gate implementation must not execute: ${execute}:${prompt}`);
}

/**
 * @flowWeaver workflow
 * @param items - Values to double and sum
 * @returns approved - Whether the total was approved
 * @node owner summingOwner
 * @node pass doubler owner.pass
 * @node gate finalApproval
 * @connect Start.execute -> owner.execute
 * @connect Start.items -> owner.items
 * @connect owner.start:pass -> pass.execute
 * @connect owner.item:pass -> pass.value
 * @connect pass.doubled -> owner.doubled:pass
 * @connect pass.onSuccess -> owner.success:pass
 * @connect owner.onSuccess -> gate.execute
 * @connect owner.total -> gate.prompt
 * @connect gate.approved -> Exit.approved
 */
export async function boundaryFreeScope(
  execute: boolean,
  params: { items: number[] },
): Promise<{
  onSuccess: boolean;
  onFailure: boolean;
  approved: boolean;
}> {
  throw new Error(`generated body was not installed: ${execute}:${String(params)}`);
}
