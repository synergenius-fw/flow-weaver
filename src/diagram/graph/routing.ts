/**
 * Which connections are drawn and the path each one takes.
 *
 * Decides the top-level connection list (connections that stay inside a
 * scope are left to the scope), the order connections are routed in (short
 * spans first, so track allocation is deterministic), the stubs drawn past
 * each port label, which connections are too long to draw in full, and the
 * orthogonal route around the node boxes, falling back to a straight line
 * when no route is found. Top-level and scope connections share one track
 * allocator so their routes do not overlap.
 */
import type { TWorkflowAST } from '../../ast/types';
import { calculateOrthogonalPathSafe, TrackAllocator } from '../orthogonal-router';
import type { NodeBox } from '../orthogonal-router';
import { getPortColor } from '../theme';
import type { DiagramConnection, DiagramNode, DiagramPort, DiagramStub } from '../types';
import { portLabelExtent } from './metrics';

// Connections beyond this x-distance show as stubs only (no full path); every
// connection within it is routed orthogonally. High enough that adjacent-layer
// connections still render their full path.
export const STUB_DISTANCE_THRESHOLD = 500;

// Stub length for long-distance connections (short segment from port center outward)
const STUB_LENGTH = 30;

/** Straight-line fallback when orthogonal routing fails (matches platform behaviour). */
export function computeConnectionPath(sx: number, sy: number, tx: number, ty: number): string {
  return `M ${sx},${sy} L ${tx},${ty}`;
}

/** A top-level connection with its resolved ports, waiting to be routed. */
export interface PendingConnection {
  fromNodeId: string; fromPortName: string;
  toNodeId: string; toPortName: string;
  sourcePort: DiagramPort; targetPort: DiagramPort;
  fromPortIndex: number; toPortIndex: number;
}

/**
 * Resolve the top-level connections to their ports. Scope-qualified
 * connections and connections that stay inside one scope (child to child,
 * child to its parent, parent to its child) are skipped: the scope draws
 * those. A connection that crosses a scope boundary finds its scope child.
 */
export function collectExternalConnections(
  ast: TWorkflowAST,
  diagramNodes: Map<string, DiagramNode>,
  scopedChildren: Set<string>,
): PendingConnection[] {
  const pendingConnections: PendingConnection[] = [];
  for (const conn of ast.connections) {
    // Skip scope-qualified connections (handled by scope logic)
    if (conn.from.scope || conn.to.scope) continue;

    // Look up nodes — check main diagram nodes first, then scope children
    let fromNode = diagramNodes.get(conn.from.node);
    let toNode = diagramNodes.get(conn.to.node);

    // Cross-scope: look up scope children for nodes not in main diagram
    if (!fromNode) {
      for (const node of diagramNodes.values()) {
        const child = node.scopeChildren?.find(c => c.id === conn.from.node);
        if (child) { fromNode = child; break; }
      }
    }
    if (!toNode) {
      for (const node of diagramNodes.values()) {
        const child = node.scopeChildren?.find(c => c.id === conn.to.node);
        if (child) { toNode = child; break; }
      }
    }

    if (!fromNode || !toNode) continue;

    // Skip connections where both endpoints are scope children or parent↔child
    // (these are handled as scope connections in finalizeScopePositions)
    const fromIsScoped = scopedChildren.has(conn.from.node);
    const toIsScoped = scopedChildren.has(conn.to.node);
    if (fromIsScoped && toIsScoped) continue; // child→child
    if (fromIsScoped && diagramNodes.has(conn.to.node) && findScopeParent(conn.from.node, diagramNodes) === conn.to.node) continue; // child→parent
    if (toIsScoped && diagramNodes.has(conn.from.node) && findScopeParent(conn.to.node, diagramNodes) === conn.from.node) continue; // parent→child

    const sourcePort = fromNode.outputs.find(p => p.name === conn.from.port);
    const targetPort = toNode.inputs.find(p => p.name === conn.to.port);
    if (!sourcePort || !targetPort) continue;

    const fromPortIndex = fromNode.outputs.indexOf(sourcePort);
    const toPortIndex = toNode.inputs.indexOf(targetPort);

    pendingConnections.push({
      fromNodeId: conn.from.node, fromPortName: conn.from.port,
      toNodeId: conn.to.node, toPortName: conn.to.port,
      sourcePort, targetPort,
      fromPortIndex, toPortIndex,
    });
  }
  return pendingConnections;
}

