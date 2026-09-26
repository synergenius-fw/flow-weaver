/**
 * Where each top-level node box sits.
 *
 * Decides x and y from the layers `layoutWorkflow` assigns: layers run left
 * to right, the boxes in a layer stack centred on y = 0, the gap between two
 * layers widens so opposing port labels never touch, and a node that lands
 * inside a widened scope box is pushed right, along with everything after it.
 */
import type { DiagramNode } from '../types';
import { LABEL_CLEARANCE, LABEL_GAP, LABEL_HEIGHT, maxPortLabelExtent } from './metrics';

const LAYER_GAP_X = 300;              // target center-to-center; actual gap adapts to port labels
const MIN_EDGE_GAP = 112;             // minimum edge-to-edge gap between node boxes
const NODE_GAP_Y = 60;

/**
 * Compute the maximum right-side overhang for a layer (external output port labels only).
 * Scope inner-edge port labels face inward and don't extend past the node boundary.
 */
function layerOutputExtent(layerNodes: string[], diagramNodes: Map<string, DiagramNode>): number {
  let max = 0;
  for (const id of layerNodes) {
    const node = diagramNodes.get(id)!;
    max = Math.max(max, maxPortLabelExtent(node.outputs));
  }
  return max;
}

/**
 * Compute the maximum left-side overhang for a layer (external input port labels only).
 * Scope inner-edge port labels face inward and don't extend past the node boundary.
 */
function layerInputExtent(layerNodes: string[], diagramNodes: Map<string, DiagramNode>): number {
  let max = 0;
  for (const id of layerNodes) {
    const node = diagramNodes.get(id)!;
    max = Math.max(max, maxPortLabelExtent(node.inputs));
  }
  return max;
}

/** Vertical gap between boxes in a layer: tighter as the layer grows. */
function adaptiveGapY(layerSize: number): number {
  if (layerSize <= 2) return NODE_GAP_Y;
  return Math.max(24, Math.round(NODE_GAP_Y * 2 / layerSize));
}

/**
 * Assign coordinates to nodes using auto-layout layer assignments.
 * Gap between layers adapts to port label extents so labels never overlap,
 * while using LAYER_GAP_X as the target center-to-center distance.
 */
export function assignLayerCoordinates(
  layers: string[][],
  diagramNodes: Map<string, DiagramNode>,
): void {
  // Pre-compute filtered layers
  const filtered: string[][] = layers.map(l => l.filter(id => diagramNodes.has(id)));

  let currentX = 0;
  for (let i = 0; i < filtered.length; i++) {
    const layerNodes = filtered[i];
    if (layerNodes.length === 0) {
      currentX += LAYER_GAP_X;
      continue;
    }

    const maxWidth = Math.max(...layerNodes.map(id => diagramNodes.get(id)!.width));
    const gapY = adaptiveGapY(layerNodes.length);
    const totalHeight = layerNodes.reduce((sum, id) => {
      const n = diagramNodes.get(id)!;
      return sum + n.height + LABEL_HEIGHT + LABEL_GAP;
    }, 0) + (layerNodes.length - 1) * gapY;

    let currentY = -totalHeight / 2;
    for (const id of layerNodes) {
      const node = diagramNodes.get(id)!;
      currentY += LABEL_HEIGHT + LABEL_GAP;
      node.x = currentX + (maxWidth - node.width) / 2;
      node.y = currentY;
      currentY += node.height + gapY;
    }

    // Compute label-aware edge gap to the next layer
    const nextLayerNodes = filtered[i + 1];
    if (nextLayerNodes && nextLayerNodes.length > 0) {
      const outputOverhang = layerOutputExtent(layerNodes, diagramNodes);
      const inputOverhang = layerInputExtent(nextLayerNodes, diagramNodes);
      const labelMinGap = outputOverhang + LABEL_CLEARANCE + inputOverhang;
      const edgeGap = Math.max(labelMinGap, LAYER_GAP_X - maxWidth, MIN_EDGE_GAP);
      currentX += maxWidth + edgeGap;
    } else {
      currentX += maxWidth + LAYER_GAP_X;
    }
  }
}

/**
 * After layout, resolve overlaps caused by expanded scope boxes. Only checks
 * nodes immediately after a scope parent. When a node falls inside the
 * expanded scope box, shift it and all further-right nodes to clear.
 */
export function resolvePostLayoutOverlaps(diagramNodes: Map<string, DiagramNode>): void {
  const hasScopeParent = [...diagramNodes.values()].some(n => n.scopeChildren && n.scopeChildren.length > 0);
  if (!hasScopeParent) return;

  const nodes = [...diagramNodes.values()].sort((a, b) => a.x - b.x);
  for (let i = 1; i < nodes.length; i++) {
    const prev = nodes[i - 1];
    const curr = nodes[i];

    // Only resolve overlaps caused by scope parent expansion
    if (!prev.scopeChildren || prev.scopeChildren.length === 0) continue;

    const actualGap = curr.x - (prev.x + prev.width);
    if (actualGap < MIN_EDGE_GAP) {
      const shift = MIN_EDGE_GAP - actualGap;
      for (let j = i; j < nodes.length; j++) {
        nodes[j].x += shift;
      }
    }
  }
}
