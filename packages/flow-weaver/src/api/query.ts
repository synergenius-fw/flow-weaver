/**
 * Query API for read-only workflow inspection
 * All functions are pure and do not modify the workflow
 */

import type {
  TWorkflowAST,
  TNodeInstanceAST,
  TConnectionAST,
  TPortReference,
  TNodeTypeAST,
} from '../ast/types';
import type { NodeFilter } from './helpers';
import { portReferencesEqual } from './helpers';
import { isPerPortScopedChild } from '../generator/control-flow';

// ============================================================================
// SCOPE HELPERS
// ============================================================================

/**
 * Get connections that belong to the main control flow (exclude scoped connections).
 * Mirrors the filtering logic in control-flow.ts buildControlFlowGraph().
 */
function getMainFlowConnections(ast: TWorkflowAST): TConnectionAST[] {
  return ast.connections.filter((conn) => {
    // Skip connections with scope annotation on either end
    if (conn.from.scope || conn.to.scope) return false;

    // Skip connections involving per-port scoped children
    const fromInstance = ast.instances.find((i) => i.id === conn.from.node);
    const toInstance = ast.instances.find((i) => i.id === conn.to.node);

    if (
      (fromInstance && isPerPortScopedChild(fromInstance, ast, ast.nodeTypes)) ||
      (toInstance && isPerPortScopedChild(toInstance, ast, ast.nodeTypes))
    ) {
      return false;
    }

    return true;
  });
}

/**
 * Get instances that belong to the main control flow (exclude per-port scoped children).
 */
function getMainFlowInstances(ast: TWorkflowAST): TNodeInstanceAST[] {
  return ast.instances.filter((inst) => !isPerPortScopedChild(inst, ast, ast.nodeTypes));
}

// ============================================================================
// NODE QUERIES
// ============================================================================

/**
 * Get a single node instance by ID
 *
 * @param ast - Workflow to query
 * @param nodeId - ID of node to retrieve
 * @returns Node instance or undefined
 *
 * @example
 * ```typescript
 * const node = getNode(workflow, 'processor1');
 * if (node) {
 *   console.log(`Node type: ${node.nodeType}`);
 * }
 * ```
 */
export function getNode(ast: TWorkflowAST, nodeId: string): TNodeInstanceAST | undefined {
  return ast.instances.find((n) => n.id === nodeId);
}

/**
 * Get all node instances, optionally filtered
 *
 * @param ast - Workflow to query
 * @param filter - Optional filter criteria
 * @returns Array of matching node instances
 *
 * @example
 * ```typescript
 * // Get all nodes
 * const allNodes = getNodes(workflow);
 *
 * // Get nodes of specific type
 * const processors = getNodes(workflow, { type: 'processor' });
 *
 * // Get nodes in specific scope
 * const scopedNodes = getNodes(workflow, { scope: 'mainLoop' });
 *
 * // Custom filter
 * const configured = getNodes(workflow, {
 *   predicate: (node) => node.config !== undefined
 * });
 * ```
 */
export function getNodes(ast: TWorkflowAST, filter?: NodeFilter): TNodeInstanceAST[] {
  let nodes = [...ast.instances];

  if (!filter) {
    return nodes;
  }

  // Filter by type
  if (filter.type) {
    nodes = nodes.filter((n) => n.nodeType === filter.type);
  }

  // Filter by scope
  if (filter.scope) {
    nodes = nodes.filter((n) => {
      if (!n.parent) return false;
      // Match by parent id (simple scope) or full qualified path
      return (
        n.parent.id === filter.scope ||
        (n.parent.scope && `${n.parent.id}.${n.parent.scope}` === filter.scope)
      );
    });
  }

  // Apply custom predicate
  if (filter.predicate) {
    nodes = nodes.filter(filter.predicate);
  }

  return nodes;
}

