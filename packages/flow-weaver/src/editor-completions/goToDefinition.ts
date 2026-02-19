/**
 * Editor Completions - Go To Definition
 *
 * Find definition locations for Flow Weaver symbols.
 */

import type { DefinitionLocation, WorkflowContext } from "./types";
import { detectSymbolType } from "./contextParser";

/**
 * Find the definition location for a symbol at the given position.
 *
 * @param lineText - The full text of the current line
 * @param offset - Cursor position within the line (0-based)
 * @param context - Workflow context with nodeTypes and instances
 * @returns Definition location or null if not found
 *
 * @example
 * ```typescript
 * // User Cmd+clicks on "MyAdder" in "@node add1 MyAdder"
 * const location = getDefinitionLocation(
 *   " * @node add1 MyAdder",
 *   18,  // position of 'M' in MyAdder
 *   { nodeTypes: { MyAdder: { filePath: "/src/nodes.ts", line: 42 } } }
 * );
 * // Returns: { type: "nodeType", name: "MyAdder", filePath: "/src/nodes.ts", line: 42 }
 * ```
 */
export function getDefinitionLocation(
  lineText: string,
  offset: number,
  context: WorkflowContext
): DefinitionLocation | null {
  // Detect what kind of symbol this is based on context
  const symbolInfo = detectSymbolType(lineText, offset);
  if (!symbolInfo) {
    return null;
  }

  switch (symbolInfo.type) {
    case "nodeType":
      return findNodeTypeDefinition(symbolInfo.name, context);

    case "nodeId":
      return findNodeDefinition(symbolInfo.name, context);

    case "port":
      return findPortDefinition(symbolInfo.name, symbolInfo.nodeId, context);

    default:
      return null;
  }
}

/**
 * Find definition for a nodeType name.
 */
function findNodeTypeDefinition(
  name: string,
  context: WorkflowContext
): DefinitionLocation | null {
  const nodeType = context.nodeTypes[name];
  if (!nodeType) {
    return null;
  }

  return {
    type: "nodeType",
    name,
    filePath: nodeType.filePath,
    line: nodeType.line,
  };
}

/**
 * Find definition for a node instance ID.
 * This navigates to the @node declaration in the current file.
 */
function findNodeDefinition(
  id: string,
  context: WorkflowContext
): DefinitionLocation | null {
  const instance = context.instances?.find((inst) => inst.id === id);
  if (!instance) {
    return null;
  }

  // For node instances, we return the node type location
  // since instances are defined inline in JSDoc
  const nodeType = context.nodeTypes[instance.nodeType];
  if (nodeType) {
    return {
      type: "node",
      name: id,
      filePath: nodeType.filePath,
      line: nodeType.line,
    };
  }

  return {
    type: "node",
    name: id,
  };
}

/**
 * Find definition for a port on a node.
 */
function findPortDefinition(
  portName: string,
  nodeId: string | undefined,
  context: WorkflowContext
): DefinitionLocation | null {
  if (!nodeId) {
    return null;
  }

  // Find the node instance
  const instance = context.instances?.find((inst) => inst.id === nodeId);
  if (!instance) {
    return null;
  }

  // Find the node type
  const nodeType = context.nodeTypes[instance.nodeType];
  if (!nodeType) {
    return null;
  }

  // Find the port
  const port = nodeType.ports.find((p) => p.name === portName);
  if (!port) {
    return null;
  }

  return {
    type: "port",
    name: portName,
    filePath: nodeType.filePath,
    line: nodeType.line, // Ideally we'd have per-port line numbers
  };
}
