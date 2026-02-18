/**
 * Utility node types for cross-file import testing
 * NOTE: This file intentionally does NOT use .ts convention
 */

/**
 * @flowWeaver nodeType
 * @input value - Value to double
 * @output result - Doubled value
 */
export function doubleValue(
  execute: boolean,
  value: number
): { onSuccess: boolean; onFailure: boolean; result: number } {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
  return { onSuccess: true, onFailure: false, result: value * 2 };
}

/**
 * @flowWeaver nodeType
 * @input text - Text to uppercase
 * @output result - Uppercased text
 */
export function toUpperCase(
  execute: boolean,
  text: string
): { onSuccess: boolean; onFailure: boolean; result: string } {
  if (!execute) return { onSuccess: false, onFailure: false, result: "" };
  return { onSuccess: true, onFailure: false, result: text.toUpperCase() };
}