/**
 * Get all nodes of a specific type
 *
 * @param ast - Workflow to query
 * @param nodeType - Node type (functionName) to filter by
 * @returns Array of matching node instances
 *
 * @example
 * ```typescript
 * const processors = getNodesByType(workflow, 'process');
 * console.log(`Found ${processors.length} processor nodes`);
 * ```
 */
export function getNodesByType(ast: TWorkflowAST, nodeType: string): TNodeInstanceAST[] {
  return ast.instances.filter((n) => n.nodeType === nodeType);
}

/**
 * Get all nodes in a specific scope
 *
 * @param ast - Workflow to query
 * @param scopeName - Name of scope
 * @returns Array of node instances in the scope
 *
 * @example
 * ```typescript
 * const loopNodes = getNodesInScope(workflow, 'mainLoop');
 * ```
 */
export function getNodesInScope(ast: TWorkflowAST, scopeName: string): TNodeInstanceAST[] {
  return ast.instances.filter((n) => {
    if (!n.parent) return false;
    // Match by parent id (simple scope) or full qualified path
    return (
      n.parent.id === scopeName ||
      (n.parent.scope && `${n.parent.id}.${n.parent.scope}` === scopeName)
    );
  });
}

/**
 * Check if a node exists
 *
 * @param ast - Workflow to query
 * @param nodeId - ID of node to check
 * @returns True if node exists
 *
 * @example
 * ```typescript
 * if (hasNode(workflow, 'processor1')) {
 *   console.log('Node exists');
 * }
 * ```
 */
export function hasNode(ast: TWorkflowAST, nodeId: string): boolean {
  return ast.instances.some((n) => n.id === nodeId);
}

/**
 * Find nodes by name pattern (searches in config.label)
 *
 * @param ast - Workflow to query
 * @param pattern - String pattern or regex to match
 * @param caseSensitive - Whether to match case-sensitively (default: false)
 * @returns Array of matching node instances
 *
 * @example
 * ```typescript
 * // Find nodes with 'processor' in label
 * const nodes = findNodesByName(workflow, 'processor');
 *
 * // Case-sensitive search
 * const exact = findNodesByName(workflow, 'Processor', true);
 *
 * // Regex search
 * const regex = findNodesByName(workflow, /^proc-\d+$/);
 * ```
 */
export function findNodesByName(
  ast: TWorkflowAST,
  pattern: string | RegExp,
  caseSensitive: boolean = false
): TNodeInstanceAST[] {
  const regex =
    typeof pattern === 'string' ? new RegExp(pattern, caseSensitive ? '' : 'i') : pattern;

  return ast.instances.filter((node) => {
    // Check node ID
    if (regex.test(node.id)) {
      return true;
    }

    // Check config label if present
    if (node.config?.label && regex.test(node.config.label)) {
      return true;
    }

    return false;
  });
}

// ============================================================================
// CONNECTION QUERIES
// ============================================================================

/**
 * Get all connections, optionally filtered by node
 *
 * @param ast - Workflow to query
 * @param nodeId - Optional node ID to filter connections
 * @returns Array of connections
 *
 * @example
 * ```typescript
 * // Get all connections
 * const allConnections = getConnections(workflow);
 *
 * // Get all connections involving a specific node
 * const nodeConnections = getConnections(workflow, 'processor1');
 * ```
 */
export function getConnections(ast: TWorkflowAST, nodeId?: string): TConnectionAST[] {
  if (!nodeId) {
    return [...ast.connections];
  }

  return ast.connections.filter((conn) => conn.from.node === nodeId || conn.to.node === nodeId);
}

/**
 * Get all incoming connections to a node or port
 *
 * @param ast - Workflow to query
 * @param nodeId - Target node ID
 * @param portName - Optional port name to filter
 * @returns Array of incoming connections
 *
 * @example
 * ```typescript
 * // Get all connections to a node
 * const incoming = getIncomingConnections(workflow, 'processor1');
 *
 * // Get connections to specific port
 * const inputConns = getIncomingConnections(workflow, 'processor1', 'input');
 * ```
 */
