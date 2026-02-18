/**
 * @module api
 *
 * # Flow Weaver API
 *
 * High-level API for working with Flow Weaver workflows.
 *
 * ## Parse → Validate → Generate Pipeline
 *
 * ```
 * Source File (.ts)
 *       ↓
 *   parseWorkflow()     → TWorkflowAST
 *       ↓
 *   validateWorkflow()  → ValidationResult
 *       ↓
 *   generateCode()      → Executable code
 * ```
 *
 * Or use `compileWorkflow()` for all steps in one call.
 *
 * ## Key Exports
 *
 * - **Parsing**: {@link parseWorkflow}
 * - **Validation**: {@link validateWorkflow}
 * - **Generation**: {@link generateCode}, {@link generateInPlace}
 * - **Compilation**: {@link compileWorkflow}
 * - **Query**: `getNode()`, `getNodeType()`, `findConnections()`
 * - **Manipulation**: `addNode()`, `removeNode()`, `addConnection()`, etc.
 * - **Builder**: `WorkflowBuilder` for programmatic AST construction
 */

// Export AST types (not the old AST builder to avoid conflict with new API builder)
export type {
  TWorkflowAST,
  TNodeTypeDefaultConfig,
  TNodeTypeAST,
  TNodeInstanceConfig,
  TNodeInstanceAST,
  TConnectionAST,
  TPortReference,
  TImportDeclaration,
  TImportSpecifier,
  TPortDefinition,
  TDataType,
  TSerializableValue,
  TSerializableObject,
  TSerializableArray,
  TExecuteWhen,
  TBranchingStrategy,
  TWorkflowMetadata,
  TNodeMetadata,
  TConnectionMetadata,
  TSourceLocation,
  TControlFlowGraph,
  TControlFlowEdge,
  TValidationError,
  TAnalysisResult,
  TBranchingNodeInfo,
  TBranchRegion,
  TMergeNodeInfo,
  TASTTransformer,
  TASTVisitor,
  TParseOptions,
  TValidationRule,
  TGenerateOptions,
  TCompileResult,
  TCompilationMetadata,
} from '../ast/types';

export { type CompileOptions, compileWorkflow } from './compile';
export { type GenerateResult, generateCode } from './generate';
export {
  type InPlaceGenerateOptions,
  type InPlaceGenerateResult,
  generateInPlace,
  hasInPlaceMarkers,
  stripGeneratedSections,
  MARKERS,
} from './generate-in-place';
export { type ParseResult, parseWorkflow } from './parse';
export { transformWorkflow } from './transform';
export { type ValidationResult, validateWorkflow } from './validate';

export * from './manipulation';
export {
  withValidation,
  withMinimalValidation,
  withoutValidation,
  type RemoveOptions,
  type NodeFilter,
  type OperationResult,
  validatePortReference,
  portReferencesEqual,
  formatPortReference,
  generateUniqueNodeId,
  assertNodeTypeExists,
  assertNodeExists,
  assertNodeNotExists,
} from './helpers';
export * from './query';
export * from './builder';
export * from './workflow-file-operations';
export * from './templates';
export * from './patterns';
