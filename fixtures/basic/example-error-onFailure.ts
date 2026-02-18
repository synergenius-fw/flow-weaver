// Example workflow with error-triggered onFailure handling

// ============================================================================
// NODE DEFINITIONS
// ============================================================================

/**
 * Validates input - throws error if invalid
 * Has onSuccess/onFailure ports for branching
 *
 * @flowWeaver nodeType
 * @label Validate
 * @input value
 * @output validated
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
 * Processes valid value - only runs on success
 *
 * @flowWeaver nodeType
 * @label ProcessValid
 * @input value
 * @output result
 */
function processValid(execute: boolean, value: number) {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
  return { onSuccess: true, onFailure: false, result: value * 2 };
}

/**
 * Handles error - only runs on failure
 *
 * @flowWeaver nodeType
 * @label HandleError
 * @output error
 */
function handleError(execute: boolean) {
  if (!execute) return { onSuccess: false, onFailure: false, error: '' };
  return { onSuccess: true, onFailure: false, error: 'Validation failed' };
}

// ============================================================================
// WORKFLOW DEFINITION
// ============================================================================

/**
 * Validates and processes a number with error handling
 * - Valid input (0-100): Returns doubled value
 * - Invalid input: Returns error message gracefully
 *
 * @flowWeaver workflow
 * @name validateWithErrorHandling
 * @node validate validate
 * @node processValid processValid
 * @node handleError handleError
 * @path Start -> validate -> processValid -> Exit
 * @path Start -> validate:fail -> handleError -> Exit
 * @connect Start.input -> validate.value
 * @connect validate.onSuccess -> processValid.execute
 * @connect validate.validated -> processValid.value
 * @connect processValid.result -> Exit.result
 * @connect validate.onFailure -> handleError.execute
 * @connect handleError.error -> Exit.error
 */
export async function validateWithErrorHandling(execute: boolean, params: { input: number }): Promise<{
  onSuccess: boolean;
  onFailure: boolean;
  result?: number;
  error?: string;
}> {
  throw new Error('Not implemented');
}

export { validate, processValid, handleError };
