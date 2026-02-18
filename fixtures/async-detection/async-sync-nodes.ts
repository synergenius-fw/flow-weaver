/**
 * Test workflow for async/sync detection
 * Contains both async and sync node functions
 */

/**
 * Sync node - adds two numbers synchronously
 *
 * @flowWeaver nodeType
 * @label SyncAdd
 * @input a
 * @input b
 * @output sum
 */
function syncAdd(execute: boolean, a: number, b: number) {
  if (!execute) {
    return { onSuccess: false, onFailure: false, sum: 0 };
  }

  const sum = a + b;
  return {
    onSuccess: true,
    onFailure: false,
    sum
  };
}

/**
 * Async node - multiplies two numbers asynchronously
 *
 * @flowWeaver nodeType
 * @label AsyncMultiply
 * @input a
 * @input b
 * @output product
 */
async function asyncMultiply(execute: boolean, a: number, b: number) {
  if (!execute) {
    return { onSuccess: false, onFailure: false, product: 0 };
  }

  // Simulate async operation
  await new Promise(resolve => setTimeout(resolve, 10));

  const product = a * b;
  return {
    onSuccess: true,
    onFailure: false,
    product
  };
}

/**
 * Another sync node - divides two numbers
 *
 * @flowWeaver nodeType
 * @label SyncDivide
 * @input numerator
 * @input denominator
 * @output quotient
 */
function syncDivide(execute: boolean, numerator: number, denominator: number) {
  if (!execute) {
    return { onSuccess: false, onFailure: false, quotient: 0 };
  }

  if (denominator === 0) {
    return {
      onSuccess: false,
      onFailure: true,
      quotient: 0
    };
  }

  const quotient = numerator / denominator;
  return {
    onSuccess: true,
    onFailure: false,
    quotient
  };
}

/**
 * Sync workflow - all nodes are sync
 *
 * @flowWeaver workflow
 * @name syncOnlyWorkflow
 * @description Calculates (a + b) / denominator using only sync nodes
 * @node adder syncAdd
 * @node divider syncDivide
 * @connect Start.a -> adder.a
 * @connect Start.b -> adder.b
 * @connect adder.sum -> divider.numerator
 * @connect Start.denominator -> divider.denominator
 * @connect divider.quotient -> Exit.result
 */
export function syncOnlyWorkflow(
  execute: boolean,
  params: { a: number; b: number; denominator: number }
): {
  onSuccess: boolean;
  onFailure: boolean;
  result: number
} {
  throw new Error('Not implemented - Flow Weaver must generate this');
}

/**
 * Async workflow - contains async nodes
 *
 * @flowWeaver workflow
 * @name asyncWorkflow
 * @description Calculates (a + b) * factor using async multiply
 * @node adder syncAdd
 * @node multiplier asyncMultiply
 * @connect Start.a -> adder.a
 * @connect Start.b -> adder.b
 * @connect adder.sum -> multiplier.a
 * @connect Start.factor -> multiplier.b
 * @connect multiplier.product -> Exit.result
 */
export async function asyncWorkflow(
  execute: boolean,
  params: { a: number; b: number; factor: number }
): Promise<{
  onSuccess: boolean;
  onFailure: boolean;
  result: number
}> {
  throw new Error('Not implemented - Flow Weaver must generate this');
}
