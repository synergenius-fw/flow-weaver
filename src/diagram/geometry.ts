import type { TWorkflowAST, TNodeTypeAST, TPortDefinition, TDataType } from '../ast/types';
import { isStartNode, isExitNode, isExecutePort, isSuccessPort, isFailurePort, SCOPED_PORT_NAMES, isScopedStartPort, isScopedSuccessPort, isScopedFailurePort } from '../constants';
import { assignImplicitPortOrders } from '../utils/port-ordering';
import { getPortColor, NODE_VARIANT_COLORS, TYPE_ABBREVIATIONS } from './theme';
import { layoutWorkflow } from './layout';
import { calculateOrthogonalPathSafe, TrackAllocator } from './orthogonal-router';
import type { NodeBox } from './orthogonal-router';
import type { DiagramNode, DiagramPort, DiagramConnection, DiagramGraph, DiagramOptions } from './types';

// ---- Constants (matching React component-node) ----

export const PORT_RADIUS = 7;
export const PORT_SIZE = PORT_RADIUS * 2; // 14px — matches portRootStyle
export const PORT_GAP = 8;               // matches port column gap
export const PORT_PADDING_Y = 18;        // matches inputsStyle paddingTop/Bottom
export const NODE_MIN_WIDTH = 90;         // matches NODE_MIN_WIDTH in styles.ts
export const NODE_MIN_HEIGHT = 90;        // matches NODE_MIN_HEIGHT in styles.ts
export const BORDER_RADIUS = 6;           // matches wrapperStyle borderRadius
export const LAYER_GAP_X = 300;              // target center-to-center; actual gap adapts to port labels
export const LABEL_CLEARANCE = 42;           // breathing room between opposing port label badges
export const MIN_EDGE_GAP = 112;             // minimum edge-to-edge gap between node boxes
export const NODE_GAP_Y = 60;
export const LABEL_HEIGHT = 20;           // 13px font + padding
export const LABEL_GAP = 12;             // matches labelRootStyle bottom: calc(100% + 12px)

// Scope rendering constants
export const SCOPE_PADDING_X = 140;        // horizontal padding inside scope (between port columns and children)
export const SCOPE_PADDING_Y = 40;         // vertical padding inside scope (top/bottom)
export const SCOPE_PORT_COLUMN = 50;     // width for scoped port column on inner edges
export const SCOPE_INNER_GAP_X = 240;    // horizontal gap between children inside scope

// Routing mode threshold — connections longer than this use orthogonal routing
// (midpoint of original 250–350 hysteresis thresholds)
export const ORTHOGONAL_DISTANCE_THRESHOLD = 300;

// ---- Font metrics (Montserrat 600-weight, 10px — measured via SVG getBBox) ----

const CHAR_WIDTHS: Record<string, number> = {
  ' ': 2.78, '!': 3.34, '"': 4.74, '#': 5.56, '$': 5.56, '%': 8.9, '&': 7.23,
  "'": 2.38, '(': 3.34, ')': 3.34, '*': 3.9, '+': 5.84, ',': 2.78, '-': 3.34,
  '.': 2.78, '/': 3.95, '0': 5.56, '1': 5.56, '2': 5.56, '3': 5.56, '4': 5.56,
  '5': 5.56, '6': 5.56, '7': 5.56, '8': 5.56, '9': 5.56, ':': 3.34, ';': 3.34,
  '<': 5.86, '=': 5.84, '>': 5.86, '?': 6.11, '@': 9.76,
  A: 7.23, B: 7.23, C: 7.23, D: 7.23, E: 6.67, F: 6.11, G: 7.78, H: 7.23,
  I: 2.78, J: 5.56, K: 7.23, L: 6.11, M: 8.34, N: 7.23, O: 7.78, P: 6.67,
  Q: 7.78, R: 7.23, S: 6.67, T: 6.11, U: 7.23, V: 6.67, W: 9.45, X: 6.67,
  Y: 6.67, Z: 6.11, '[': 3.34, '\\': 3.95, ']': 3.34, '^': 5.84, '_': 5.56, '`': 3.58,
  a: 5.56, b: 6.11, c: 5.56, d: 6.11, e: 5.56, f: 3.34, g: 6.11, h: 6.11,
  i: 2.78, j: 2.78, k: 5.56, l: 2.78, m: 8.9, n: 6.11, o: 6.11, p: 6.11,
  q: 6.11, r: 3.9, s: 5.56, t: 3.34, u: 6.11, v: 5.56, w: 7.78, x: 5.56,
  y: 5.56, z: 5, '{': 3.9, '|': 2.8, '}': 3.9, '~': 5.96,
};
const DEFAULT_CHAR_WIDTH = 5.56;

/** Measure text width using pre-computed Montserrat 600/10px SVG character widths */
export function measureText(text: string): number {
  let width = 0;
  for (let i = 0; i < text.length; i++) {
    width += CHAR_WIDTHS[text[i]] ?? DEFAULT_CHAR_WIDTH;
  }
  return width;
}

/** Compute the full badge width for a port label (matches renderer badge layout) */
export function portBadgeWidth(port: DiagramPort): number {
  const abbrev = TYPE_ABBREVIATIONS[port.dataType] ?? port.dataType;
  const typeWidth = measureText(abbrev);
  const labelWidth = measureText(port.label);
  const pad = 7;
  const divGap = 4;
  return pad + typeWidth + divGap + 1 + divGap + labelWidth + pad;
}

/** Total extent of a port label from the port dot center outward (badge + gap + dot radius) */
function portLabelExtent(port: DiagramPort): number {
  const badgeGap = 5;
  return PORT_RADIUS + badgeGap + portBadgeWidth(port);
}

// ---- Dimension computation ----

