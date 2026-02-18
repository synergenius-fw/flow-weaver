import type { TNodeInstanceAST, TNodeTypeAST, TWorkflowAST } from '../ast';
import {
  RESERVED_NODE_NAMES,
  RESERVED_PORT_NAMES,
  isStartNode,
  isExitNode,
  isSuccessPort,
  isFailurePort,
} from '../constants';

export type ControlFlowGraph = {
  graph: Map<string, string[]>;
  inDegree: Map<string, number>;
};

export function buildControlFlowGraph(
  workflow: TWorkflowAST,
  nodeTypes: TNodeTypeAST[]
): ControlFlowGraph {
  const graph = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  graph.set(RESERVED_NODE_NAMES.START, []);
  inDegree.set(RESERVED_NODE_NAMES.START, 0);
  graph.set(RESERVED_NODE_NAMES.EXIT, []);
  inDegree.set(RESERVED_NODE_NAMES.EXIT, 0);
  // Initialize graph with instance IDs (exclude per-port scoped children)
  workflow.instances.forEach((instance) => {
    // Skip per-port scoped children - they execute in parent's scope function
    if (isPerPortScopedChild(instance, workflow, nodeTypes)) {
      return;
    }
    graph.set(instance.id, []);
    inDegree.set(instance.id, 0);
  });
  workflow.connections.forEach((conn) => {
    const fromNode = conn.from.node;
    const toNode = conn.to.node;

    // Skip scoped connections - they're internal to scope, not main control flow
    // A scoped connection has scope set on either the from or to port reference
    if (conn.from.scope || conn.to.scope) {
      return; // Skip this connection
    }

    // Skip connections involving per-port scoped children
    const fromInstance = workflow.instances.find((i) => i.id === fromNode);
    const toInstance = workflow.instances.find((i) => i.id === toNode);

    if (
      (fromInstance && isPerPortScopedChild(fromInstance, workflow, nodeTypes)) ||
      (toInstance && isPerPortScopedChild(toInstance, workflow, nodeTypes))
    ) {
      return; // Skip this connection
    }

    // Include both control-flow AND data-flow edges so the topological sort
    // respects data dependencies (e.g., node A produces data consumed by node B).
    // Self-loops (fromNode === toNode) are intentionally included so Kahn's
    // algorithm detects them as cycles.
    if (graph.has(fromNode) && graph.has(toNode)) {
      const successors = graph.get(fromNode) || [];
      if (!successors.includes(toNode)) {
        successors.push(toNode);
        graph.set(fromNode, successors);
        inDegree.set(toNode, (inDegree.get(toNode) || 0) + 1);
      }
    }
  });
  // Connect instances with no incoming edges to Start
  workflow.instances.forEach((instance) => {
    // Skip per-port scoped children
    if (isPerPortScopedChild(instance, workflow, nodeTypes)) {
      return;
    }
    if ((inDegree.get(instance.id) || 0) === 0) {
      const startSuccessors = graph.get(RESERVED_NODE_NAMES.START) || [];
      if (!startSuccessors.includes(instance.id)) {
        startSuccessors.push(instance.id);
        graph.set(RESERVED_NODE_NAMES.START, startSuccessors);
        inDegree.set(instance.id, 1);
      }
    }
  });
  // Connect instances with no outgoing edges to Exit
  workflow.instances.forEach((instance) => {
    // Skip per-port scoped children
    if (isPerPortScopedChild(instance, workflow, nodeTypes)) {
      return;
    }
    const successors = graph.get(instance.id) || [];
    if (successors.length === 0) {
      successors.push(RESERVED_NODE_NAMES.EXIT);
      graph.set(instance.id, successors);
      inDegree.set(RESERVED_NODE_NAMES.EXIT, (inDegree.get(RESERVED_NODE_NAMES.EXIT) || 0) + 1);
    }
  });
  return { graph, inDegree };
}

