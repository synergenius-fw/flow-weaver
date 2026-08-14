/**
 * @flowWeaver nodeType
 * @durableEffect
 * @expression
 * @input month - Accounting month
 * @output report - Filing report
 * @output stepReport - Visible workflow report
 */
async function assembleAccountingBatch(
  month: string,
  operationKey: string,
): Promise<{
  receipt: { operationKey: string };
  result: {
    onSuccess: boolean;
    onFailure: boolean;
    report: { month: string; ready: number };
    stepReport: string;
  };
}> {
  return {
    receipt: { operationKey },
    result: {
      onSuccess: true,
      onFailure: false,
      report: { month, ready: 1 },
      stepReport: `Ready for ${month}`,
    },
  };
}

/**
 * @flowWeaver nodeType
 * @durableGate approval
 * @input report - Filing report
 * @output approved - Approval result
 */
async function approveAccountingBatch(
  execute: boolean,
  report: { month: string; ready: number },
): Promise<{ onSuccess: boolean; onFailure: boolean; approved: boolean }> {
  throw new Error(`durable gate implementation must not execute: ${execute}:${report.month}`);
}

/**
 * @flowWeaver workflow
 * @param month - Accounting month
 * @returns approved - Approval result
 * @node assemble assembleAccountingBatch
 * @node approve approveAccountingBatch
 * @connect Start.execute -> assemble.execute
 * @connect Start.month -> assemble.month
 * @connect assemble.onSuccess -> approve.execute
 * @connect assemble.report -> approve.report
 * @connect approve.approved -> Exit.approved
 */
export async function validAccountingEffect(
  execute: boolean,
  params: { month: string },
): Promise<{ onSuccess: boolean; onFailure: boolean; approved: boolean }> {
  throw new Error(`generated body was not installed: ${execute}:${params.month}`);
}
