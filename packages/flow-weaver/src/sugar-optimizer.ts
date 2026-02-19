/**
 * Sugar Optimizer - Auto-detect @path routes from connections.
 *
 * Analyzes control-flow connections and identifies routes through the graph
 * that can be expressed as @path macros. @connect is the escape hatch for
 * connections that @path can't cover.
 */

import type {
  TConnectionAST,
  TNodeInstanceAST,
  TNodeTypeAST,
  TWorkflowMacro,
  TPathMacro,
  TPortDefinition,
} from './ast/types';
import { isControlFlowPort } from './constants';

export interface DetectedSugar {
  paths: TPathMacro[];
}

// =============================================================================
// Path Validation (for stale macro detection during round-trip)
// =============================================================================

/**
 * Validate that a @path macro's control-flow connections still exist
 * in the actual connection set. Also checks that all step nodes exist
 * as instances (or are Start/Exit).
 *
 * Returns true if the path is still valid, false if it should be dropped.
 */
export function validatePathMacro(
  path: TPathMacro,
  connections: TConnectionAST[],
  instances: TNodeInstanceAST[],
): boolean {
  const instanceIds = new Set(instances.map(inst => inst.id));

  // Check all step nodes exist as instances (or are Start/Exit)
  for (const step of path.steps) {
    if (step.node === 'Start' || step.node === 'Exit') continue;
    if (!instanceIds.has(step.node)) return false;
  }

  // Build a quick lookup set for unscoped connections
  const connKeys = new Set<string>();
  for (const conn of connections) {
    if (!conn.from.scope && !conn.to.scope) {
      connKeys.add(`${conn.from.node}.${conn.from.port}->${conn.to.node}.${conn.to.port}`);
    }
  }

  // For each consecutive pair, compute expected control-flow connection
  for (let i = 0; i < path.steps.length - 1; i++) {
    const current = path.steps[i];
    const next = path.steps[i + 1];
    const route = current.route || 'ok';

    let expectedKey: string;

    if (current.node === 'Start') {
      expectedKey = `Start.execute->${next.node}.execute`;
    } else if (next.node === 'Exit') {
      if (route === 'fail') {
        expectedKey = `${current.node}.onFailure->Exit.onFailure`;
      } else {
        expectedKey = `${current.node}.onSuccess->Exit.onSuccess`;
      }
    } else {
      if (route === 'fail') {
        expectedKey = `${current.node}.onFailure->${next.node}.execute`;
      } else {
        expectedKey = `${current.node}.onSuccess->${next.node}.execute`;
      }
    }

    if (!connKeys.has(expectedKey)) {
      return false;
    }
  }

  return true;
}

/**
 * Filter existing macros, removing any @path macros whose control-flow
 * connections no longer exist in the connection set.
 * Non-path macros are passed through unchanged.
 */
export function filterStaleMacros(
  macros: TWorkflowMacro[],
  connections: TConnectionAST[],
  instances: TNodeInstanceAST[],
): TWorkflowMacro[] {
  return macros.filter(macro => {
    if (macro.type !== 'path') return true;
    return validatePathMacro(macro, connections, instances);
  });
}

// =============================================================================
// Path Detection (auto-detect @path routes from connections)
// =============================================================================

type PathStep = { node: string; route?: 'ok' | 'fail' };

/**
 * Detect @path routes from a set of connections.
 *
 * Algorithm:
 * 1. Build control-flow adjacency from unscoped connections
 * 2. DFS from Start to enumerate all Start-to-Exit routes
 * 3. Validate data connections for each candidate (scope walking safety)
 * 4. Greedy route selection to cover all control-flow edges
 */
