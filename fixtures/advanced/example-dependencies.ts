// Example workflow that imports nodes from other files (Phase 11)

// Import nodes from utility file
import { double, triple, add } from '../real-world/example-utils';

// ============================================================================
// WORKFLOW USING IMPORTED NODES
// ============================================================================

/**
 * Workflow that uses imported utility nodes
 * Demonstrates: Importing and composing reusable nodes
 *
 * @flowWeaver workflow
 * @name composedWorkflow
 * @node double double
 * @node triple triple
 * @node add add
 * @path Start -> double -> add -> Exit
 * @path Start -> triple -> add -> Exit
 * @connect Start.input -> double.value
 * @connect Start.input -> triple.value
 * @connect double.result -> add.a
 * @connect triple.result -> add.b
 * @connect add.sum -> Exit.result
 */
export async function composedWorkflow(execute: boolean, params: { input: number }): Promise<{ onSuccess: boolean; onFailure: boolean; result: number }> {
  throw new Error('Not implemented');
}
