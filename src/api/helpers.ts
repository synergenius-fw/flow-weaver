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
  TPortReference,
} from "../ast/types";

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
      throw new Error(`${getErrorMessage(error)}${context}`);
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
 *   if (node) node.x = 100;
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
 * Validates and normalizes port reference format
 * Accepts either string format ("nodeId.portName") or object format ({ node, port })
 *
 * @param ref - Port reference to validate
 * @returns Validated TPortReference object
 * @throws {Error} If format is invalid
 *
 * @example
 * ```typescript
 * // String format
 * const ref1 = validatePortReference("processor1.input");
 * // Returns: { node: "processor1", port: "input" }
 *
 * // Object format
 * const ref2 = validatePortReference({ node: "processor1", port: "input" });
 * // Returns: { node: "processor1", port: "input" }
 *
 * // Invalid format throws error
 * validatePortReference("invalid"); // Throws: Invalid port reference format
 * ```
 */
export function validatePortReference(
  ref: string | TPortReference,
): TPortReference {
  if (typeof ref === "string") {
    const parts = ref.split(".");
    if (parts.length !== 2) {
      throw new Error(
        `Invalid port reference format: "${ref}". Expected "nodeId.portName"`,
      );
    }
    return { node: parts[0], port: parts[1] };
  }

  if (!ref.node || !ref.port) {
    throw new Error(
      `Invalid port reference: missing node or port property`,
    );
  }

  return ref;
}

/**
 * Checks if two port references point to the same port
 * Compares both node ID and port name for equality
 *
 * @param a - First port reference
 * @param b - Second port reference
 * @returns True if both references point to the same port
 *
 * @example
 * ```typescript
 * const ref1 = { node: "processor1", port: "input" };
 * const ref2 = { node: "processor1", port: "input" };
 * const ref3 = { node: "processor1", port: "output" };
 *
 * portReferencesEqual(ref1, ref2); // true
 * portReferencesEqual(ref1, ref3); // false
 * ```
 */
export function portReferencesEqual(
  a: TPortReference,
  b: TPortReference,
): boolean {
  // Include scope in comparison - scoped ports are different from non-scoped ports
  return a.node === b.node && a.port === b.port && (a.scope ?? null) === (b.scope ?? null);
}

/**
 * Formats a port reference object as a string
 * Converts { node, port } to "node.port" format
 *
 * @param ref - Port reference to format
 * @returns String representation in "node.port" format
 *
 * @example
 * ```typescript
 * const ref = { node: "processor1", port: "input" };
 * const str = formatPortReference(ref);
 * // Returns: "processor1.input"
 * ```
 */
export function formatPortReference(ref: TPortReference): string {
  return `${ref.node}.${ref.port}`;
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
