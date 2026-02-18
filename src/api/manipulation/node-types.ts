/**
 * Node type operations for workflow manipulation
 */

import { produce } from "immer";
import type { TWorkflowAST, TNodeTypeAST } from "../../ast/types";
import { withoutValidation } from "../helpers";

/**
 * Add a node type definition to the workflow (idempotent).
 * Uses no validation to allow adding even when workflow has other errors.
 *
 * If a node type with the same name already exists, returns the AST unchanged
 * without throwing an error. This handles state desync between server and client,
 * race conditions, double-clicks, and server restarts gracefully.
 *
 * @param ast - Workflow to modify
 * @param nodeType - Node type to add
 * @returns Modified workflow (or unchanged if node type already exists)
 *
 * @example
 * ```typescript
 * const ast = addNodeType(workflow, {
 *   type: 'NodeType',
 *   name: 'double',
 *   functionName: 'double',
 *   inputs: { x: { dataType: 'NUMBER' } },
 *   outputs: { result: { dataType: 'NUMBER' } },
 *   hasSuccessPort: true,
 *   hasFailurePort: true,
 *   executeWhen: 'CONJUNCTION'
 * });
 * ```
 */
export function addNodeType(
  ast: TWorkflowAST,
  nodeType: TNodeTypeAST,
): TWorkflowAST {
  const existingIndex = ast.nodeTypes.findIndex((nt) => nt.name === nodeType.name);

  // If node type already exists, check if we need to update it with new properties
  // (e.g., importSource for npm types that were parsed without @import annotation)
  if (existingIndex >= 0) {
    const existing = ast.nodeTypes[existingIndex];
    const newImportSource = (nodeType as { importSource?: string }).importSource;
    const existingImportSource = (existing as { importSource?: string }).importSource;

    // If the new type has importSource but the existing one doesn't, update it
    if (newImportSource && !existingImportSource) {
      return produce(ast, (draft: { nodeTypes: TNodeTypeAST[] }) => {
        (draft.nodeTypes[existingIndex] as { importSource?: string }).importSource = newImportSource;
      }) as TWorkflowAST;
    }

    // Otherwise, return unchanged (idempotent)
    return ast;
  }

  // Add new node type
  return produce(ast, (draft: { nodeTypes: TNodeTypeAST[] }) => {
    draft.nodeTypes.push(nodeType);
  }) as TWorkflowAST;
}

/**
 * Remove a node type from the workflow.
 * Uses minimal validation (only checks type exists and has no instances)
 * to allow deletion even when the workflow has other validation errors.
 *
 * @param ast - Workflow to modify
 * @param typeName - Name of node type to remove
 * @returns Modified workflow
 * @throws {Error} If node type doesn't exist or instances reference it
 *
 * @example
 * ```typescript
 * const ast = removeNodeType(workflow, 'obsoleteType');
 * ```
 */
export function removeNodeType(
  ast: TWorkflowAST,
  typeName: string,
): TWorkflowAST {
  // First, verify node type exists
  const typeIndex = ast.nodeTypes.findIndex((nt) => nt.name === typeName);
  if (typeIndex === -1) {
    throw new Error(`Node type "${typeName}" not found`);
  }

  // Check if any instances reference this type
  const functionName = ast.nodeTypes[typeIndex].functionName;
  const referencingInstances = ast.instances.filter(
    (inst) => inst.nodeType === functionName,
  );

  if (referencingInstances.length > 0) {
    throw new Error(
      `Cannot remove node type "${typeName}": ${referencingInstances.length} instance(s) still reference it (${referencingInstances.map((i) => i.id).join(", ")})`,
    );
  }

  return withoutValidation(
    ast,
    (draft) => {
      const idx = draft.nodeTypes.findIndex((nt) => nt.name === typeName);
      draft.nodeTypes.splice(idx, 1);
    },
  );
}

