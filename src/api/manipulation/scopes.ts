/**
 * Scope operations for workflow manipulation
 */

import type { TWorkflowAST } from "../../ast/types";
import { withoutValidation, assertNodeExists } from "../helpers";

/**
 * Create a new scope
 *
 * @param ast - Workflow to modify
 * @param scopeName - Name of scope
 * @param nodeIds - Node IDs in scope
 * @returns Modified workflow
 * @throws {Error} If scope already exists
 */
export function createScope(
  ast: TWorkflowAST,
  scopeName: string,
  nodeIds: string[],
): TWorkflowAST {
  // Validate scope doesn't exist
  if (ast.scopes?.[scopeName]) {
    throw new Error(`Scope "${scopeName}" already exists`);
  }

  // Verify all nodes exist before mutation to avoid type instantiation issues
  nodeIds.forEach((nodeId) => assertNodeExists(ast, nodeId));

  return withoutValidation(
    ast,
    (draft) => {
      if (!draft.scopes) {
        draft.scopes = {};
      }

      draft.scopes[scopeName] = nodeIds;

      // Update node instances to reference scope
      // scopeName format is "parentNodeId.scopeName"
      const dotIndex = scopeName.indexOf('.');
      const parentNodeName = dotIndex > 0 ? scopeName.substring(0, dotIndex) : scopeName;
      const scope = dotIndex > 0 ? scopeName.substring(dotIndex + 1) : '';
      nodeIds.forEach((nodeId) => {
        const node = draft.instances.find((n) => n.id === nodeId)!;
        node.parent = { id: parentNodeName, scope };
      });
    },
  );
}

/**
 * Remove a scope.
 * Uses no validation to allow deletion even when workflow has other errors.
 *
 * @param ast - Workflow to modify
 * @param scopeName - Name of scope to remove
 * @returns Modified workflow
 */
export function removeScope(
  ast: TWorkflowAST,
  scopeName: string,
): TWorkflowAST {
  // Verify scope exists
  if (!ast.scopes?.[scopeName]) {
    throw new Error(`Scope "${scopeName}" not found`);
  }

  return withoutValidation(
    ast,
    (draft) => {
      const nodeIds = draft.scopes![scopeName];

      // Remove parent from nodes
      nodeIds.forEach((nodeId) => {
        const node = draft.instances.find((n) => n.id === nodeId);
        if (node) {
          delete node.parent;
        }
      });

      delete draft.scopes![scopeName];
    },
  );
}

/**
 * Add node to existing scope
 *
 * @param ast - Workflow to modify
 * @param scopeName - Name of scope
 * @param nodeId - Node ID to add
 * @returns Modified workflow
 */
export function addToScope(
  ast: TWorkflowAST,
  scopeName: string,
  nodeId: string,
): TWorkflowAST {
  // Validate before mutation to avoid type instantiation issues
  if (!ast.scopes?.[scopeName]) {
    throw new Error(`Scope "${scopeName}" not found`);
  }
  assertNodeExists(ast, nodeId);

  return withoutValidation(
    ast,
    (draft) => {
      if (!draft.scopes![scopeName].includes(nodeId)) {
        draft.scopes![scopeName].push(nodeId);
      }

      const node = draft.instances.find((n) => n.id === nodeId);
      if (!node) return; // Already validated above

      // scopeName format is "parentNodeId.scopeName"
      const dotIndex = scopeName.indexOf('.');
      const parentNodeName = dotIndex > 0 ? scopeName.substring(0, dotIndex) : scopeName;
      const scope = dotIndex > 0 ? scopeName.substring(dotIndex + 1) : '';
      node.parent = { id: parentNodeName, scope };
    },
  );
}

/**
 * Remove node from scope.
 * Uses no validation to allow deletion even when workflow has other errors.
 *
 * @param ast - Workflow to modify
 * @param scopeName - Name of scope
 * @param nodeId - Node ID to remove
 * @returns Modified workflow
 */
export function removeFromScope(
  ast: TWorkflowAST,
  scopeName: string,
  nodeId: string,
): TWorkflowAST {
  // Verify scope exists
  if (!ast.scopes?.[scopeName]) {
    throw new Error(`Scope "${scopeName}" not found`);
  }

  return withoutValidation(
    ast,
    (draft) => {
      draft.scopes![scopeName] = draft.scopes![scopeName].filter(
        (id) => id !== nodeId,
      );

      const node = draft.instances.find((n) => n.id === nodeId);
      if (node && node.parent) {
        // Match by parent id (simple scope) or full qualified path
        const matchesScope = node.parent.id === scopeName ||
          (node.parent.scope && `${node.parent.id}.${node.parent.scope}` === scopeName);
        if (matchesScope) {
          delete node.parent;
        }
      }
    },
  );
}

/**
 * Move node to different scope
 *
 * @param ast - Workflow to modify
 * @param nodeId - Node ID to move
 * @param targetScope - Target scope name
 * @returns Modified workflow
 */
export function moveToScope(
  ast: TWorkflowAST,
  nodeId: string,
  targetScope: string,
): TWorkflowAST {
  // Validate before mutation to avoid type instantiation issues
  assertNodeExists(ast, nodeId);
  if (!ast.scopes?.[targetScope]) {
    throw new Error(`Target scope "${targetScope}" not found`);
  }

  return withoutValidation(
    ast,
    (draft) => {
      const node = draft.instances.find((n) => n.id === nodeId);
      if (!node || !draft.scopes) return; // Already validated above

      // Remove from current scope if any
      if (node.parent) {
        // Check for simple scope (just id) or full qualified path
        const simpleScope = node.parent.id;
        const fullScope = node.parent.scope ? `${node.parent.id}.${node.parent.scope}` : null;
        const currentScope = draft.scopes[simpleScope] ? simpleScope : (fullScope && draft.scopes[fullScope] ? fullScope : null);
        if (currentScope && draft.scopes[currentScope]) {
          draft.scopes[currentScope] = draft.scopes[currentScope].filter(
            (id) => id !== nodeId,
          );
        }
      }

      // Add to target scope
      if (!draft.scopes[targetScope].includes(nodeId)) {
        draft.scopes[targetScope].push(nodeId);
      }

      // targetScope format is "parentNodeId.scopeName"
      const dotIndex = targetScope.indexOf('.');
      const parentNodeName = dotIndex > 0 ? targetScope.substring(0, dotIndex) : targetScope;
      const scope = dotIndex > 0 ? targetScope.substring(dotIndex + 1) : '';
      node.parent = { id: parentNodeName, scope };
    },
  );
}
