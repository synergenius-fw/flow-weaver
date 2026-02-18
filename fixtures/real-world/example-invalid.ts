// Example with intentional errors for validation testing (Phase 13)

// ============================================================================
// NODE DEFINITIONS
// ============================================================================

/**
 * @flowWeaver nodeType
 * @input value
 * @output doubled
 */
function double(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, doubled: value * 2  };
}

/**
 * @flowWeaver nodeType
 * @input value
 * @output tripled
 */
function triple(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, tripled: value * 3  };
}

// Unused node (will trigger warning)
/**
 * @flowWeaver nodeType
 * @input value
 * @output result
 */
function unused(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, result: value * 10  };
}

// ============================================================================
// WORKFLOW WITH ERRORS
// ============================================================================

/**
 * Workflow with intentional validation errors
 *
 * @flowWeaver workflow
 * @name invalidWorkflow
 * @node double double
 * @node triple triple
 * @connect Start.input -> double.value
 * @connect double.doubled -> nonexistent.value
 * @connect triple.wrongPort -> Exit.result
 */
export async function invalidWorkflow(execute: boolean, params: { input: number }): Promise<{ onSuccess: boolean; onFailure: boolean; result: number }> {
  throw new Error('Not implemented');
}
