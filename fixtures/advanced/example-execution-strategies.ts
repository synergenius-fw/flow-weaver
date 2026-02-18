/**
 * Examples demonstrating different execution strategies:
 * - CONJUNCTION: Execute when ALL inputs have data (default, AND logic)
 * - DISJUNCTION: Execute when ANY input has data (OR logic)
 * - CUSTOM: Execute based on custom condition
 */

// ============================================================================
// Test 1: CONJUNCTION (default) - Execute when ALL inputs ready
// ============================================================================

/**
 * @flowWeaver nodeType
 * @input value
 * @output result
 * @output signal
 */
function sourceA(execute: boolean, value: number) {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0, signal: false };
  console.log("sourceA executing");
  return { onSuccess: true, onFailure: false, result: value * 2, signal: true };
}

/**
 * @flowWeaver nodeType
 * @input value
 * @output result
 * @output signal
 */
function sourceB(execute: boolean, value: number) {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0, signal: false };
  console.log("sourceB executing");
  return { onSuccess: true, onFailure: false, result: value * 3, signal: true };
}

/**
 * @flowWeaver nodeType
 * @executeWhen CONJUNCTION
 * @input signalA
 * @input signalB
 * @output result
 */
function conjunctionMerge(execute: boolean, signalA: any, signalB: any) {
  if (!execute) return { onSuccess: false, onFailure: false, result: "" };
  console.log("conjunctionMerge executing (should see AFTER both sources)");
  return { onSuccess: true, onFailure: false, result: "both-ready" };
}

/**
 * @flowWeaver workflow
 * @name conjunctionTest
 * @node sourceA sourceA
 * @node sourceB sourceB
 * @node conjunctionMerge conjunctionMerge
 * @path Start -> sourceA -> conjunctionMerge -> Exit
 * @path Start -> sourceB -> conjunctionMerge -> Exit
 * @connect Start.value -> sourceA.value
 * @connect Start.value -> sourceB.value
 * @connect sourceA.signal -> conjunctionMerge.signalA
 * @connect sourceB.signal -> conjunctionMerge.signalB
 * @connect conjunctionMerge.result -> Exit.result
 */
export async function conjunctionTest(execute: boolean, params: { value: number }): Promise<{ onSuccess: boolean; onFailure: boolean; result: string }> {
  throw new Error("Not implemented - will be generated");
}

// ============================================================================
// Test 2: DISJUNCTION - Execute when ANY input ready
// ============================================================================

/**
 * @flowWeaver nodeType
 * @input value
 * @output result
 * @output signal
 */
function slowSource(execute: boolean, value: number) {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0, signal: false };
  console.log("slowSource executing");
  return { onSuccess: true, onFailure: false, result: value * 10, signal: true };
}

/**
 * @flowWeaver nodeType
 * @input value
 * @output result
 * @output signal
 */
function fastSource(execute: boolean, value: number) {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0, signal: false };
  console.log("fastSource executing");
  return { onSuccess: true, onFailure: false, result: value * 5, signal: true };
}

/**
 * @flowWeaver nodeType
 * @executeWhen DISJUNCTION
 * @input [slowSignal]
 * @input [fastSignal]
 * @output result
 */
function disjunctionMerge(execute: boolean, slowSignal?: any, fastSignal?: any) {
  if (!execute) return { onSuccess: false, onFailure: false, result: "" };
  console.log("disjunctionMerge executing (should see AFTER first source)");
  return { onSuccess: true, onFailure: false, result: "one-ready" };
}

/**
 * @flowWeaver workflow
 * @name disjunctionTest
 * @node slowSource slowSource
 * @node fastSource fastSource
 * @node disjunctionMerge disjunctionMerge
 * @path Start -> slowSource -> disjunctionMerge -> Exit
 * @path Start -> fastSource -> disjunctionMerge -> Exit
 * @connect Start.value -> slowSource.value
 * @connect Start.value -> fastSource.value
 * @connect slowSource.signal -> disjunctionMerge.slowSignal
 * @connect fastSource.signal -> disjunctionMerge.fastSignal
 * @connect disjunctionMerge.result -> Exit.result
 */
export async function disjunctionTest(execute: boolean, params: { value: number }): Promise<{ onSuccess: boolean; onFailure: boolean; result: string }> {
  throw new Error("Not implemented - will be generated");
}

// ============================================================================
// Test 3: CUSTOM - Execute based on custom condition
// ============================================================================

/**
 * @flowWeaver nodeType
 * @input value
 * @output result
 * @output signal
 */