export function getIncomingConnections(
  ast: TWorkflowAST,
  nodeId: string,
  portName?: string
): TConnectionAST[] {
  return ast.connections.filter((conn) => {
    if (conn.to.node !== nodeId) {
      return false;
    }

    if (portName && conn.to.port !== portName) {
      return false;
    }

    return true;
  });
}

/**
 * Get all outgoing connections from a node or port
 *
 * @param ast - Workflow to query
 * @param nodeId - Source node ID
 * @param portName - Optional port name to filter
 * @returns Array of outgoing connections
 *
 * @example
 * ```typescript
 * // Get all connections from a node
 * const outgoing = getOutgoingConnections(workflow, 'processor1');
 *
 * // Get connections from specific port
 * const outputConns = getOutgoingConnections(workflow, 'processor1', 'output');
 * ```
 */
export function getOutgoingConnections(
  ast: TWorkflowAST,
  nodeId: string,
  portName?: string
): TConnectionAST[] {
  return ast.connections.filter((conn) => {
    if (conn.from.node !== nodeId) {
      return false;
    }

    if (portName && conn.from.port !== portName) {
      return false;
    }

    return true;
  });
}

/**
 * Check if two ports are connected
 *
 * @param ast - Workflow to query
 * @param from - Source port reference (string or object)
 * @param to - Target port reference (string or object)
 * @returns True if connected
 *
 * @example
 * ```typescript
 * if (isConnected(workflow, 'node1.output', 'node2.input')) {
 *   console.log('Nodes are connected');
 * }
 * ```
 */
export function isConnected(
  ast: TWorkflowAST,
  from: string | TPortReference,
  to: string | TPortReference
): boolean {
  const fromRef =
    typeof from === 'string' ? { node: from.split('.')[0], port: from.split('.')[1] } : from;
  const toRef = typeof to === 'string' ? { node: to.split('.')[0], port: to.split('.')[1] } : to;

  return ast.connections.some(
    (conn) => portReferencesEqual(conn.from, fromRef) && portReferencesEqual(conn.to, toRef)
  );
}

/**
 * Get all ports connected to a node
 *
 * @param ast - Workflow to query
 * @param nodeId - Node ID to check
 * @returns Object with incoming and outgoing port references
 *
 * @example
 * ```typescript
 * const ports = getConnectedPorts(workflow, 'processor1');
 * console.log('Incoming:', ports.incoming);
 * console.log('Outgoing:', ports.outgoing);
 * ```
 */
export function getConnectedPorts(
  ast: TWorkflowAST,
  nodeId: string
): { incoming: TPortReference[]; outgoing: TPortReference[] } {
  const incoming = ast.connections.filter((conn) => conn.to.node === nodeId).map((conn) => conn.to);

  const outgoing = ast.connections
    .filter((conn) => conn.from.node === nodeId)
    .map((conn) => conn.from);

  return { incoming, outgoing };
}

/**
 * Get all unconnected ports for a node
 *
 * @param ast - Workflow to query
 * @param nodeId - Node ID to check
 * @returns Object with unconnected input and output port names
 *
 * @example
 * ```typescript
 * const unconnected = getUnconnectedPorts(workflow, 'processor1');
 * console.log('Unconnected inputs:', unconnected.inputs);
 * console.log('Unconnected outputs:', unconnected.outputs);
 * ```
 */
export function getUnconnectedPorts(
  ast: TWorkflowAST,
  nodeId: string
): { inputs: string[]; outputs: string[] } {
  const node = ast.instances.find((n) => n.id === nodeId);
  if (!node) {
    return { inputs: [], outputs: [] };
  }

  const nodeType = ast.nodeTypes.find((nt) => nt.name === node.nodeType || nt.functionName === node.nodeType);
  if (!nodeType) {
    return { inputs: [], outputs: [] };
  }

  // Get connected ports
  const connectedInputs = new Set(
    ast.connections.filter((conn) => conn.to.node === nodeId).map((conn) => conn.to.port)
  );

  const connectedOutputs = new Set(
    ast.connections.filter((conn) => conn.from.node === nodeId).map((conn) => conn.from.port)
  );

  // Find unconnected ports
  const inputs = Object.keys(nodeType.inputs).filter((port) => !connectedInputs.has(port));

  const outputs = Object.keys(nodeType.outputs).filter((port) => !connectedOutputs.has(port));

  return { inputs, outputs };
}

