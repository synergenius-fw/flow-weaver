/**
 * Helper utilities for API manipulation operations
 * Provides immutability via Immer and validation wrappers
 */

import { produce, enableMapSet, type Draft } from "immer";
import { validateWorkflow, type ValidationResult } from "./validate";
import { getErrorMessage } from "../utils/error-utils";
import type {
  TWorkflowAST,
  TNodeInstanceAST,
} from "../ast/types";

// The pure port reference helpers live in their own module so the query layer
// can use them without importing validation. Re-exported here for callers.
export {
  validatePortReference,
  portReferencesEqual,
  formatPortReference,
} from "./port-references";

// Enable Map/Set support for Immer
enableMapSet();

/**
 * Wrapper for all mutation operations that ensures:
 * 1. Immutability via Immer's structural sharing (only clones what changes)
 * 2. Validation after operation (ensures every operation produces valid AST)
 * 3. Proper error handling (throws on validation failure)
 *
 * This is the foundation of all manipulation API functions.
 * Each operation can mutate the draft as if it were mutable,
 * but Immer returns a new immutable AST with structural sharing.
 *
 * @param ast - The workflow AST to operate on
 * @param operation - Function that mutates the draft
 * @param operationName - Optional name for better error messages
 * @returns New immutable WorkflowAST
 * @throws {Error} If validation fails after operation
 *
 * @example
 * ```typescript
 * const newAst = withValidation(ast, draft => {
 *   draft.instances.push(newNode);
 * }, 'addNode');
 * ```
 */
export function withValidation<T extends TWorkflowAST>(
  ast: T,
  operation: (draft: Draft<T>) => void,
  operationName?: string,
): T {
  // Execute operation with Immer
  const result = produce(ast, operation);

  // Validate the final result (not the draft)
  const validation = validateWorkflow(result);

  if (validation.errors.length > 0) {
    const context = operationName ? ` during ${operationName}` : "";
    const errorDetails = validation.errors
      .slice(0, 3)
      .map((e) => `  - ${e.message}`)
      .join("\n");

    throw new Error(
      `Validation failed${context}:\n${errorDetails}${validation.errors.length > 3 ? `\n  ... and ${validation.errors.length - 3} more errors` : ""}`,
    );
  }

  return result;
}

/**
 * Wrapper for mutation operations with minimal validation.
 * Only validates operation-specific requirements (e.g., "does this node exist?")
 * but does NOT validate the entire workflow.
 *
 * This allows operations to succeed even when the workflow has other validation
 * errors, preventing a frustrating "can't move nodes because workflow is broken"
 * experience while still catching obvious mistakes like typos.
 *
 * @param ast - The workflow AST to operate on
 * @param operation - Function that mutates the draft
 * @param checks - Optional validation checks specific to this operation
 * @param operationName - Optional name for better error messages
 * @returns New immutable WorkflowAST
 * @throws {Error} If operation-specific checks fail
 *
 * @example
 * ```typescript
 * const newAst = withMinimalValidation(
 *   ast,
 *   draft => { draft.instances = draft.instances.filter(n => n.id !== nodeId); },
 *   [(result) => assertNodeExists(result, nodeId)],
 *   'removeNode'
 * );
 * ```
 */
export function withMinimalValidation<T extends TWorkflowAST>(
  ast: T,
  operation: (draft: Draft<T>) => void,
  checks?: Array<(result: T) => void>,
  operationName?: string,
): T {
  // Execute operation with Immer
  const result = produce(ast, operation);

  // Run operation-specific checks (if provided)
  if (checks) {
    try {
      checks.forEach(check => check(result));
    } catch (error: unknown) {
      const context = operationName ? ` during ${operationName}` : "";
      throw new Error(`${getErrorMessage(error)}${context}`, { cause: error });
    }
  }

  return result;
}

/**
 * Wrapper for UI-only mutation operations that ensures immutability
 * but performs NO validation. Use this for metadata changes that don't
 * affect workflow correctness (e.g., node positions, labels, UI state).
 *
 * This allows users to make cosmetic changes even when the workflow
 * has validation errors, providing a smooth editing experience.
 *
 * @param ast - The workflow AST to operate on
 * @param operation - Function that mutates the draft
 * @returns New immutable WorkflowAST
 *
 * @example
 * ```typescript
 * const newAst = withoutValidation(ast, draft => {
 *   const node = draft.instances.find(n => n.id === nodeId);
 *   if (node) node.config = { ...node.config, label: 'Main' };
 * });
 * ```
 */
export function withoutValidation<T extends TWorkflowAST>(
  ast: T,
  operation: (draft: Draft<T>) => void,
): T {
  // Execute operation with Immer (immutability only, no validation)
  return produce(ast, operation);
}

