/**
 * ForEach Batch Processing Template
 * Iterate over array items with scoped ports
 */

import type { WorkflowTemplate, WorkflowTemplateOptions } from '../index';

export const foreachTemplate: WorkflowTemplate = {
  id: 'foreach',
  name: 'ForEach Batch',
  description: 'Batch processing with iteration over arrays',
  category: 'data-processing',
  generate: (opts: WorkflowTemplateOptions): string => {
    const { workflowName, async: isAsync } = opts;
    const asyncKeyword = isAsync ? 'async ' : '';
    const returnType = isAsync
      ? 'Promise<{ onSuccess: boolean; onFailure: boolean; results: any[]; successCount: number; failedCount: number }>'
      : '{ onSuccess: boolean; onFailure: boolean; results: any[]; successCount: number; failedCount: number }';

    return `
/**
 * Iterates over items and processes each one
 *
 * @flowWeaver nodeType
 * @label For Each Item
 * @input items [order:1] - Array of items to iterate
 * @input success scope:processItem [order:0] - From child onSuccess
 * @input failure scope:processItem [order:1] - From child onFailure
 * @input result scope:processItem [order:2] - Result from child
 * @input execute [order:0] - Execute
 * @output start scope:processItem [order:0] - Triggers child execute
 * @output item scope:processItem [order:1] - Current item to process
 * @output results [order:2] - Collected results after iteration
 * @output onSuccess [order:0] - On Success
 * @output onFailure [order:1] - On Failure
 */
function forEachItem(
  execute: boolean,
  items: any[],
  processItem: (start: boolean, item: any) => { success: boolean; failure: boolean; result: any }
): { onSuccess: boolean; onFailure: boolean; results: any[] } {
  if (!execute) {
    return { onSuccess: false, onFailure: false, results: [] };
  }

  const results: any[] = [];
  for (const item of items) {
    const r = processItem(true, item);
    results.push(r.result);
  }

  return { onSuccess: true, onFailure: false, results };
}

/**
 * Processes a single item
 *
 * @flowWeaver nodeType
 * @label Process Item
 * @input item [order:1] - Item to process
 * @input execute [order:0] - Execute
 * @output result [order:2] - Processed result
 * @output onSuccess [order:0] - On Success
 * @output onFailure [order:1] - On Failure
 */
function processItem(
  execute: boolean,
  item: any
): { onSuccess: boolean; onFailure: boolean; result: any } {
  if (!execute) {
    return { onSuccess: false, onFailure: false, result: null };
  }

  // TODO: Add your processing logic here
  const result = { ...item, processed: true };

  return { onSuccess: true, onFailure: false, result };
}

/**
 * Aggregates results from iteration
 *
 * @flowWeaver nodeType
 * @label Aggregate Results
 * @input results [order:1] - Array of processed results
 * @input execute [order:0] - Execute
 * @output successCount [order:2] - Number of successes
 * @output failedCount [order:3] - Number of failures
 * @output onSuccess [order:0] - On Success
 * @output onFailure [order:1] - On Failure
 */
function aggregateResults(
  execute: boolean,
  results: any[]
): { onSuccess: boolean; onFailure: boolean; successCount: number; failedCount: number } {
  if (!execute) {
    return { onSuccess: false, onFailure: false, successCount: 0, failedCount: 0 };
  }

  const successCount = results.filter(r => r?.processed).length;
  const failedCount = results.length - successCount;

  return { onSuccess: true, onFailure: false, successCount, failedCount };
}

/**
 * @flowWeaver workflow
 * @node iterator forEachItem [size: 300 200]
 * @node processor processItem iterator.processItem
 * @node aggregator aggregateResults
 * @position Start -450 0
 * @position iterator -90 0
 * @position processor 90 0
 * @position aggregator 270 0
 * @position Exit 450 0
 * @connect Start.execute -> iterator.execute
 * @connect Start.items -> iterator.items
 * @connect iterator.start:processItem -> processor.execute
 * @connect iterator.item:processItem -> processor.item
 * @connect processor.result -> iterator.result:processItem
 * @connect processor.onSuccess -> iterator.success:processItem
 * @connect processor.onFailure -> iterator.failure:processItem
 * @connect iterator.results -> Exit.results
 * @connect iterator.results -> aggregator.results
 * @connect iterator.onSuccess -> aggregator.execute
 * @connect aggregator.successCount -> Exit.successCount
 * @connect aggregator.failedCount -> Exit.failedCount
 * @connect aggregator.onSuccess -> Exit.onSuccess
 * @connect aggregator.onFailure -> Exit.onFailure
 * @param execute [order:0] - Execute
 * @param items [order:1] - Array of items to process
 * @returns onSuccess [order:0] - On Success
 * @returns onFailure [order:1] - On Failure
 * @returns results [order:2] - Processed results
 * @returns successCount [order:3] - Number of successful items
 * @returns failedCount [order:4] - Number of failed items
 */
export ${asyncKeyword}function ${workflowName}(
  execute: boolean,
  params: { items: any[] }
): ${returnType} {
  throw new Error("Compile with: flow-weaver compile <file>");
}
`.trim();
  },
};
