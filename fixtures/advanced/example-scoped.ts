// Example workflow with container-scoped execution (old-style @scope annotation)
// Demonstrates: container node with @scope that holds addTen and multiplyTwo children

// ============================================================================
// NODE DEFINITIONS
// ============================================================================

/**
 * Container node - provides scoped execution context for children
 *
 * @flowWeaver nodeType
 * @scope scope
 * @input value
 * @output value
 */
function container(execute: boolean, value: number) {
  if (!execute) return { onSuccess: false, onFailure: false, value: 0 };
  return { onSuccess: true, onFailure: false, value };
}

/**
 * Add Ten - adds 10 to input value
 *
 * @flowWeaver nodeType
 * @input value
 * @output result
 */
function addTen(execute: boolean, value: number) {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
  return { onSuccess: true, onFailure: false, result: value + 10 };
}

/**
 * Multiply Two - multiplies input by 2
 *
 * @flowWeaver nodeType
 * @input value
 * @output result
 */
function multiplyTwo(execute: boolean, value: number) {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
  return { onSuccess: true, onFailure: false, result: value * 2 };
}

// ============================================================================
// WORKFLOW DEFINITION
// ============================================================================

/**
 * Scoped workflow: container holds addTen and multiplyTwo in sequence
 *
 * Execution flow:
 * 1. Start passes value 5 to container
 * 2. Container passes value through to scope children
 * 3. addTen(5) -> 15
 * 4. multiplyTwo(15) -> 30
 * 5. Result 30 goes to Exit
 *
 * @flowWeaver workflow
 * @node container container
 * @node addTen addTen container.scope
 * @node multiplyTwo multiplyTwo container.scope
 * @path Start -> container -> Exit
 * @connect Start.value -> container.value
 * @connect container.value -> addTen.value
 * @connect addTen.result -> multiplyTwo.value
 * @connect multiplyTwo.result -> Exit.result
 * @scope container.scope [addTen, multiplyTwo]
 */
export async function scopedWorkflow(
  execute: boolean,
  params: { value: number }
): Promise<{ onSuccess: boolean; onFailure: boolean; result: number }> {
  throw new Error('Not implemented');
}

export { container, addTen, multiplyTwo };