/**
 * Options for node removal operations
 */
export interface RemoveOptions {
  /**
   * Whether to remove all connections to/from the node
   * @default true
   */
  removeConnections?: boolean;

  /**
   * Whether to validate after removal
   * @default true
   */
  validateAfter?: boolean;
}

/**
 * Filter options for querying nodes
 */
export interface NodeFilter {
  /** Filter by node type name */
  type?: string;

  /** Filter by parent scope */
  scope?: string;

  /** Custom filter predicate */
  predicate?: (node: TNodeInstanceAST) => boolean;
}

/**
 * Helper to generate unique node IDs
 * Uses base name + incrementing counter
 *
 * @param ast - Workflow AST
 * @param baseName - Base name for the ID
 * @returns Unique node ID
 *
 * @example
 * ```typescript
 * generateUniqueNodeId(ast, 'processor') // Returns 'processor', 'processor1', 'processor2', etc.
 * ```
 */
export function generateUniqueNodeId(
  ast: TWorkflowAST,
  baseName: string,
): string {
  const existingIds = new Set(ast.instances.map((n) => n.id));

  // Try base name first
  if (!existingIds.has(baseName)) {
    return baseName;
  }

  // Try with counter
  let counter = 1;
  while (existingIds.has(`${baseName}${counter}`)) {
    counter++;
  }

  return `${baseName}${counter}`;
}

/**
 * Asserts that a node type exists in the workflow
 * Useful for validation before adding node instances
 *
 * @param ast - Workflow AST (or Immer draft)
 * @param typeName - Node type function name to check
 * @throws {Error} If node type doesn't exist (lists available types)
 *
 * @example
 * ```typescript
 * // Before adding a node, verify its type exists
 * assertNodeTypeExists(workflow, "processData");
 * const node = addNode(workflow, { id: "proc1", nodeType: "processData" });
 *
 * // Throws with helpful message if missing
 * assertNodeTypeExists(workflow, "invalid");
 * // Error: Node type "invalid" not found. Available types: processData, transformData
 * ```
 */
export function assertNodeTypeExists(
  ast: TWorkflowAST,
  typeName: string,
): void {
  if (!ast.nodeTypes.some((nt) => nt.name === typeName || nt.functionName === typeName)) {
    throw new Error(
      `Node type "${typeName}" not found. Available types: ${ast.nodeTypes.map((nt) => nt.name || nt.functionName).join(", ")}`,
    );
  }
}

/**
 * Asserts that a node instance exists in the workflow
 * Useful for validation before operations like rename or remove
 *
 * @param ast - Workflow AST (or Immer draft)
 * @param nodeId - Node instance ID to check
 * @throws {Error} If node doesn't exist (lists available nodes)
 *
 * @example
 * ```typescript
 * // Before renaming a node, verify it exists
 * assertNodeExists(workflow, "processor1");
 * const updated = renameNode(workflow, "processor1", "processor_renamed");
 *
 * // Throws with helpful message if missing
 * assertNodeExists(workflow, "missing");
 * // Error: Node "missing" not found. Available nodes: processor1, transformer1
 * ```
 */
export function assertNodeExists(
  ast: TWorkflowAST,
  nodeId: string,
): void {
  if (!ast.instances.some((n) => n.id === nodeId)) {
    throw new Error(
      `Node "${nodeId}" not found. Available nodes: ${ast.instances.map((n) => n.id).join(", ")}`,
    );
  }
}

/**
 * Asserts that a node instance does NOT exist in the workflow
 * Useful for validation before adding new nodes to prevent ID conflicts
 *
 * @param ast - Workflow AST (or Immer draft)
 * @param nodeId - Node instance ID to check
 * @throws {Error} If node already exists
 *
 * @example
 * ```typescript
 * // Before adding a node, verify ID is unique
 * assertNodeNotExists(workflow, "newProcessor");
 * const updated = addNode(workflow, { id: "newProcessor", nodeType: "process" });
 *
 * // Throws if ID is taken
 * assertNodeNotExists(workflow, "processor1");
 * // Error: Node "processor1" already exists
 * ```
 */
export function assertNodeNotExists(
  ast: TWorkflowAST,
  nodeId: string,
): void {
  if (ast.instances.some((n) => n.id === nodeId)) {
    throw new Error(`Node "${nodeId}" already exists`);
  }
}

/**
 * Result type for operations that may produce warnings
 */
export interface OperationResult<T = void> {
  /** Result value (if applicable) */
  value?: T;
  /** Validation result */
  validation: ValidationResult;
  /** Whether operation succeeded */
  success: boolean;
}
