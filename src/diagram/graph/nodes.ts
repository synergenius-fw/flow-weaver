/**
 * What box each node is before it is placed.
 *
 * Decides a node's ports, label, colour, icon and base size: the Start and
 * Exit boxes with their mandatory step ports, instance boxes from their node
 * type (with synthesized step ports, which a pull-style expression node does
 * not get), and the explicit `[size: W H]` override that wins over any
 * computed size.
 */
import type { TNodeTypeAST, TPortDefinition, TWorkflowAST } from '../../ast/types';
import { isExecutePort, isFailurePort, isSuccessPort } from '../../constants';
import { NODE_DEFAULT_COLOR, NODE_VARIANT_COLORS } from '../theme';
import type { DiagramNode } from '../types';
import {
  NODE_MIN_HEIGHT, NODE_MIN_WIDTH, PORT_GAP, PORT_PADDING_Y, PORT_SIZE,
} from './metrics';
import { filterHiddenPorts, filterNonScopedPorts, orderedPorts } from './ports';

/** Node types by name, and also by function name where that differs. */
export function buildNodeTypeMap(ast: TWorkflowAST): Map<string, TNodeTypeAST> {
  const nodeTypeMap = new Map<string, TNodeTypeAST>();
  for (const nt of ast.nodeTypes) {
    nodeTypeMap.set(nt.name, nt);
    if (nt.functionName && nt.functionName !== nt.name) {
      nodeTypeMap.set(nt.functionName, nt);
    }
  }
  return nodeTypeMap;
}

/** Size a node box to fit its taller port column, never below the minimum. */
export function computeNodeDimensions(node: DiagramNode): void {
  const maxPorts = Math.max(node.inputs.length, node.outputs.length);
  // React: paddingTop + n * (PORT_SIZE + PORT_GAP) - PORT_GAP + paddingBottom
  const portsHeight = maxPorts > 0
    ? PORT_PADDING_Y + maxPorts * PORT_SIZE + (maxPorts - 1) * PORT_GAP + PORT_PADDING_Y
    : 0;
  node.width = NODE_MIN_WIDTH;
  node.height = Math.max(NODE_MIN_HEIGHT, portsHeight);
}

/** The Start box: the workflow's start ports, with a mandatory execute STEP port. */
export function buildStartNode(ast: TWorkflowAST): DiagramNode {
  const allStartPorts: Record<string, TPortDefinition> = filterHiddenPorts({ ...ast.startPorts });
  if (!allStartPorts.execute && !ast.startPorts.execute?.hidden) {
    allStartPorts.execute = { dataType: 'STEP' };
  }
  const startOutputs = orderedPorts(allStartPorts, 'OUTPUT');
  return {
    id: 'Start',
    label: 'Start',
    color: NODE_DEFAULT_COLOR,
    icon: 'startNode',
    isVirtual: true,
    inputs: [],
    outputs: startOutputs,
    x: 0, y: 0,
    width: NODE_MIN_WIDTH,
    height: NODE_MIN_HEIGHT,
  };
}

/** The Exit box: the workflow's exit ports, with mandatory onSuccess/onFailure STEP ports. */
export function buildExitNode(ast: TWorkflowAST): DiagramNode {
  const allExitPorts: Record<string, TPortDefinition> = filterHiddenPorts({ ...ast.exitPorts });
  if (!allExitPorts.onSuccess && !ast.exitPorts.onSuccess?.hidden) {
    allExitPorts.onSuccess = { dataType: 'STEP', isControlFlow: true };
  }
  if (!allExitPorts.onFailure && !ast.exitPorts.onFailure?.hidden) {
    allExitPorts.onFailure = { dataType: 'STEP', isControlFlow: true, failure: true };
  } else if (allExitPorts.onFailure) {
    allExitPorts.onFailure = { ...allExitPorts.onFailure, failure: true };
  }
  const exitInputs = orderedPorts(allExitPorts, 'INPUT');
  return {
    id: 'Exit',
    label: 'Exit',
    color: NODE_DEFAULT_COLOR,
    icon: 'exitNode',
    isVirtual: true,
    inputs: exitInputs,
    outputs: [],
    x: 0, y: 0,
    width: NODE_MIN_WIDTH,
    height: NODE_MIN_HEIGHT,
  };
}

