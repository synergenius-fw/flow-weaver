// Example workflow with pull execution (transformation nodes)
// Demonstrates: Lazy evaluation - nodes execute only when output is needed

// ============================================================================
// NODE DEFINITIONS
// ============================================================================

/**
 * Regular node - executes in flow order
 *
 * @flowWeaver nodeType
 * @label Double
 * @input value
 * @output doubled
 */
function double(execute: boolean, value: number) {
  if (!execute) return { onSuccess: false, onFailure: false, doubled: 0 };
  console.log('Executing double node');
  return { onSuccess: true, onFailure: false, doubled: value * 2 };
}

/**
 * Transformation node - pull execution (lazy)
 * Only executes when 'tripled' output is needed
 *
 * @flowWeaver nodeType
 * @label Triple
 * @pullExecution execute
 * @input value
 * @output tripled
 */
function triple(execute: boolean, value: number) {
  if (!execute) return { onSuccess: false, onFailure: false, tripled: 0 };
  console.log('Executing triple node (lazy)');
  return { onSuccess: true, onFailure: false, tripled: value * 3 };
}

/**
 * Another transformation node - pull execution
 * Only executes when 'result' is needed
 *
 * @flowWeaver nodeType
 * @label Add
 * @pullExecution execute
 * @input a
 * @input b
 * @output sum
 */
function add(execute: boolean, a: number, b: number) {
  if (!execute) return { onSuccess: false, onFailure: false, sum: 0 };
  console.log('Executing add node (lazy)');
  return { onSuccess: true, onFailure: false, sum: a + b };
}

// ============================================================================
// WORKFLOW DEFINITION
// ============================================================================

/**
 * Workflow with pull execution
 * - double executes immediately (push)
 * - triple and add only execute when needed (pull/lazy)
 *
 * @flowWeaver workflow
 * @name pullExecutionWorkflow
 * @node double double
 * @node triple triple
 * @node add add
 * @connect Start.input -> double.value
 * @connect Start.input -> triple.value
 * @connect double.doubled -> add.a
 * @connect triple.tripled -> add.b
 * @connect add.sum -> Exit.result
 */
export async function pullExecutionWorkflow(execute: boolean, params: { input: number }): Promise<{ onSuccess: boolean; onFailure: boolean; result: number }> {
  throw new Error('Not implemented');
}

export { double, triple, add };
