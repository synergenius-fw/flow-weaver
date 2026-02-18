/**
 * Workflow exports for workflow-as-nodetype testing
 * These workflows should be usable as node types in other workflows
 */

/**
 * @flowWeaver nodeType
 * @input value - Value to validate
 * @output valid - Validated value
 * @output invalid - Error info
 */
function validateNumber(
  execute: boolean,
  value: any
): { onSuccess: boolean; onFailure: boolean; valid: number | null; invalid: string | null } {
  if (!execute) return { onSuccess: false, onFailure: false, valid: null, invalid: null };
  if (typeof value === 'number' && !isNaN(value)) {
    return { onSuccess: true, onFailure: false, valid: value, invalid: null };
  }
  return { onSuccess: false, onFailure: true, valid: null, invalid: "Not a valid number" };
}

/**
 * @flowWeaver workflow
 * @node validator validateNumber
 * @connect Start.data -> validator.value
 * @connect validator.valid -> Exit.result
 * @connect validator.onSuccess -> Exit.onSuccess
 * @connect validator.onFailure -> Exit.onFailure
 * @param data - Data to validate and transform
 * @returns result - Validated result
 */
export function validateAndTransform(
  execute: boolean,
  params: { data: any }
): { onSuccess: boolean; onFailure: boolean; result: number | null } {
  return { onSuccess: true, onFailure: false, result: null };
}

/**
 * @flowWeaver nodeType
 * @input value - Value to format
 * @output formatted - Formatted string
 */
function formatNumber(
  execute: boolean,
  value: number
): { onSuccess: boolean; onFailure: boolean; formatted: string } {
  if (!execute) return { onSuccess: false, onFailure: false, formatted: "" };
  return { onSuccess: true, onFailure: false, formatted: value.toFixed(2) };
}

/**
 * @flowWeaver workflow
 * @node fmt formatNumber
 * @connect Start.value -> fmt.value
 * @connect fmt.formatted -> Exit.output
 * @connect fmt.onSuccess -> Exit.onSuccess
 * @connect fmt.onFailure -> Exit.onFailure
 * @param value - Number to format
 * @returns output - Formatted string
 */
export function formatValue(
  execute: boolean,
  params: { value: number }
): { onSuccess: boolean; onFailure: boolean; output: string } {
  return { onSuccess: true, onFailure: false, output: "" };
}
