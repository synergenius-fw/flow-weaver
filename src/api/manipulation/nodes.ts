/**
 * Node instance operations for workflow manipulation
 */

import { produce } from "immer";
import type {
  TWorkflowAST,
  TNodeInstanceAST,
  TNodeInstanceConfig,
} from "../../ast/types";
import {
  withoutValidation,
  type RemoveOptions,
  assertNodeExists,
  assertNodeNotExists,
} from "../helpers";

/**
 * Add a node instance to the workflow
 *
 * @param ast - Workflow to modify
 * @param node - Node instance to add
 * @returns Modified workflow
 * @throws {Error} If node ID already exists or node type doesn't exist
 *
 * @example
 * ```typescript
 * const ast = addNode(workflow, {
 *   type: 'NodeInstance',
 *   id: 'processor1',
 *   nodeType: 'dataProcessor'
 * });
 * ```
 */
export function addNode(
  ast: TWorkflowAST,
  node: TNodeInstanceAST,
): TWorkflowAST {
  // Check for duplicate ID
  assertNodeNotExists(ast, node.id);

  // Note: We don't check if node type exists here (eventual consistency model).
  // Diagnostics will catch INVALID_NODE_TYPE if the type doesn't exist.

  // Use produce directly with simplified type to avoid excessive type instantiation
  return produce(ast, (draft: { instances: TNodeInstanceAST[] }) => {
    draft.instances.push(node);
  }) as TWorkflowAST;
}

/**
 * Remove a node instance from the workflow.
 * Uses minimal validation (only checks node exists) to allow deletion
 * even when the workflow has other validation errors.
 *
 * @param ast - Workflow to modify
 * @param nodeId - ID of node to remove
 * @param options - Remove options
 * @returns Modified workflow
 * @throws {Error} If node doesn't exist
 *
 * @example
 * ```typescript
 * // Remove node and all its connections
 * const ast = removeNode(workflow, 'processor1');
 *
 * // Remove node, keep connections (will fail validation)
 * const ast = removeNode(workflow, 'processor1', { removeConnections: false });
 * ```
 */
export function removeNode(
  ast: TWorkflowAST,
  nodeId: string,
  options: RemoveOptions = {},
): TWorkflowAST {
  const {
    removeConnections = true,
  } = options;

  // First, verify node exists (fail fast with clear error)
  assertNodeExists(ast, nodeId);

  return withoutValidation(
    ast,
    (draft) => {
      // Remove node instance
      const nodeIndex = draft.instances.findIndex((n) => n.id === nodeId);
      draft.instances.splice(nodeIndex, 1);

      // Remove connections if requested
      if (removeConnections) {
        draft.connections = draft.connections.filter(
          (conn) => conn.from.node !== nodeId && conn.to.node !== nodeId,
        );
      }

      // Remove from scopes
      if (draft.scopes) {
        Object.keys(draft.scopes).forEach((scopeName) => {
          draft.scopes![scopeName] = draft.scopes![scopeName].filter(
            (id) => id !== nodeId,
          );
        });
      }

      // Clean up macros referencing the deleted node
      if (draft.macros) {
        draft.macros = draft.macros.filter((macro) => {
          if (macro.type === 'map') {
            return macro.instanceId !== nodeId && macro.childId !== nodeId;
          }
          if (macro.type === 'path') {
            return !macro.steps.some(s => s.node === nodeId);
          }
          if (macro.type === 'fanOut') {
            return macro.source.node !== nodeId && !macro.targets.some(t => t.node === nodeId);
          }
          if (macro.type === 'fanIn') {
            return macro.target.node !== nodeId && !macro.sources.some(s => s.node === nodeId);
          }
          return true;
        });
        if (draft.macros.length === 0) {
          delete draft.macros;
        }
      }
    },
  );
}

/**
 * Rename a node instance (updates all connections)
 *
 * @param ast - Workflow to modify
 * @param oldId - Current node ID
 * @param newId - New node ID
 * @returns Modified workflow
 * @throws {Error} If old ID doesn't exist or new ID already exists
 *
 * @example
 * ```typescript
 * const ast = renameNode(workflow, 'processor1', 'dataProcessor');
 * // All connections updated automatically
 * ```
 */
