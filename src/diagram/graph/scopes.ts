/**
 * How a scoped node draws its scope inside its own box.
 *
 * Decides which instances are scope children (from `ast.scopes` and from
 * scope-qualified connections), which of the parent's ports move to the
 * scope's inner edges, how big the parent box grows to hold its children,
 * where the children and inner ports sit once the parent is placed, and the
 * connections drawn inside the scope, including the implicit start, success
 * and failure wiring when none is written.
 */
import type { TNodeTypeAST, TPortDefinition, TWorkflowAST } from '../../ast/types';
import {
  SCOPED_PORT_NAMES, isExecutePort, isFailurePort, isScopedFailurePort,
  isScopedStartPort, isScopedSuccessPort, isSuccessPort,
} from '../../constants';
import { getPortColor } from '../theme';
import type { DiagramConnection, DiagramNode, DiagramPort } from '../types';
import { LABEL_CLEARANCE, LABEL_GAP, LABEL_HEIGHT, portLabelExtent, portsColumnHeight } from './metrics';
import { buildInstanceNode, computeNodeDimensions } from './nodes';
import { computePortPositions, orderedPorts, positionPortList } from './ports';
import { computeConnectionPath } from './routing';

// Scope rendering constants
export const SCOPE_PADDING_X = 140;        // horizontal padding inside scope (between port columns and children)
export const SCOPE_PADDING_Y = 40;         // vertical padding inside scope (top/bottom)
export const SCOPE_PORT_COLUMN = 45;     // matches platform scopeContainerStyle minWidth/maxWidth
export const SCOPE_INNER_GAP_X = 240;    // horizontal gap between children inside scope

/**
 * Every scope, keyed `parentId.scopeName`, and the set of all scope children.
 * Explicit `ast.scopes` come first; scopes implied by per-port scope
 * qualifiers on connections (`:scopeName`) are added when not already listed.
 */
export function collectScopes(ast: TWorkflowAST): {
  allScopes: Record<string, string[]>;
  scopedChildren: Set<string>;
} {
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

  return { allScopes, scopedChildren };
}

/** Build every scope's sub-graph into its parent box, growing the parent to fit. */
export function buildScopeSubGraphs(
  ast: TWorkflowAST,
  diagramNodes: Map<string, DiagramNode>,
  allScopes: Record<string, string[]>,
  nodeTypeMap: Map<string, TNodeTypeAST>,
  theme: 'dark' | 'light',
): void {
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

    buildScopeSubGraph(parentNode, parentNt, scopeName, childIds, ast, nodeTypeMap, theme);
  }
}

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

  for (const childId of childIds) {
    const childInst = ast.instances.find(i => i.id === childId);
    if (!childInst) continue;

    const childNode = buildInstanceNode(childId, childInst.nodeType, childInst.config, nodeTypeMap, theme);
    computeNodeDimensions(childNode);
    if (childInst.config?.width != null) childNode.width = childInst.config.width;
    if (childInst.config?.height != null) childNode.height = childInst.config.height;
    children.push(childNode);
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
export function finalizeScopePositions(
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
  positionPortList(scopePorts.outputs, leftEdgeX, parentNode.y);

  // Position scoped input ports on right inner edge
  const rightEdgeX = parentNode.x + parentNode.width - SCOPE_PORT_COLUMN;
  positionPortList(scopePorts.inputs, rightEdgeX, parentNode.y);

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

/** A scope connection with a straight placeholder path; routing replaces the path later. */
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