export function computeNodeDimensions(node: DiagramNode): void {
  const maxPorts = Math.max(node.inputs.length, node.outputs.length);
  // React: paddingTop + n * (PORT_SIZE + PORT_GAP) - PORT_GAP + paddingBottom
  const portsHeight = maxPorts > 0
    ? PORT_PADDING_Y + maxPorts * PORT_SIZE + (maxPorts - 1) * PORT_GAP + PORT_PADDING_Y
    : 0;
  node.width = NODE_MIN_WIDTH;
  node.height = Math.max(NODE_MIN_HEIGHT, portsHeight);
}

// ---- Port positions ----

export function computePortPositions(node: DiagramNode): void {
  positionPortList(node.inputs, node.x, node.y, node.height);
  positionPortList(node.outputs, node.x + node.width, node.y, node.height);
}

function positionPortList(ports: DiagramPort[], cx: number, nodeY: number, _nodeHeight: number): void {
  if (ports.length === 0) return;
  // Matches React portPositionCalculator: y = nodeY + paddingTop + i * (size + gap) + size/2
  for (let i = 0; i < ports.length; i++) {
    ports[i].cx = cx;
    ports[i].cy = nodeY + PORT_PADDING_Y + i * (PORT_SIZE + PORT_GAP) + PORT_SIZE / 2;
  }
}

// ---- Connection path (ported from connectionCalculator.ts) ----

/**
 * Compute a quad-curve connection from B towards D with consistent tangent.
 * U is a unit vector from B to C with the same slope as B→D.
 */
function quadCurveControl(ax: number, ay: number, bx: number, by: number, ux: number, uy: number): [number, number] {
  const dn = Math.abs(ay - by);
  const cx = bx + (ux * dn) / Math.abs(uy);
  const cy = ay;
  return [cx, cy];
}

export function computeConnectionPath(sx: number, sy: number, tx: number, ty: number): string {
  const e = 0.0001; // insignificant shift to avoid degenerate tangents
  const ax = sx + e;
  const ay = sy + e;
  const hx = tx - e;
  const hy = ty - e;

  const ramp = Math.min(20, (hx - ax) / 10);
  const bx = ax + ramp;
  const by = ay + e;
  const gx = hx - ramp;
  const gy = hy - e;

  const curveSizeX = Math.min(60, Math.abs(ax - hx) / 4);
  const curveSizeY = Math.min(60, Math.abs(ay - hy) / 4);
  const curveMag = Math.sqrt(curveSizeX * curveSizeX + curveSizeY * curveSizeY);

  const bgX = gx - bx;
  const bgY = gy - by;
  const bgLen = Math.sqrt(bgX * bgX + bgY * bgY);
  const bgUx = bgX / bgLen;
  const bgUy = bgY / bgLen;

  const dx = bx + bgUx * curveMag;
  const dy = by + (bgUy * curveMag) / 2;
  const ex = gx - bgUx * curveMag;
  const ey = gy - (bgUy * curveMag) / 2;

  const deX = ex - dx;
  const deY = ey - dy;
  const deLen = Math.sqrt(deX * deX + deY * deY);
  const deUx = deX / deLen;
  const deUy = deY / deLen;

  const [cx, cy] = quadCurveControl(bx, by, dx, dy, -deUx, -deUy);
  const [fx, fy] = quadCurveControl(gx, gy, ex, ey, deUx, deUy);

  let path = `M ${cx},${cy} M ${ax},${ay}`;
  path += ` L ${bx},${by}`;
  path += ` Q ${cx},${cy} ${dx},${dy}`;
  path += ` L ${ex},${ey}`;
  path += ` Q ${fx},${fy} ${gx},${gy}`;
  path += ` L ${hx},${hy}`;
  return path;
}

/** @deprecated Use computeConnectionPath instead */
export function computeBezierPath(sx: number, sy: number, tx: number, ty: number): string {
  return computeConnectionPath(sx, sy, tx, ty);
}

// ---- Port ordering helpers ----

/**
 * Get ordered ports from a port definition record using metadata.order.
 * Uses assignImplicitPortOrders to ensure all ports have proper ordering
 * (mandatory ports like execute/onSuccess/onFailure get precedence).
 */
function orderedPorts(
  ports: Record<string, TPortDefinition>,
  direction: 'INPUT' | 'OUTPUT',
): DiagramPort[] {
  // Clone port definitions so assignImplicitPortOrders can mutate safely
  const cloned: Record<string, TPortDefinition> = {};
  for (const [name, def] of Object.entries(ports)) {
    cloned[name] = { ...def, metadata: def.metadata ? { ...def.metadata } : undefined };
  }

  // Ensure all ports have order values (mandatory ports get precedence)
  assignImplicitPortOrders(cloned);

  return Object.entries(cloned)
    .sort(([, a], [, b]) => {
      const orderA = (a.metadata?.order as number) ?? Infinity;
      const orderB = (b.metadata?.order as number) ?? Infinity;
      return orderA - orderB;
    })
    .map(([name, def]) => ({
      name,
      label: def.label ?? name,
      dataType: def.dataType,
      direction,
      isControlFlow: def.dataType === 'STEP',
      isFailure: !!def.failure,
      cx: 0,
      cy: 0,
    }));
}

// ---- Instance node builder (shared by main graph and scope sub-graphs) ----

