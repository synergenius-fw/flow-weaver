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
 * Iterates over items and processes each one.
 * Normal mode on purpose: a scope owner drives its child through scoped STEP ports.
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
 * Processes a single item. A throw here aborts the whole batch with that
 * error; to record a per-item failure instead, return it as part of the result.
 *
 * @flowWeaver nodeType
 * @expression
 * @label Process Item
 * @input item - Item to process
 * @output result - Processed result
 */
function processItem(item: any): { result: any } {
  // TODO: Add your processing logic here
  return { result: { ...item, processed: true } };
}

/**
 * Aggregates results from iteration
 *
 * @flowWeaver nodeType
 * @expression
 * @label Aggregate Results
 * @input results - Array of processed results
 * @output successCount - Number of successes
 * @output failedCount - Number of failures
 */
function aggregateResults(results: any[]): { successCount: number; failedCount: number } {
  const successCount = results.filter(r => r?.processed).length;
  return { successCount, failedCount: results.length - successCount };
}

/**
 * @flowWeaver workflow
 * @node iterator forEachItem [color: "purple"] [icon: "repeat"] [suppress: "DESIGN_SCOPE_NO_FAILURE_EXIT"]
 * @node processor processItem iterator.processItem [color: "blue"] [icon: "settings"]
 * @node aggregator aggregateResults [color: "teal"] [icon: "inventory"]
 * @path Start -> iterator -> aggregator -> Exit
 * @connect iterator.start:processItem -> processor.execute
 * @connect iterator.item:processItem -> processor.item
 * @connect processor.result -> iterator.result:processItem
 * @connect processor.onSuccess -> iterator.success:processItem
 * @connect processor.onFailure -> iterator.failure:processItem
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
  throw new Error("Compile with: fw compile <file>");
}
`.trim();
  },
};
