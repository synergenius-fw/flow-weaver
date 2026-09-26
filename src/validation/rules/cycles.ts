/**
 * Cycle detection. The generated code runs nodes in topological order, so a
 * loop between nodes has no order to run in; iteration belongs in a scoped
 * node (forEach and the like), which runs its children once per item.
 *
 * Each scope layer (the root, and every parent's children) is checked on its
 * own, over the connections whose ends share that layer. A node connected to
 * itself is allowed (an iteration pattern) and never starts a reported loop.
 * The same loop found from several entry points is reported once.
 */

import type { TWorkflowAST } from '../../ast/types';
import type { ValidationContext } from './context.js';

type Instances = TWorkflowAST['instances'];
type Connections = TWorkflowAST['connections'];

/** Instances grouped by the parent they live under; null is the root layer. */
function groupInstancesByLayer(workflow: TWorkflowAST): Map<string | null, Instances> {
  const instancesByParent = new Map<string | null, Instances>();
  instancesByParent.set(null, []);
  for (const instance of workflow.instances) {
    const parentId = instance.parent?.id || null;
    if (!instancesByParent.has(parentId)) {
      instancesByParent.set(parentId, []);
    }
    instancesByParent.get(parentId)!.push(instance);
  }
  return instancesByParent;
}

/**
 * Connections grouped by layer, keeping only those whose two ends are
 * instances in the same layer. Start and Exit are virtual and never loop.
 */
function groupConnectionsByLayer(workflow: TWorkflowAST): Map<string | null, Connections> {
  const connectionsByParent = new Map<string | null, Connections>();
  connectionsByParent.set(null, []);
  for (const connection of workflow.connections) {
    const sourceInstance = workflow.instances.find((n) => n.id === connection.from.node);
    const targetInstance = workflow.instances.find((n) => n.id === connection.to.node);
    if (!sourceInstance || !targetInstance) continue;

    const sourceParent = sourceInstance.parent?.id || null;
    const targetParent = targetInstance.parent?.id || null;
    if (sourceParent === targetParent) {
      if (!connectionsByParent.has(sourceParent)) {
        connectionsByParent.set(sourceParent, []);
      }
      connectionsByParent.get(sourceParent)!.push(connection);
    }
  }
  return connectionsByParent;
}

/** Depth-first search state for one layer. */
interface LayerSearch {
  ctx: ValidationContext;
  parentId: string | null;
  instances: Instances;
  /** Connections of the layer minus self-loops, which are allowed. */
  edges: Connections;
  /** Nodes with a self-loop; reaching one again is not a reported loop. */
  selfLoopNodes: Set<string>;
  visited: Set<string>;
  recursionStack: Set<string>;
  /** Sorted node lists of loops already reported, so each is reported once. */
  reportedCycles: Set<string>;
}

/** Report the loop that closes at `nodeName`, once per distinct set of nodes. */
function reportCycle(search: LayerSearch, nodeName: string, path: string[]): void {
  const cyclePath = [...path.slice(path.indexOf(nodeName)), nodeName];
  const cycleKey = [...cyclePath.slice(0, -1)].sort().join(',');
  if (search.reportedCycles.has(cycleKey)) return;
  search.reportedCycles.add(cycleKey);
  const parentContext = search.parentId ? ` in scope "${search.parentId}"` : '';
  const instance = search.instances.find((n) => n.id === nodeName);
  search.ctx.errors.push({
    type: 'error',
    code: 'CYCLE_DETECTED',
    message: `Loop detected${parentContext}: ${cyclePath.join(' -> ')}`,
    node: nodeName,
    location: instance?.sourceLocation,
  });
}

/** Visit `nodeName` along `path`; true when a loop was found through it. */
function visit(search: LayerSearch, nodeName: string, path: string[]): boolean {
  if (search.recursionStack.has(nodeName)) {
    if (search.selfLoopNodes.has(nodeName)) return false;
    reportCycle(search, nodeName, path);
    return true;
  }
  if (search.visited.has(nodeName)) return false;

  search.recursionStack.add(nodeName);
  if (!search.instances.find((n) => n.id === nodeName)) {
    search.recursionStack.delete(nodeName);
    return false;
  }

  const newPath = [...path, nodeName];
  let hasCycle = false;
  for (const conn of search.edges.filter((c) => c.from.node === nodeName)) {
    if (visit(search, conn.to.node, newPath)) {
      hasCycle = true;
    }
  }

  search.recursionStack.delete(nodeName);
  if (!hasCycle) {
    search.visited.add(nodeName);
  }
  return hasCycle;
}

/** Search one layer from every node, sharing visited and reported sets. */
function detectCyclesInLayer(
  ctx: ValidationContext,
  parentId: string | null,
  instances: Instances,
  connections: Connections
): void {
  const search: LayerSearch = {
    ctx,
    parentId,
    instances,
    edges: connections.filter((c) => c.from.node !== c.to.node),
    selfLoopNodes: new Set(connections.filter((c) => c.from.node === c.to.node).map((c) => c.from.node)),
    visited: new Set(),
    recursionStack: new Set(),
    reportedCycles: new Set(),
  };
  for (const instance of instances) {
    if (!search.visited.has(instance.id)) {
      visit(search, instance.id, []);
    }
  }
}

/**
 * Validate for cycles (loops) in the workflow graph, one scope layer at a time.
 */
export function validateCycles(ctx: ValidationContext, workflow: TWorkflowAST): void {
  const instancesByParent = groupInstancesByLayer(workflow);
  const connectionsByParent = groupConnectionsByLayer(workflow);
  for (const [parentId, instances] of instancesByParent.entries()) {
    detectCyclesInLayer(ctx, parentId, instances, connectionsByParent.get(parentId) || []);
  }
}
