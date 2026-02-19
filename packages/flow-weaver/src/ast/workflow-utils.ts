import type { TPortDefinition, TWorkflowAST } from "./types";
import {
  RESERVED_PORT_NAMES,
  isStartNode,
  isExitNode,
  isSuccessPort,
  isFailurePort,
} from "../constants";

/**
 * Extracts the input port definitions from the workflow's Start virtual node.
 * Returns the workflow's explicit `startPorts` if defined, otherwise infers them
 * from connections originating at the Start node by matching target node input types.
 * Always includes the reserved EXECUTE control-flow port.
 *
 * @param workflow - The workflow AST to extract start ports from.
 * @returns A record mapping port names to their port definitions.
 */
export function extractStartPorts(
  workflow: TWorkflowAST,
): Record<string, TPortDefinition> {
  if (workflow.startPorts) {
    return workflow.startPorts;
  }
  const startPorts: Record<string, TPortDefinition> = {};
  startPorts[RESERVED_PORT_NAMES.EXECUTE] = {
    dataType: "STEP",
    isControlFlow: true,
  };
  workflow.connections
    .filter((conn) => isStartNode(conn.from.node))
    .forEach((conn) => {
      const portName = conn.from.port;
      const targetNodeType = workflow.nodeTypes.find((n) => n.name === conn.to.node);
      if (targetNodeType?.inputs[conn.to.port]) {
        startPorts[portName] = {
          ...targetNodeType.inputs[conn.to.port],
        };
      } else {
        startPorts[portName] = {
          dataType: "ANY",
        };
      }
    });
  return startPorts;
}

/**
 * Extracts the output port definitions from the workflow's Exit virtual node.
 * Returns the workflow's explicit `exitPorts` if defined, otherwise infers them
 * from connections targeting the Exit node by matching source node output types.
 *
 * @param workflow - The workflow AST to extract exit ports from.
 * @returns A record mapping port names to their port definitions.
 */
export function extractExitPorts(
  workflow: TWorkflowAST,
): Record<string, TPortDefinition> {
  if (workflow.exitPorts) {
    return workflow.exitPorts;
  }
  const exitPorts: Record<string, TPortDefinition> = {};
  workflow.connections
    .filter((conn) => isExitNode(conn.to.node))
    .forEach((conn) => {
      const portName = conn.to.port;
      const sourceNodeType = workflow.nodeTypes.find((n) => n.name === conn.from.node);
      if (sourceNodeType?.outputs[conn.from.port]) {
        exitPorts[portName] = {
          ...sourceNodeType.outputs[conn.from.port],
        };
      } else {
        exitPorts[portName] = {
          dataType: "ANY",
        };
      }
    });
  return exitPorts;
}

/**
 * Finds a node type definition by name within a workflow.
 *
 * @param workflow - The workflow AST to search.
 * @param nodeName - The name of the node type to find.
 * @returns The matching node type, or undefined if not found.
 */
export function getNodeType(workflow: TWorkflowAST, nodeName: string) {
  return workflow.nodeTypes.find((n) => n.name === nodeName);
}

/**
 * Returns all connections originating from the specified node.
 *
 * @param workflow - The workflow AST to search.
 * @param nodeName - The source node name to filter by.
 * @returns An array of connections where `from.node` matches the given name.
 */
export function getConnectionsFrom(workflow: TWorkflowAST, nodeName: string) {
  return workflow.connections.filter((c) => c.from.node === nodeName);
}

/**
 * Returns all connections targeting the specified node.
 *
 * @param workflow - The workflow AST to search.
 * @param nodeName - The target node name to filter by.
 * @returns An array of connections where `to.node` matches the given name.
 */
export function getConnectionsTo(workflow: TWorkflowAST, nodeName: string) {
  return workflow.connections.filter((c) => c.to.node === nodeName);
}

/**
 * Determines whether a workflow contains branching control flow.
 * A workflow has branching if any node type has multiple outgoing success connections
 * or any outgoing failure connections.
 *
 * @param workflow - The workflow AST to inspect.
 * @returns True if the workflow contains branching logic.
 */
export function hasBranching(workflow: TWorkflowAST): boolean {
  return workflow.nodeTypes.some((nodeType) => {
    const successConns = workflow.connections.filter(
      (c) => c.from.node === nodeType.name && isSuccessPort(c.from.port),
    );
    const failureConns = workflow.connections.filter(
      (c) => c.from.node === nodeType.name && isFailurePort(c.from.port),
    );
    return successConns.length > 1 || failureConns.length > 0;
  });
}