/**
 * Route the top-level connections, then recompute every scope connection's
 * path with the same router. Call after the coordinates are normalized.
 */
export function routeConnections(
  pendingConnections: PendingConnection[],
  nodes: DiagramNode[],
  theme: 'dark' | 'light',
): DiagramConnection[] {
  const nodeBoxes = buildNodeBoxes(nodes);
  // Create a single TrackAllocator for deterministic batch routing
  const allocator = new TrackAllocator();
  const connections = routeExternalConnections(pendingConnections, nodeBoxes, allocator, theme);
  routeScopeConnections(nodes, nodeBoxes, allocator);
  return connections;
}

/**
 * Build NodeBox array for orthogonal routing (after coordinate normalization).
 * Include scope children so the router can route around them.
 */
function buildNodeBoxes(nodes: DiagramNode[]): NodeBox[] {
  const nodeBoxes: NodeBox[] = nodes.map(node => ({
    id: node.id,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
  }));
  for (const node of nodes) {
    if (node.scopeChildren) {
      for (const child of node.scopeChildren) {
        nodeBoxes.push({ id: child.id, x: child.x, y: child.y, width: child.width, height: child.height });
      }
    }
  }
  return nodeBoxes;
}

/**
 * Routing order: short spans first, then by source X, then by source Y
 * (matching original editor for deterministic track allocation).
 */
function compareRoutingOrder(
  a: { sourcePort: DiagramPort; targetPort: DiagramPort },
  b: { sourcePort: DiagramPort; targetPort: DiagramPort },
): number {
  const aSpan = Math.abs(a.targetPort.cx - a.sourcePort.cx);
  const bSpan = Math.abs(b.targetPort.cx - b.sourcePort.cx);
  if (Math.abs(aSpan - bSpan) > 1) return aSpan - bSpan;
  if (Math.abs(a.sourcePort.cx - b.sourcePort.cx) > 1) return a.sourcePort.cx - b.sourcePort.cx;
  return a.sourcePort.cy - b.sourcePort.cy;
}

function routeExternalConnections(
  pendingConnections: PendingConnection[],
  nodeBoxes: NodeBox[],
  allocator: TrackAllocator,
  theme: 'dark' | 'light',
): DiagramConnection[] {
  pendingConnections.sort(compareRoutingOrder);

  // Compute all connection paths with routing mode selection
  const connections: DiagramConnection[] = [];
  for (const pc of pendingConnections) {
    const sx = pc.sourcePort.cx;
    const sy = pc.sourcePort.cy;
    const tx = pc.targetPort.cx;
    const ty = pc.targetPort.cy;

    const sourceColor = getPortColor(pc.sourcePort.dataType, pc.sourcePort.isFailure, theme);
    const targetColor = getPortColor(pc.targetPort.dataType, pc.targetPort.isFailure, theme);
    const xDistance = Math.abs(tx - sx);

    // Always compute stubs so the HTML viewer can toggle between path/stubs on drag.
    // In static SVG (labels always visible), stubs start after the port label badge.
    // In HTML, stubs start from port center by default and push out when labels appear.
    const dashed = pc.sourcePort.dataType !== 'STEP';
    const srcLabelEnd = portLabelExtent(pc.sourcePort);
    const tgtLabelEnd = portLabelExtent(pc.targetPort);
    const sourceStub: DiagramStub = {
      x: sx + srcLabelEnd, y: sy,
      endX: sx + srcLabelEnd + STUB_LENGTH,
      labelOffset: srcLabelEnd,
      color: sourceColor,
      dashed,
    };
    const targetStub: DiagramStub = {
      x: tx - tgtLabelEnd, y: ty,
      endX: tx - tgtLabelEnd - STUB_LENGTH,
      labelOffset: tgtLabelEnd,
      color: targetColor,
      dashed,
    };

    // Path endpoints sit past the port labels, so a connection is never
    // hidden behind a label badge.
    const pathSx = sx + srcLabelEnd;
    const pathTx = tx - tgtLabelEnd;

    let path: string;
    if (xDistance > STUB_DISTANCE_THRESHOLD) {
      // Long-distance: static SVG hides the full path, only shows stubs
      path = '';
    } else {
      const orthoPath = calculateOrthogonalPathSafe(
        [pathSx, sy], [pathTx, ty],
        nodeBoxes,
        pc.fromNodeId, pc.toNodeId,
        { fromPortIndex: pc.fromPortIndex, toPortIndex: pc.toPortIndex, allocator },
      );
      path = orthoPath ?? computeConnectionPath(pathSx, sy, pathTx, ty);
    }

    connections.push({
      fromNode: pc.fromNodeId, fromPort: pc.fromPortName,
      toNode: pc.toNodeId, toPort: pc.toPortName,
      sourceColor, targetColor,
      isStepConnection: pc.sourcePort.dataType === 'STEP',
      path,
      sourceStub,
      targetStub,
    });
  }
  return connections;
}

