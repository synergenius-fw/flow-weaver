/**
 * Which ports a node shows, in what order, and where their dots sit.
 *
 * Decides the port list drawn on a node edge from a set of port definitions:
 * hidden ports and ports that belong to a scope are left off, the rest are
 * ordered by their metadata order (execute, onSuccess and onFailure first),
 * and each dot is placed down the edge at a fixed pitch.
 */
import type { TPortDefinition } from '../../ast/types';
import { assignImplicitPortOrders } from '../../utils/port-ordering';
import type { DiagramNode, DiagramPort } from '../types';
import { PORT_GAP, PORT_PADDING_Y, PORT_SIZE } from './metrics';

/**
 * Get ordered ports from a port definition record using metadata.order.
 * Uses assignImplicitPortOrders to ensure all ports have proper ordering
 * (mandatory ports like execute/onSuccess/onFailure get precedence).
 */
export function orderedPorts(
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

export function filterHiddenPorts(ports: Record<string, TPortDefinition>): Record<string, TPortDefinition> {
  const result: Record<string, TPortDefinition> = {};
  for (const [name, def] of Object.entries(ports)) {
    if (!def.hidden) result[name] = def;
  }
  return result;
}

export function filterNonScopedPorts(ports: Record<string, TPortDefinition>): Record<string, TPortDefinition> {
  const result: Record<string, TPortDefinition> = {};
  for (const [name, def] of Object.entries(ports)) {
    if (!def.scope) result[name] = def;
  }
  return result;
}

/** Place a node's input dots on its left edge and output dots on its right edge. */
export function computePortPositions(node: DiagramNode): void {
  positionPortList(node.inputs, node.x, node.y);
  positionPortList(node.outputs, node.x + node.width, node.y);
}

/** Place a column of port dots at x = `cx`, top-aligned to `nodeY`. */
export function positionPortList(ports: DiagramPort[], cx: number, nodeY: number): void {
  if (ports.length === 0) return;
  // Matches React portPositionCalculator: y = nodeY + paddingTop + i * (size + gap) + size/2
  for (let i = 0; i < ports.length; i++) {
    ports[i].cx = cx;
    ports[i].cy = nodeY + PORT_PADDING_Y + i * (PORT_SIZE + PORT_GAP) + PORT_SIZE / 2;
  }
}
