// Utility nodes that can be imported by other workflows (Phase 11)

// ============================================================================
// REUSABLE UTILITY NODES
// ============================================================================

/**
 * Double a number
 *
 * @flowWeaver nodeType
 * @label Double
 * @input value
 * @output result
 */
export function double(execute: boolean, value: number) {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
  console.log(`Doubling: ${value}`);
  return { onSuccess: true, onFailure: false, result: value * 2 };
}

/**
 * Triple a number
 *
 * @flowWeaver nodeType
 * @label Triple
 * @input value
 * @output result
 */
export function triple(execute: boolean, value: number) {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
  console.log(`Tripling: ${value}`);
  return { onSuccess: true, onFailure: false, result: value * 3 };
}

/**
 * Add two numbers
 *
 * @flowWeaver nodeType
 * @label Add
 * @input a
 * @input b
 * @output sum
 */
export function add(execute: boolean, a: number, b: number) {
  if (!execute) return { onSuccess: false, onFailure: false, sum: 0 };
  console.log(`Adding: ${a} + ${b}`);
  return { onSuccess: true, onFailure: false, sum: a + b };
}
