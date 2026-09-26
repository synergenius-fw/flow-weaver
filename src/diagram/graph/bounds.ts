/**
 * The graph's coordinate frame and its bounds.
 *
 * Decides where the drawing starts and how big it is: once the boxes are
 * placed, every coordinate is shifted so the node boxes, their labels and
 * their port label badges sit a fixed padding inside the top-left corner, and
 * after routing the bounds grow to cover any connection path that leaves
 * that area, moving the origin when a path runs above or left of it.
 */
import type { DiagramConnection, DiagramGraph, DiagramNode, DiagramPort } from '../types';
import { LABEL_GAP, LABEL_HEIGHT, maxPortLabelExtent } from './metrics';

const PADDING = 40;

/** Extent of the node boxes, labels and port badges before normalization. */
export interface NodeExtent {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Measure the extent of the nodes (include scope children and port labels),
 * then shift every node, scope child and port so the extent starts at
 * (PADDING, PADDING). Returns the extent measured before the shift.
 */
export function normalizeNodes(nodes: DiagramNode[]): NodeExtent {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const node of nodes) {
    const labelTop = node.y - LABEL_HEIGHT - LABEL_GAP;

    // Port label badges extend beyond node boundaries
    const inputLabelExtent = maxPortLabelExtent(node.inputs);
    const outputLabelExtent = maxPortLabelExtent(node.outputs);

    minX = Math.min(minX, node.x - inputLabelExtent);
    minY = Math.min(minY, labelTop);
    maxX = Math.max(maxX, node.x + node.width + outputLabelExtent);
    maxY = Math.max(maxY, node.y + node.height);
  }

  const offsetX = -minX + PADDING;
  const offsetY = -minY + PADDING;

  const shiftPorts = (ports: DiagramPort[]) => {
    for (const p of ports) { p.cx += offsetX; p.cy += offsetY; }
  };

  // Normalize all coordinates
  for (const node of nodes) {
    node.x += offsetX;
    node.y += offsetY;
    shiftPorts(node.inputs);
    shiftPorts(node.outputs);

    // Offset scope children and scope ports
    if (node.scopeChildren) {
      for (const child of node.scopeChildren) {
        child.x += offsetX;
        child.y += offsetY;
        shiftPorts(child.inputs);
        shiftPorts(child.outputs);
      }
    }
    if (node.scopePorts) {
      shiftPorts(node.scopePorts.inputs);
      shiftPorts(node.scopePorts.outputs);
    }
  }

  return { minX, minY, maxX, maxY };
}

/**
 * The graph's bounds: the normalized node extent plus padding, extended to
 * include every connection path (top-level and inside scopes), since routes
 * can go outside the node area.
 */
export function graphBounds(
  extent: NodeExtent,
  connections: DiagramConnection[],
  nodes: DiagramNode[],
): DiagramGraph['bounds'] {
  const { minX, minY, maxX, maxY } = extent;
  let originX = 0;
  let originY = 0;
  let normalizedMaxY = (maxY - minY) + PADDING * 2;
  let normalizedMaxX = (maxX - minX) + PADDING * 2;
  const allConns = [...connections];
  for (const node of nodes) {
    if (node.scopeConnections) allConns.push(...node.scopeConnections);
  }
  for (const conn of allConns) {
    const pe = pathExtent(conn.path);
    if (pe.maxY + PADDING > normalizedMaxY) normalizedMaxY = pe.maxY + PADDING;
    if (pe.maxX + PADDING > normalizedMaxX) normalizedMaxX = pe.maxX + PADDING;
    if (pe.minY - PADDING < originY) originY = pe.minY - PADDING;
    if (pe.minX - PADDING < originX) originX = pe.minX - PADDING;
  }
  // Expand dimensions to cover the shifted origin
  normalizedMaxX -= originX;
  normalizedMaxY -= originY;

  return { width: normalizedMaxX, height: normalizedMaxY, originX, originY };
}

/** Extract min/max X/Y extent from an SVG path string (for bounds calculation) */
function pathExtent(path: string): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;
  const pattern = /(-?[\d.]+),(-?[\d.]+)/g;
  let m;
  while ((m = pattern.exec(path)) !== null) {
    const x = parseFloat(m[1]);
    const y = parseFloat(m[2]);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}
