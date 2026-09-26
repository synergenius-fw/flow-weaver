/**
 * Data flow: values that are produced but go nowhere, and workflow outputs
 * that nothing produces or that several producers race for.
 *
 * Checks, in order:
 * - unused output ports: data a node produces that no connection reads
 * - unreachable Exit ports: a declared return value with no incoming connection
 * - multiple connections into one Exit data port, unless the sources sit on
 *   opposite branches (onSuccess / onFailure) of the same branching node, so
 *   at most one of them runs
 * - `@http` route `:params` that name no workflow parameter
 */

import type { TConnectionAST, TNodeTypeAST, TWorkflowAST } from '../../ast/types';
import { isExitNode } from '../../constants';
import { getInstanceLocation, areMutuallyExclusive } from '../validator-helpers.js';
import type { ValidationContext } from './context.js';

/**
 * A data output no connection reads is discarded. Control-flow, failure and
 * scoped outputs are exempt: scoped outputs flow through the scope function.
 */
function warnUnusedOutputPorts(ctx: ValidationContext, workflow: TWorkflowAST, instanceMap: Map<string, TNodeTypeAST>): void {
  const connectedOutputPorts = new Set<string>();
  workflow.connections.forEach((conn) => {
    connectedOutputPorts.add(`${conn.from.node}.${conn.from.port}`);
  });

  instanceMap.forEach((nodeType, instanceId) => {
    Object.keys(nodeType.outputs).forEach((portName) => {
      const portDef = nodeType.outputs[portName];
      if (portDef.isControlFlow || portDef.failure) return;
      if (portDef.scope) return;
      if (connectedOutputPorts.has(`${instanceId}.${portName}`)) return;
      ctx.warnings.push({
        type: 'warning',
        code: 'UNUSED_OUTPUT_PORT',
        message: `Output port "${portName}" of node "${instanceId}" is never connected. Data will be discarded.`,
        node: instanceId,
        location: getInstanceLocation(workflow, instanceId),
      });
    });
  });
}

/** The connections into each Exit port, keyed by port name, in connection order. */
function groupExitConnections(workflow: TWorkflowAST): Map<string, TConnectionAST[]> {
  const exitPortConnections = new Map<string, TConnectionAST[]>();
  workflow.connections.forEach((conn) => {
    if (isExitNode(conn.to.node)) {
      const port = conn.to.port;
      if (!exitPortConnections.has(port)) {
        exitPortConnections.set(port, []);
      }
      exitPortConnections.get(port)!.push(conn);
    }
  });
  return exitPortConnections;
}

/** A declared data return value with no incoming connection is always undefined. */
function warnUnreachableExitPorts(
  ctx: ValidationContext,
  workflow: TWorkflowAST,
  exitPortConnections: Map<string, TConnectionAST[]>
): void {
  Object.entries(workflow.exitPorts).forEach(([portName, portDef]) => {
    if (portDef.isControlFlow) return;
    if (exitPortConnections.has(portName)) return;
    ctx.warnings.push({
      type: 'warning',
      code: 'UNREACHABLE_EXIT_PORT',
      message: `Exit port "${portName}" has no incoming connection. Return value will be undefined.`,
    });
  });
}

/**
 * Several values into one Exit data port means only one is returned. STEP
 * ports are exempt (several terminal nodes converging on Exit.onSuccess is the
 * normal pattern), and so are sources on mutually exclusive branches.
 */
function warnMultipleExitConnections(
  ctx: ValidationContext,
  workflow: TWorkflowAST,
  instanceMap: Map<string, TNodeTypeAST>,
  exitPortConnections: Map<string, TConnectionAST[]>
): void {
  exitPortConnections.forEach((connections, portName) => {
    if (connections.length <= 1) return;
    const exitPort = workflow.exitPorts[portName];
    if (exitPort?.isControlFlow || exitPort?.dataType === 'STEP') return;
    if (areMutuallyExclusive(connections.map((c) => c.from.node), workflow, instanceMap)) return;
    const sources = connections.map((c) => `${c.from.node}.${c.from.port}`).join(', ');
    ctx.warnings.push({
      type: 'warning',
      code: 'MULTIPLE_EXIT_CONNECTIONS',
      message: `Exit port "${portName}" has ${connections.length} incoming connections (${sources}). Only one value will be used - consider using separate Exit ports.`,
    });
  });
}

/**
 * An @http route's :params bind to workflow params by name; one that names
 * no param would be dropped on the floor at request time.
 */
function checkHttpRouteParams(ctx: ValidationContext, workflow: TWorkflowAST): void {
  const paramNames = new Set(Object.keys(workflow.startPorts).filter((p) => p !== 'execute'));
  for (const route of workflow.options?.http ?? []) {
    for (const seg of route.path.split('/')) {
      if (!seg.startsWith(':')) continue;
      const name = seg.slice(1);
      if (!paramNames.has(name)) {
        ctx.errors.push({
          type: 'error',
          code: 'HTTP_PARAM_UNKNOWN',
          message: `@http ${route.method} ${route.path}: ":${name}" is not a parameter of this workflow${paramNames.size ? ` (parameters: ${[...paramNames].join(', ')})` : ''}.`,
        });
      }
    }
  }
}

/**
 * Validate data flow in the workflow. See the module comment for the checks.
 */
export function validateDataFlow(ctx: ValidationContext, workflow: TWorkflowAST, instanceMap: Map<string, TNodeTypeAST>): void {
  warnUnusedOutputPorts(ctx, workflow, instanceMap);
  const exitPortConnections = groupExitConnections(workflow);
  warnUnreachableExitPorts(ctx, workflow, exitPortConnections);
  warnMultipleExitConnections(ctx, workflow, instanceMap, exitPortConnections);
  checkHttpRouteParams(ctx, workflow);
}
