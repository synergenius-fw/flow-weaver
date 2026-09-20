/* eslint-disable @typescript-eslint/no-require-imports */
// Example workflow with ForEach scoped execution

// ============================================================================
// NODE DEFINITIONS
// ============================================================================

/**
 * ForEach container node - iterates over items
 *
 * @flowWeaver nodeType
 * @label ForEach
 * @input items [order:1] - Items
 * @input execute [order:0] - Execute
 * @input success scope:iteration [order:0] - Success from iteration
 * @input failure scope:iteration [order:1] - Failure from iteration
 * @input result scope:iteration [order:2] - Result from iteration
 * @output start scope:iteration [order:0] - Start control for iteration
 * @output item scope:iteration [order:1] - Current item
 * @output results [order:2] - Results
 * @output onSuccess [order:0] - On Success
 * @output onFailure [order:1] - On Failure
 */
async function forEach(
  execute: boolean,
  items: any[],
  iteration: (start: boolean, item: any) => Promise<{
    success: boolean;
    failure: boolean;
    result: any;
  }>
) {
  if (!execute) return { results: [], onSuccess: false, onFailure: false };
  const results: any[] = [];
  for (const item of items) {
    const r = await iteration(true, item);
    results.push(r.result);
  }
  return { results, onSuccess: true, onFailure: false };
}

/**
 * Process Item - executes within forEach scope
 *
 * @flowWeaver nodeType
 * @label Process Item
 * @input item [order:1] - Item
 * @input execute [order:0] - Execute
 * @output processed [order:2] - Processed
 * @output onSuccess [order:0] - On Success
 * @output onFailure [order:1] - On Failure
 */
function processItem(execute: boolean, item: any) {
  if (!execute) return { onSuccess: false, onFailure: false, processed: null };
  return { onSuccess: true, onFailure: false, processed: item };
}

/**
 * Double Value - executes within forEach scope
 *
 * @flowWeaver nodeType
 * @label Double
 * @input value [order:1] - Value
 * @input execute [order:0] - Execute
 * @output doubled [order:2] - Doubled
 * @output onSuccess [order:0] - On Success
 * @output onFailure [order:1] - On Failure
 */
function double(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, doubled: value * 2 };
}

// ============================================================================
// WORKFLOW DEFINITION
// ============================================================================

/**
 * @flowWeaver workflow
 * @node forEach forEach
 * @node processItem processItem forEach.iteration
 * @node double double forEach.iteration
 * @path Start -> forEach -> Exit
 * @path Start -> forEach:fail -> Exit
 * @connect forEach.start:iteration -> processItem.execute
 * @connect forEach.item:iteration -> processItem.item
 * @connect processItem.onSuccess -> double.execute
 * @connect processItem.processed -> double.value
 * @connect double.doubled -> forEach.result:iteration
 * @connect double.onSuccess -> forEach.success:iteration
 * @connect double.onFailure -> forEach.failure:iteration
 * @connect forEach.results -> Exit.results
 * @param execute [order:0] - Execute
 * @param items [order:1] - Items
 * @returns onSuccess [order:0] - On Success
 * @returns onFailure [order:1] - On Failure
 * @returns results [order:2] - Results
 */
export async function processArray(
  execute: boolean,
  params: { items: any[] }
): Promise<{ onSuccess: boolean; onFailure: boolean; results: any[] }> {
  throw new Error('Not implemented');
}

export { forEach, processItem, double };