/**
 * Which STEP ports (execute/onSuccess/onFailure) each instance actually wires.
 * Used to hide the synthesized step ports on pull-style expression nodes.
 */
export function collectWiredStepPorts(ast: TWorkflowAST): Map<string, Set<string>> {
  const stepPortsUsed = new Map<string, Set<string>>();
  const noteStep = (nodeId: string, port: string) => {
    if (!isExecutePort(port) && !isSuccessPort(port) && !isFailurePort(port)) return;
    let s = stepPortsUsed.get(nodeId);
    if (!s) stepPortsUsed.set(nodeId, (s = new Set()));
    s.add(port);
  };
  for (const conn of ast.connections) {
    noteStep(conn.from.node, conn.from.port);
    noteStep(conn.to.node, conn.to.port);
  }
  return stepPortsUsed;
}

/** Build an instance box (shared by the main graph and scope sub-graphs). */
export function buildInstanceNode(
  instId: string,
  instNodeType: string,
  instConfig: { label?: string; color?: string; icon?: string } | undefined,
  nodeTypeMap: Map<string, TNodeTypeAST>,
  theme: 'dark' | 'light' = 'dark',
  // Step ports (execute/onSuccess/onFailure) this instance actually wires. When
  // an expression node uses none of them, it is running pull-style and its
  // synthesized step ports are noise, so they are hidden rather than drawn as
  // dangling. undefined = draw them all (callers without connection context).
  connectedStepPorts?: Set<string>,
): DiagramNode {
  const nt = nodeTypeMap.get(instNodeType);

  const allInputs: Record<string, TPortDefinition> = nt
    ? filterHiddenPorts(filterNonScopedPorts(nt.inputs))
    : {};
  const allOutputs: Record<string, TPortDefinition> = nt
    ? filterHiddenPorts(filterNonScopedPorts(nt.outputs))
    : {};

  // An expression node with no wired step port is pull-style: drop its
  // vestigial execute/onSuccess/onFailure so the graph shows only real edges.
  const pullStyle =
    !!nt?.expression && connectedStepPorts !== undefined && connectedStepPorts.size === 0;
  if (pullStyle) {
    delete allInputs.execute;
    delete allOutputs.onSuccess;
    delete allOutputs.onFailure;
  }

  if (nt && !nt.expression) {
    if (!allInputs.execute && !nt.inputs.execute?.hidden) allInputs.execute = { dataType: 'STEP' };
  }
  if (!pullStyle && nt && nt.hasSuccessPort && !allOutputs.onSuccess && !nt.outputs.onSuccess?.hidden) {
    allOutputs.onSuccess = { dataType: 'STEP', isControlFlow: true };
  }
  if (!pullStyle && nt && nt.hasFailurePort && !allOutputs.onFailure && !nt.outputs.onFailure?.hidden) {
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

/** Apply explicit [size: W H] annotations to top-level boxes: a hard override, not a floor. */
export function applySizeOverrides(
  ast: TWorkflowAST,
  diagramNodes: Map<string, DiagramNode>,
  scopedChildren: Set<string>,
): void {
  for (const inst of ast.instances) {
    if (scopedChildren.has(inst.id)) continue;
    const node = diagramNodes.get(inst.id);
    if (!node) continue;
    if (inst.config?.width != null) node.width = inst.config.width;
    if (inst.config?.height != null) node.height = inst.config.height;
  }
}

function resolveNodeColor(color?: string, theme: 'dark' | 'light' = 'dark'): string {
  if (!color) return NODE_DEFAULT_COLOR;
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