export function renameNode(
  ast: TWorkflowAST,
  oldId: string,
  newId: string,
): TWorkflowAST {
  assertNodeExists(ast, oldId);
  assertNodeNotExists(ast, newId);

  return withoutValidation(
    ast,
    (draft) => {
      // Update node instance ID
      const node = draft.instances.find((n) => n.id === oldId)!;
      node.id = newId;

      // Update all connections
      draft.connections.forEach((conn) => {
        if (conn.from.node === oldId) {
          conn.from.node = newId;
        }
        if (conn.to.node === oldId) {
          conn.to.node = newId;
        }
      });

      // Update scopes
      if (draft.scopes) {
        Object.keys(draft.scopes).forEach((scopeName) => {
          draft.scopes![scopeName] = draft.scopes![scopeName].map((id) =>
            id === oldId ? newId : id
          );
        });
      }

      // Update macro references
      if (draft.macros) {
        for (const macro of draft.macros) {
          if (macro.type === 'map') {
            if (macro.instanceId === oldId) macro.instanceId = newId;
            if (macro.childId === oldId) macro.childId = newId;
          } else if (macro.type === 'path') {
            macro.steps = macro.steps.map(s => s.node === oldId ? { ...s, node: newId } : s);
          } else if (macro.type === 'fanOut') {
            if (macro.source.node === oldId) macro.source.node = newId;
            for (const t of macro.targets) {
              if (t.node === oldId) t.node = newId;
            }
          } else if (macro.type === 'fanIn') {
            if (macro.target.node === oldId) macro.target.node = newId;
            for (const s of macro.sources) {
              if (s.node === oldId) s.node = newId;
            }
          }
        }
      }
    },
  );
}

/**
 * Update a node instance
 *
 * @param ast - Workflow to modify
 * @param nodeId - ID of node to update
 * @param updates - Partial node instance to merge
 * @returns Modified workflow
 * @throws {Error} If node doesn't exist
 *
 * @example
 * ```typescript
 * const ast = updateNode(workflow, 'processor1', {
 *   config: { x: 100, y: 200, label: 'Main Processor' }
 * });
 * ```
 */
export function updateNode(
  ast: TWorkflowAST,
  nodeId: string,
  updates: Partial<Omit<TNodeInstanceAST, "type" | "id">>,
): TWorkflowAST {
  assertNodeExists(ast, nodeId);

  return withoutValidation(
    ast,
    (draft) => {
      const node = draft.instances.find((n) => n.id === nodeId)!;
      Object.assign(node, updates);
    },
  );
}

/**
 * Add multiple nodes at once.
 * Uses no validation to allow adding even when workflow has other errors.
 *
 * @param ast - Workflow to modify
 * @param nodes - Array of node instances to add
 * @returns Modified workflow
 */
export function addNodes(
  ast: TWorkflowAST,
  nodes: TNodeInstanceAST[],
): TWorkflowAST {
  // Check for duplicate IDs only (eventual consistency model)
  nodes.forEach((node) => {
    assertNodeNotExists(ast, node.id);
  });

  // Use produce directly with simplified type to avoid excessive type instantiation
  return produce(ast, (draft: { instances: TNodeInstanceAST[] }) => {
    nodes.forEach((node) => {
      draft.instances.push(node);
    });
  }) as TWorkflowAST;
}

/**
 * Remove multiple nodes at once.
 * Uses minimal validation (only checks nodes exist) to allow deletion
 * even when the workflow has other validation errors.
 *
 * @param ast - Workflow to modify
 * @param nodeIds - Array of node IDs to remove
 * @returns Modified workflow
 */
export function removeNodes(
  ast: TWorkflowAST,
  nodeIds: string[],
): TWorkflowAST {
  // First, verify all nodes exist (fail fast with clear error)
  nodeIds.forEach((nodeId) => {
    assertNodeExists(ast, nodeId);
  });

  return withoutValidation(
    ast,
    (draft) => {
      // Remove all nodes
      draft.instances = draft.instances.filter(
        (n) => !nodeIds.includes(n.id),
      );

      // Remove all connections
      draft.connections = draft.connections.filter(
        (conn) =>
          !nodeIds.includes(conn.from.node) &&
          !nodeIds.includes(conn.to.node),
      );

      // Remove from scopes
      if (draft.scopes) {
        Object.keys(draft.scopes).forEach((scopeName) => {
          draft.scopes![scopeName] = draft.scopes![scopeName].filter(
            (id) => !nodeIds.includes(id),
          );
        });
      }
    },
  );
}

