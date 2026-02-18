/**
 * Workflow-level operations for manipulation
 */

import { produce } from "immer";
import type { TWorkflowAST, TWorkflowMetadata, TNodeTypePort } from "../../ast/types";
import { withoutValidation } from "../helpers";

/**
 * Clone a workflow (creates deep copy via Immer)
 *
 * @param ast - Workflow to clone
 * @returns New workflow instance
 *
 * @example
 * ```typescript
 * const copy = cloneWorkflow(original);
 * // copy !== original
 * ```
 */
export function cloneWorkflow(ast: TWorkflowAST): TWorkflowAST {
  // Force Immer to create a new object by making changes to nested structures
  // Without this, Immer returns the same object (structural sharing)
  return withoutValidation(
    ast,
    (draft) => {
      // Touch nested arrays to force deep cloning
      draft.nodeTypes = [...draft.nodeTypes];
      draft.instances = [...draft.instances];
      draft.connections = [...draft.connections];
    },
  );
}

/**
 * Set workflow description
 *
 * @param ast - Workflow to modify
 * @param description - New description
 * @returns Modified workflow
 */
export function setWorkflowDescription(
  ast: TWorkflowAST,
  description: string,
): TWorkflowAST {
  return withoutValidation(
    ast,
    (draft) => {
      draft.description = description;
    },
  );
}

/**
 * Set workflow metadata (forceAsync, etc.)
 *
 * @param ast - Workflow to modify
 * @param metadata - Partial metadata to merge
 * @returns Modified workflow
 *
 * @example
 * ```typescript
 * const updated = setWorkflowMetadata(workflow, { forceAsync: true });
 * ```
 */
export function setWorkflowMetadata(
  ast: TWorkflowAST,
  metadata: Partial<TWorkflowMetadata>,
): TWorkflowAST {
  return withoutValidation(
    ast,
    (draft) => {
      draft.metadata = { ...draft.metadata, ...metadata };
    },
  );
}

/**
 * Set workflow output file type
 *
 * @param ast - Workflow to modify
 * @param fileType - Target file extension
 * @returns Modified workflow
 *
 * @example
 * ```typescript
 * const updated = setOutputFileType(workflow, "tsx");
 * ```
 */
export function setOutputFileType(
  ast: TWorkflowAST,
  fileType: "js" | "ts" | "jsx" | "tsx",
): TWorkflowAST {
  return withoutValidation(
    ast,
    (draft) => {
      const baseName = draft.sourceFile.replace(/\.(ts|js|tsx|jsx)$/, "");
      draft.sourceFile = `${baseName}.${fileType}`;
    },
  );
}

/**
 * Rename workflow export
 *
 * @param ast - Workflow to modify
 * @param newName - New workflow export name
 * @returns Modified workflow
 *
 * @example
 * ```typescript
 * const updated = renameWorkflow(workflow, "myNewWorkflow");
 * ```
 */
export function renameWorkflow(
  ast: TWorkflowAST,
  newName: string,
): TWorkflowAST {
  if (!newName || !/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(newName)) {
    throw new Error(`Invalid workflow name: ${newName}`);
  }
  return withoutValidation(
    ast,
    (draft) => {
      draft.functionName = newName;
    },
  );
}

/**
 * Set workflow export interface ports
 *
 * @param ast - Workflow to modify
 * @param ports - New ports configuration
 * @returns Modified workflow
 *
 * @example
 * ```typescript
 * const updated = setWorkflowPorts(workflow, [
 *   { name: "input", type: "String", direction: "input" },
 *   { name: "result", type: "Number", direction: "output" }
 * ]);
 * ```
 */
export function setWorkflowPorts(
  ast: TWorkflowAST,
  ports: TNodeTypePort[],
): TWorkflowAST {
  // Use produce directly with non-generic approach to avoid excessive type instantiation
  return produce(ast, (draft: { ports?: TNodeTypePort[] }) => {
    draft.ports = ports;
  }) as TWorkflowAST;
}

