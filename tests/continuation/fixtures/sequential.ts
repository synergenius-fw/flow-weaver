/**
 * @flowWeaver nodeType
 * @input value
 * @output result
 */
function addOne(execute: boolean, value: number) {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
  return { onSuccess: true, onFailure: false, result: value + 1 };
}

/**
 * @flowWeaver nodeType
 * @input value
 * @output result
 */
function double(execute: boolean, value: number) {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
  return { onSuccess: true, onFailure: false, result: value * 2 };
}

/**
 * @flowWeaver workflow
 * @node increment addOne
 * @node multiply double
 * @path Start -> increment -> multiply -> Exit
 * @connect Start.value -> increment.value
 * @connect increment.result -> multiply.value
 * @connect multiply.result -> Exit.result
 */
export async function sequential(
  execute: boolean,
  params: { value: number },
): Promise<{ onSuccess: boolean; onFailure: boolean; result: number }> {
  throw new Error("Flow Weaver must generate this body");
}
