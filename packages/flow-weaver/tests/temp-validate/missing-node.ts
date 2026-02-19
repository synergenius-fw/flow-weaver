/**
 * @flowWeaver workflow
 * @name missingNodeWorkflow
 * @connect Start.execute -> nonexistent.execute
 * @connect proc.onSuccess -> Exit.onSuccess
 */
export function missingNodeWorkflow() {}

/**
 * @flowWeaver nodeType
 */
function proc(execute: boolean): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}