// ============================================================================
// DEPENDENCY ANALYSIS
// ============================================================================

/**
 * Get direct dependencies of a node (nodes that feed into it)
 *
 * @param ast - Workflow to query
 * @param nodeId - Node ID to analyze
 * @returns Array of node IDs that this node depends on
 *
 * @example
 * ```typescript
 * const deps = getDependencies(workflow, 'processor1');
 * console.log('Direct dependencies:', deps);
 * ```
 */
export function getDependencies(ast: TWorkflowAST, nodeId: string): string[] {
  const deps = new Set<string>();

  getMainFlowConnections(ast).forEach((conn) => {
    if (conn.to.node === nodeId && conn.from.node !== 'Start') {
      deps.add(conn.from.node);
    }
  });

  return Array.from(deps);
}

/**
 * Get data-only dependencies of a node (excludes control flow connections)
 *
 * @param ast - Workflow to query
 * @param nodeId - Node ID to analyze
 * @returns Array of node IDs that provide data inputs to this node
 */
export function getDataDependencies(ast: TWorkflowAST, nodeId: string): string[] {
  const deps = new Set<string>();
  const instanceTypeMap = new Map<string, TNodeTypeAST>();
  for (const inst of ast.instances) {
    // Check both name (for npm nodes like 'npm/pkg/func') and functionName (for local nodes)
    const nt = ast.nodeTypes.find((t) => t.name === inst.nodeType || t.functionName === inst.nodeType);
    if (nt) instanceTypeMap.set(inst.id, nt);
  }

  getMainFlowConnections(ast).forEach((conn) => {
    if (conn.to.node === nodeId) {
      if (conn.from.node === 'Start') {
        // Include Start only when it provides data (not just execute)
        if (conn.from.port !== 'execute') {
          deps.add(conn.from.node);
        }
        return;
      }
      const sourceNodeType = instanceTypeMap.get(conn.from.node);
      if (sourceNodeType) {
        const sourcePort = sourceNodeType.outputs[conn.from.port];
        if (sourcePort && (sourcePort.isControlFlow || sourcePort.dataType === 'STEP')) {
          return; // Skip control flow connections
        }
      }
      deps.add(conn.from.node);
    }
  });

  return Array.from(deps);
}

/**
 * Get direct dependents of a node (nodes that consume its output)
 *
 * @param ast - Workflow to query
 * @param nodeId - Node ID to analyze
 * @returns Array of node IDs that depend on this node
 *
 * @example
 * ```typescript
 * const dependents = getDependents(workflow, 'processor1');
 * console.log('Direct dependents:', dependents);
 * ```
 */
export function getDependents(ast: TWorkflowAST, nodeId: string): string[] {
  const dependents = new Set<string>();

  getMainFlowConnections(ast).forEach((conn) => {
    if (conn.from.node === nodeId && conn.to.node !== 'Exit') {
      dependents.add(conn.to.node);
    }
  });

  return Array.from(dependents);
}

/**
 * Get transitive dependencies (all upstream nodes)
 *
 * @param ast - Workflow to query
 * @param nodeId - Node ID to analyze
 * @returns Array of all node IDs in the dependency chain
 *
 * @example
 * ```typescript
 * const allDeps = getTransitiveDependencies(workflow, 'finalProcessor');
 * console.log('All upstream nodes:', allDeps);
 * ```
 */
export function getTransitiveDependencies(ast: TWorkflowAST, nodeId: string): string[] {
  const visited = new Set<string>();
  const queue = [nodeId];

  while (queue.length > 0) {
    const current = queue.shift()!;

    if (visited.has(current)) {
      continue;
    }

    visited.add(current);

    const deps = getDependencies(ast, current);
    deps.forEach((dep) => {
      if (!visited.has(dep)) {
        queue.push(dep);
      }
    });
  }

  // Remove the original node from results
  visited.delete(nodeId);

  return Array.from(visited);
}