export function detectSugarPatterns(
  connections: TConnectionAST[],
  instances: TNodeInstanceAST[],
  existingMacros: TWorkflowMacro[],
  nodeTypes: TNodeTypeAST[],
  startPorts: Record<string, TPortDefinition>,
  exitPorts: Record<string, TPortDefinition>,
): DetectedSugar {
  const coveredByExistingMacro = buildExistingMacroCoverage(existingMacros);

  // Filter out scoped connections — never optimize those
  const unscopedConns = connections.filter((c) => !c.from.scope && !c.to.scope);

  // Build lookup helpers
  const instanceMap = new Map(instances.map((inst) => [inst.id, inst]));
  const nodeTypeMap = new Map<string, TNodeTypeAST>();
  for (const nt of nodeTypes) {
    nodeTypeMap.set(nt.name, nt);
    if (nt.functionName !== nt.name) {
      nodeTypeMap.set(nt.functionName, nt);
    }
  }

  const getNodeType = (nodeId: string): TNodeTypeAST | undefined => {
    const inst = instanceMap.get(nodeId);
    if (!inst) return undefined;
    return nodeTypeMap.get(inst.nodeType);
  };

  const getOutputPorts = (nodeId: string): Record<string, TPortDefinition> => {
    if (nodeId === 'Start') return startPorts;
    const nt = getNodeType(nodeId);
    return nt?.outputs || {};
  };

  const getInputPorts = (nodeId: string): Record<string, TPortDefinition> => {
    if (nodeId === 'Exit') return exitPorts;
    const nt = getNodeType(nodeId);
    return nt?.inputs || {};
  };

  // ---- Step 1: Build control-flow adjacency ----
  // adj[node] = { ok?: targetNode, fail?: targetNode }
  // Only single-target edges are pathable (multi-target needs @connect)
  const adj = new Map<string, { ok?: string; fail?: string }>();
  const multiTargetPorts = new Set<string>(); // "node.port" keys with multiple targets

  for (const conn of unscopedConns) {
    const { from, to } = conn;
    let edgeNode: string | undefined;
    let edgeRoute: 'ok' | 'fail' | undefined;

    // Start.execute -> X.execute
    if (from.node === 'Start' && from.port === 'execute' && to.port === 'execute') {
      edgeNode = 'Start';
      edgeRoute = 'ok';
    }
    // X.onSuccess -> Exit.onSuccess
    else if (to.node === 'Exit' && from.port === 'onSuccess' && to.port === 'onSuccess') {
      edgeNode = from.node;
      edgeRoute = 'ok';
    }
    // X.onFailure -> Exit.onFailure
    else if (to.node === 'Exit' && from.port === 'onFailure' && to.port === 'onFailure') {
      edgeNode = from.node;
      edgeRoute = 'fail';
    }
    // X.onSuccess -> Y.execute
    else if (from.port === 'onSuccess' && to.port === 'execute') {
      edgeNode = from.node;
      edgeRoute = 'ok';
    }
    // X.onFailure -> Y.execute
    else if (from.port === 'onFailure' && to.port === 'execute') {
      edgeNode = from.node;
      edgeRoute = 'fail';
    }

    if (edgeNode === undefined || edgeRoute === undefined) continue;

    const portKey = `${edgeNode}.${edgeRoute}`;
    if (!adj.has(edgeNode)) {
      adj.set(edgeNode, {});
    }
    const entry = adj.get(edgeNode)!;

    if (entry[edgeRoute] !== undefined && entry[edgeRoute] !== to.node) {
      // Multiple targets for same port — not pathable
      multiTargetPorts.add(portKey);
      delete entry[edgeRoute];
    } else if (!multiTargetPorts.has(portKey)) {
      entry[edgeRoute] = to.node;
    }
  }

  // ---- Step 2: DFS to enumerate Start-to-Exit routes ----
  const candidateRoutes: PathStep[][] = [];
  const MAX_ROUTES = 20; // Sanity limit for complex graphs

  function dfs(node: string, path: PathStep[], visited: Set<string>) {
    if (candidateRoutes.length >= MAX_ROUTES) return;

    if (node === 'Exit') {
      path.push({ node: 'Exit' });
      candidateRoutes.push([...path]);
      path.pop();
      return;
    }

    if (visited.has(node)) return; // Cycle protection
    visited.add(node);

    const edges = adj.get(node);
    if (!edges) {
      visited.delete(node);
      return;
    }

    // Try ok edge
    if (edges.ok && !coveredByExistingMacro.has(edges.ok === 'Exit' ? '' : edges.ok)) {
      const step: PathStep = node === 'Start' ? { node: 'Start' } : { node };
      path.push(step);
      dfs(edges.ok, path, visited);
      path.pop();
    }

    // Try fail edge
    if (edges.fail && !coveredByExistingMacro.has(edges.fail === 'Exit' ? '' : edges.fail)) {
      const step: PathStep = { node, route: 'fail' };
      path.push(step);
      dfs(edges.fail, path, visited);
      path.pop();
    }

    visited.delete(node);
  }

  // Only start DFS if Start is not covered by existing macros
  if (!coveredByExistingMacro.has('Start')) {
    dfs('Start', [], new Set());
  }

  // ---- Step 3: Validate data connections for each candidate ----
  // Simulate scope walking and verify expected data connections exist
  const connKeySet = new Set<string>();
  for (const conn of unscopedConns) {
    connKeySet.add(`${conn.from.node}.${conn.from.port}->${conn.to.node}.${conn.to.port}`);
  }

  const validRoutes = candidateRoutes.filter(route => {
    // Path needs at least 2 steps
    if (route.length < 2) return false;

    // Simulate scope walking for data ports
    for (let i = 0; i < route.length - 1; i++) {
      const nextId = route[i + 1].node;
      if (nextId === 'Exit') continue;

      const nextInputs = getInputPorts(nextId);
      for (const [inputName] of Object.entries(nextInputs)) {
        if (isControlFlowPort(inputName)) continue;

        // Walk backward through route steps to find nearest ancestor with same-name output
        for (let j = i; j >= 0; j--) {
          const ancestorId = route[j].node;
          const ancestorOutputs = getOutputPorts(ancestorId);
          if (inputName in ancestorOutputs && !isControlFlowPort(inputName)) {
            // Scope walking would create this connection — verify it exists
            const key = `${ancestorId}.${inputName}->${nextId}.${inputName}`;
            if (!connKeySet.has(key)) {
              return false; // Path would create a connection that doesn't exist
            }
            break;
          }
        }
      }
    }

    return true;
  });

  // ---- Step 4: Greedy route selection (cover all control-flow edges) ----
  // Build set of all control-flow edges
  type CFEdge = string; // "fromNode.fromPort->toNode.toPort"
  const allCFEdges = new Set<CFEdge>();
  for (const conn of unscopedConns) {
    if (isControlFlowPort(conn.from.port) || conn.from.port === 'execute') {
      if (isControlFlowPort(conn.to.port) || conn.to.port === 'execute') {
        // Only include edges that are pathable (single target)
        const portKey = conn.from.node === 'Start' ? 'Start.ok'
          : conn.from.port === 'onSuccess' ? `${conn.from.node}.ok`
          : conn.from.port === 'onFailure' ? `${conn.from.node}.fail`
          : null;
        if (portKey && !multiTargetPorts.has(portKey)) {
          allCFEdges.add(`${conn.from.node}.${conn.from.port}->${conn.to.node}.${conn.to.port}`);
        }
      }
    }
  }

  // Remove edges already covered by existing macros
  for (const macro of existingMacros) {
    if (macro.type === 'path') {
      for (let i = 0; i < macro.steps.length - 1; i++) {
        const current = macro.steps[i];
        const next = macro.steps[i + 1];
        const route = current.route || 'ok';
        let key: string;
        if (current.node === 'Start') {
          key = `Start.execute->${next.node}.execute`;
        } else if (next.node === 'Exit') {
          const fromPort = route === 'fail' ? 'onFailure' : 'onSuccess';
          const toPort = route === 'fail' ? 'onFailure' : 'onSuccess';
          key = `${current.node}.${fromPort}->Exit.${toPort}`;
        } else {
          const fromPort = route === 'fail' ? 'onFailure' : 'onSuccess';
          key = `${current.node}.${fromPort}->${next.node}.execute`;
        }
        allCFEdges.delete(key);
      }
    }
  }

  // Compute edges covered by each candidate route
  function getRouteEdges(route: PathStep[]): CFEdge[] {
    const edges: CFEdge[] = [];
    for (let i = 0; i < route.length - 1; i++) {
      const current = route[i];
      const next = route[i + 1];
      const routeVal = current.route || 'ok';
      let key: string;
      if (current.node === 'Start') {
        key = `Start.execute->${next.node}.execute`;
      } else if (next.node === 'Exit') {
        const fromPort = routeVal === 'fail' ? 'onFailure' : 'onSuccess';
        const toPort = routeVal === 'fail' ? 'onFailure' : 'onSuccess';
        key = `${current.node}.${fromPort}->Exit.${toPort}`;
      } else {
        const fromPort = routeVal === 'fail' ? 'onFailure' : 'onSuccess';
        key = `${current.node}.${fromPort}->${next.node}.execute`;
      }
      edges.push(key);
    }
    return edges;
  }

  // Sort by length (longest first) for greedy selection
  const sortedRoutes = [...validRoutes].sort((a, b) => b.length - a.length);
  const selectedPaths: TPathMacro[] = [];
  const coveredEdges = new Set<CFEdge>();

  for (const route of sortedRoutes) {
    const routeEdges = getRouteEdges(route);
    const newEdges = routeEdges.filter(e => allCFEdges.has(e) && !coveredEdges.has(e));

    if (newEdges.length > 0) {
      selectedPaths.push({
        type: 'path',
        steps: route.map(s => s.route ? { node: s.node, route: s.route } : { node: s.node }),
      });
      for (const e of routeEdges) {
        coveredEdges.add(e);
      }
    }
  }

  return { paths: selectedPaths };
}

