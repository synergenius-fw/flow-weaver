/**
 * @flowWeaver nodeType
 * @input value
 * @output result
 */
async function double(execute: boolean, value: number) {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
  return { onSuccess: true, onFailure: false, result: value * 2 };
}

/**
 * @flowWeaver nodeType
 * @input value
 * @output result
 */
async function triple(execute: boolean, value: number) {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
  return { onSuccess: true, onFailure: false, result: value * 3 };
}

/**
 * @flowWeaver nodeType
 * @input left
 * @input right
 * @output sum
 */
function combine(execute: boolean, left: number, right: number) {
  if (!execute) return { onSuccess: false, onFailure: false, sum: 0 };
  return { onSuccess: true, onFailure: false, sum: left + right };
}

/**
 * @flowWeaver workflow
 * @node left double
 * @node right triple
 * @node joined combine
 * @connect Start.value -> left.value
 * @connect Start.value -> right.value
 * @connect left.result -> joined.left
 * @connect right.result -> joined.right
 * @connect joined.sum -> Exit.sum
 */
export async function parallel(
  execute: boolean,
  params: { value: number },
): Promise<{ onSuccess: boolean; onFailure: boolean; sum: number }> {
  throw new Error("Flow Weaver must generate this body");
}
