/**
 * @flowWeaver nodeType
 * @input value
 * @output accepted
 * @output reason
 */
function decide(execute: boolean, value: number) {
  if (!execute) {
    return { onSuccess: false, onFailure: false, accepted: 0, reason: "" };
  }
  if (value < 0) {
    return {
      onSuccess: false,
      onFailure: true,
      accepted: 0,
      reason: "negative input",
    };
  }
  return { onSuccess: true, onFailure: false, accepted: value, reason: "" };
}

/**
 * @flowWeaver nodeType
 * @input value
 * @output result
 */
function accept(execute: boolean, value: number) {
  if (!execute) return { onSuccess: false, onFailure: false, result: "" };
  return {
    onSuccess: true,
    onFailure: false,
    result: `accepted:${String(value)}`,
  };
}

/**
 * @flowWeaver nodeType
 * @input reason
 * @output result
 */
function reject(execute: boolean, reason: string) {
  if (!execute) return { onSuccess: false, onFailure: false, result: "" };
  return { onSuccess: true, onFailure: false, result: `rejected:${reason}` };
}

/**
 * @flowWeaver workflow
 * @node decision decide
 * @node accepted accept
 * @node rejected reject
 * @path Start -> decision -> accepted -> Exit
 * @path Start -> decision:fail -> rejected -> Exit
 * @connect Start.value -> decision.value
 * @connect decision.accepted -> accepted.value
 * @connect decision.reason -> rejected.reason
 * @connect accepted.result -> Exit.accepted
 * @connect rejected.result -> Exit.rejected
 */
export async function branching(
  execute: boolean,
  params: { value: number },
): Promise<{
  onSuccess: boolean;
  onFailure: boolean;
  accepted?: string;
  rejected?: string;
}> {
  throw new Error("Flow Weaver must generate this body");
}
