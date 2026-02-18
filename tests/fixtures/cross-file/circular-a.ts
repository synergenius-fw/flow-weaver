/**
 * Circular dependency test - File A imports from B
 */

// Used in workflow annotation: @node b nodeFromB
import { nodeFromB as _nodeFromB } from './circular-b';

/**
 * @flowWeaver nodeType
 * @input value - Input value
 * @output result - Output result
 */
export function nodeFromA(
  execute: boolean,
  value: number
): { onSuccess: boolean; onFailure: boolean; result: number } {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
  return { onSuccess: true, onFailure: false, result: value + 1 };
}

/**
 * @flowWeaver workflow
 * @node a nodeFromA
 * @node b nodeFromB
 * @connect Start.input -> a.value
 * @connect a.result -> b.value
 * @connect b.result -> Exit.output
 * @param input - Input
 * @returns output - Output
 */
export function workflowA(
  execute: boolean,
  params: { input: number }
): { onSuccess: boolean; onFailure: boolean; output: number } {
  void execute;
  void params;
  throw new Error('Not implemented - Flow Weaver will generate this');
}
