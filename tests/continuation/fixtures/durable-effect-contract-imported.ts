import type {
  EffectReceipt,
  EffectResult,
  FilingReport,
} from './durable-effect-contract-types.js';

/**
 * @flowWeaver nodeType
 * @durableEffect
 * @expression
 * @input month - Accounting month
 * @output report - Filing report
 * @output stepReport - Visible workflow report
 */
async function assembleImportedAccountingBatch(
  month: string,
  operationKey: string,
): Promise<{ receipt: EffectReceipt; result: EffectResult }> {
  const report: FilingReport = { month, ready: 1 };
  return {
    receipt: { schemaVersion: 1, operationKey },
    result: {
      onSuccess: true,
      onFailure: false,
      report,
      stepReport: `Ready for ${month}`,
    },
  };
}

/**
 * @flowWeaver workflow
 * @param month - Accounting month
 * @returns report - Filing report
 * @node assemble assembleImportedAccountingBatch
 * @connect Start.execute -> assemble.execute
 * @connect Start.month -> assemble.month
 * @connect assemble.report -> Exit.report
 */
export async function importedAccountingEffect(
  execute: boolean,
  params: { month: string },
): Promise<{ onSuccess: boolean; onFailure: boolean; report: FilingReport }> {
  throw new Error(`generated body was not installed: ${execute}:${params.month}`);
}