function buildInstanceNode(
  instId: string,
  instNodeType: string,
  instConfig: { label?: string; color?: string; icon?: string } | undefined,
  nodeTypeMap: Map<string, TNodeTypeAST>,
  theme: 'dark' | 'light' = 'dark',
): DiagramNode {
  const nt = nodeTypeMap.get(instNodeType);

  const allInputs: Record<string, TPortDefinition> = nt
    ? { ...filterNonScopedPorts(nt.inputs) }
    : {};
  const allOutputs: Record<string, TPortDefinition> = nt
    ? { ...filterNonScopedPorts(nt.outputs) }
    : {};

  if (nt && !nt.expression) {
    if (!allInputs.execute) allInputs.execute = { dataType: 'STEP' };
  }
  if (nt && nt.hasSuccessPort && !allOutputs.onSuccess) {
    allOutputs.onSuccess = { dataType: 'STEP', isControlFlow: true };
  }
  if (nt && nt.hasFailurePort && !allOutputs.onFailure) {
    allOutputs.onFailure = { dataType: 'STEP', isControlFlow: true, failure: true };
  }

  // Resolve icon: instance config → node type visuals → auto-detection
  const resolvedIcon = instConfig?.icon
    ?? nt?.visuals?.icon
    ?? resolveDefaultIcon(nt);

  return {
    id: instId,
    label: instConfig?.label ?? nt?.label ?? instId,
    color: resolveNodeColor(instConfig?.color ?? nt?.visuals?.color, theme),
    icon: resolvedIcon,
    isVirtual: false,
    inputs: orderedPorts(allInputs, 'INPUT'),
    outputs: orderedPorts(allOutputs, 'OUTPUT'),
    x: 0, y: 0,
    width: NODE_MIN_WIDTH,
    height: NODE_MIN_HEIGHT,
  };
}

// ---- Scope sub-graph builder ----

function buildScopeSubGraph(
  parentNode: DiagramNode,
  parentNt: TNodeTypeAST,
  scopeName: string,
  childIds: string[],
  ast: TWorkflowAST,
  nodeTypeMap: Map<string, TNodeTypeAST>,
  theme: 'dark' | 'light' = 'dark',
): void {
  const childIdSet = new Set(childIds);

  // Extract scoped port definitions from parent's node type (ports with explicit scope marker)
  const scopedOutputDefs: Record<string, TPortDefinition> = {};
  const scopedInputDefs: Record<string, TPortDefinition> = {};
  for (const [name, def] of Object.entries(parentNt.outputs)) {
    if (def.scope === scopeName) scopedOutputDefs[name] = def;
  }
  for (const [name, def] of Object.entries(parentNt.inputs)) {
    if (def.scope === scopeName) scopedInputDefs[name] = def;
  }

  // Derive additional scope ports from connections involving scope children.
  // Parent→child connections need a scope OUTPUT port (left inner edge).
  // Child→parent connections need a scope INPUT port (right inner edge).
  for (const conn of ast.connections) {
    // Parent → child: parent's output becomes scope output
    if (conn.from.node === parentNode.id && childIdSet.has(conn.to.node)) {
      const portName = conn.from.port;
      if (!scopedOutputDefs[portName]) {
        const parentDef = parentNt.outputs[portName];
        if (parentDef) {
          // Move existing output from external to scoped
          scopedOutputDefs[portName] = { ...parentDef, scope: scopeName };
        } else {
          // Implicit scoped port (e.g. forEach.item:iteration) — infer type and label from child
          const childInst = ast.instances.find(i => i.id === conn.to.node);
          const childNt = childInst ? nodeTypeMap.get(childInst.nodeType) : undefined;
          const childInputDef = childNt?.inputs[conn.to.port];
          scopedOutputDefs[portName] = {
            dataType: childInputDef?.dataType ?? 'ANY',
            scope: scopeName,
            label: childInputDef?.label ?? portName,
          };
        }
      }
    }

    // Child → parent: parent's input becomes scope input
    if (conn.to.node === parentNode.id && childIdSet.has(conn.from.node)) {
      const portName = conn.to.port;
      if (!scopedInputDefs[portName]) {
        const parentDef = parentNt.inputs[portName];
        if (parentDef) {
          scopedInputDefs[portName] = { ...parentDef, scope: scopeName };
        } else {
          // Implicit scoped port — infer type and label from child
          const childInst = ast.instances.find(i => i.id === conn.from.node);
          const childNt = childInst ? nodeTypeMap.get(childInst.nodeType) : undefined;
          const childOutputDef = childNt?.outputs[conn.from.port];
          scopedInputDefs[portName] = {
            dataType: childOutputDef?.dataType ?? 'ANY',
            scope: scopeName,
            label: childOutputDef?.label ?? portName,
          };
        }
      }
    }
  }

  // Add mandatory STEP scope ports for non-expression scoped nodes.
  // Use scoped port names (start/success/failure) so assignImplicitPortOrders gives them priority.
  if (!parentNt.expression) {
    if (!scopedOutputDefs[SCOPED_PORT_NAMES.START]) {
      scopedOutputDefs[SCOPED_PORT_NAMES.START] = { dataType: 'STEP', scope: scopeName, label: 'Execute' };
    }
    if (!scopedInputDefs[SCOPED_PORT_NAMES.SUCCESS]) {
      scopedInputDefs[SCOPED_PORT_NAMES.SUCCESS] = { dataType: 'STEP', isControlFlow: true, scope: scopeName, label: 'On Success' };
    }
    if (!scopedInputDefs[SCOPED_PORT_NAMES.FAILURE]) {
      scopedInputDefs[SCOPED_PORT_NAMES.FAILURE] = { dataType: 'STEP', isControlFlow: true, scope: scopeName, failure: true, label: 'On Failure' };
    }
  }

  // Remove scope-derived ports from parent's external port lists
  // (they should only appear on inner edges, not outer edges)
  parentNode.outputs = parentNode.outputs.filter(p => !scopedOutputDefs[p.name]);
  parentNode.inputs = parentNode.inputs.filter(p => !scopedInputDefs[p.name]);

  const scopeOutputPorts = orderedPorts(scopedOutputDefs, 'OUTPUT');
  const scopeInputPorts = orderedPorts(scopedInputDefs, 'INPUT');

  // Build child nodes
  const children: DiagramNode[] = [];
  const childNodeMap = new Map<string, DiagramNode>();

  for (const childId of childIds) {
    const childInst = ast.instances.find(i => i.id === childId);
    if (!childInst) continue;

    const childNode = buildInstanceNode(childId, childInst.nodeType, childInst.config, nodeTypeMap, theme);
    computeNodeDimensions(childNode);
    children.push(childNode);
    childNodeMap.set(childId, childNode);
  }

  if (children.length === 0) return;

  // Layout children left-to-right in local coordinates
  let childX = 0;
  const maxChildHeight = Math.max(...children.map(c => c.height + LABEL_HEIGHT + LABEL_GAP));

  for (const child of children) {
    child.x = childX;
    child.y = LABEL_HEIGHT + LABEL_GAP + (maxChildHeight - LABEL_HEIGHT - LABEL_GAP - child.height) / 2;
    childX += child.width + SCOPE_INNER_GAP_X;
  }

  const childrenWidth = childX > 0 ? childX - SCOPE_INNER_GAP_X : 0;
  const childrenHeight = maxChildHeight;

  // Compute scope port column heights
  const scopeOutPortsHeight = portsColumnHeight(scopeOutputPorts.length);
  const scopeInPortsHeight = portsColumnHeight(scopeInputPorts.length);

  // Use persisted UI dimensions if available, otherwise compute from children
  const parentUI = ast.ui?.instances?.find(u => u.name === parentNode.id);
  const uiWidth = parentUI?.expandedWidth ?? parentUI?.width;
  const uiHeight = parentUI?.expandedHeight ?? parentUI?.height;

  // Minimum inner width so opposing scope port labels don't collide
  const maxLeftLabelExtent = scopeOutputPorts.length > 0
    ? Math.max(...scopeOutputPorts.map(portLabelExtent))
    : 0;
  const maxRightLabelExtent = scopeInputPorts.length > 0
    ? Math.max(...scopeInputPorts.map(portLabelExtent))
    : 0;
  const minInnerWidth = maxLeftLabelExtent + LABEL_CLEARANCE + maxRightLabelExtent;

  const contentWidth = Math.max(childrenWidth, minInnerWidth);
  const computedWidth = SCOPE_PORT_COLUMN + SCOPE_PADDING_X + contentWidth + SCOPE_PADDING_X + SCOPE_PORT_COLUMN;
  const computedHeight = SCOPE_PADDING_Y * 2 + Math.max(childrenHeight, scopeOutPortsHeight, scopeInPortsHeight);

  parentNode.width = Math.max(parentNode.width, uiWidth ?? computedWidth);
  parentNode.height = Math.max(parentNode.height, uiHeight ?? computedHeight);

  // Store scope data (children positions are in local coordinates, will be offset later)
  parentNode.scopeChildren = children;
  parentNode.scopePorts = { inputs: scopeInputPorts, outputs: scopeOutputPorts };
  parentNode.scopeConnections = []; // populated after positioning
}

