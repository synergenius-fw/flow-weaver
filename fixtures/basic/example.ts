/**
 * Basic arithmetic workflow example
 * Updated for STEP Port Architecture v0.2.0
 */

/**
 * Add two numbers
 * ALL nodes must have execute parameter and return onSuccess/onFailure
 *
 * @flowWeaver nodeType
 * @label Add
 * @input a
 * @input b
 * @output sum
 */
function add(execute: boolean, a: number, b: number) {
  if (!execute) {
    return { onSuccess: false, onFailure: false, sum: 0 };
  }

  const sum = a + b;
  return {
    onSuccess: true,  // Explicitly set by node
    onFailure: false, // Explicitly set by node
    sum
  };
}

/**
 * Multiply a value by a factor
 *
 * @flowWeaver nodeType
 * @label Multiply
 * @input value
 * @input factor
 * @output result
 */
function multiply(execute: boolean, value: number, factor: number) {
  if (!execute) {
    return { onSuccess: false, onFailure: false, result: 0 };
  }

  const result = value * factor;
  return {
    onSuccess: true,
    onFailure: false,
    result
  };
}

/**
 * Arithmetic calculation workflow
 * Workflow function also has execute parameter and onSuccess/onFailure returns
 *
 * @flowWeaver workflow
 * @name calculate
 * @description Calculates (a + b) * factor
 * @node adder add
 * @node multiplier multiply
 * @connect Start.a -> adder.a
 * @connect Start.b -> adder.b
 * @connect Start.factor -> multiplier.factor
 * @connect adder.sum -> multiplier.value
 * @connect multiplier.result -> Exit.result
 */
export async function calculate(
  execute: boolean,  // REQUIRED: workflow execute parameter
  params: { a: number; b: number; factor: number }
): Promise<{
  onSuccess: boolean;  // REQUIRED: from Exit
  onFailure: boolean;  // REQUIRED: from Exit
  result: number
}> {
  // BLACK BOX - Flow Weaver will generate this implementation
  throw new Error('Not implemented - Flow Weaver must generate this');
}
