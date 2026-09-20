/**
 * Pure, state-free helpers extracted from WorkflowValidator (debt #3 step 2).
 *
 * These functions have no dependency on validator instance state
 * (errors/warnings/mode). They were previously private methods. Moving them out
 * shrinks the validator class and lets the extracted rule functions share them.
 * Behavior is identical to the former methods.
 */

import type {
  TNodeTypeAST,
  TWorkflowAST,
  TSourceLocation,
  TConnectionAST,
} from '../ast/types';

/** Look up instance sourceLocation by instance ID. */
export function getInstanceLocation(
  workflow: TWorkflowAST,
  instanceId: string,
): TSourceLocation | undefined {
  const instance = workflow.instances.find((inst) => inst.id === instanceId);
  return instance?.sourceLocation;
}

/** Look up connection sourceLocation. */
export function getConnectionLocation(conn: TConnectionAST): TSourceLocation | undefined {
  return conn.sourceLocation;
}

/** Format a data type for display, including its TS type when available. */
export function formatType(dataType: string, tsType?: string): string {
  if (tsType) {
    return `${tsType} (${dataType})`;
  }
  return dataType;
}

/** Normalize a type string for case-insensitive, whitespace-insensitive compare. */
export function normalizeTypeString(type: string): string {
  let n = type;
  // Remove all whitespace
  n = n.replace(/\s+/g, '');
  // Normalize Array<T> → T[]
  n = n.replace(/Array<(.+?)>/g, '$1[]');
  // Remove trailing semicolons before closing braces/brackets
  n = n.replace(/;(?=[}\]])/g, '');
  // Lowercase for case-insensitive compare
  n = n.toLowerCase();
  return n;
}

/**
 * Determine whether the given source nodes are mutually exclusive — i.e. they
 * all trace back to different branches (onSuccess/onFailure) of the same
 * branching ancestor, so at most one executes.
 */
export function areMutuallyExclusive(
  sourceNodes: string[],
  workflow: TWorkflowAST,
  instanceMap: Map<string, TNodeTypeAST>,
): boolean {
  if (sourceNodes.length < 2) return false;

  // Build reverse connection map: targetNode -> [{fromNode, fromPort}]
  const reverseMap = new Map<string, Array<{ fromNode: string; fromPort: string }>>();
  for (const conn of workflow.connections) {
    if (!reverseMap.has(conn.to.node)) {
      reverseMap.set(conn.to.node, []);
    }
    reverseMap.get(conn.to.node)!.push({ fromNode: conn.from.node, fromPort: conn.from.port });
  }

  // For each source node, trace backwards to find a branching ancestor and which branch it's on
  type BranchInfo = { branchNode: string; branch: 'onSuccess' | 'onFailure' };
  const findBranchAncestor = (nodeId: string): BranchInfo | null => {
    const visited = new Set<string>();
    const queue = [nodeId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);

      const incomingEdges = reverseMap.get(current);
      if (!incomingEdges) continue;

      for (const edge of incomingEdges) {
        // Check if this incoming edge is from a branching port
        if (edge.fromPort === 'onSuccess' || edge.fromPort === 'onFailure') {
          const parentNodeType = instanceMap.get(edge.fromNode);
          if (parentNodeType?.hasSuccessPort && parentNodeType?.hasFailurePort) {
            return { branchNode: edge.fromNode, branch: edge.fromPort as 'onSuccess' | 'onFailure' };
          }
        }
        queue.push(edge.fromNode);
      }
    }
    return null;
  };

  // Get branch info for all source nodes
  const branchInfos = sourceNodes.map(findBranchAncestor);

  // All must have a branch ancestor
  if (branchInfos.some((info) => info === null)) return false;

  // All must share the same branch node
  const branchNode = branchInfos[0]!.branchNode;
  if (!branchInfos.every((info) => info!.branchNode === branchNode)) return false;

  // They must be on different branches (not all on the same one)
  const branches = new Set(branchInfos.map((info) => info!.branch));
  return branches.size > 1;
}
