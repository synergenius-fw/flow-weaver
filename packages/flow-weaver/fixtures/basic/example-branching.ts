/**
 * Example: Branching workflow with onSuccess/onFailure
 *
 * Flow:
 *   Start -> validate -> (success) processValid -> Exit.result
 *                     -> (failure) buildError -> Exit.error
 */

/**
 * Validates input data
 *
 * @flowWeaver nodeType
 * @label Validate Input
 * @input data - Data to validate
 * @output validated - Validated data
 * @output errors - Validation errors
 * @output isValid - Whether data is valid
 */
function validate(execute: boolean, data: any) {
  if (!execute) return { onSuccess: false, onFailure: false, validated: {}, errors: [], isValid: false };

  if (!data || !data.name || data.name.length < 3) {
    return {
      onSuccess: false,
      onFailure: true,
      validated: {},
      errors: ['Name must be at least 3 characters'],
      isValid: false
    };
  }
  return {
    onSuccess: true,
    onFailure: false,
    validated: data,
    errors: [],
    isValid: true
  };
}

/**
 * Process valid data
 *
 * @flowWeaver nodeType
 * @label Process Valid Data
 * @input data - Valid data to process
 * @output result - Processed data
 */
function processValid(execute: boolean, data: any) {
  if (!execute) return { onSuccess: false, onFailure: false, result: {} };

  return {
    onSuccess: true,
    onFailure: false,
    result: {
      ...data,
      processed: true,
      timestamp: Date.now()
    }
  };
}

/**
 * Build error response
 *
 * @flowWeaver nodeType
 * @label Build Error Response
 * @input errors - Error messages
 * @output error - Formatted error message
 */
function buildError(execute: boolean, errors: string[]) {
  if (!execute) return { onSuccess: false, onFailure: false, error: '' };

  return {
    onSuccess: true,
    onFailure: false,
    error: errors.join(', ')
  };
}

/**
 * Validates input and processes if valid, returns error otherwise
 *
 * @flowWeaver workflow
 * @name ValidateAndProcess
 * @description Validates input and processes if valid, returns error otherwise
 * @node validate validate
 * @node processValid processValid
 * @node buildError buildError
 * @connect Start.execute -> validate.execute
 * @connect Start.input -> validate.data
 * @connect validate.onSuccess -> processValid.execute
 * @connect validate.validated -> processValid.data
 * @connect validate.onFailure -> buildError.execute
 * @connect validate.errors -> buildError.errors
 * @connect processValid.result -> Exit.result
 * @connect processValid.onSuccess -> Exit.onSuccess
 * @connect buildError.error -> Exit.error
 * @connect buildError.onSuccess -> Exit.onFailure
 */
export async function validateAndProcess(execute: boolean, params: { input: any }): Promise<{ onSuccess: boolean; onFailure: boolean; result?: any; error?: string }> {
  throw new Error('Not implemented');
}
