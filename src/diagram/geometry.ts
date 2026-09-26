/**
 * The laid-out diagram graph behind the ASCII and text renderers and
 * `fw describe`: every node box, port dot and connection path of a workflow
 * with its coordinates.
 *
 * buildDiagramGraph decides the order of the steps. Each step lives in
 * src/diagram/graph/:
 *
 * - nodes: the Start, Exit and instance boxes, their ports and base size
 * - scopes: scope children, inner ports, the grown parent box, scope wiring
 * - placement: x and y of each top-level box from the layout's layers
 * - bounds: shifting into a padded frame and the final bounds
 * - routing: which connections are drawn, their stubs and their paths
 * - ports / metrics: port order and positions; sizes and text widths
 */
import type { TWorkflowAST } from '../ast/types';
import { layoutWorkflow } from './layout';
import type { DiagramGraph, DiagramNode, DiagramOptions } from './types';
import { graphBounds, normalizeNodes } from './graph/bounds';
import {
  applySizeOverrides, buildExitNode, buildInstanceNode, buildNodeTypeMap, buildStartNode,
  collectWiredStepPorts, computeNodeDimensions,
} from './graph/nodes';
import { assignLayerCoordinates, resolvePostLayoutOverlaps } from './graph/placement';
import { computePortPositions } from './graph/ports';
import { collectExternalConnections, routeConnections } from './graph/routing';
import { buildScopeSubGraphs, collectScopes, finalizeScopePositions } from './graph/scopes';

export {
  PORT_RADIUS, PORT_SIZE, PORT_GAP, PORT_PADDING_Y, NODE_MIN_WIDTH, NODE_MIN_HEIGHT,
  LABEL_HEIGHT, LABEL_GAP, measureText, portBadgeWidth,
} from './graph/metrics';
export { SCOPE_PADDING_X, SCOPE_PADDING_Y, SCOPE_PORT_COLUMN, SCOPE_INNER_GAP_X } from './graph/scopes';
export { STUB_DISTANCE_THRESHOLD, computeConnectionPath } from './graph/routing';
export { computeNodeDimensions } from './graph/nodes';
export { computePortPositions } from './graph/ports';

export function buildDiagramGraph(ast: TWorkflowAST, options: DiagramOptions = {}): DiagramGraph {
  const themeName = options.theme ?? 'dark';
  const nodeTypeMap = buildNodeTypeMap(ast);

  // Track scoped children — from explicit ast.scopes and from scope-qualified connections
  const { allScopes, scopedChildren } = collectScopes(ast);

  // Build diagram nodes
  const diagramNodes = new Map<string, DiagramNode>();
  diagramNodes.set('Start', buildStartNode(ast));
  diagramNodes.set('Exit', buildExitNode(ast));

  // Instance nodes (skip scoped children — they are built inside their parent)
  const stepPortsUsed = collectWiredStepPorts(ast);
  for (const inst of ast.instances) {
    if (scopedChildren.has(inst.id)) continue;
    const node = buildInstanceNode(
      inst.id, inst.nodeType, inst.config, nodeTypeMap, themeName,
      stepPortsUsed.get(inst.id) ?? new Set(),
    );
    diagramNodes.set(inst.id, node);
  }

  // Compute base dimensions
  for (const node of diagramNodes.values()) {
    computeNodeDimensions(node);
  }

  // Build scope sub-graphs (expands parent dimensions)
  buildScopeSubGraphs(ast, diagramNodes, allScopes, nodeTypeMap, themeName);

  // Apply explicit [size: W H] annotation — hard override (not a floor)
  applySizeOverrides(ast, diagramNodes, scopedChildren);

  // Layout: layers left to right from the control flow.
  const { layers } = layoutWorkflow(ast);
  assignLayerCoordinates(layers, diagramNodes);

  // Resolve overlaps caused by expanded scope boxes. Scope parents can be far
  // wider than the layer layout assumes, so cascade a rightward shift to all
  // downstream nodes that fall inside the expanded box.
  resolvePostLayoutOverlaps(diagramNodes);

  // Compute external port positions
  for (const node of diagramNodes.values()) {
    computePortPositions(node);
  }

  // Finalize scope sub-graph positions (offset children + build scope connections)
  for (const node of diagramNodes.values()) {
    if (node.scopeChildren) {
      finalizeScopePositions(node, ast, themeName);
    }
  }

  // Build external connections (skip connections fully handled by scope logic)
  const pendingConnections = collectExternalConnections(ast, diagramNodes, scopedChildren);

  // Shift everything into a padded frame, then route against the final coordinates
  const nodes = Array.from(diagramNodes.values());
  const extent = normalizeNodes(nodes);
  const connections = routeConnections(pendingConnections, nodes, themeName);

  return {
    nodes,
    connections,
    bounds: graphBounds(extent, connections, nodes),
    workflowName: ast.name,
  };
}