/** Recompute scope connection paths with the same routing logic as external connections */
function routeScopeConnections(
  nodes: DiagramNode[],
  nodeBoxes: NodeBox[],
  allocator: TrackAllocator,
): void {
  for (const node of nodes) {
    if (!node.scopeConnections || !node.scopePorts || !node.scopeChildren) continue;

    const childMap = new Map<string, DiagramNode>();
    for (const c of node.scopeChildren) childMap.set(c.id, c);

    // Collect scope connections with resolved ports and port indices
    type ScopePending = {
      conn: DiagramConnection;
      sourcePort: DiagramPort;
      targetPort: DiagramPort;
      fromNodeId: string;
      toNodeId: string;
      fromPortIndex: number;
      toPortIndex: number;
    };
    const scopePending: ScopePending[] = [];

    for (const conn of node.scopeConnections) {
      const sPort = findScopePort(conn.fromNode, conn.fromPort, node, childMap, 'output');
      const tPort = findScopePort(conn.toNode, conn.toPort, node, childMap, 'input');
      if (!sPort || !tPort) continue;

      let fromPortIndex = 0;
      let toPortIndex = 0;
      if (conn.fromNode === node.id) {
        fromPortIndex = node.scopePorts.outputs.indexOf(sPort);
      } else {
        const fromChild = childMap.get(conn.fromNode);
        if (fromChild) fromPortIndex = fromChild.outputs.indexOf(sPort);
      }
      if (conn.toNode === node.id) {
        toPortIndex = node.scopePorts.inputs.indexOf(tPort);
      } else {
        const toChild = childMap.get(conn.toNode);
        if (toChild) toPortIndex = toChild.inputs.indexOf(tPort);
      }

      scopePending.push({
        conn, sourcePort: sPort, targetPort: tPort,
        fromNodeId: conn.fromNode, toNodeId: conn.toNode,
        fromPortIndex: Math.max(0, fromPortIndex),
        toPortIndex: Math.max(0, toPortIndex),
      });
    }

    scopePending.sort(compareRoutingOrder);

    // Route each scope connection
    for (const sp of scopePending) {
      const sx = sp.sourcePort.cx;
      const sy = sp.sourcePort.cy;
      const tx = sp.targetPort.cx;
      const ty = sp.targetPort.cy;

      // Always try orthogonal routing first (matches platform style)
      const orthoPath = calculateOrthogonalPathSafe(
        [sx, sy], [tx, ty],
        nodeBoxes,
        sp.fromNodeId, sp.toNodeId,
        { fromPortIndex: sp.fromPortIndex, toPortIndex: sp.toPortIndex, allocator },
      );
      sp.conn.path = orthoPath ?? computeConnectionPath(sx, sy, tx, ty);
    }
  }
}

/** Find a port for scope connection path recomputation */
function findScopePort(
  nodeId: string, portName: string,
  parentNode: DiagramNode,
  childMap: Map<string, DiagramNode>,
  side: 'input' | 'output',
): DiagramPort | undefined {
  // Check if it's a scope port on the parent
  if (nodeId === parentNode.id) {
    const ports = side === 'output' ? parentNode.scopePorts?.outputs : parentNode.scopePorts?.inputs;
    return ports?.find(p => p.name === portName);
  }
  // Check child nodes
  const child = childMap.get(nodeId);
  if (!child) return undefined;
  return side === 'output'
    ? child.outputs.find(p => p.name === portName)
    : child.inputs.find(p => p.name === portName);
}

/** Find the parent diagram node that contains a scope child */
function findScopeParent(childId: string, diagramNodes: Map<string, DiagramNode>): string | undefined {
  for (const node of diagramNodes.values()) {
    if (node.scopeChildren?.some(c => c.id === childId)) return node.id;
  }
  return undefined;
}
