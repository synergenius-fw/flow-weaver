// Example workflow with PER-PORT scoped execution (NEW architecture)
// Demonstrates: forEach node with scoped OUTPUT port defining iteration function

// ============================================================================
// NODE DEFINITIONS
// ============================================================================

/**
 * ForEach node - receives a scope function for processing each item
 * Scoped OUTPUT port: processItem defines the function signature
 *
 * @flowWeaver nodeType
 * @label For Each
 * @input items - Array to iterate over
 * @output start scope:processItem - MANDATORY: Start control for scope
 * @output item scope:processItem - Current item passed to scope
 * @input success scope:processItem - MANDATORY: Success control from scope
 * @input failure scope:processItem - MANDATORY: Failure control from scope
 * @input processed scope:processItem - Processed value returned from scope
 * @output results - Processed results
 */
function forEach(
  execute: boolean,
  items: any[],
  processItem: (start: boolean, item: any) => {
    success: boolean;
    failure: boolean;
    processed: any;
  }
) {
  if (!execute) return { onSuccess: false, onFailure: false, results: [] };

  // processItem is a scope function that executes child nodes for each item
  const results = items.map((item) => {
    const result = processItem(true, item);
    return result.processed;
  });

  return { onSuccess: true, onFailure: false, results };
}

/**
 * Processor node - executes within forEach iteration scope
 * Processes one item at a time
 *
 * @flowWeaver nodeType
 * @label Process Item
 * @input item - Single item to process
 * @output processed - Processed item
 */
function processItem(execute: boolean, item: any) {
  if (!execute) return { onSuccess: false, onFailure: false, processed: null };

  // Double the value
  return { onSuccess: true, onFailure: false, processed: item * 2 };
}

// ============================================================================
// WORKFLOW DEFINITION
// ============================================================================

/**
 * Workflow with scoped port execution
 * forEach receives a scope function for the 'iteration' scope
 *
 * Execution flow:
 * 1. Start passes items [1, 2, 3] to forEach
 * 2. forEach calls processItem scope function for each item:
 *    - Iteration 1: processItem(1) -> 2
 *    - Iteration 2: processItem(2) -> 4
 *    - Iteration 3: processItem(3) -> 6
 * 3. forEach collects results [2, 4, 6] and returns to Exit
 *
 * @flowWeaver workflow
 * @name scopedPortsWorkflow
 * @node forEach1 forEach
 * @node processor1 processItem forEach1.processItem
 * @connect Start.execute -> forEach1.execute
 * @connect Start.items -> forEach1.items
 * @connect forEach1.start:processItem -> processor1.execute
 * @connect forEach1.item:processItem -> processor1.item
 * @connect processor1.processed -> forEach1.processed:processItem
 * @connect processor1.onSuccess -> forEach1.success:processItem
 * @connect processor1.onFailure -> forEach1.failure:processItem
 * @connect forEach1.results -> Exit.results
 * @connect forEach1.onSuccess -> Exit.onSuccess
 * @connect forEach1.onFailure -> Exit.onFailure
 */
export function scopedPortsWorkflow(
  execute: boolean,
  params: { items: number[] }
): { onSuccess: boolean; onFailure: boolean; results: number[] } {
  throw new Error('Not implemented - will be generated');
}

export { forEach, processItem };