function conditionSourceA(execute: boolean, value: number) {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0, signal: false };
  console.log("conditionSourceA executing");
  return { onSuccess: true, onFailure: false, result: value + 10, signal: true };
}

/**
 * @flowWeaver nodeType
 * @input value
 * @output result
 * @output signal
 */
function conditionSourceB(execute: boolean, value: number) {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0, signal: false };
  console.log("conditionSourceB executing");
  return { onSuccess: true, onFailure: false, result: value + 20, signal: true };
}

/**
 * @flowWeaver nodeType
 * @executeWhen CUSTOM
 * @input [signalA]
 * @input [signalB]
 * @output result
 */
function customMerge(execute: boolean, signalA?: any, signalB?: any) {
  if (!execute) return { onSuccess: false, onFailure: false, result: "" };
  console.log("customMerge executing (custom condition)");
  return { onSuccess: true, onFailure: false, result: "custom-condition-met" };
}

/**
 * @flowWeaver workflow
 * @name customTest
 * @node conditionSourceA conditionSourceA
 * @node conditionSourceB conditionSourceB
 * @node customMerge customMerge
 * @path Start -> conditionSourceA -> customMerge -> Exit
 * @path Start -> conditionSourceB -> customMerge -> Exit
 * @connect Start.value -> conditionSourceA.value
 * @connect Start.value -> conditionSourceB.value
 * @connect conditionSourceA.signal -> customMerge.signalA
 * @connect conditionSourceB.signal -> customMerge.signalB
 * @connect customMerge.result -> Exit.result
 */
export async function customTest(execute: boolean, params: { value: number }): Promise<{ onSuccess: boolean; onFailure: boolean; result: string }> {
  throw new Error("Not implemented - will be generated");
}

// ============================================================================
// Test 4: Mixed execution strategies
// ============================================================================

/**
 * @flowWeaver nodeType
 * @input value
 * @output result
 * @output signal
 */
function input1(execute: boolean, value: number) {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0, signal: false };
  console.log("input1 executing");
  return { onSuccess: true, onFailure: false, result: value, signal: true };
}

/**
 * @flowWeaver nodeType
 * @input value
 * @output result
 * @output signal
 */
function input2(execute: boolean, value: number) {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0, signal: false };
  console.log("input2 executing");
  return { onSuccess: true, onFailure: false, result: value, signal: true };
}

/**
 * @flowWeaver nodeType
 * @input value
 * @output result
 * @output signal
 */
function input3(execute: boolean, value: number) {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0, signal: false };
  console.log("input3 executing");
  return { onSuccess: true, onFailure: false, result: value, signal: true };
}

/**
 * @flowWeaver nodeType
 * @executeWhen DISJUNCTION
 * @input [signal1]
 * @input [signal2]
 * @output result
 * @output signal
 */
function disjunctionNode(execute: boolean, signal1?: any, signal2?: any) {
  if (!execute) return { onSuccess: false, onFailure: false, result: "", signal: false };
  console.log("disjunctionNode executing (OR)");
  return { onSuccess: true, onFailure: false, result: "or-ready", signal: true };
}

/**
 * @flowWeaver nodeType
 * @executeWhen CONJUNCTION
 * @input signal3
 * @input signalOr
 * @output result
 */
function conjunctionNode(execute: boolean, signal3: any, signalOr: any) {
  if (!execute) return { onSuccess: false, onFailure: false, result: "" };
  console.log("conjunctionNode executing (AND)");
  return { onSuccess: true, onFailure: false, result: "and-ready" };
}

/**
 * @flowWeaver workflow
 * @name mixedTest
 * @node input1 input1
 * @node input2 input2
 * @node input3 input3
 * @node disjunctionNode disjunctionNode
 * @node conjunctionNode conjunctionNode
 * @path Start -> input1 -> disjunctionNode -> conjunctionNode -> Exit
 * @path Start -> input2 -> disjunctionNode -> conjunctionNode -> Exit
 * @path Start -> input3 -> conjunctionNode -> Exit
 * @connect Start.value -> input1.value
 * @connect Start.value -> input2.value
 * @connect Start.value -> input3.value
 * @connect input1.signal -> disjunctionNode.signal1
 * @connect input2.signal -> disjunctionNode.signal2
 * @connect input3.signal -> conjunctionNode.signal3
 * @connect disjunctionNode.signal -> conjunctionNode.signalOr
 * @connect conjunctionNode.result -> Exit.result
 */
export async function mixedTest(execute: boolean, params: { value: number }): Promise<{ onSuccess: boolean; onFailure: boolean; result: string }> {
  throw new Error("Not implemented - will be generated");
}
