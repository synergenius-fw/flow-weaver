/**
 * @module api/manipulation
 *
 * # Manipulation API
 *
 * Immutable operations for programmatic workflow modification.
 * All functions return a new AST (never mutate the original).
 *
 * ## Operation Categories
 *
 * | Category    | Functions |
 * |-------------|-----------|
 * | Workflow    | `cloneWorkflow`, `renameWorkflow`, `setWorkflowPorts` |
 * | Node Types  | `addNodeType`, `removeNodeType`, `updateNodeType` |
 * | Nodes       | `addNode`, `removeNode`, `renameNode`, `setNodePosition` |
 * | Connections | `addConnection`, `removeConnection`, `reconnect` |
 * | Ports       | `swapPortOrder`, `swapNodeInstancePortOrder` |
 * | Scopes      | `createScope`, `removeScope`, `addToScope` |
 *
 * ## Validation Options
 *
 * Operations validate by default. Use wrappers for control:
 * - `withValidation(workflow)` - Full validation (default)
 * - `withMinimalValidation(workflow)` - Skip expensive checks
 * - `withoutValidation(workflow)` - No validation (use with caution)
 */

// Re-export validation utilities
export {
  withoutValidation,
  type RemoveOptions,
  type NodeFilter,
  type OperationResult,
  validatePortReference,
  portReferencesEqual,
  formatPortReference,
  generateUniqueNodeId,
  assertNodeExists,
  assertNodeNotExists,
} from "./validation";

// Re-export workflow-level operations
export {
  cloneWorkflow,
  setWorkflowDescription,
  setWorkflowMetadata,
  setOutputFileType,
  renameWorkflow,
  setWorkflowPorts,
} from "./workflow";

// Re-export node type operations
export {
  addNodeType,
  removeNodeType,
  updateNodeType,
  getNodeType,
  hasNodeType,
  listNodeTypes,
  renameNodeType,
  replaceNodeTypes,
} from "./node-types";

// Re-export node instance operations
export {
  addNode,
  removeNode,
  renameNode,
  updateNode,
  addNodes,
  removeNodes,
  setNodeConfig,
  setNodePosition,
  setNodeMinimized,
  setNodeSize,
  setNodeLabel,
} from "./nodes";

// Re-export connection operations
export {
  addConnection,
  removeConnection,
  removeAllConnections,
  reconnect,
  addConnections,
  replaceConnections,
} from "./connections";

// Re-export port operations
export {
  swapPortOrder,
  swapNodeInstancePortOrder,
  setStartExitPorts,
  setInstancePortConfigs,
} from "./ports";

// Re-export scope operations
export {
  createScope,
  removeScope,
  addToScope,
  removeFromScope,
  moveToScope,
} from "./scopes";
