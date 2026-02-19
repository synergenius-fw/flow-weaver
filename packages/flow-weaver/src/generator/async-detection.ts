/**
 * Async Detection Logic
 * Determines whether a workflow should be generated as async based on node composition
 */

import { TWorkflowAST, TNodeTypeAST } from "../ast/types";

/**
 * Determines if a workflow should be async based on its node composition
 * Rule: Workflow is async if ANY node in its execution graph is async
 *
 * @param workflow - The workflow AST
 * @param nodeTypes - Available node types
 * @returns true if any node in the workflow is async, false otherwise
 */
export function shouldWorkflowBeAsync(
  workflow: TWorkflowAST,
  nodeTypes: TNodeTypeAST[]
): boolean {
  // Build map of node type name -> isAsync
  // Map both nt.name and nt.functionName to support npm nodes where instance.nodeType uses nt.name
  const nodeTypeMap = new Map<string, boolean>();
  for (const nt of nodeTypes) {
    nodeTypeMap.set(nt.name, nt.isAsync);
    if (nt.functionName && nt.functionName !== nt.name) {
      nodeTypeMap.set(nt.functionName, nt.isAsync);
    }
  }

  // Check if ANY instance uses an async node type
  for (const instance of workflow.instances) {
    const isAsync = nodeTypeMap.get(instance.nodeType);
    if (isAsync === true) {
      return true;  // Found an async node
    }
  }

  return false;  // All nodes are sync (or no nodes)
}

/**
 * Validates workflow async mode and returns final decision with optional warning
 * Respects user's intent but ensures correctness
 *
 * @param workflow - The workflow AST
 * @param nodeTypes - Available node types
 * @returns Object with shouldBeAsync decision and optional warning
 */
export function validateWorkflowAsync(
  workflow: TWorkflowAST,
  nodeTypes: TNodeTypeAST[]
): { shouldBeAsync: boolean; warning?: string } {
  const computedAsync = shouldWorkflowBeAsync(workflow, nodeTypes);
  const userAsync = workflow.userSpecifiedAsync ?? true; // Default to async for backwards compat

  if (!userAsync && computedAsync) {
    // User wrote sync function, but workflow contains async nodes
    return {
      shouldBeAsync: true,  // Force async for correctness
      warning: `Workflow function '${workflow.functionName}' was declared as sync, but contains async nodes. Generating as async function.`
    };
  }

  // Either:
  // - User wrote async and nodes are async (correct)
  // - User wrote async and nodes are sync (honor user's choice, slight overhead but safe)
  // - User wrote sync and nodes are sync (correct)
  return { shouldBeAsync: computedAsync || userAsync };
}