/** Position scope children and ports relative to the parent's final position */
function finalizeScopePositions(
  parentNode: DiagramNode,
  ast: TWorkflowAST,
  theme: 'dark' | 'light' = 'dark',
): void {
  const children = parentNode.scopeChildren;
  const scopePorts = parentNode.scopePorts;
  if (!children || children.length === 0 || !scopePorts) return;

  // Scope inner area (between the two port columns)
  const innerLeft = parentNode.x + SCOPE_PORT_COLUMN + SCOPE_PADDING_X;
  const innerRight = parentNode.x + parentNode.width - SCOPE_PORT_COLUMN - SCOPE_PADDING_X;
  const innerWidth = innerRight - innerLeft;

  // Compute children block width from local coordinates
  const lastChild = children[children.length - 1];
  const childrenBlockWidth = lastChild.x + lastChild.width;

  // Center children horizontally within the inner area
  const centerOffsetX = innerLeft + (innerWidth - childrenBlockWidth) / 2;
  const scopeOriginY = parentNode.y + SCOPE_PADDING_Y;

  // Offset children to absolute positions
  for (const child of children) {
    child.x += centerOffsetX;
    child.y += scopeOriginY;
    computePortPositions(child);
  }

  // Position scoped output ports on left inner edge
  const leftEdgeX = parentNode.x + SCOPE_PORT_COLUMN;
  positionPortList(scopePorts.outputs, leftEdgeX, parentNode.y, parentNode.height);

  // Position scoped input ports on right inner edge
  const rightEdgeX = parentNode.x + parentNode.width - SCOPE_PORT_COLUMN;
  positionPortList(scopePorts.inputs, rightEdgeX, parentNode.y, parentNode.height);

  // Build scope connections — match by child membership, not scope qualifiers
  const childNodeMap = new Map<string, DiagramNode>();
  for (const child of children) childNodeMap.set(child.id, child);
  const childIdSet = new Set(children.map(c => c.id));

  parentNode.scopeConnections = [];

  for (const conn of ast.connections) {
    const fromIsChild = childIdSet.has(conn.from.node);
    const toIsChild = childIdSet.has(conn.to.node);
    const fromIsParent = conn.from.node === parentNode.id;
    const toIsParent = conn.to.node === parentNode.id;

    // Only process connections that involve at least one scope child
    if (!fromIsChild && !toIsChild) continue;

    // Parent port → child input (scope output feeds child)
    if (fromIsParent && toIsChild) {
      const sourcePort = scopePorts.outputs.find(p => p.name === conn.from.port);
      const targetChild = childNodeMap.get(conn.to.node);
      const targetPort = targetChild?.inputs.find(p => p.name === conn.to.port);
      if (sourcePort && targetPort) {
        parentNode.scopeConnections.push(buildConnection(
          parentNode.id, conn.from.port, conn.to.node, conn.to.port,
          sourcePort, targetPort, theme,
        ));
      }
      continue;
    }

    // Child output → parent port (child feeds scope input)
    if (fromIsChild && toIsParent) {
      const sourceChild = childNodeMap.get(conn.from.node);
      const sourcePort = sourceChild?.outputs.find(p => p.name === conn.from.port);
      const targetPort = scopePorts.inputs.find(p => p.name === conn.to.port);
      if (sourcePort && targetPort) {
        parentNode.scopeConnections.push(buildConnection(
          conn.from.node, conn.from.port, parentNode.id, conn.to.port,
          sourcePort, targetPort, theme,
        ));
      }
      continue;
    }

    // Child → child within scope
    if (fromIsChild && toIsChild) {
      const sourceChild = childNodeMap.get(conn.from.node);
      const targetChild = childNodeMap.get(conn.to.node);
      if (sourceChild && targetChild) {
        const sourcePort = sourceChild.outputs.find(p => p.name === conn.from.port);
        const targetPort = targetChild.inputs.find(p => p.name === conn.to.port);
        if (sourcePort && targetPort) {
          parentNode.scopeConnections.push(buildConnection(
            conn.from.node, conn.from.port, conn.to.node, conn.to.port,
            sourcePort, targetPort, theme,
          ));
        }
      }
      continue;
    }

    // Cross-scope: child → external or external → child
    // These are handled in the main connection loop (which looks up scope children)
  }

  // Auto-connect mandatory STEP scope ports that have no explicit connections.
  // scope.execute → first child's execute, last child's onSuccess/onFailure → scope inputs.
  if (children.length > 0) {
    const connectedScopePorts = new Set(
      parentNode.scopeConnections.map(c =>
        c.fromNode === parentNode.id ? `out:${c.fromPort}` : `in:${c.toPort}`
      ).filter(k => k.startsWith('out:') || k.startsWith('in:'))
    );

    const firstChild = children[0];
    const lastChild = children[children.length - 1];

    // scope.start → first child.execute (scoped port uses "start", child uses "execute")
    const execScopePort = scopePorts.outputs.find(p => isScopedStartPort(p.name));
    const execChildPort = firstChild.inputs.find(p => isExecutePort(p.name));
    if (execScopePort && execChildPort && !connectedScopePorts.has(`out:${execScopePort.name}`)) {
      parentNode.scopeConnections.push(buildConnection(
        parentNode.id, execScopePort.name, firstChild.id, execChildPort.name,
        execScopePort, execChildPort, theme,
      ));
    }

    // last child.onSuccess → scope.success (child uses "onSuccess", scoped port uses "success")
    const successScopePort = scopePorts.inputs.find(p => isScopedSuccessPort(p.name));
    const successChildPort = lastChild.outputs.find(p => isSuccessPort(p.name));
    if (successScopePort && successChildPort && !connectedScopePorts.has(`in:${successScopePort.name}`)) {
      parentNode.scopeConnections.push(buildConnection(
        lastChild.id, successChildPort.name, parentNode.id, successScopePort.name,
        successChildPort, successScopePort, theme,
      ));
    }

    // last child.onFailure → scope.failure (child uses "onFailure", scoped port uses "failure")
    const failureScopePort = scopePorts.inputs.find(p => isScopedFailurePort(p.name));
    const failureChildPort = lastChild.outputs.find(p => isFailurePort(p.name));
    if (failureScopePort && failureChildPort && !connectedScopePorts.has(`in:${failureScopePort.name}`)) {
      parentNode.scopeConnections.push(buildConnection(
        lastChild.id, failureChildPort.name, parentNode.id, failureScopePort.name,
        failureChildPort, failureScopePort, theme,
      ));
    }
  }
}