/**
 * Check if a connection is covered by detected sugar and should be omitted from @connect output.
 */
export function isConnectionCoveredBySugar(
  conn: TConnectionAST,
  sugar: DetectedSugar,
): boolean {
  // Scoped connections are never covered
  if (conn.from.scope || conn.to.scope) return false;

  for (const path of sugar.paths) {
    const steps = path.steps;
    const fromIdx = steps.findIndex(s => s.node === conn.from.node);
    const toIdx = steps.findIndex(s => s.node === conn.to.node);
    if (fromIdx === -1 || toIdx === -1 || fromIdx >= toIdx) continue;

    // Control flow: check consecutive pairs
    if (toIdx === fromIdx + 1) {
      const route = steps[fromIdx].route || 'ok';
      // Start.execute -> next.execute
      if (conn.from.node === 'Start' && conn.from.port === 'execute' && conn.to.port === 'execute') return true;
      // To Exit: route determines which Exit port
      if (conn.to.node === 'Exit') {
        if (route === 'fail' && conn.from.port === 'onFailure' && conn.to.port === 'onFailure') return true;
        if (route === 'ok' && conn.from.port === 'onSuccess' && conn.to.port === 'onSuccess') return true;
      }
      // Normal: onSuccess/onFailure -> execute
      if (route === 'fail' && conn.from.port === 'onFailure' && conn.to.port === 'execute') return true;
      if (route === 'ok' && conn.from.port === 'onSuccess' && conn.to.port === 'execute') return true;
    }

    // Data: same-name non-control-flow, from before to, to is not Exit
    if (
      conn.to.node !== 'Exit' &&
      !isControlFlowPort(conn.from.port) &&
      !isControlFlowPort(conn.to.port) &&
      conn.from.port === conn.to.port
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Build a set of node IDs that are already covered by user-written macros.
 * These nodes should not be included in auto-detected patterns.
 */
function buildExistingMacroCoverage(macros: TWorkflowMacro[]): Set<string> {
  const covered = new Set<string>();
  for (const macro of macros) {
    if (macro.type === 'map') {
      covered.add(macro.instanceId);
      covered.add(macro.childId);
    } else if (macro.type === 'path') {
      for (const step of macro.steps) {
        covered.add(step.node);
      }
    }
  }
  return covered;
}
