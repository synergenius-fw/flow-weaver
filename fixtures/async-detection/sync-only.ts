/**
 * Sync-only workflow for testing sync code generation
 */

/**
 * @flowWeaver nodeType
 * @label Add
 * @input a - First number
 * @input b - Second number
 * @output result - Sum
 */
function add(execute: boolean, a: number, b: number) {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
  return { onSuccess: true, onFailure: false, result: a + b };
}

/**
 * @flowWeaver nodeType
 * @label Multiply
 * @input a - First number
 * @input b - Second number
 * @output result - Product
 */
function multiply(execute: boolean, a: number, b: number) {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
  return { onSuccess: true, onFailure: false, result: a * b };
}

/**
 * @flowWeaver workflow
 * @node adder add
 * @node multiplier multiply
 * @connect Start.execute -> adder.execute
 * @connect adder.onSuccess -> multiplier.execute
 * @connect multiplier.onSuccess -> Exit.onSuccess
 * @connect Start.x -> adder.a
 * @connect Start.y -> adder.b
 * @connect adder.result -> multiplier.a
 * @connect Start.z -> multiplier.b
 * @connect multiplier.result -> Exit.result
 * @param {NUMBER} x - First number
 * @param {NUMBER} y - Second number
 * @param {NUMBER} z - Third number
 * @returns {NUMBER} result - Final result
 */
export function syncCalculation(
  execute: boolean,
  params: { x: number; y: number; z: number }
): { onSuccess: boolean; onFailure: boolean; result: number } {
  throw new Error('Not implemented');
}

export { add, multiply };
