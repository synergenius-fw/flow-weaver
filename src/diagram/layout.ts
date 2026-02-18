import type { TWorkflowAST } from '../ast/types';
import { isStartNode, isExitNode } from '../constants';

export interface LayoutResult {
  layers: string[][];
  nodeLayer: Map<string, number>;
}

/**
 * Layered graph layout using Kahn's longest-path BFS + barycenter crossing minimization.
 * Filters out scoped connections and scoped child nodes.
 */
export function layoutWorkflow(ast: TWorkflowAST): LayoutResult {
  // Collect all node IDs (Start, Exit, and non-scoped instances)
  const nodeIds = new Set<string>();
  nodeIds.add('Start');
  nodeIds.add('Exit');

  // Track scoped child nodes to exclude
  const scopedChildren = new Set<string>();
  if (ast.scopes) {
    for (const children of Object.values(ast.scopes)) {
      for (const child of children) {
        scopedChildren.add(child);
      }
    }
  }

  for (const inst of ast.instances) {
    if (!scopedChildren.has(inst.id)) {
      nodeIds.add(inst.id);
    }
  }

  // Build adjacency (filter scoped connections)
  const forward = new Map<string, Set<string>>();
  const backward = new Map<string, Set<string>>();
  for (const id of nodeIds) {
    forward.set(id, new Set());
    backward.set(id, new Set());
  }

  for (const conn of ast.connections) {
    // Skip scoped connections
    if (conn.from.scope || conn.to.scope) continue;
    const from = conn.from.node;
    const to = conn.to.node;
    if (!nodeIds.has(from) || !nodeIds.has(to)) continue;
    forward.get(from)!.add(to);
    backward.get(to)!.add(from);
  }

  // Kahn's longest-path layer assignment (BFS from Start)
  const nodeLayer = new Map<string, number>();
  const inDegree = new Map<string, number>();
  for (const id of nodeIds) {
    inDegree.set(id, backward.get(id)!.size);
  }

  const queue: string[] = [];
  for (const id of nodeIds) {
    if (inDegree.get(id) === 0) {
      queue.push(id);
      nodeLayer.set(id, 0);
    }
  }

  // Force Start at layer 0 even if it has incoming edges (shouldn't, but be safe)
  if (!nodeLayer.has('Start')) {
    nodeLayer.set('Start', 0);
    queue.push('Start');
  }

  let head = 0;
  while (head < queue.length) {
    const node = queue[head++];
    const layer = nodeLayer.get(node)!;
    for (const next of forward.get(node)!) {
      const candidate = layer + 1;
      if (!nodeLayer.has(next) || nodeLayer.get(next)! < candidate) {
        nodeLayer.set(next, candidate);
      }
      inDegree.set(next, inDegree.get(next)! - 1);
      if (inDegree.get(next) === 0) {
        queue.push(next);
      }
    }
  }

  // Handle disconnected nodes - assign to layer 1 (after Start)
  for (const id of nodeIds) {
    if (!nodeLayer.has(id)) {
      nodeLayer.set(id, 1);
    }
  }

  // Force Exit to last layer
  let maxLayer = 0;
  for (const [id, layer] of nodeLayer) {
    if (!isExitNode(id) && layer > maxLayer) {
      maxLayer = layer;
    }
  }
  nodeLayer.set('Exit', maxLayer + 1);

  // Build layers array
  const layerCount = nodeLayer.get('Exit')! + 1;
  const layers: string[][] = Array.from({ length: layerCount }, () => []);
  for (const [id, layer] of nodeLayer) {
    layers[layer].push(id);
  }

  // Barycenter heuristic for crossing minimization (4 sweeps)
  for (let sweep = 0; sweep < 4; sweep++) {
    if (sweep % 2 === 0) {
      // Forward sweep
      for (let l = 1; l < layerCount; l++) {
        sortLayerByBarycenter(layers[l], layers[l - 1], backward, forward);
      }
    } else {
      // Backward sweep
      for (let l = layerCount - 2; l >= 0; l--) {
        sortLayerByBarycenter(layers[l], layers[l + 1], forward, backward);
      }
    }
  }

  return { layers, nodeLayer };
}

function sortLayerByBarycenter(
  layer: string[],
  referenceLayer: string[],
  _adjacencyToRef: Map<string, Set<string>>,
  _adjacencyFromRef: Map<string, Set<string>>,
): void {
  const refPositions = new Map<string, number>();
  referenceLayer.forEach((id, i) => refPositions.set(id, i));

  const barycenters = new Map<string, number>();
  for (const nodeId of layer) {
    // Get neighbors in the reference layer
    const neighbors: number[] = [];
    const fwd = _adjacencyToRef.get(nodeId);
    const bwd = _adjacencyFromRef.get(nodeId);
    if (fwd) {
      for (const n of fwd) {
        if (refPositions.has(n)) neighbors.push(refPositions.get(n)!);
      }
    }
    if (bwd) {
      for (const n of bwd) {
        if (refPositions.has(n)) neighbors.push(refPositions.get(n)!);
      }
    }
    if (neighbors.length > 0) {
      barycenters.set(nodeId, neighbors.reduce((a, b) => a + b, 0) / neighbors.length);
    } else {
      barycenters.set(nodeId, Infinity);
    }
  }

  layer.sort((a, b) => barycenters.get(a)! - barycenters.get(b)!);
}
