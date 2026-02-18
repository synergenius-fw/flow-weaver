/**
 * Test fixture for pull execution node ID bug
 * Instance ID (doubler) differs from node type name (Double)
 */

/**
 * @flowWeaver nodeType
 * @input execute [order:0] - Execute
 * @input value [order:0]
 * @output onSuccess [order:0] - On Success
 * @output onFailure [order:1] - On Failure
 * @output result [order:2]
 */
function Double(execute: boolean, value: number) {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
  return { onSuccess: true, onFailure: false, result: value * 2 };
}

/**
 * @flowWeaver nodeType
 * @input execute [order:0] - Execute
 * @input x [order:0]
 * @input y [order:2]
 * @output onSuccess [order:0] - On Success
 * @output onFailure [order:1] - On Failure
 * @output sum [order:2]
 */
function Add(execute: boolean, x: number, y: number) {
  if (!execute) return { onSuccess: false, onFailure: false, sum: 0 };
  return { onSuccess: true, onFailure: false, sum: x + y };
}

/**
 * @flowWeaver workflow
 * @node doubler Double [pullExecution: result]
 * @node adder Add
 * @connect Start.a -> doubler.value
 * @connect Start.b -> adder.x
 * @connect doubler.result -> adder.y
 * @connect adder.sum -> Exit.result
 * @connect Start.execute -> adder.execute
 * @param execute - Execute
 * @param a [order:1] - A
 * @param b [order:2] - B
 * @returns onSuccess - On Success
 * @returns onFailure - On Failure
 * @returns result - Result
 */
export async function testPullNodeId(
  execute: boolean,
  params: { a: number; b: number }
): Promise<{ onSuccess: boolean; onFailure: boolean; result: number }> {
  throw new Error('Not implemented');
}
