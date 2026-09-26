/**
 * Connections implied by workflow macros.
 *
 * Decides whether a connection is already expressed by a `@map`, `@path`,
 * `@fanOut` or `@fanIn` macro, in which case the workflow JSDoc must not
 * repeat it as an `@connect` line.
 */

import type { TConnectionAST, TWorkflowMacro } from '../../ast/types';
import { isPathImpliedDataEdge } from '../../parser/path-data-resolution';

/**
 * Check if a connection is covered by a macro (and should not be written as @connect).
 * Handles @map, @path, @fanOut and @fanIn macros.
 */
export function isConnectionCoveredByMacro(conn: TConnectionAST, macros: TWorkflowMacro[]): boolean {
  for (const macro of macros) {
    if (macro.type === 'map') {
      const [sourceNode, sourcePort] = macro.sourcePort.split('.');

      // Scoped connections between the map instance and its child
      if (
        (conn.from.node === macro.instanceId || conn.from.node === macro.childId) &&
        (conn.to.node === macro.instanceId || conn.to.node === macro.childId) &&
        (conn.from.scope === 'iterate' || conn.to.scope === 'iterate')
      ) {
        return true;
      }

      // Upstream connection: source.port -> mapInstance.items
      if (
        conn.from.node === sourceNode &&
        conn.from.port === sourcePort &&
        !conn.from.scope &&
        conn.to.node === macro.instanceId &&
        conn.to.port === 'items' &&
        !conn.to.scope
      ) {
        return true;
      }
    } else if (macro.type === 'path') {
      if (conn.from.scope || conn.to.scope) continue;
      const steps = macro.steps;
      const fromIdx = steps.findIndex(s => s.node === conn.from.node);
      const toIdx = steps.findIndex(s => s.node === conn.to.node);
      if (fromIdx === -1 || toIdx === -1 || fromIdx >= toIdx) continue;

      // Control flow: check consecutive pairs
      if (toIdx === fromIdx + 1) {
        const route = steps[fromIdx].route || 'ok';
        if (conn.from.node === 'Start' && conn.from.port === 'execute' && conn.to.port === 'execute') return true;
        if (conn.to.node === 'Exit') {
          if (route === 'fail' && conn.from.port === 'onFailure' && conn.to.port === 'onFailure') return true;
          if (route === 'ok' && conn.from.port === 'onSuccess' && conn.to.port === 'onSuccess') return true;
        }
        if (route === 'fail' && conn.from.port === 'onFailure' && conn.to.port === 'execute') return true;
        if (route === 'ok' && conn.from.port === 'onSuccess' && conn.to.port === 'execute') return true;
      }
      // Data: the shape a path implies between two of its steps (Exit included)
      if (isPathImpliedDataEdge(conn.from.node, conn.from.port, conn.to.node, conn.to.port)) {
        return true;
      }
    } else if (macro.type === 'fanOut') {
      if (conn.from.scope || conn.to.scope) continue;
      if (conn.from.node === macro.source.node && conn.from.port === macro.source.port) {
        for (const target of macro.targets) {
          const targetPort = target.port ?? macro.source.port;
          if (conn.to.node === target.node && conn.to.port === targetPort) {
            return true;
          }
        }
      }
    } else if (macro.type === 'fanIn') {
      if (conn.from.scope || conn.to.scope) continue;
      if (conn.to.node === macro.target.node && conn.to.port === macro.target.port) {
        for (const source of macro.sources) {
          const sourcePort = source.port ?? macro.target.port;
          if (conn.from.node === source.node && conn.from.port === sourcePort) {
            return true;
          }
        }
      }
    }
  }
  return false;
}