/**
 * Find a path between two nodes (BFS)
 *
 * @param ast - Workflow to query
 * @param fromNodeId - Source node ID
 * @param toNodeId - Target node ID
 * @returns Array of node IDs representing the path, or null if no path exists
 *
 * @example
 * ```typescript
 * const path = findPath(workflow, 'input', 'output');
 * if (path) {
 *   console.log('Path:', path.join(' → '));
 * } else {
 *   console.log('No path exists');
 * }
 * ```
 */
export function findPath(ast: TWorkflowAST, fromNodeId: string, toNodeId: string): string[] | null {
  if (fromNodeId === toNodeId) {
    return [fromNodeId];
  }

  const visited = new Set<string>();
  const queue: { node: string; path: string[] }[] = [{ node: fromNodeId, path: [fromNodeId] }];

  while (queue.length > 0) {
    const { node: current, path } = queue.shift()!;

    if (visited.has(current)) {
      continue;
    }

    visited.add(current);

    // Check if we reached the target
    if (current === toNodeId) {
      return path;
    }

    // Add all dependents to queue
    const dependents = getDependents(ast, current);
    dependents.forEach((dep) => {
      if (!visited.has(dep)) {
        queue.push({ node: dep, path: [...path, dep] });
      }
    });
  }

  return null; // No path found
}

/**
 * Get topological order of all nodes (for execution planning)
 *
 * @param ast - Workflow to query
 * @returns Array of node IDs in topological order
 * @throws {Error} If workflow contains cycles
 *
 * @example
 * ```typescript
 * try {
 *   const order = getTopologicalOrder(workflow);
 *   console.log('Execution order:', order);
 * } catch (error) {
 *   console.error('Workflow has cycles!');
 * }
 * ```
 */
export function getTopologicalOrder(ast: TWorkflowAST): string[] {
  const mainInstances = getMainFlowInstances(ast);
  const mainConnections = getMainFlowConnections(ast);
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  // Initialize with main-flow instances only
  mainInstances.forEach((node) => {
    inDegree.set(node.id, 0);
    adjacency.set(node.id, []);
  });

  // Build graph from main-flow connections only
  mainConnections.forEach((conn) => {
    if (conn.from.node !== 'Start' && conn.to.node !== 'Exit') {
      const from = conn.from.node;
      const to = conn.to.node;

      adjacency.get(from)?.push(to);
      inDegree.set(to, (inDegree.get(to) || 0) + 1);
    }
  });

  // Kahn's algorithm
  const queue: string[] = [];
  const result: string[] = [];

  // Start with nodes that have no dependencies
  inDegree.forEach((degree, node) => {
    if (degree === 0) {
      queue.push(node);
    }
  });

  while (queue.length > 0) {
    const current = queue.shift()!;
    result.push(current);

    const neighbors = adjacency.get(current) || [];
    neighbors.forEach((neighbor) => {
      const newDegree = (inDegree.get(neighbor) || 0) - 1;
      inDegree.set(neighbor, newDegree);

      if (newDegree === 0) {
        queue.push(neighbor);
      }
    });
  }

  // Check for cycles (compare against main-flow instances, not all instances)
  if (result.length !== mainInstances.length) {
    throw new Error('Cannot compute topological order: workflow contains cycles');
  }

  return result;
}

/**
 * Group nodes by execution level (nodes at same level can execute in parallel)
 *
 * @param ast - Workflow to query
 * @returns Array of arrays, where each sub-array contains node IDs at that level
 * @throws {Error} If workflow contains cycles
 *
 * @example
 * ```typescript
 * const groups = getExecutionGroups(workflow);
 * groups.forEach((group, level) => {
 *   console.log(`Level ${level}:`, group.join(', '));
 * });
 * ```
 */