function buildConnection(
  fromNode: string, fromPort: string, toNode: string, toPort: string,
  sourcePort: DiagramPort, targetPort: DiagramPort,
  theme: 'dark' | 'light' = 'dark',
): DiagramConnection {
  const sourceColor = getPortColor(sourcePort.dataType, sourcePort.isFailure, theme);
  const targetColor = getPortColor(targetPort.dataType, targetPort.isFailure, theme);
  const path = computeConnectionPath(sourcePort.cx, sourcePort.cy, targetPort.cx, targetPort.cy);
  return {
    fromNode, fromPort, toNode, toPort,
    sourceColor, targetColor,
    isStepConnection: sourcePort.dataType === 'STEP',
    path,
  };
}

function portsColumnHeight(count: number): number {
  if (count === 0) return 0;
  return PORT_PADDING_Y + count * PORT_SIZE + (count - 1) * PORT_GAP + PORT_PADDING_Y;
}

// ---- Position extraction ----

/**
 * Extract explicit positions from AST metadata.
 * Returns a map of node ID → {x, y} for nodes that have both x and y defined.
 * Sources: ast.ui.startNode, ast.ui.exitNode, instance.config.x/y
 */
function extractExplicitPositions(ast: TWorkflowAST): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();

  if (ast.ui?.startNode?.x != null && ast.ui.startNode.y != null) {
    positions.set('Start', { x: ast.ui.startNode.x, y: ast.ui.startNode.y });
  }

  if (ast.ui?.exitNode?.x != null && ast.ui.exitNode.y != null) {
    positions.set('Exit', { x: ast.ui.exitNode.x, y: ast.ui.exitNode.y });
  }

  for (const inst of ast.instances) {
    if (inst.config?.x != null && inst.config.y != null) {
      positions.set(inst.id, { x: inst.config.x, y: inst.config.y });
    }
  }

  return positions;
}

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

/**
 * Assign coordinates to nodes using auto-layout layer assignments.
 * Gap between layers adapts to port label extents so labels never overlap,
 * while using LAYER_GAP_X as the target center-to-center distance.
 */
function adaptiveGapY(layerSize: number): number {
  if (layerSize <= 2) return NODE_GAP_Y;
  return Math.max(24, Math.round(NODE_GAP_Y * 2 / layerSize));
}

