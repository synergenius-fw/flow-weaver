// Example workflow with error handling - JSDoc Syntax

// ============================================================================
// NODE DEFINITIONS
// ============================================================================

/**
 * Validates input - throws error if invalid
 *
 * @flowWeaver nodeType
 * @label Validate
 * @input value - Value to validate
 * @output validated - Validated value
 */
function validate(execute: boolean, value: number) {
  if (!execute) return { onSuccess: false, onFailure: false, validated: 0 };
  if (value < 0) {
    throw new Error('Value must be non-negative');
  }
  if (value > 100) {
    throw new Error('Value must not exceed 100');
  }
  return { onSuccess: true, onFailure: false, validated: value };
}

/**
 * Doubles the value
 *
 * @flowWeaver nodeType
 * @label Double
 * @input value - Value to double
 * @output result - Doubled value
 */
function double(execute: boolean, value: number) {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
  return { onSuccess: true, onFailure: false, result: value * 2 };
}

// ============================================================================
// WORKFLOW DEFINITION
// ============================================================================

/**
 * Validates and doubles a number
 * Will fail if input is < 0 or > 100
 *
 * @flowWeaver workflow
 * @name validateAndDouble
 * @node validate validate
 * @node double double
 * @path Start -> validate -> double -> Exit
 * @connect Start.input -> validate.value
 * @connect validate.validated -> double.value
 * @connect double.result -> Exit.result
 */
export async function validateAndDouble(execute: boolean, params: { input: number }): Promise<{ onSuccess: boolean; onFailure: boolean; result: number }> {
  throw new Error('Not implemented');
}

export { validate, double };
