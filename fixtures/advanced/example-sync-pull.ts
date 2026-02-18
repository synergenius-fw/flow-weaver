// Sync workflow with pull execution
// Tests that sync functions can use pull execution without async

// ============================================================================
// NODE DEFINITIONS
// ============================================================================

/**
 * Sync transformation node with pull execution (lazy)
 * Only executes when 'doubled' output is needed
 *
 * @flowWeaver nodeType
 * @label Sync Double
 * @pullExecution execute
 * @input value
 * @output doubled
 */
function syncDouble(execute: boolean, value: number) {
  if (!execute) return { onSuccess: false, onFailure: false, doubled: 0 };
  return { onSuccess: true, onFailure: false, doubled: value * 2 };
}

/**
 * Another sync transformation node with pull execution
 *
 * @flowWeaver nodeType
 * @label Sync Add
 * @pullExecution execute
 * @input a
 * @input b
 * @output sum
 */
function syncAdd(execute: boolean, a: number, b: number) {
  if (!execute) return { onSuccess: false, onFailure: false, sum: 0 };
  return { onSuccess: true, onFailure: false, sum: a + b };
}

// ============================================================================
// WORKFLOW DEFINITION
// ============================================================================

/**
 * Sync workflow with pull execution nodes
 * All nodes are sync, workflow is sync
 *
 * @flowWeaver workflow
 * @name syncPullWorkflow
 * @node doubled syncDouble
 * @node added syncAdd
 * @path Start -> doubled -> added -> Exit
 * @connect Start.input -> doubled.value
 * @connect Start.input -> added.a
 * @connect doubled.doubled -> added.b
 * @connect added.sum -> Exit.result
 */
function syncPullWorkflow(execute: boolean, params: { input: number }): { result: number } {
  // Sync workflow - no async keyword
  throw new Error('Not implemented');
}

export { syncDouble, syncAdd, syncPullWorkflow };
