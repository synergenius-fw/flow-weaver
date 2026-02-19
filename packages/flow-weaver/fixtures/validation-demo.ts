/**
 * Validation Demo - Intentional Errors for Testing
 *
 * This file demonstrates the build-time validator catching errors
 */

// ❌ ERROR 1: Duplicate port name
/**
 * @flowWeaver nodeType
 * @input value
 * @input value
 * @output result
 */
function DuplicatePort(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, result: value  };
}

// ✅ VALID: No errors
/**
 * @flowWeaver nodeType
 * @input x
 * @input y
 * @output sum
 */
function Add(execute: boolean, x: number, y: number) {
  return { onSuccess: true, onFailure: false, sum: x + y  };
}

// ❌ ERROR 2: Connection references non-existent node
/**
 * @flowWeaver workflow
 * @node DuplicatePort DuplicatePort
 * @node Add Add
 * @connect Start.value -> DuplicatePort.value
 * @connect DuplicatePort.result -> NonExistentNode.input
 * @connect Add.sum -> Exit.result
 */
export async function invalidWorkflow(execute: boolean, params: { value: number }): Promise<{ onSuccess: boolean; onFailure: boolean; result: number }> {
  // Implementation
}

// ✅ VALID: Simple workflow for empty branch elimination tests
/**
 * @flowWeaver workflow
 * @node adder Add
 * @connect Start.execute -> adder.execute
 * @connect adder.onSuccess -> Exit.onSuccess
 * @connect adder.onFailure -> Exit.onFailure
 * @connect Start.x -> adder.x
 * @connect Start.y -> adder.y
 * @connect adder.sum -> Exit.result
 * @param {NUMBER} x - First number
 * @param {NUMBER} y - Second number
 * @returns {NUMBER} result - Sum
 */
export async function calculate(execute: boolean, params: { x: number; y: number }): Promise<{ onSuccess: boolean; onFailure: boolean; result: number }> {
  throw new Error('Not implemented');
}
