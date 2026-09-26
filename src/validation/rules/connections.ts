/**
 * Connection rules: every `@connect` must name real nodes and real ports, may
 * appear once, and may be the only value flowing into a data input.
 *
 * These run before the type, data-flow and scope rules, which skip any
 * connection whose endpoints do not resolve and rely on the errors here to
 * report it. The cascading-error filter in WorkflowValidator.validate() also
 * drops the UNKNOWN_SOURCE_NODE / UNKNOWN_TARGET_NODE errors raised here when
 * the node's type itself is unknown.
 */

import type { TConnectionAST, TNodeTypeAST, TWorkflowAST } from '../../ast/types';
import { isStartNode, isExitNode, isPseudoNode } from '../../constants';
import { findClosestMatches } from '../../utils/string-distance.js';
import { getConnectionLocation } from '../validator-helpers.js';
import type { ValidationContext } from './context.js';

/** ` Did you mean "<closest>"?`, or an empty string when nothing is close. */
function didYouMean(name: string, candidates: string[]): string {
  const suggestions = findClosestMatches(name, candidates);
  return suggestions.length > 0 ? ` Did you mean "${suggestions[0]}"?` : '';
}

/** The source node must be Start, a pseudo node, or a declared instance. */
function checkSourceNode(ctx: ValidationContext, conn: TConnectionAST, instanceMap: Map<string, TNodeTypeAST>): void {
  const fromNode = conn.from.node;
  if (isStartNode(fromNode) || isPseudoNode(fromNode) || instanceMap.has(fromNode)) return;
  ctx.errors.push({
    type: 'error',
    code: 'UNKNOWN_SOURCE_NODE',
    message: `Connection references unknown source node: "${fromNode}"${didYouMean(fromNode, [...instanceMap.keys()])}`,
    connection: conn,
    location: getConnectionLocation(conn),
  });
}

/** The target node must be Exit or a declared instance. */
function checkTargetNode(ctx: ValidationContext, conn: TConnectionAST, instanceMap: Map<string, TNodeTypeAST>): void {
  const toNode = conn.to.node;
  if (isExitNode(toNode) || instanceMap.has(toNode)) return;
  ctx.errors.push({
    type: 'error',
    code: 'UNKNOWN_TARGET_NODE',
    message: `Connection references unknown target node: "${toNode}"${didYouMean(toNode, [...instanceMap.keys()])}`,
    connection: conn,
    location: getConnectionLocation(conn),
  });
}

/** An instance source port must be one of the node type's outputs. */
function checkSourcePort(ctx: ValidationContext, conn: TConnectionAST, instanceMap: Map<string, TNodeTypeAST>): void {
  const { node: fromNode, port: fromPort } = conn.from;
  const sourceNode = instanceMap.get(fromNode);
  if (!sourceNode || Object.prototype.hasOwnProperty.call(sourceNode.outputs, fromPort)) return;
  ctx.errors.push({
    type: 'error',
    code: 'UNKNOWN_SOURCE_PORT',
    message: `Node "${fromNode}" does not have output port "${fromPort}"${didYouMean(fromPort, Object.keys(sourceNode.outputs))}`,
    node: fromNode,
    connection: conn,
    location: getConnectionLocation(conn),
  });
}

/**
 * A Start port must be a declared workflow `@param`; `execute` is always
 * implicit. With no close match the hint says how to declare the param.
 */
function checkStartPort(ctx: ValidationContext, workflow: TWorkflowAST, conn: TConnectionAST): void {
  const { node: fromNode, port: fromPort } = conn.from;
  const validStartPorts = new Set(['execute', ...Object.keys(workflow.startPorts)]);
  if (validStartPorts.has(fromPort)) return;
  const suggestions = findClosestMatches(fromPort, Array.from(validStartPorts));
  const hint =
    suggestions.length > 0
      ? ` Did you mean "${suggestions[0]}"?`
      : `\nAdd '@param ${fromPort}' to the workflow JSDoc and include it in the params object:\n(execute: boolean, params: { ${fromPort}: type, ... })`;
  ctx.errors.push({
    type: 'error',
    code: 'UNKNOWN_SOURCE_PORT',
    message: `Start node does not have output port "${fromPort}".${hint}`,
    node: fromNode,
    connection: conn,
    location: getConnectionLocation(conn),
  });
}

/** An instance target port must be one of the node type's inputs. */
function checkTargetPort(ctx: ValidationContext, conn: TConnectionAST, instanceMap: Map<string, TNodeTypeAST>): void {
  const { node: toNode, port: toPort } = conn.to;
  const targetNode = instanceMap.get(toNode);
  if (!targetNode || Object.prototype.hasOwnProperty.call(targetNode.inputs, toPort)) return;
  ctx.errors.push({
    type: 'error',
    code: 'UNKNOWN_TARGET_PORT',
    message: `Node "${toNode}" does not have input port "${toPort}"${didYouMean(toPort, Object.keys(targetNode.inputs))}`,
    node: toNode,
    connection: conn,
    location: getConnectionLocation(conn),
  });
}

