/**
 * Simple example for Phase 10: Expression-based port values
 * Demonstrates evaluateConstantAs: JS_EXPRESSION
 */

// ============================================================================
// NODE WITH EXPRESSION-BASED DEFAULT VALUE
// ============================================================================

/**
 * Node that uses an expression to compute a default multiplier
 * The expression reads a config value from the Start node
 *
 * @flowWeaver nodeType
 * @label Multiply with Expression
 * @input value
 * @input multiplier - Expression: (ctx) => ctx.getVariable({ id: "Start", portName: "defaultMultiplier", executionIndex: 0 })
 * @output result
 */
function multiplyWithExpression(execute: boolean, value: number, multiplier: number) {
  return { onSuccess: true, onFailure: false, result: value * multiplier  };
}

/**
 * Node with static default (for comparison)
 *
 * @flowWeaver nodeType
 * @label Multiply with Static
 * @input value
 * @input [multiplier=2] - Static default
 * @output result
 */
function multiplyWithStatic(execute: boolean, value: number, multiplier: number) {
  return { onSuccess: true, onFailure: false, result: value * multiplier  };
}

// ============================================================================
// WORKFLOW
// ============================================================================

/**
 * Test workflow:
 * - multiplyWithExpression gets multiplier from defaultMultiplier param (via expression)
 * - multiplyWithStatic uses hardcoded multiplier = 2
 *
 * @flowWeaver workflow
 * @name expressionWorkflow
 * @node multiplyExp1 multiplyWithExpression
 * @node multiplyStatic1 multiplyWithStatic
 * @path Start -> multiplyExp1 -> multiplyStatic1 -> Exit
 * @connect Start.input -> multiplyExp1.value
 * @connect multiplyExp1.result -> multiplyStatic1.value
 * @connect multiplyStatic1.result -> Exit.result
 */
export async function expressionWorkflow(execute: boolean, params: {
    input: number;
    defaultMultiplier: number; // Used by expression
  }): Promise<{
    onSuccess: boolean;
    onFailure: boolean;
    result: number;
  }> {
  throw new Error('Not implemented - will be generated');
}