export function getExecutionGroups(ast: TWorkflowAST): string[][] {
  const mainInstances = getMainFlowInstances(ast);
  const mainConnections = getMainFlowConnections(ast);
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  // Initialize with main-flow instances only
  mainInstances.forEach((node) => {
    inDegree.set(node.id, 0);
    adjacency.set(node.id, []);
  });

  // Build graph from main-flow connections only
  mainConnections.forEach((conn) => {
    if (conn.from.node !== 'Start' && conn.to.node !== 'Exit') {
      const from = conn.from.node;
      const to = conn.to.node;

      adjacency.get(from)?.push(to);
      inDegree.set(to, (inDegree.get(to) || 0) + 1);
    }
  });

  // Level-based BFS
  const groups: string[][] = [];
  let currentLevel = Array.from(inDegree.entries())
    .filter(([_, degree]) => degree === 0)
    .map(([node, _]) => node);

  const processed = new Set<string>();

  while (currentLevel.length > 0) {
    groups.push([...currentLevel]);

    const nextLevel = new Set<string>();

    currentLevel.forEach((node) => {
      processed.add(node);

      const neighbors = adjacency.get(node) || [];
      neighbors.forEach((neighbor) => {
        const newDegree = (inDegree.get(neighbor) || 0) - 1;
        inDegree.set(neighbor, newDegree);

        if (newDegree === 0 && !processed.has(neighbor)) {
          nextLevel.add(neighbor);
        }
      });
    });

    currentLevel = Array.from(nextLevel);
  }

  // Check for cycles (compare against main-flow instances, not all instances)
  if (processed.size !== mainInstances.length) {
    throw new Error('Cannot compute execution groups: workflow contains cycles');
  }

  return groups;
}

// ============================================================================
// STATISTICS
// ============================================================================

/**
 * Count nodes, optionally filtered
 *
 * @param ast - Workflow to query
 * @param filter - Optional filter criteria
 * @returns Number of matching nodes
 *
 * @example
 * ```typescript
 * const total = countNodes(workflow);
 * const processors = countNodes(workflow, { type: 'process' });
 * ```
 */
export function countNodes(ast: TWorkflowAST, filter?: NodeFilter): number {
  return getNodes(ast, filter).length;
}

/**
 * Count connections, optionally for a specific node
 *
 * @param ast - Workflow to query
 * @param nodeId - Optional node ID to filter
 * @returns Number of connections
 *
 * @example
 * ```typescript
 * const total = countConnections(workflow);
 * const nodeConns = countConnections(workflow, 'processor1');
 * ```
 */
export function countConnections(ast: TWorkflowAST, nodeId?: string): number {
  return getConnections(ast, nodeId).length;
}

/**
 * Count node types defined in workflow
 *
 * @param ast - Workflow to query
 * @returns Number of node type definitions
 *
 * @example
 * ```typescript
 * const typeCount = countNodeTypes(workflow);
 * ```
 */
export function countNodeTypes(ast: TWorkflowAST): number {
  return ast.nodeTypes.length;
}

/**
 * Find isolated nodes (no connections)
 *
 * @param ast - Workflow to query
 * @returns Array of isolated node IDs
 *
 * @example
 * ```typescript
 * const isolated = findIsolatedNodes(workflow);
 * if (isolated.length > 0) {
 *   console.warn('Isolated nodes:', isolated);
 * }
 * ```
 */
export function findIsolatedNodes(ast: TWorkflowAST): string[] {
  const mainConnections = getMainFlowConnections(ast);
  return getMainFlowInstances(ast)
    .filter((node) => {
      const hasConnections = mainConnections.some(
        (conn) => conn.from.node === node.id || conn.to.node === node.id
      );
      return !hasConnections;
    })
    .map((node) => node.id);
}

/**
 * Find unused node types (no instances)
 *
 * @param ast - Workflow to query
 * @returns Array of unused node type names
 *
 * @example
 * ```typescript
 * const unused = findUnusedNodeTypes(workflow);
 * if (unused.length > 0) {
 *   console.warn('Unused node types:', unused);
 * }
 * ```
 */
