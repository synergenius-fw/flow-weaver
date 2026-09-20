/**
 * The one rule for the data edges a `@path` implies.
 *
 * `@path` writes the control flow. For data, each step's non-control input
 * ports resolve by name: walk backward through the path to the nearest
 * ancestor that has a same-name output port, and wire it. This module is the
 * single place that rule lives. The parser uses it to add the edges, the sugar
 * optimizer uses it to check that a path is still consistent with the
 * connection set, and the annotation generators use it to decide which
 * `@connect` lines a `@path` already covers.
 *
 * Exit participates like any other step: a port declared with `@returns`
 * resolves to the nearest ancestor output of the same name. One deliberate
 * exception: a `Start` param never resolves straight to an Exit port. That
 * would echo an input as an output and could hide a missing producer, so a
 * pass-through has to be written as an explicit `@connect`.
 */

import { isControlFlowPort } from '../constants';

export interface PathStepRef {
  node: string;
  route?: string;
}

export interface PathDataEdge {
  from: { node: string; port: string };
  to: { node: string; port: string };
}

export interface PathPortLookup {
  /** Data + control input ports of a step (Exit's are its `@returns` ports). */
  inputs(nodeId: string): Record<string, unknown>;
  /** Data + control output ports of a step (Start's are its `@param` ports). */
  outputs(nodeId: string): Record<string, unknown>;
}

/**
 * Whether a single connection is of the shape a `@path` implies between two of
 * its steps: same port name on both ends, a data port, and not a `Start`
 * param passed straight through to `Exit`.
 */
export function isPathImpliedDataEdge(
  fromNode: string,
  fromPort: string,
  toNode: string,
  toPort: string,
): boolean {
  if (fromPort !== toPort) return false;
  if (isControlFlowPort(fromPort) || isControlFlowPort(toPort)) return false;
  if (toNode === 'Exit' && fromNode === 'Start') return false;
  return true;
}

/**
 * The data edges a path implies, in path order. For each step after the
 * first, every non-control input port is matched against the nearest
 * ancestor with a same-name output. The nearest ancestor decides: when it is
 * `Start` and the step is `Exit`, no edge is implied and no farther ancestor
 * is tried.
 */
export function impliedPathDataEdges(steps: readonly PathStepRef[], ports: PathPortLookup): PathDataEdge[] {
  const edges: PathDataEdge[] = [];
  for (let i = 0; i < steps.length - 1; i++) {
    edges.push(...impliedPathDataEdgesInto(steps, i + 1, ports));
  }
  return edges;
}

/**
 * The data edges implied for one step, `steps[stepIndex]`, from the steps
 * before it. The parser calls this per consecutive pair so that the data
 * edges of a step are added right after its control-flow edge. Connection
 * order is part of a workflow's graph fingerprint and must stay stable.
 */
export function impliedPathDataEdgesInto(
  steps: readonly PathStepRef[],
  stepIndex: number,
  ports: PathPortLookup,
): PathDataEdge[] {
  const edges: PathDataEdge[] = [];
  const nextId = steps[stepIndex].node;
  for (const inputName of Object.keys(ports.inputs(nextId))) {
    if (isControlFlowPort(inputName)) continue;
    for (let j = stepIndex - 1; j >= 0; j--) {
      const ancestorId = steps[j].node;
      if (!(inputName in ports.outputs(ancestorId))) continue;
      if (isPathImpliedDataEdge(ancestorId, inputName, nextId, inputName)) {
        edges.push({ from: { node: ancestorId, port: inputName }, to: { node: nextId, port: inputName } });
      }
      break;
    }
  }
  return edges;
}

/**
 * Whether every edge a path implies is accounted for in a connection set. An
 * implied edge is satisfied when it exists, or when the author wired that
 * target port to something else explicitly (the parser then leaves the port
 * alone, so the path is still consistent).
 */
export function pathDataEdgesSatisfied(
  steps: readonly PathStepRef[],
  ports: PathPortLookup,
  connections: readonly { from: { node: string; port: string }; to: { node: string; port: string } }[],
): boolean {
  const keys = new Set(connections.map((c) => `${c.from.node}.${c.from.port}->${c.to.node}.${c.to.port}`));
  const targets = new Set(connections.map((c) => `${c.to.node}.${c.to.port}`));
  for (const edge of impliedPathDataEdges(steps, ports)) {
    const key = `${edge.from.node}.${edge.from.port}->${edge.to.node}.${edge.to.port}`;
    if (keys.has(key)) continue;
    if (targets.has(`${edge.to.node}.${edge.to.port}`)) continue;
    return false;
  }
  return true;
}
