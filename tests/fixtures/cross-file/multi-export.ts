/**
 * Multiple node types in a single file for testing multi-import
 */

/**
 * @flowWeaver nodeType
 * @input a - First number
 * @input b - Second number
 * @output sum - Sum result
 */
export function add(
  execute: boolean,
  a: number,
  b: number
): { onSuccess: boolean; onFailure: boolean; sum: number } {
  if (!execute) return { onSuccess: false, onFailure: false, sum: 0 };
  return { onSuccess: true, onFailure: false, sum: a + b };
}

/**
 * @flowWeaver nodeType
 * @input a - First number
 * @input b - Second number
 * @output product - Product result
 */
export function multiply(
  execute: boolean,
  a: number,
  b: number
): { onSuccess: boolean; onFailure: boolean; product: number } {
  if (!execute) return { onSuccess: false, onFailure: false, product: 0 };
  return { onSuccess: true, onFailure: false, product: a * b };
}

/**
 * @flowWeaver nodeType
 * @input value - Value to negate
 * @output result - Negated value
 */
export function negate(
  execute: boolean,
  value: number
): { onSuccess: boolean; onFailure: boolean; result: number } {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
  return { onSuccess: true, onFailure: false, result: -value };
}