/**
 * Perform Kahn's topological sort algorithm on control flow graph
 *
 * Determines the execution order of nodes in the workflow, ensuring all
 * dependencies execute before dependent nodes.
 *
 * Algorithm:
 * 1. Start with nodes that have no dependencies (in-degree = 0)
 * 2. Process each node, decreasing in-degree of successors
 * 3. Add nodes with in-degree 0 to queue
 * 4. Repeat until all nodes processed
 *
 * @param controlFlowGraph - Control flow graph with nodes and edges
 * @returns Ordered array of node IDs in execution order
 * @throws {Error} If circular dependency detected (cycle in graph)
 */
export function performKahnsTopologicalSort(controlFlowGraph: ControlFlowGraph): string[] {
  const executionOrder: string[] = [];
  const inDegree = new Map(controlFlowGraph.inDegree);
  const queue: string[] = [];
  inDegree.forEach((degree, node) => {
    if (degree === 0) {
      queue.push(node);
    }
  });
  while (queue.length > 0) {
    const node = queue.shift()!;
    executionOrder.push(node);
    const successors = controlFlowGraph.graph.get(node) || [];
    successors.forEach((successor) => {
      const newDegree = (inDegree.get(successor) || 0) - 1;
      inDegree.set(successor, newDegree);
      if (newDegree === 0) {
        queue.push(successor);
      }
    });
  }
  if (executionOrder.length !== controlFlowGraph.graph.size) {
    // Circular dependency detected - collect nodes still in the cycle
    const cycleNodes: string[] = [];
    inDegree.forEach((degree, node) => {
      if (degree > 0 && !executionOrder.includes(node)) {
        cycleNodes.push(node);
      }
    });
    throw new Error(
      `Circular dependency detected in workflow. Nodes in cycle: ${cycleNodes.join(', ')}`
    );
  }
  return executionOrder;
}

export function findAllBranchingNodes(
  workflow: TWorkflowAST,
  nodeTypes: TNodeTypeAST[]
): Set<string> {
  const branchingNodes = new Set<string>();
  workflow.connections.forEach((conn) => {
    const nodeName = conn.from.node;
    const portName = conn.from.port;
    if (isSuccessPort(portName) || isFailurePort(portName)) {
      // Skip per-port scoped children - their branches shouldn't affect main control flow
      const instance = workflow.instances.find((i) => i.id === nodeName);
      if (instance && isPerPortScopedChild(instance, workflow, nodeTypes)) {
        return;
      }
      branchingNodes.add(nodeName);
    }
  });
  return branchingNodes;
}

/**
 * Check if an instance is a per-port scoped child.
 *
 * Per-port scoped children:
 * - Have a parent reference (instance.parent)
 * - Parent has ports with matching scope name (scope declared via @scope tag or callback param)
 * - Execute inside parent's scope function, NOT in main control flow
 *
 * Node-level scoped children:
 * - Have a parent reference (instance.parent)
 * - Parent does NOT have ports with matching scope
 * - Execute in parent's scope block within main control flow
 */
export function isPerPortScopedChild(
  instance: TNodeInstanceAST,
  workflow: TWorkflowAST,
  nodeTypes: TNodeTypeAST[]
): boolean {
  if (!instance.parent) return false;

  const parentInstance = workflow.instances.find((i) => i.id === instance.parent!.id);
  if (!parentInstance) return false;

  const parentNodeType = nodeTypes.find((nt) => nt.name === parentInstance.nodeType || nt.functionName === parentInstance.nodeType);
  if (!parentNodeType) return false;

  // Check if parent has any port (input or output) with the matching scope name.
  // A scope is valid if declared via @scope tag or inferred from callback parameter.
  // If scoped ports exist, they indicate a valid scope function.
  const scopeName = instance.parent!.scope;
  const hasOutputWithScope = Object.values(parentNodeType.outputs).some(
    (port) => port.scope === scopeName
  );
  const hasInputWithScope = Object.values(parentNodeType.inputs).some(
    (port) => port.scope === scopeName
  );

  return hasOutputWithScope || hasInputWithScope;
}