/**
 * Update an existing node type.
 * Uses no validation to allow updates even when workflow has other errors.
 *
 * @param ast - Workflow to modify
 * @param typeName - Name of node type to update
 * @param updates - Partial node type to merge
 * @returns Modified workflow
 * @throws {Error} If node type doesn't exist
 *
 * @example
 * ```typescript
 * const ast = updateNodeType(workflow, 'processor', {
 *   label: 'Data Processor',
 *   description: 'Processes incoming data'
 * });
 * ```
 */
export function updateNodeType(
  ast: TWorkflowAST,
  typeName: string,
  updates: Partial<Omit<TNodeTypeAST, "type" | "name">>,
): TWorkflowAST {
  // Verify node type exists
  if (!ast.nodeTypes.find((nt) => nt.name === typeName)) {
    throw new Error(`Node type "${typeName}" not found`);
  }

  return withoutValidation(
    ast,
    (draft) => {
      const nodeType = draft.nodeTypes.find((nt) => nt.name === typeName)!;
      Object.assign(nodeType, updates);
    },
  );
}

/**
 * Get a node type by name
 *
 * @param ast - Workflow to query
 * @param typeName - Name of node type
 * @returns Node type or undefined
 */
export function getNodeType(
  ast: TWorkflowAST,
  typeName: string,
): TNodeTypeAST | undefined {
  return ast.nodeTypes.find((nt) => nt.name === typeName);
}

/**
 * Check if node type exists
 *
 * @param ast - Workflow to query
 * @param typeName - Name of node type
 * @returns True if exists
 */
export function hasNodeType(ast: TWorkflowAST, typeName: string): boolean {
  return ast.nodeTypes.some((nt) => nt.name === typeName);
}

/**
 * List all node types
 *
 * @param ast - Workflow to query
 * @returns Array of node types
 */
export function listNodeTypes(ast: TWorkflowAST): TNodeTypeAST[] {
  return [...ast.nodeTypes];
}

/**
 * Rename a node type and update all instances that reference it.
 * Uses no validation to allow renames even when workflow has other errors.
 *
 * @param ast - Workflow to modify
 * @param oldTypeName - Current name of the node type
 * @param newTypeName - New name for the node type
 * @returns Modified workflow
 * @throws {Error} If node type doesn't exist or new name already exists
 *
 * @example
 * ```typescript
 * const ast = renameNodeType(workflow, 'OldTypeName', 'NewTypeName');
 * ```
 */
export function renameNodeType(
  ast: TWorkflowAST,
  oldTypeName: string,
  newTypeName: string,
): TWorkflowAST {
  // Check if new name already exists
  if (ast.nodeTypes.some((nt) => nt.name === newTypeName)) {
    throw new Error(`Node type "${newTypeName}" already exists`);
  }

  return withoutValidation(
    ast,
    (draft) => {
      // Find the node type in nodeTypes array
      const nodeTypeIndex = draft.nodeTypes.findIndex(
        (nt) => nt.name === oldTypeName,
      );

      // Rename the node type if it exists in nodeTypes array
      if (nodeTypeIndex >= 0) {
        draft.nodeTypes[nodeTypeIndex].name = newTypeName;
      }

      // Update all instances that reference this node type
      draft.instances.forEach((instance) => {
        if (instance.nodeType === oldTypeName) {
          instance.nodeType = newTypeName;
        }
      });
    },
  );
}

/**
 * Replace all node types in workflow.
 * Uses no validation to allow replacement even when workflow has other errors.
 *
 * @param ast - Workflow to modify
 * @param nodeTypes - New array of node types
 * @returns Modified workflow
 *
 * @example
 * ```typescript
 * const ast = replaceNodeTypes(workflow, [
 *   { type: 'NodeType', name: 'type1', ... },
 *   { type: 'NodeType', name: 'type2', ... }
 * ]);
 * ```
 */
export function replaceNodeTypes(
  ast: TWorkflowAST,
  nodeTypes: TNodeTypeAST[],
): TWorkflowAST {
  // Use produce directly with simplified type to avoid excessive type instantiation
  return produce(ast, (draft: { nodeTypes: TNodeTypeAST[] }) => {
    draft.nodeTypes = nodeTypes;
  }) as TWorkflowAST;
}
