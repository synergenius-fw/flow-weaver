/**
 * Main workflow that imports node types from another file
 * NOTE: Imports from .ts file (not .ts) to test convention isn't required
 */

// Used in workflow annotation: @node imported doubleValue
import { doubleValue as _doubleValue } from './node-utils';

/**
 * @flowWeaver nodeType
 * @input value - Local node input
 * @output result - Local node output
 */
// Used in workflow annotation: @node local localNode
function localNode(
  execute: boolean,
  value: number
): { onSuccess: boolean; onFailure: boolean; result: number } {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
  return { onSuccess: true, onFailure: false, result: value + 10 };
}

/**
 * @flowWeaver workflow
 * @node imported doubleValue
 * @node local localNode
 * @connect Start.input -> imported.value
 * @connect imported.result -> local.value
 * @connect local.result -> Exit.output
 * @param input - Input number
 * @returns output - Processed output
 */
export function mainWorkflow(
  execute: boolean,
  params: { input: number }
): { onSuccess: boolean; onFailure: boolean; output: number } {
  void execute;
  void params;
  throw new Error('Not implemented - Flow Weaver will generate this');
}
