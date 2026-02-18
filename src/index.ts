/**
 * @packageDocumentation
 *
 * # Flow Weaver Library
 *
 * A visual dataflow programming system for TypeScript. Workflows are defined via
 * JSDoc annotations in standard TypeScript files and can be parsed, validated,
 * and compiled to executable code.
 *
 * ## Core Concepts
 *
 * - **Workflow** (`TWorkflowAST`) - A graph of connected nodes with start/exit ports
 * - **NodeType** (`TNodeTypeAST`) - Template defining inputs, outputs, and behavior
 * - **NodeInstance** (`TNodeInstanceAST`) - A usage of a node type in a workflow
 * - **Port** (`TPortDefinition`) - Entry/exit point on a node (data or control flow)
 * - **Connection** (`TConnectionAST`) - Links ports between nodes
 *
 * ## File Format
 *
 * Any `.ts`, `.tsx`, `.js`, or `.jsx` file can contain workflows.
 *
 * ```typescript
 * // Define a node type
 * /**
 *  * @flowWeaver nodeType
 *  * @input a - First number
 *  * @input b - Second number
 *  * @output result - Sum
 *  *\/
 * function add(execute: boolean, a: number, b: number): { onSuccess: boolean; result: number } { ... }
 *
 * // Define a workflow
 * /**
 *  * @flowWeaver workflow
 *  * @node adder1 add
 *  * @connect Start.execute -> adder1.execute
 *  * @connect adder1.onSuccess -> Exit.onSuccess
 *  *\/
 * export function myWorkflow(execute: boolean, params: {...}): {...} { ... }
 * ```
 *
 * ## Main APIs
 *
 * - {@link parseWorkflow} - Parse a file to AST
 * - {@link validateWorkflow} - Validate workflow structure
 * - {@link generateCode} - Generate executable code from AST
 * - {@link compileWorkflow} - Parse + validate + generate in one step
 *
 * ## JSDoc Port Sync (Browser-compatible)
 *
 * For IDE integration, use the browser-compatible sync functions:
 * - {@link parsePortsFromFunctionText} - Extract ports from JSDoc
 * - {@link updatePortsInFunctionText} - Update ports in function text
 * - {@link formatPortsInFunctionText} - Format ports consistently
 *
 * @module @synergenius/flow-weaver
 */

// Public API
export * from './api';

// Parser (for advanced use - clearing import cache)
export { parser, resolveNpmNodeTypes } from './parser';
export type { TExternalNodeType } from './parser';

// AST Types
export type {
  TConnectionAST,
  TNodeTypeAST,
  TNodeInstanceAST,
  TNodeInstanceConfig,
  TPortConfig,
  TWorkflowAST,
  TPortReference,
  TPortDefinition,
  TDataType,
  TExecuteWhen,
  TBranchingStrategy,
  TSerializableValue,
  TSerializableObject,
  TSerializableArray,
  TImportDeclaration,
  TImportSpecifier,
  TSourceLocation,
  TValidationError,
  TAnalysisResult,
  TControlFlowGraph,
  TControlFlowEdge,
  TBranchingNodeInfo,
  TBranchRegion,
  TMergeNodeInfo,
  TWorkflowMetadata,
  TNodeMetadata,
  TConnectionMetadata,
  TASTTransformer,
  TASTVisitor,
  TParseOptions,
  TValidationRule,
  TGenerateOptions,
  TCompileResult,
  TCompilationMetadata,
  TNodeTypeDefaultConfig,
  TNodeTypePort,
  TPortDirection,
  TNodeParent,
  TPullExecutionConfig,
  TWorkflowFileExtension,
  TPortPlacement,
  TPortUI,
  TNodeTypeUI,
  TNodeUI,
  TWorkFlowFunctionUI,
  TPortType,
} from './ast/types';

// AST Builders (for programmatic AST construction)
export {
  WorkflowBuilder,
  NodeTypeBuilder,
  NodeInstanceBuilder,
  ConnectionBuilder,
} from './ast/builder';
export { portRef, port, workflow, nodeType, nodeInstance } from './ast/builder';

// Runtime
export { GeneratedExecutionContext } from './runtime/ExecutionContext';
export type { TDebugger } from './runtime/events';

// Node Types Generator (for generated .node-types files)
export type { TLocalFunctionNodeType } from './node-types-generator';

// Generated Branding (configurable output branding)
export { configureGeneratedBranding, getGeneratedBranding } from './generated-branding';
export type { GeneratedBranding } from './generated-branding';

// Type Mappings & Constants
export * from './type-mappings';
export * from './constants';

// Validation
export { validator, WorkflowValidator } from './validator';

// Friendly Errors (beginner-friendly validation messages)
export { getFriendlyError, formatFriendlyDiagnostics } from './friendly-errors';
export type { TFriendlyError } from './friendly-errors';

// Code Generation
export { generator, WorkflowGenerator } from './generator';
export { AnnotationGenerator } from './annotation-generator';
export type { GenerateAnnotationsOptions } from './annotation-generator';

// Generator Utilities (for advanced use)
export * as GeneratorUtils from './generator';

// JSDoc Port Sync (browser-compatible parsing/updating)
export {
  parsePortsFromFunctionText,
  updatePortsInFunctionText,
  formatPortsInFunctionText,
  syncCodeRenames,
  renamePortInCode,
  parseReturnTypeFields,
  parseFunctionSignature,
  parseReturnFields,
} from './jsdoc-port-sync';

// Templates (for workflow/node creation)
export {
  workflowTemplates,
  nodeTemplates,
  getWorkflowTemplate,
  getNodeTemplate,
  toCamelCase,
  toPascalCase,
} from './cli/templates';
export type { WorkflowTemplate, NodeTemplate, WorkflowTemplateOptions } from './cli/templates';

// Diff (semantic comparison)
export { WorkflowDiffer } from './diff/WorkflowDiffer';
export { formatDiff, type TDiffFormat } from './diff/formatDiff';
export {
  IMPACT_DESCRIPTIONS,
  IMPACT_COLORS,
  getImpactReasons,
  hasBreakingChanges,
  getNodeTypeChanges,
  getCriticalConnections,
} from './diff/impact';
export type {
  TWorkflowDiff,
  TNodeTypeDiff,
  TInstanceDiff,
  TConnectionDiff,
  TWorkflowPortsDiff,
  TScopeDiff,
  TPortChange,
  TImpactLevel,
  TChangeType,
  TChange,
  TInstanceConfigChange,
  TPortRef,
} from './diff/types';
