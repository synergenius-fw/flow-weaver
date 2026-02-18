// Standalone utility functions (no decorators, can be imported directly)
// Updated for STEP Port Architecture v0.2.0

/**
 * Double a number
 */
export function double(execute: boolean, value: number) {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
  console.log(`Doubling: ${value}`);
  return { onSuccess: true, onFailure: false, result: value * 2 };
}

/**
 * Triple a number
 */
export function triple(execute: boolean, value: number) {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
  console.log(`Tripling: ${value}`);
  return { onSuccess: true, onFailure: false, result: value * 3 };
}

/**
 * Add two numbers
 */
export function add(execute: boolean, a: number, b: number) {
  if (!execute) return { onSuccess: false, onFailure: false, sum: 0 };
  console.log(`Adding: ${a} + ${b}`);
  return { onSuccess: true, onFailure: false, sum: a + b };
}
