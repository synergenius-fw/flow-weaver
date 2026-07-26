/**
 * @flowWeaver nodeType
 * @input value
 * @output result
 */
function increment(execute: boolean, value: number) {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
  return { onSuccess: true, onFailure: false, result: value + 1 };
}

/**
 * @flowWeaver workflow
 * @node step increment
 * @connect Start.value -> step.value
 * @connect step.result -> Exit.result
 */
export function nestedIncrement(
  execute: boolean,
  params: { value: number },
): { onSuccess: boolean; onFailure: boolean; result: number } {
  throw new Error("Flow Weaver must generate this body");
}

/**
 * @flowWeaver workflow
 * @node first nestedIncrement
 * @node second nestedIncrement
 * @connect Start.value -> first.value
 * @connect first.result -> second.value
 * @connect second.result -> Exit.result
 */
export function nested(
  execute: boolean,
  params: { value: number },
): { onSuccess: boolean; onFailure: boolean; result: number } {
  throw new Error("Flow Weaver must generate this body");
}