function assignLayerCoordinates(
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
 * Hybrid positioning: apply explicit positions to positioned nodes,
 * then auto-layout only the remaining unpositioned nodes.
 */
function assignUnpositionedNodes(
  layers: string[][],
  diagramNodes: Map<string, DiagramNode>,
  explicitPositions: Map<string, { x: number; y: number }>,
): void {
  // Apply explicit positions first
  for (const [id, pos] of explicitPositions) {
    const node = diagramNodes.get(id);
    if (node) {
      node.x = pos.x;
      node.y = pos.y;
    }
  }

  // Auto-layout only unpositioned nodes using the same layer-based algorithm
  const filtered: string[][] = layers.map(l => l.filter(id => diagramNodes.has(id)));

  let currentX = 0;
  for (let i = 0; i < filtered.length; i++) {
    const layerNodes = filtered[i];
    if (layerNodes.length === 0) {
      currentX += LAYER_GAP_X;
      continue;
    }

    const unpositioned = layerNodes.filter(id => !explicitPositions.has(id));
    const maxWidth = Math.max(...layerNodes.map(id => diagramNodes.get(id)!.width));

    if (unpositioned.length > 0) {
      const gapY = adaptiveGapY(unpositioned.length);
      const totalHeight = unpositioned.reduce((sum, id) => {
        const n = diagramNodes.get(id)!;
        return sum + n.height + LABEL_HEIGHT + LABEL_GAP;
      }, 0) + (unpositioned.length - 1) * gapY;

      let currentY = -totalHeight / 2;
      for (const id of unpositioned) {
        const node = diagramNodes.get(id)!;
        currentY += LABEL_HEIGHT + LABEL_GAP;
        node.x = currentX + (maxWidth - node.width) / 2;
        node.y = currentY;
        currentY += node.height + gapY;
      }
    }

    // Label-aware edge gap
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
 * After applying explicit positions, ensure no nodes overlap horizontally.
 * Sorts nodes by x, then pushes any node whose left edge (minus its input
 * label extent) intrudes into the previous node's right edge (plus its
 * output label extent and clearance).
 */
function resolveHorizontalOverlaps(diagramNodes: Map<string, DiagramNode>): void {
  const nodes = [...diagramNodes.values()].sort((a, b) => a.x - b.x);
  for (let i = 1; i < nodes.length; i++) {
    const prev = nodes[i - 1];
    const curr = nodes[i];

    // Only external port labels overhang the node boundary.
    // Scope inner-edge port labels face inward and don't extend past the node box.
    const prevRightExtent = maxPortLabelExtent(prev.outputs);
    const currLeftExtent = maxPortLabelExtent(curr.inputs);

    const minGap = Math.max(prevRightExtent + LABEL_CLEARANCE + currLeftExtent, MIN_EDGE_GAP);
    const actualGap = curr.x - (prev.x + prev.width);

    if (actualGap < minGap) {
      curr.x = prev.x + prev.width + minGap;
    }
  }
}

// ---- Main orchestrator ----

export function buildDiagramGraph(ast: TWorkflowAST, options: DiagramOptions = {}): DiagramGraph {
  const themeName = options.theme ?? 'dark';
  const nodeTypeMap = new Map<string, TNodeTypeAST>();
  for (const nt of ast.nodeTypes) {
    nodeTypeMap.set(nt.name, nt);
    if (nt.functionName && nt.functionName !== nt.name) {
      nodeTypeMap.set(nt.functionName, nt);
    }
  }

  // Track scoped children — from explicit ast.scopes and from scope-qualified connections
  const scopedChildren = new Set<string>();
  const allScopes: Record<string, string[]> = { ...(ast.scopes ?? {}) };

  if (ast.scopes) {
    for (const children of Object.values(ast.scopes)) {
      for (const child of children) scopedChildren.add(child);
    }
  }

  // Infer scopes from per-port scope annotations (connections with :scopeName qualifiers)
  const inferredScopes = new Map<string, Set<string>>();
  for (const conn of ast.connections) {
    if (conn.from.scope) {
      const key = `${conn.from.node}.${conn.from.scope}`;
      if (!inferredScopes.has(key)) inferredScopes.set(key, new Set());
      inferredScopes.get(key)!.add(conn.to.node);
    }
    if (conn.to.scope) {
      const key = `${conn.to.node}.${conn.to.scope}`;
      if (!inferredScopes.has(key)) inferredScopes.set(key, new Set());
      inferredScopes.get(key)!.add(conn.from.node);
    }
  }
  for (const [key, childSet] of inferredScopes) {
    if (!allScopes[key]) {
      allScopes[key] = [...childSet];
      for (const child of childSet) scopedChildren.add(child);
    }
  }

  // Build diagram nodes
  const diagramNodes = new Map<string, DiagramNode>();

  // Start node — ensure mandatory execute STEP port exists
  const allStartPorts: Record<string, TPortDefinition> = { ...ast.startPorts };
  if (!allStartPorts.execute) {
    allStartPorts.execute = { dataType: 'STEP' };
  }
  const startOutputs = orderedPorts(allStartPorts, 'OUTPUT');
  diagramNodes.set('Start', {
    id: 'Start',
    label: 'Start',
    color: '#334155',
    icon: 'startNode',
    isVirtual: true,
    inputs: [],
    outputs: startOutputs,
    x: 0, y: 0,
    width: NODE_MIN_WIDTH,
    height: NODE_MIN_HEIGHT,
  });

  // Exit node — ensure mandatory onSuccess/onFailure STEP ports exist
  const allExitPorts: Record<string, TPortDefinition> = { ...ast.exitPorts };
  if (!allExitPorts.onSuccess) {
    allExitPorts.onSuccess = { dataType: 'STEP', isControlFlow: true };
  }
  if (!allExitPorts.onFailure) {
    allExitPorts.onFailure = { dataType: 'STEP', isControlFlow: true, failure: true };
  } else {
    allExitPorts.onFailure = { ...allExitPorts.onFailure, failure: true };
  }
  const exitInputs = orderedPorts(allExitPorts, 'INPUT');
  diagramNodes.set('Exit', {
    id: 'Exit',
    label: 'Exit',
    color: '#334155',
    icon: 'exitNode',
    isVirtual: true,
    inputs: exitInputs,
    outputs: [],
    x: 0, y: 0,
    width: NODE_MIN_WIDTH,
    height: NODE_MIN_HEIGHT,
  });

  // Instance nodes (skip scoped children — they are built inside their parent)
  for (const inst of ast.instances) {
    if (scopedChildren.has(inst.id)) continue;
    const node = buildInstanceNode(inst.id, inst.nodeType, inst.config, nodeTypeMap, themeName);
    diagramNodes.set(inst.id, node);
  }

  // Compute base dimensions
  for (const node of diagramNodes.values()) {
    computeNodeDimensions(node);
  }

  // Build scope sub-graphs (expands parent dimensions)
  for (const [scopeKey, childIds] of Object.entries(allScopes)) {
    const dotIndex = scopeKey.indexOf('.');
    const parentId = scopeKey.substring(0, dotIndex);
    const scopeName = scopeKey.substring(dotIndex + 1);

    const parentNode = diagramNodes.get(parentId);
    if (!parentNode) continue;

    const parentInst = ast.instances.find(i => i.id === parentId);
    if (!parentInst) continue;
    const parentNt = nodeTypeMap.get(parentInst.nodeType);
    if (!parentNt) continue;

    buildScopeSubGraph(parentNode, parentNt, scopeName, childIds, ast, nodeTypeMap, themeName);
  }

  // Layout — use explicit positions when available, auto-layout otherwise
  const explicitPositions = extractExplicitPositions(ast);
  const allPositioned = [...diagramNodes.keys()].every(id => explicitPositions.has(id));
  const nonePositioned = ![...diagramNodes.keys()].some(id => explicitPositions.has(id));

  if (allPositioned) {
    // All nodes have explicit positions — apply them
    for (const [id, pos] of explicitPositions) {
      const node = diagramNodes.get(id);
      if (node) {
        node.x = pos.x;
        node.y = pos.y;
      }
    }
    // Resolve horizontal overlaps: scope nodes may be wider than the
    // original positions anticipated, so push downstream nodes apart.
    resolveHorizontalOverlaps(diagramNodes);
  } else if (nonePositioned) {
    // No positions — full auto-layout (original behavior)
    const { layers } = layoutWorkflow(ast);
    assignLayerCoordinates(layers, diagramNodes);
  } else {
    // Mixed — explicit positions + auto-layout for remaining nodes
    const { layers } = layoutWorkflow(ast);
    assignUnpositionedNodes(layers, diagramNodes, explicitPositions);
  }

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
  // Collect connection data with port indices for stub spacing
  type PendingConnection = {
    fromNodeId: string; fromPortName: string;
    toNodeId: string; toPortName: string;
    sourcePort: DiagramPort; targetPort: DiagramPort;
    fromPortIndex: number; toPortIndex: number;
  };
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

  // Compute bounds (include scope children and port labels in calculation)
  const nodes = Array.from(diagramNodes.values());
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

  const padding = options.padding ?? 40;
  const offsetX = -minX + padding;
  const offsetY = -minY + padding;

  // Normalize all coordinates
  for (const node of nodes) {
    node.x += offsetX;
    node.y += offsetY;
    for (const p of node.inputs) { p.cx += offsetX; p.cy += offsetY; }
    for (const p of node.outputs) { p.cx += offsetX; p.cy += offsetY; }

    // Offset scope children and scope ports
    if (node.scopeChildren) {
      for (const child of node.scopeChildren) {
        child.x += offsetX;
        child.y += offsetY;
        for (const p of child.inputs) { p.cx += offsetX; p.cy += offsetY; }
        for (const p of child.outputs) { p.cx += offsetX; p.cy += offsetY; }
      }
    }
    if (node.scopePorts) {
      for (const p of node.scopePorts.inputs) { p.cx += offsetX; p.cy += offsetY; }
      for (const p of node.scopePorts.outputs) { p.cx += offsetX; p.cy += offsetY; }
    }
  }

  // Build NodeBox array for orthogonal routing (after coordinate normalization)
  const nodeBoxes: NodeBox[] = nodes.map(node => ({
    id: node.id,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
  }));

  // Sort connections: short spans first, then by source X, then by source Y
  // (matching original editor for deterministic track allocation)
  pendingConnections.sort((a, b) => {
    const aSpan = Math.abs(a.targetPort.cx - a.sourcePort.cx);
    const bSpan = Math.abs(b.targetPort.cx - b.sourcePort.cx);
    if (Math.abs(aSpan - bSpan) > 1) return aSpan - bSpan;
    if (Math.abs(a.sourcePort.cx - b.sourcePort.cx) > 1) return a.sourcePort.cx - b.sourcePort.cx;
    return a.sourcePort.cy - b.sourcePort.cy;
  });

  // Create a single TrackAllocator for deterministic batch routing
  const allocator = new TrackAllocator();

  // Pre-compute routing mode consistency for fan-out and fan-in:
  // When multiple connections share the same source port (fan-out), target
  // port (fan-in), or target node (multi-port fan-in), use the same routing
  // mode for visual consistency. If ANY connection in the group would use
  // curves, force ALL connections in the group to curves.
  const srcPortKey = (pc: PendingConnection) => `srcPort:${pc.fromNodeId}.${pc.fromPortName}`;
  const tgtPortKey = (pc: PendingConnection) => `tgtPort:${pc.toNodeId}.${pc.toPortName}`;
  const tgtNodeKey = (pc: PendingConnection) => `tgtNode:${pc.toNodeId}`;
  const routingGroups = new Map<string, PendingConnection[]>();
  for (const pc of pendingConnections) {
    for (const key of [srcPortKey(pc), tgtPortKey(pc), tgtNodeKey(pc)]) {
      if (!routingGroups.has(key)) routingGroups.set(key, []);
      routingGroups.get(key)!.push(pc);
    }
  }
  const forceCurveKeys = new Set<string>();
  for (const [key, group] of routingGroups) {
    if (group.length < 2) continue;
    const anyShort = group.some(pc => {
      const dx = pc.targetPort.cx - pc.sourcePort.cx;
      const dy = pc.targetPort.cy - pc.sourcePort.cy;
      return Math.sqrt(dx * dx + dy * dy) <= ORTHOGONAL_DISTANCE_THRESHOLD;
    });
    if (anyShort) forceCurveKeys.add(key);
  }
  const forceCurveSet = new Set<PendingConnection>();
  for (const pc of pendingConnections) {
    if (forceCurveKeys.has(srcPortKey(pc)) || forceCurveKeys.has(tgtPortKey(pc)) || forceCurveKeys.has(tgtNodeKey(pc))) {
      forceCurveSet.add(pc);
    }
  }

  // Compute all connection paths with routing mode selection
  const connections: DiagramConnection[] = [];
  for (const pc of pendingConnections) {
    const sx = pc.sourcePort.cx;
    const sy = pc.sourcePort.cy;
    const tx = pc.targetPort.cx;
    const ty = pc.targetPort.cy;

    const dx = tx - sx;
    const dy = ty - sy;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const useCurve = forceCurveSet.has(pc);

    let path: string;
    if (!useCurve && distance > ORTHOGONAL_DISTANCE_THRESHOLD) {
      // Try orthogonal routing for long-distance connections
      const orthoPath = calculateOrthogonalPathSafe(
        [sx, sy], [tx, ty],
        nodeBoxes,
        pc.fromNodeId, pc.toNodeId,
        { fromPortIndex: pc.fromPortIndex, toPortIndex: pc.toPortIndex },
        allocator,
      );
      path = orthoPath ?? computeConnectionPath(sx, sy, tx, ty);
    } else {
      path = computeConnectionPath(sx, sy, tx, ty);
    }

    const sourceColor = getPortColor(pc.sourcePort.dataType, pc.sourcePort.isFailure, themeName);
    const targetColor = getPortColor(pc.targetPort.dataType, pc.targetPort.isFailure, themeName);
    connections.push({
      fromNode: pc.fromNodeId, fromPort: pc.fromPortName,
      toNode: pc.toNodeId, toPort: pc.toPortName,
      sourceColor, targetColor,
      isStepConnection: pc.sourcePort.dataType === 'STEP',
      path,
    });
  }

  // Recompute scope connection paths after normalization
  for (const node of nodes) {
    if (node.scopeConnections && node.scopePorts && node.scopeChildren) {
      const childMap = new Map<string, DiagramNode>();
      for (const c of node.scopeChildren) childMap.set(c.id, c);

      for (const conn of node.scopeConnections) {
        const sPort = findScopePort(conn.fromNode, conn.fromPort, node, childMap, 'output');
        const tPort = findScopePort(conn.toNode, conn.toPort, node, childMap, 'input');
        if (sPort && tPort) {
          conn.path = computeConnectionPath(sPort.cx, sPort.cy, tPort.cx, tPort.cy);
        }
      }
    }
  }

  // Extend bounds to include connection paths (routes can go outside node area)
  let originX = 0;
  let originY = 0;
  let normalizedMaxY = (maxY - minY) + padding * 2;
  let normalizedMaxX = (maxX - minX) + padding * 2;
  const allConns = [...connections];
  for (const node of nodes) {
    if (node.scopeConnections) allConns.push(...node.scopeConnections);
  }
  for (const conn of allConns) {
    const extent = pathExtent(conn.path);
    if (extent.maxY + padding > normalizedMaxY) normalizedMaxY = extent.maxY + padding;
    if (extent.maxX + padding > normalizedMaxX) normalizedMaxX = extent.maxX + padding;
    if (extent.minY - padding < originY) originY = extent.minY - padding;
    if (extent.minX - padding < originX) originX = extent.minX - padding;
  }
  // Expand dimensions to cover the shifted origin
  normalizedMaxX -= originX;
  normalizedMaxY -= originY;

  return {
    nodes,
    connections,
    bounds: { width: normalizedMaxX, height: normalizedMaxY, originX, originY },
    workflowName: ast.name,
  };
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

// ---- Helpers ----

/** Find the parent diagram node that contains a scope child */
function findScopeParent(childId: string, diagramNodes: Map<string, DiagramNode>): string | undefined {
  for (const node of diagramNodes.values()) {
    if (node.scopeChildren?.some(c => c.id === childId)) return node.id;
  }
  return undefined;
}

function filterNonScopedPorts(ports: Record<string, TPortDefinition>): Record<string, TPortDefinition> {
  const result: Record<string, TPortDefinition> = {};
  for (const [name, def] of Object.entries(ports)) {
    if (!def.scope) result[name] = def;
  }
  return result;
}

function resolveNodeColor(color?: string, theme: 'dark' | 'light' = 'dark'): string {
  if (!color) return '#334155';
  const variant = NODE_VARIANT_COLORS[color];
  if (variant) return theme === 'dark' ? variant.darkBorder : variant.border;
  return color;
}

/** Auto-detect icon based on node type variant (matching original getNodeIcon logic) */
function resolveDefaultIcon(nt: TNodeTypeAST | undefined): string {
  if (!nt) return 'code';
  if (nt.variant === 'WORKFLOW' || nt.variant === 'IMPORTED_WORKFLOW') return 'flow';
  return 'code';
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

/** Estimate the maximum port label badge extent beyond the node edge */
function maxPortLabelExtent(ports: readonly DiagramPort[]): number {
  if (ports.length === 0) return 0;
  let max = 0;
  for (const port of ports) {
    const abbrev = TYPE_ABBREVIATIONS[port.dataType] ?? port.dataType;
    const badgeTextWidth = measureText(abbrev) + measureText(port.label);
    const badgeWidth = badgeTextWidth + 23; // 7px pad + 4px + 1px divider + 4px + 7px pad
    // PORT_RADIUS + gap(5) + badgeWidth
    max = Math.max(max, PORT_RADIUS + 5 + badgeWidth);
  }
  return max;
}
