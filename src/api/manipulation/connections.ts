/**
 * Connection operations for workflow manipulation
 */

import type {
  TWorkflowAST,
  TConnectionAST,
  TPortReference,
} from "../../ast/types";
import {
  withoutValidation,
  validatePortReference,
  portReferencesEqual,
} from "../helpers";

/**
 * Add a connection between two ports
 *
 * @param ast - Workflow to modify
 * @param from - Source port reference (string "node.port" or object)
 * @param to - Target port reference (string "node.port" or object)
 * @returns Modified workflow
 * @throws {Error} If connection already exists
 *
 * @example
 * ```typescript
 * // Using string format
 * const ast = addConnection(workflow, 'Start.input', 'processor.input');
 *
 * // Using object format
 * const ast = addConnection(
 *   workflow,
 *   { node: 'Start', port: 'input' },
 *   { node: 'processor', port: 'input' }
 * );
 * ```
 */
export function addConnection(
  ast: TWorkflowAST,
  from: string | TPortReference,
  to: string | TPortReference,
): TWorkflowAST {
  const fromRef = validatePortReference(from);
  const toRef = validatePortReference(to);

  // Check for duplicate connection
  const exists = ast.connections.some(
    (conn) =>
      portReferencesEqual(conn.from, fromRef) &&
      portReferencesEqual(conn.to, toRef),
  );

  if (exists) {
    throw new Error(
      `Connection already exists: ${fromRef.node}.${fromRef.port} → ${toRef.node}.${toRef.port}`,
    );
  }

  return withoutValidation(
    ast,
    (draft) => {
      draft.connections.push({
        type: "Connection",
        from: fromRef,
        to: toRef,
      });
    },
  );
}

/**
 * Remove a connection.
 * Uses no validation to allow deletion even when workflow has other errors.
 *
 * @param ast - Workflow to modify
 * @param from - Source port reference
 * @param to - Target port reference
 * @returns Modified workflow
 * @throws {Error} If connection doesn't exist
 */
export function removeConnection(
  ast: TWorkflowAST,
  from: string | TPortReference,
  to: string | TPortReference,
): TWorkflowAST {
  const fromRef = validatePortReference(from);
  const toRef = validatePortReference(to);

  // Verify connection exists first
  const connIndex = ast.connections.findIndex(
    (conn) =>
      portReferencesEqual(conn.from, fromRef) &&
      portReferencesEqual(conn.to, toRef),
  );

  if (connIndex === -1) {
    throw new Error(
      `Connection not found: ${fromRef.node}.${fromRef.port} → ${toRef.node}.${toRef.port}`,
    );
  }

  return withoutValidation(
    ast,
    (draft) => {
      const idx = draft.connections.findIndex(
        (conn) =>
          portReferencesEqual(conn.from, fromRef) &&
          portReferencesEqual(conn.to, toRef),
      );
      draft.connections.splice(idx, 1);
    },
  );
}

/**
 * Remove all connections for a node (or specific port).
 * Uses no validation to allow deletion even when workflow has other errors.
 *
 * @param ast - Workflow to modify
 * @param nodeId - Node ID
 * @param portName - Optional port name to filter
 * @returns Modified workflow
 */
export function removeAllConnections(
  ast: TWorkflowAST,
  nodeId: string,
  portName?: string,
): TWorkflowAST {
  return withoutValidation(
    ast,
    (draft) => {
      draft.connections = draft.connections.filter((conn) => {
        const matchesFrom =
          conn.from.node === nodeId &&
          (!portName || conn.from.port === portName);
        const matchesTo =
          conn.to.node === nodeId && (!portName || conn.to.port === portName);

        return !matchesFrom && !matchesTo;
      });
    },
  );
}

/**
 * Reconnect (change target of existing connection).
 * Uses no validation to allow reconnecting even when workflow has other errors.
 *
 * @param ast - Workflow to modify
 * @param from - Source port reference (identifies connection)
 * @param oldTo - Old target port reference
 * @param newTo - New target port reference
 * @returns Modified workflow
 */
export function reconnect(
  ast: TWorkflowAST,
  from: string | TPortReference,
  oldTo: string | TPortReference,
  newTo: string | TPortReference,
): TWorkflowAST {
  const fromRef = validatePortReference(from);
  const oldToRef = validatePortReference(oldTo);
  const newToRef = validatePortReference(newTo);

  // Verify connection exists
  const connExists = ast.connections.find(
    (c) =>
      portReferencesEqual(c.from, fromRef) &&
      portReferencesEqual(c.to, oldToRef),
  );

  if (!connExists) {
    throw new Error(
      `Connection not found: ${fromRef.node}.${fromRef.port} → ${oldToRef.node}.${oldToRef.port}`,
    );
  }

  return withoutValidation(
    ast,
    (draft) => {
      const conn = draft.connections.find(
        (c) =>
          portReferencesEqual(c.from, fromRef) &&
          portReferencesEqual(c.to, oldToRef),
      )!;
      conn.to = newToRef;
    },
  );
}

/**
 * Add multiple connections at once.
 * Uses no validation to allow adding even when workflow has other errors.
 *
 * @param ast - Workflow to modify
 * @param connections - Array of connections to add
 * @returns Modified workflow
 */
export function addConnections(
  ast: TWorkflowAST,
  connections: TConnectionAST[],
): TWorkflowAST {
  return withoutValidation(
    ast,
    (draft) => {
      connections.forEach((conn) => {
        // Check for duplicates
        const exists = draft.connections.some(
          (c) =>
            portReferencesEqual(c.from, conn.from) &&
            portReferencesEqual(c.to, conn.to),
        );

        if (!exists) {
          draft.connections.push(conn);
        }
      });
    },
  );
}

/**
 * Replace all connections for a node.
 * Uses no validation to allow replacing even when workflow has other errors.
 *
 * @param ast - Workflow to modify
 * @param nodeId - Node ID
 * @param connections - New connections
 * @returns Modified workflow
 */
export function replaceConnections(
  ast: TWorkflowAST,
  nodeId: string,
  connections: TConnectionAST[],
): TWorkflowAST {
  return withoutValidation(
    ast,
    (draft) => {
      // Remove existing connections
      draft.connections = draft.connections.filter(
        (conn) => conn.from.node !== nodeId && conn.to.node !== nodeId,
      );

      // Add new connections
      draft.connections.push(...connections);
    },
  );
}
