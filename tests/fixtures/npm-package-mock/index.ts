/**
 * Mock npm package with Flow Weaver node types
 * Used for testing npm package imports
 */

/**
 * @flowWeaver nodeType
 * @label Package Double
 * @input value - Value to double
 * @output result - Doubled value
 */
export function packageDouble(
  execute: boolean,
  value: number
): { onSuccess: boolean; onFailure: boolean; result: number } {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
  return { onSuccess: true, onFailure: false, result: value * 2 };
}

/**
 * @flowWeaver nodeType
 * @label Package Add
 * @input a - First number
 * @input b - Second number
 * @output sum - Sum of inputs
 */
export function packageAdd(
  execute: boolean,
  a: number,
  b: number
): { onSuccess: boolean; onFailure: boolean; sum: number } {
  if (!execute) return { onSuccess: false, onFailure: false, sum: 0 };
  return { onSuccess: true, onFailure: false, sum: a + b };
}

/**
 * @flowWeaver workflow
 * @node doubler packageDouble
 * @connect Start.input -> doubler.value
 * @connect doubler.result -> Exit.output
 * @param input - Input value
 * @returns output - Output value
 */
export function packageWorkflow(
  execute: boolean,
  params: { input: number }
): { onSuccess: boolean; onFailure: boolean; output: number } {
  return { onSuccess: true, onFailure: false, output: 0 };
}
