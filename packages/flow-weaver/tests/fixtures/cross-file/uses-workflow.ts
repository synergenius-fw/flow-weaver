/**
 * Workflow that imports other workflows as node types
 * This tests the workflow-as-nodetype feature
 */

// Used in workflow annotation: @node validate validateAndTransform, @node format formatValue
import {
  validateAndTransform as _validateAndTransform,
  formatValue as _formatValue,
} from './workflow-utils';

/**
 * @flowWeaver workflow
 * @node validate validateAndTransform
 * @node format formatValue
 * @connect Start.input -> validate.data
 * @connect validate.result -> format.value
 * @connect format.output -> Exit.result
 * @connect format.onSuccess -> Exit.onSuccess
 * @connect format.onFailure -> Exit.onFailure
 * @param input - Raw input data
 * @returns result - Formatted result
 */
export function processData(
  execute: boolean,
  params: { input: unknown }
): { onSuccess: boolean; onFailure: boolean; result: string } {
  void execute;
  void params;
  throw new Error('Not implemented - Flow Weaver will generate this');
}