/** An Exit port must be a declared `@returns`; `onSuccess` and `onFailure` are always implicit. */
function checkExitPort(ctx: ValidationContext, workflow: TWorkflowAST, conn: TConnectionAST): void {
  const { node: toNode, port: toPort } = conn.to;
  const validExitPorts = new Set(['onSuccess', 'onFailure', ...Object.keys(workflow.exitPorts)]);
  if (validExitPorts.has(toPort)) return;
  ctx.errors.push({
    type: 'error',
    code: 'UNKNOWN_TARGET_PORT',
    message: `Exit node does not have input port "${toPort}"${didYouMean(toPort, Array.from(validExitPorts))}`,
    node: toNode,
    connection: conn,
    location: getConnectionLocation(conn),
  });
}

/**
 * Every connection must join known nodes through ports they declare. Per
 * connection the errors come in a fixed order: source node, target node,
 * source port, target port.
 */
export function validateConnections(
  ctx: ValidationContext,
  workflow: TWorkflowAST,
  instanceMap: Map<string, TNodeTypeAST>
): void {
  workflow.connections.forEach((conn) => {
    checkSourceNode(ctx, conn, instanceMap);
    checkTargetNode(ctx, conn, instanceMap);
    if (isStartNode(conn.from.node)) {
      checkStartPort(ctx, workflow, conn);
    } else {
      checkSourcePort(ctx, conn, instanceMap);
    }
    if (isExitNode(conn.to.node)) {
      checkExitPort(ctx, workflow, conn);
    } else {
      checkTargetPort(ctx, conn, instanceMap);
    }
  });
}

/** The same `from.port -> to.port` pair written twice is an error on the second copy. */
export function validateDuplicateConnections(ctx: ValidationContext, workflow: TWorkflowAST): void {
  const seen = new Set<string>();
  for (const conn of workflow.connections) {
    const key = `${conn.from.node}.${conn.from.port}->${conn.to.node}.${conn.to.port}`;
    if (seen.has(key)) {
      ctx.errors.push({
        type: 'error',
        code: 'DUPLICATE_CONNECTION',
        message: `Duplicate connection: ${key}`,
        connection: conn,
        location: getConnectionLocation(conn),
      });
    }
    seen.add(key);
  }
}

/**
 * Validate that no input port has multiple connections.
 * Only one value can be received per input port.
 * (STEP ports can have multiple connections as they're control flow)
 */
export function validateMultipleInputConnections(
  ctx: ValidationContext,
  workflow: TWorkflowAST,
  instanceMap: Map<string, TNodeTypeAST>
): void {
  const inputConnections = new Map<string, typeof workflow.connections>();

  for (const conn of workflow.connections) {
    const targetKey = `${conn.to.node}.${conn.to.port}`;

    // Skip Exit node (handled separately in validateDataFlow)
    if (isExitNode(conn.to.node)) continue;

    // One expression may read several upstream ports; each is a derived
    // connection into the same target, and the expression is the single value
    if (conn.derived) continue;

    // An edge touching a node that is not an instance is already an
    // UNKNOWN_SOURCE_NODE / UNKNOWN_TARGET_NODE error; counting it here would
    // report the same mistake a second time.
    const targetNodeType = instanceMap.get(conn.to.node);
    if (!targetNodeType) continue;
    if (!isStartNode(conn.from.node) && !isPseudoNode(conn.from.node) && !instanceMap.has(conn.from.node)) continue;

    // STEP ports can have multiple connections (control flow)
    const targetPortDef = targetNodeType.inputs[conn.to.port];
    if (targetPortDef?.dataType === 'STEP') continue;
    // Ports with mergeStrategy can have multiple connections (fan-in)
    if (targetPortDef?.mergeStrategy) continue;

    if (!inputConnections.has(targetKey)) {
      inputConnections.set(targetKey, []);
    }
    inputConnections.get(targetKey)!.push(conn);
  }

  for (const [, connections] of inputConnections) {
    if (connections.length > 1) {
      const [firstConn] = connections;
      const sources = connections.map((c) => `${c.from.node}.${c.from.port}`).join(', ');

      ctx.errors.push({
        type: 'error',
        code: 'MULTIPLE_CONNECTIONS_TO_INPUT',
        message: `Input port "${firstConn.to.port}" on node "${firstConn.to.node}" has ${connections.length} connections (${sources}). Only one value can be received.`,
        node: firstConn.to.node,
        connection: firstConn,
        location: getConnectionLocation(firstConn),
      });
    }
  }
}