export function findUnusedNodeTypes(ast: TWorkflowAST): string[] {
  const usedTypes = new Set(ast.instances.map((n) => n.nodeType));

  return ast.nodeTypes.filter((nt) => !usedTypes.has(nt.functionName)).map((nt) => nt.name);
}

/**
 * Find dead-end nodes (output never reaches Exit)
 *
 * @param ast - Workflow to query
 * @returns Array of dead-end node IDs
 *
 * @example
 * ```typescript
 * const deadEnds = findDeadEnds(workflow);
 * if (deadEnds.length > 0) {
 *   console.warn('Dead-end nodes:', deadEnds);
 * }
 * ```
 */
export function findDeadEnds(ast: TWorkflowAST): string[] {
  const deadEnds: string[] = [];
  const mainConnections = getMainFlowConnections(ast);

  getMainFlowInstances(ast).forEach((node) => {
    // Check if there's a path from this node to Exit
    const hasPathToExit = mainConnections.some((conn) => {
      if (conn.from.node === node.id && conn.to.node === 'Exit') {
        return true;
      }

      // Check indirect paths via DFS
      const visited = new Set<string>();
      const stack = [node.id];

      while (stack.length > 0) {
        const current = stack.pop()!;

        if (visited.has(current)) {
          continue;
        }

        visited.add(current);

        // Check if current connects to Exit (using main flow connections)
        const toExit = mainConnections.some((c) => c.from.node === current && c.to.node === 'Exit');

        if (toExit) {
          return true;
        }

        // Add dependents to stack (getDependents already uses main flow connections)
        const deps = getDependents(ast, current);
        deps.forEach((dep) => stack.push(dep));
      }

      return false;
    });

    if (!hasPathToExit) {
      deadEnds.push(node.id);
    }
  });

  return deadEnds;
}

/**
 * Find output ports that are not connected to anything.
 * Excludes control flow ports (onSuccess/onFailure) and scoped ports.
 *
 * @param ast - Workflow to query
 * @returns Array of objects with nodeId and their disconnected output port names
 */
/**
 * Find dead-end details: both dead-end nodes and disconnected output ports.
 * Combines findDeadEnds() and findDisconnectedOutputPorts() into a single result.
 *
 * @param ast - Workflow to query
 * @returns Object with deadEndNodes and disconnectedOutputs
 */
export function findDeadEndDetails(ast: TWorkflowAST): {
  deadEndNodes: string[];
  disconnectedOutputs: Array<{ nodeId: string; ports: string[] }>;
} {
  return {
    deadEndNodes: findDeadEnds(ast),
    disconnectedOutputs: findDisconnectedOutputPorts(ast),
  };
}

export function findDisconnectedOutputPorts(
  ast: TWorkflowAST
): Array<{ nodeId: string; ports: string[] }> {
  const connectedOutputPorts = new Set<string>();
  getMainFlowConnections(ast).forEach((conn) => {
    connectedOutputPorts.add(`${conn.from.node}.${conn.from.port}`);
  });

  const results: Array<{ nodeId: string; ports: string[] }> = [];

  for (const instance of getMainFlowInstances(ast)) {
    // Check both name (for npm nodes like 'npm/pkg/func') and functionName (for local nodes)
    const nodeType = ast.nodeTypes.find((nt) => nt.name === instance.nodeType || nt.functionName === instance.nodeType);
    if (!nodeType) continue;
    const disconnectedPorts: string[] = [];
    for (const [portName, portDef] of Object.entries(nodeType.outputs)) {
      if (portDef.isControlFlow || portDef.failure || portDef.scope) continue;
      if (!connectedOutputPorts.has(`${instance.id}.${portName}`)) {
        disconnectedPorts.push(portName);
      }
    }
    if (disconnectedPorts.length > 0) {
      results.push({ nodeId: instance.id, ports: disconnectedPorts });
    }
  }

  return results;
}