/**
 * Set node configuration
 *
 * @param ast - Workflow to modify
 * @param nodeId - ID of node to configure
 * @param config - Configuration to set
 * @returns Modified workflow
 */
export function setNodeConfig(
  ast: TWorkflowAST,
  nodeId: string,
  config: TNodeInstanceConfig,
): TWorkflowAST {
  return updateNode(ast, nodeId, { config });
}

/**
 * Set node position (UI coordinates)
 *
 * @param ast - Workflow to modify
 * @param nodeId - ID of node to position (including virtual nodes "Start" and "Exit")
 * @param x - X coordinate
 * @param y - Y coordinate
 * @returns Modified workflow
 */
export function setNodePosition(
  ast: TWorkflowAST,
  nodeId: string,
  x: number,
  y: number,
): TWorkflowAST {
  // Validate before mutation to avoid type instantiation issues inside callback
  if (nodeId !== "Start" && nodeId !== "Exit") {
    assertNodeExists(ast, nodeId);
  }

  return withoutValidation(
    ast,
    (draft) => {
      // Handle Start/Exit virtual nodes
      if (nodeId === "Start" || nodeId === "Exit") {
        const uiField = nodeId === "Start" ? "startNode" : "exitNode";
        draft.ui = {
          ...draft.ui,
          [uiField]: {
            ...draft.ui?.[uiField],
            x,
            y,
          },
        };
        return;
      }

      // Regular nodes - find and update
      const node = draft.instances.find((n) => n.id === nodeId);
      if (!node) return; // Already validated above

      if (!node.config) {
        node.config = {};
      }

      node.config.x = x;
      node.config.y = y;
    },
  );
}

/**
 * Set node minimized state (UI state)
 *
 * @param ast - Workflow to modify
 * @param nodeId - ID of node to minimize/expand
 * @param minimized - Whether the node is minimized
 * @returns Modified workflow
 */
export function setNodeMinimized(
  ast: TWorkflowAST,
  nodeId: string,
  minimized: boolean,
): TWorkflowAST {
  // Validate before mutation to avoid type instantiation issues inside callback
  assertNodeExists(ast, nodeId);

  return withoutValidation(
    ast,
    (draft) => {
      const node = draft.instances.find((n) => n.id === nodeId);
      if (!node) return; // Already validated above

      if (!node.config) {
        node.config = {};
      }

      node.config.minimized = minimized;
    },
  );
}

/**
 * Set node label (UI display name)
 *
 * @param ast - Workflow to modify
 * @param nodeId - ID of node to label
 * @param label - Label to set (empty string or undefined clears the label)
 * @returns Modified workflow
 */
export function setNodeLabel(
  ast: TWorkflowAST,
  nodeId: string,
  label: string | undefined,
): TWorkflowAST {
  // Validate before mutation to avoid type instantiation issues inside callback
  assertNodeExists(ast, nodeId);

  return withoutValidation(
    ast,
    (draft) => {
      const node = draft.instances.find((n) => n.id === nodeId);
      if (!node) return; // Already validated above

      if (!node.config) {
        node.config = {};
      }

      // Set or clear the label
      if (label) {
        node.config.label = label;
      } else {
        delete node.config.label;
      }
    },
  );
}

/**
 * Set node size (UI state)
 *
 * @param ast - Workflow to modify
 * @param nodeId - ID of node to resize
 * @param width - Node width
 * @param height - Node height
 * @returns Modified workflow
 */
export function setNodeSize(
  ast: TWorkflowAST,
  nodeId: string,
  width: number,
  height: number,
): TWorkflowAST {
  // Validate before mutation to avoid type instantiation issues inside callback
  assertNodeExists(ast, nodeId);

  return withoutValidation(
    ast,
    (draft) => {
      const node = draft.instances.find((n) => n.id === nodeId);
      if (!node) return; // Already validated above

      if (!node.config) {
        node.config = {};
      }

      node.config.width = width;
      node.config.height = height;
    },
  );
}