export function findNodesInBranch(
  branchNode: string,
  branchPort: typeof RESERVED_PORT_NAMES.ON_SUCCESS | typeof RESERVED_PORT_NAMES.ON_FAILURE,
  workflow: TWorkflowAST,
  allNodes: Set<string>,
  stopAtBranchingNodes: Set<string>,
  _allParsedNodeTypes?: TNodeTypeAST[]
): Set<string> {
  const reachable = new Set<string>();
  const visited = new Set<string>();
  const queue: string[] = [];
  workflow.connections.forEach((conn) => {
    const fromNode = conn.from.node;
    const fromPort = conn.from.port;
    const toNode = conn.to.node;
    if (fromNode === branchNode && fromPort === branchPort) {
      queue.push(toNode);
    }
  });
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current) || isExitNode(current) || isStartNode(current)) {
      continue;
    }
    visited.add(current);
    if (stopAtBranchingNodes.has(current) && current !== branchNode) {
      reachable.add(current);
      continue;
    }
    if (allNodes.has(current)) {
      reachable.add(current);
      workflow.connections.forEach((conn) => {
        const fromNode = conn.from.node;
        const fromPort = conn.from.port;
        const toNode = conn.to.node;
        if (fromNode === current && !isSuccessPort(fromPort) && !isFailurePort(fromPort)) {
          if (!visited.has(toNode)) {
            queue.push(toNode);
          }
        }
      });
    }
  }
  return reachable;
}

/**
 * Detect sequential chains of branching nodes where flattening can reduce nesting.
 *
 * A chain link exists when a branching node has exactly one branching child in one
 * direction (success or failure) and zero in the other. Chains must be >= 2 nodes.
 *
 * @returns Map from chain head ID to ordered array of chain node IDs
 */
export function detectBranchingChains(
  branchingNodes: Set<string>,
  branchRegions: Map<string, { successNodes: Set<string>; failureNodes: Set<string> }>
): Map<string, string[]> {
  // Build chain successor links: nodeId -> next branching node in chain
  const chainSuccessor = new Map<string, string>();

  for (const nodeId of branchingNodes) {
    const region = branchRegions.get(nodeId);
    if (!region) continue;

    const successBranching = [...region.successNodes].filter((n) => branchingNodes.has(n));
    const failureBranching = [...region.failureNodes].filter((n) => branchingNodes.has(n));

    // Chain link: exactly one direction has one branching child, other has zero
    let nextNode: string | null = null;
    if (successBranching.length === 1 && failureBranching.length === 0) {
      nextNode = successBranching[0];
    } else if (failureBranching.length === 1 && successBranching.length === 0) {
      nextNode = failureBranching[0];
    }

    if (nextNode) {
      chainSuccessor.set(nodeId, nextNode);
    }
  }

  // Find nodes that have a chain predecessor
  const hasChainPredecessor = new Set<string>(chainSuccessor.values());

  // Build chains starting from head nodes (nodes with successor but no predecessor)
  const chains = new Map<string, string[]>();

  for (const nodeId of branchingNodes) {
    if (hasChainPredecessor.has(nodeId)) continue; // not a head
    if (!chainSuccessor.has(nodeId)) continue; // no successor = no chain

    const chain: string[] = [nodeId];
    let current = nodeId;
    while (chainSuccessor.has(current)) {
      const next = chainSuccessor.get(current)!;
      chain.push(next);
      current = next;
    }

    if (chain.length >= 2) {
      chains.set(nodeId, chain);
    }
  }

  return chains;
}

export function determineExecutionOrder(workflow: TWorkflowAST, nodes: TNodeTypeAST[]): string[] {
  const nodeMap = new Map<string, TNodeTypeAST>();
  nodes.forEach((node) => nodeMap.set(node.functionName, node));
  const executionOrder: string[] = [];
  const visited = new Set<string>();
  function visit(nodeName: string) {
    if (visited.has(nodeName)) return;
    visited.add(nodeName);
    const outgoingConnections = workflow.connections.filter(
      (conn) => conn.from.node === nodeName && !isExitNode(conn.to.node)
    );
    outgoingConnections.forEach((conn) => {
      const targetNode = conn.to.node;
      if (!isExitNode(targetNode)) {
        visit(targetNode);
      }
    });
    executionOrder.unshift(nodeName);
  }
  const startConnections = workflow.connections.filter(
    (conn) => isStartNode(conn.from.node) && !isExitNode(conn.to.node)
  );
  startConnections.forEach((conn) => {
    visit(conn.to.node);
  });
  return executionOrder;
}
