/**
 * @flowWeaver workflow
 * @node wait delay [expr: duration="'10s'"]
 * @path Start -> wait -> Exit
 */
export async function cancellationPortable(
  execute: boolean,
): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  throw new Error("Flow Weaver must generate this body");
}
