/**
 * @flowWeaver nodeType
 * @durablePure
 * @input value - Input value
 * @output resolved - Resolved value
 */
function resolveValue(
  execute: boolean,
  value: number,
): { onSuccess: boolean; onFailure: boolean; resolved: number } {
  return {
    onSuccess: execute,
    onFailure: false,
    resolved: value,
  };
}

/**
 * @flowWeaver nodeType
 * @durablePure
 * @input resolved - Resolved value
 * @output report - Report retained across review
 */
function assembleReport(
  execute: boolean,
  resolved: number,
): { onSuccess: boolean; onFailure: boolean; report: string } {
  return {
    onSuccess: execute,
    onFailure: false,
    report: `report:${resolved}`,
  };
}

/**
 * @flowWeaver nodeType
 * @durablePure
 * @input report - Report to summarize for review
 * @output prompt - Review prompt
 */
function buildReview(
  execute: boolean,
  report: string,
): { onSuccess: boolean; onFailure: boolean; prompt: string } {
  return {
    onSuccess: execute,
    onFailure: false,
    prompt: `Review ${report}`,
  };
}

/**
 * @flowWeaver nodeType
 * @durableGate approval
 * @input prompt - Prompt requiring approval
 * @output approved - Whether the report was approved
 */
async function reviewReport(
  execute: boolean,
  prompt: string,
): Promise<{ onSuccess: boolean; onFailure: boolean; approved: boolean }> {
  throw new Error(`durable gate implementation must not execute: ${execute}:${prompt}`);
}

/**
 * @flowWeaver workflow
 * @param value - Input value
 * @returns report - Report retained after review
 * @returns approved - Whether the report was approved
 * @node resolve resolveValue
 * @node assemble assembleReport
 * @node build buildReview
 * @node review reviewReport
 * @connect Start.value -> resolve.value
 * @connect resolve.onSuccess -> assemble.execute
 * @connect resolve.resolved -> assemble.resolved
 * @connect assemble.onSuccess -> build.execute
 * @connect assemble.report -> build.report
 * @connect build.onSuccess -> review.execute
 * @connect build.prompt -> review.prompt
 * @connect assemble.report -> Exit.report
 * @connect review.approved -> Exit.approved
 */
export async function durableOutputAfterGate(
  execute: boolean,
  params: { value: number },
): Promise<{
  onSuccess: boolean;
  onFailure: boolean;
  report: string;
  approved: boolean;
}> {
  throw new Error(`generated body was not installed: ${execute}:${params.value}`);
}
