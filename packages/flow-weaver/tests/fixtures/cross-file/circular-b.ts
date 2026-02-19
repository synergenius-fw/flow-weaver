/**
 * Circular dependency test - File B imports from A
 */

// Used in workflow annotation: @node a nodeFromA
import { nodeFromA as _nodeFromA } from './circular-a';

/**
 * @flowWeaver nodeType
 * @input value - Input value
 * @output result - Output result
 */
export function nodeFromB(
  execute: boolean,
  value: number
): { onSuccess: boolean; onFailure: boolean; result: number } {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
  return { onSuccess: true, onFailure: false, result: value * 2 };
}

/**
 * @flowWeaver workflow
 * @node b nodeFromB
 * @node a nodeFromA
 * @connect Start.input -> b.value
 * @connect b.result -> a.value
 * @connect a.result -> Exit.output
 * @param input - Input
 * @returns output - Output
 */
export function workflowB(
  execute: boolean,
  params: { input: number }
): { onSuccess: boolean; onFailure: boolean; output: number } {
  void execute;
  void params;
  throw new Error('Not implemented - Flow Weaver will generate this');
}
