/**
 * Workflow AST - The root structure representing a complete workflow.
 *
 * A workflow is a directed graph where:
 * - `nodeTypes` define templates (like classes)
 * - `instances` are usages of those templates (like objects)
 * - `connections` link ports between instances
 * - `startPorts`/`exitPorts` define the workflow's external interface
 *
 * ```
 * ┌─────────────────────────────────────────────────────────────┐
 * │                        WORKFLOW                              │
 * │  ┌─────────────────┐    ┌─────────────────┐                 │
 * │  │  NODE TYPES     │    │  NODE INSTANCES │                 │
 * │  │  (templates)    │◄───│  (usages)       │                 │
 * │  └─────────────────┘    └─────────────────┘                 │
 * │                              │                               │
 * │  ┌───────────────────────────▼───────────────────────────┐  │
 * │  │                   CONNECTIONS                          │  │
 * │  │  from: {node, port} → to: {node, port}                 │  │
 * │  └────────────────────────────────────────────────────────┘  │
 * │  startPorts{} ─────────────────────────────► exitPorts{}     │
 * └─────────────────────────────────────────────────────────────┘
 * ```
 *
 * @example
 * ```typescript
 * const workflow: TWorkflowAST = {
 *   type: "Workflow",
 *   sourceFile: "./math.ts",
 *   name: "addNumbers",
 *   functionName: "addNumbers",
 *   nodeTypes: [...],
 *   instances: [...],
 *   connections: [...],
 *   startPorts: { execute: { dataType: "STEP" }, a: { dataType: "NUMBER" } },
 *   exitPorts: { onSuccess: { dataType: "STEP" }, result: { dataType: "NUMBER" } },
 *   imports: []
 * };
 * ```
 */
export type TWorkflowAST = {
  type: 'Workflow';
  /** Source file path */
  sourceFile: string;
  /** Generated output file path (if any) */
  generatedFile?: string;
  /** Workflow name (usually same as functionName) */
  name: string;
  /** The function name in source code */
  functionName: string;
  /** Description from JSDoc */
  description?: string;
  /**
   * Node types are templates/definitions.
   * Multiple instances can reference the same node type.
   */
  nodeTypes: TNodeTypeAST[];
  /**
   * Instances are the actual nodes in the workflow graph.
   * Each instance references a node type by name.
   */
  instances: TNodeInstanceAST[];
  /** Connections linking ports between nodes */
  connections: TConnectionAST[];
  /**
   * Scope definitions: maps scope names to instance IDs within that scope.
   * Used for iteration/callback patterns (e.g., forEach).
   * @example { 'forEach1.iteration': ['processor1', 'doubler1'] }
   */
  scopes?: Record<string, string[]>;
  /** Input ports exposed on the Start virtual node */
  startPorts: Record<string, TPortDefinition>;
  /** Output ports exposed on the Exit virtual node */
  exitPorts: Record<string, TPortDefinition>;
  /** Import declarations from the source file */
  imports: TImportDeclaration[];
  /** Unified ports array (alternative representation) */
  ports?: TNodeTypePort[];
  /** Workflow script content (for script-based workflows) */
  script?: string;
  /** Whether the function was declared with `async` keyword */
  userSpecifiedAsync?: boolean;
  /** Workflow-level options (e.g., strictTypes) */
  options?: TWorkflowOptions;
  /** UI metadata for visual editor state */
  ui?: {
    disablePan?: boolean;
    disableZoom?: boolean;
    startNode?: { x?: number; y?: number };
    exitNode?: { x?: number; y?: number };
    instances?: TNodeUI[];
    nodeTypes?: TNodeTypeUI[];
    /** In-memory only: stage transformation matrix (not persisted to file) */
    transformation?: number[];
  };
  /** All function names found in the source file (annotated or not). Used by validator to hint about unannotated functions. */
  availableFunctionNames?: string[];
  /** Sugar macros (@map, @filter) that expand to full scope patterns. Stored for round-trip preservation. */
  macros?: TWorkflowMacro[];
  /** Reserved for plugin extensibility */
  metadata?: TWorkflowMetadata;
};

/**
 * A sugar macro that expands to a full scope pattern or connection set.
 * Stored on the workflow AST for round-trip preservation in generateInPlace.
 */
export type TWorkflowMacro = TMapMacro | TPathMacro;

export type TMapMacro = {
  type: 'map';
  /** Instance ID for the synthetic iterator node (e.g., "loop") */
  instanceId: string;
  /** Child node ID to apply to each item (e.g., "proc") */
  childId: string;
  /** Source port for the array in "node.port" format (e.g., "scan.files") */
  sourcePort: string;
  /** Explicit input port on child (auto-inferred if omitted) */
  inputPort?: string;
  /** Explicit output port on child (auto-inferred if omitted) */
  outputPort?: string;
};

export type TPathMacro = {
  type: 'path';
  /** Ordered steps through the graph, each with optional routing suffix */
  steps: Array<{ node: string; route?: 'ok' | 'fail' }>;
};

/**
 * Default configuration for a node type that can be overridden per instance.
 */
export type TNodeTypeDefaultConfig = {
  /** Which STEP input port triggers pull execution (default: 'execute') */
  pullExecution?: { triggerPort: string };
  label?: string;
  description?: string;
};

/**
 * Node Type AST - A template defining node behavior.
 *
 * Node types are like classes - they define what inputs/outputs a node has
 * and how it behaves. Multiple instances can reference the same node type.
 *
 * Created by `@flowWeaver nodeType` annotation:
 * ```typescript
 * /**
 *  * @flowWeaver nodeType
 *  * @input a - First operand
 *  * @input b - Second operand
 *  * @output result - Sum
 *  *\/
 * function add(execute: boolean, a: number, b: number): {
 *   onSuccess: boolean;
 *   result: number;
 * } { ... }
 * ```
 *
 * @remarks
 * **Port Location Mapping:**
 * | Port Type | External Location | Scoped Location |
 * |-----------|-------------------|-----------------|
 * | INPUT     | Function param    | Callback return field |
 * | OUTPUT    | Return type field | Callback param |
 */
export type TNodeTypeAST = {
  type: 'NodeType';
  /** Unique name for this node type (defaults to function name) */
  name: string;
  /** The function that implements this node type */
  functionName: string;
  /** Input port definitions */
  inputs: Record<string, TPortDefinition>;
  /** Output port definitions */
  outputs: Record<string, TPortDefinition>;
  /** Whether this node has an onSuccess output port */
  hasSuccessPort: boolean;
  /** Whether this node has an onFailure output port */
  hasFailurePort: boolean;
  /** When this node executes relative to its inputs */
  executeWhen: TExecuteWhen;
  /** Whether the function is declared async */
  isAsync: boolean;
  /** Default configuration for instances */
  defaultConfig?: TNodeTypeDefaultConfig;
  /** Single scope name (e.g., 'iteration' for forEach) */
  scope?: string;
  /** Multiple scopes this node creates */
  scopes?: string[];
  /** Variant identifier (set by app layer) */
  variant?: 'FUNCTION' | 'WORKFLOW' | 'IMPORTED_WORKFLOW' | 'MAP_ITERATOR';
  /** File path for external node types */
  path?: string;
  /** Function reference for function-based node types */
  function?: string;
  /** Unified ports array (alternative to inputs/outputs) */
  ports?: TNodeTypePort[];
  /** Display label */
  label?: string;
  /** Description from JSDoc */
  description?: string;
  /** X position hint */
  x?: number;
  /** Y position hint */
  y?: number;
  /** Source code location */
  sourceLocation?: TSourceLocation;
  /** Original function source text */
  functionText?: string;
  /** How success/failure branching works */
  branchingStrategy?: TBranchingStrategy;
  /** Field name for value-based branching */
  branchField?: string;
  /** Reserved for plugin extensibility */
  metadata?: TNodeMetadata;
  /** Visual customization (color, icon, tags) */
  visuals?: TNodeVisualsAST;
  /** Whether this is an expression node (no execute param, raw return mapped to outputs) */
  expression?: boolean;
  /** Whether this node type was auto-inferred from an unannotated function signature */
  inferred?: boolean;
  /** Declaration kind for arrow/function-expression node types ('const', 'let', 'var') */
  declarationKind?: 'const' | 'let' | 'var';
  /** npm package specifier this node type was resolved from (e.g., 'date-fns') */
  importSource?: string;
};

/**
 * Port configuration for instance-level overrides
 * Allows customizing how ports evaluate data and execution signals
 */
export type TPortConfig = {
  portName: string;
  direction?: 'INPUT' | 'OUTPUT';

  /**
   * Scope for scoped ports (e.g., "loop", "conditional")
   * Used to differentiate ports with same name across scopes
   */
  scope?: string;

  /**
   * Display order for this port in the UI
   * Instance-level override of node type's defaultOrder
   * Lower numbers appear first
   */
  order?: number;

  /**
   * Display label for this port in the UI
   * Instance-level override of node type's defaultLabel
   */
  label?: string;

  /**
   * Expression for data ports
   * Value is evaluated as JavaScript expression
   */
  expression?: string;

  /**
   * Execution signal evaluation for control flow ports
   * Defines when the node should execute
   */
  executionSignal?: {
    /**
     * all: AND - wait for all signals (COMBINED_CONJUNCTION)
     * any: OR - execute on first signal (COMBINED_DISJUNCTION)
     * expression: Custom JavaScript expression (CUSTOM)
     */
    type: 'all' | 'any' | 'expression';
    expression?: string; // Required when type is "expression"
  };

  /**
   * Legacy field - use `constant` instead
   * @deprecated Use `constant` with type and value instead
   */
  evaluateConstantAs?: {
    type: string;
    expression?: string;
    value?: TSerializableValue;
  };

  /**
   * Legacy field - use `executionSignal` instead
   * @deprecated Use `executionSignal` with type and expression instead
   */
  evaluateExecutionSignalAs?: {
    type: string;
    expression?: string;
  };
};

/**
 * Instance-specific configuration that can override node type defaults
 */
export type TNodeInstanceConfig = {
  pullExecution?: {
    triggerPort: string; // Override which STEP port triggers pull execution
  };
  label?: string;
  description?: string;
  executeWhen?: TExecuteWhen; // Override execution strategy

  /**
   * Port-level configuration overrides
   * Allows instances to customize port behavior
   */
  portConfigs?: TPortConfig[];

  // UI properties
  x?: number;
  y?: number;
  color?: string;
  icon?: string;
  tags?: TNodeTagAST[];
  minimized?: boolean;
  width?: number;
  height?: number;
};

/**
 * Node Instance AST - A usage of a node type in a workflow.
 *
 * Instances are like objects created from a class (node type).
 * They have unique IDs and can override node type defaults.
 *
 * Created by `@node` annotation in workflow:
 * ```
 * @node adder1 Add
 * @node processor Transform forEach1.iteration
 * ```
 */
export type TNodeInstanceAST = {
  type: 'NodeInstance';
  /** Unique ID within the workflow (e.g., 'adder1', 'processor') */
  id: string;
  /** Reference to the node type name (e.g., 'Add', 'Multiply') */
  nodeType: string;
  /** Instance-specific configuration overrides */
  config?: TNodeInstanceConfig;
  /** Parent scope (if inside a scoped node like forEach) */
  parent?: TNodeParent | null;
  /** Computed: nodes this instance depends on */
  dependencies?: string[];
  /** Computed: nodes that depend on this instance */
  dependents?: string[];
  /** Computed: whether this node is reachable from Start */
  isReachable?: boolean;
  /** Computed: whether this node contributes to Exit */
  isUsed?: boolean;
  /** Source location of @node annotation */
  sourceLocation?: TSourceLocation;
  /** Reserved for plugin extensibility */
  metadata?: TNodeMetadata;
};

/**
 * Type compatibility result for a connection.
 * Pre-computed during parsing using TypeScript's isAssignableTo().
 */
export type TTypeCompatibility = {
  /** Whether the types are compatible */
  isCompatible: boolean;
  /** The reason for the compatibility result */
  reason: 'exact' | 'assignable' | 'coercible' | 'incompatible';
  /** Source type as string */
  sourceType: string;
  /** Target type as string */
  targetType: string;
  /** Error message when incompatible */
  errorMessage?: string;
};

/**
 * Workflow-level options parsed from JSDoc annotations.
 */
export type TWorkflowOptions = {
  /** When true, type incompatibilities are errors instead of warnings */
  strictTypes?: boolean;
  /** When true, connections are auto-wired based on node declaration order */
  autoConnect?: boolean;
  /** Trigger configuration (event name and/or cron schedule) */
  trigger?: { event?: string; cron?: string };
  /** Cancellation configuration — cancel on matching external event */
  cancelOn?: { event: string; match?: string; timeout?: string };
  /** Number of retries on failure */
  retries?: number;
  /** Function-level timeout (e.g. "30m", "1h") */
  timeout?: string;
  /** Rate limiting configuration */
  throttle?: { limit: number; period?: string };
};

/**
 * Connection AST - A link between two ports.
 *
 * Format in annotation: `@connect fromNode.port -> toNode.port`
 * With scope: `@connect forEach1.item:iteration -> processor.input:iteration`
 */
export type TConnectionAST = {
  type: 'Connection';
  /** Source port reference */
  from: TPortReference;
  /** Target port reference */
  to: TPortReference;
  /** Source location of @connect annotation */
  sourceLocation?: TSourceLocation;
  /** Reserved for plugin extensibility */
  metadata?: TConnectionMetadata;
  /** Pre-computed type compatibility (set during parsing when ts-morph Types are available) */
  typeCompatibility?: TTypeCompatibility;
};

/**
 * Port Reference - Identifies a specific port on a node.
 */
export type TPortReference = {
  /** Node instance ID */
  node: string;
  /** Port name */
  port: string;
  /** Scope qualifier (for scoped ports) */
  scope?: string;
};

/**
 * Import Declaration - An import statement from the source file.
 */
export type TImportDeclaration = {
  type: 'Import';
  specifiers: TImportSpecifier[];
  /** Module path (e.g., './utils', 'lodash') */
  source: string;
  /** Whether this is a value or type-only import */
  importKind: 'value' | 'type';
};

/**
 * Import Specifier - A single imported item.
 */
export type TImportSpecifier = {
  /** Name in the source module */
  imported: string;
  /** Local alias (often same as imported) */
  local: string;
  /** Import type */
  kind: 'named' | 'default' | 'namespace';
};

/**
 * Port Definition - Defines a port's type and metadata.
 *
 * @remarks
 * **Reserved port names:**
 * - External: `execute`, `onSuccess`, `onFailure`
 * - Scoped: `start`, `success`, `failure`
 */
export type TPortDefinition = {
  /** Port data type (semantic category for color mapping) */
  dataType: TDataType;
  /** Original TypeScript type string (e.g., "User[]", "Map<string, number>") */
  tsType?: string;
  /** Schema breakdown for complex types (property name -> type string) */
  tsSchema?: Record<string, string>;
  /** Whether this port is optional */
  optional?: boolean;
  /** Default value if not connected */
  default?: TSerializableValue;
  /** JavaScript expression for computed value */
  expression?: string;
  /** Display label */
  label?: string;
  /** Description from JSDoc */
  description?: string;
  /** Whether to hide in UI */
  hidden?: boolean;
  /** Whether this is a failure output port */
  failure?: boolean;
  /** Whether this port carries control flow (STEP) */
  isControlFlow?: boolean;
  /** Scope this port belongs to (for scoped ports) */
  scope?: string;
  /** Merge strategy for fan-in connections (multiple sources) */
  mergeStrategy?: TMergeStrategy;
  /** Parameter order for preserving original function signature order */
  order?: number;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
};

/**
 * Data Type - The type of data a port carries.
 *
 * | Type     | TypeScript | Description |
 * |----------|------------|-------------|
 * | STRING   | `string`   | Text values |
 * | NUMBER   | `number`   | Numeric values |
 * | BOOLEAN  | `boolean`  | True/false |
 * | ARRAY    | `any[]`    | Arrays |
 * | OBJECT   | `any`      | Objects |
 * | FUNCTION | `(...) => any` | Callbacks |
 * | STEP     | `boolean`  | Control flow signal |
 * | ANY      | `any`      | Fallback for unknown types |
 */
export type TDataType =
  | 'STRING'
  | 'NUMBER'
  | 'BOOLEAN'
  | 'OBJECT'
  | 'ARRAY'
  | 'FUNCTION'
  | 'STEP'
  | 'ANY';

/** JSON-serializable value */
export type TSerializableValue =
  | string
  | number
  | boolean
  | null
  | TSerializableObject
  | TSerializableArray;

/** JSON-serializable object */
export type TSerializableObject = {
  [key: string]: TSerializableValue;
};

/** JSON-serializable array */
export type TSerializableArray = TSerializableValue[];

/**
 * Execute When - Controls when a node executes based on input signals.
 *
 * - `CONJUNCTION` - AND: Wait for ALL STEP inputs before executing
 * - `DISJUNCTION` - OR: Execute on FIRST STEP input received
 * - `CUSTOM` - Custom JavaScript expression
 */
export type TExecuteWhen = 'CONJUNCTION' | 'DISJUNCTION' | 'CUSTOM';

/**
 * Merge Strategy - How multiple connections to a DATA port are combined.
 *
 * - `FIRST` - Use first non-undefined value
 * - `LAST` - Use last non-undefined value
 * - `COLLECT` - Collect all values into an array
 * - `MERGE` - Merge objects with Object.assign
 * - `CONCAT` - Concatenate arrays
 */
export type TMergeStrategy = 'FIRST' | 'LAST' | 'COLLECT' | 'MERGE' | 'CONCAT';

/**
 * Branching Strategy - How a node determines success/failure output.
 *
 * - `value-based` - Branch based on return value field (uses `branchField`)
 * - `exception-based` - Branch based on thrown exceptions
 * - `none` - No branching logic
 */
export type TBranchingStrategy = 'value-based' | 'exception-based' | 'none';

export type TWorkflowMetadata = {
  generatedAt?: string;
  generatorVersion?: string;
  controlFlowGraph?: TControlFlowGraph;
  executionOrder?: string[];
  branchingNodes?: string[];
  mergeNodes?: string[];
  validated?: boolean;
  validationErrors?: TValidationError[];
  [key: string]: unknown;
};

// Reserved for plugin extensibility - do not use for core features
export type TNodeMetadata = {
  [key: string]: unknown;
};

/** Tag displayed on a node with optional tooltip */
export type TNodeTagAST = {
  label: string;
  tooltip?: string;
};

/** Visual customization for node types */
export type TNodeVisualsAST = {
  /** Theme color: blue, purple, teal, orange, pink, green */
  color?: string;
  /** Icon preset name */
  icon?: string;
  /** Tags displayed below the label */
  tags?: TNodeTagAST[];
};

export type TConnectionMetadata = {
  sourceLocation?: TSourceLocation;
  isControlFlow?: boolean;
  isDataFlow?: boolean;
  [key: string]: unknown;
};

export type TSourceLocation = {
  file: string;
  line: number;
  column: number;
};

export type TControlFlowGraph = {
  nodes: string[];
  edges: TControlFlowEdge[];
  inDegree: Record<string, number>;
  outDegree: Record<string, number>;
};

export type TControlFlowEdge = {
  from: string;
  to: string;
  type: 'success' | 'failure' | 'unconditional';
};

export type TValidationError = {
  type: 'error' | 'warning';
  code: string;
  message: string;
  node?: string;
  connection?: TConnectionAST;
  location?: TSourceLocation;
};

export type TAnalysisResult = {
  controlFlowGraph: TControlFlowGraph;
  executionOrder: string[];
  branchingNodes: TBranchingNodeInfo[];
  branchRegions: TBranchRegion[];
  mergeNodes: TMergeNodeInfo[];
  errors: TValidationError[];
  warnings: TValidationError[];
  unusedNodes: string[];
  inlineCandidates: string[];
};

export type TBranchingNodeInfo = {
  nodeName: string;
  strategy: TBranchingStrategy;
  branchField?: string;
  successNodes: string[];
  failureNodes: string[];
};

export type TBranchRegion = {
  branchNode: string;
  successNodes: Set<string>;
  failureNodes: Set<string>;
};

export type TMergeNodeInfo = {
  nodeName: string;
  sources: string[];
  executeWhen: TExecuteWhen;
};

export type TASTTransformer = {
  name: string;
  transform(ast: TWorkflowAST): TWorkflowAST;
};

export type TASTVisitor = {
  visitWorkflow?(ast: TWorkflowAST): void;
  visitNodeType?(nodeType: TNodeTypeAST): void;
  visitNodeInstance?(instance: TNodeInstanceAST): void;
  visitConnection?(connection: TConnectionAST): void;
  visitPort?(port: TPortDefinition, nodeName: string, portName: string): void;
};

export type TParseOptions = {
  filePath: string;
  includeLocations?: boolean;
  validate?: boolean;
  validationRules?: TValidationRule[];
};

export type TValidationRule = {
  name: string;
  validate(ast: TWorkflowAST): TValidationError[];
};

export type TGenerateOptions = {
  includeContext?: boolean;
  includeDebugEvents?: boolean;
  optimize?: 'none' | 'basic' | 'aggressive';
  outputFormat?: 'typescript' | 'javascript';
};

export type TCompileResult = {
  code: string;
  sourceMap?: string;
  ast: TWorkflowAST;
  analysis: TAnalysisResult;
  metadata: TCompilationMetadata;
};

export type TCompilationMetadata = {
  sourceFile: string;
  outputFile: string;
  compiledAt: string;
  compilerVersion: string;
  generationTime: number;
};

// ==================================================
// ADDITIONAL TYPES
// ==================================================

/**
 * Port definition with name and direction - used by IDE and node type discovery
 * dataType and type are interchangeable (type is IDE alias for dataType)
 */
export type TNodeTypePort = {
  name: string;
  direction: 'INPUT' | 'OUTPUT';
  dataType?: TDataType | string; // Accepts both TDataType and string for IDE flexibility
  type?: TDataType | string; // IDE alias for dataType
  tsType?: string; // Original TS type (e.g., "User[]", "Map<string, number>")
  defaultLabel?: string;
  defaultOrder?: number;
  defaultPlacement?: 'TOP' | 'BOTTOM' | 'LEFT' | 'RIGHT';
  defaultHidden?: boolean;
  reference?: string;
  optional?: boolean;
  default?: TSerializableValue;
  expression?: string;
  label?: string;
  description?: string;
  hidden?: boolean;
  failure?: boolean;
  isControlFlow?: boolean;
  metadata?: Record<string, unknown>;
  scope?: string;
};

/**
 * Port direction type
 */
export type TPortDirection = 'INPUT' | 'OUTPUT';

/**
 * Parent scope reference - structured format for setting node parent
 */
export type TNodeParent = {
  id: string;
  scope: string;
};

/**
 * Pull execution config extracted type
 */
export type TPullExecutionConfig = NonNullable<TNodeInstanceConfig['pullExecution']>;

/**
 * Workflow file extension type
 */
export type TWorkflowFileExtension = 'ts' | 'tsx' | 'js' | 'jsx';

/**
 * Port placement for UI rendering
 */
export type TPortPlacement = 'TOP' | 'BOTTOM' | 'CENTER' | 'LEFT' | 'RIGHT';

/**
 * UI-specific port metadata for rendering
 */
export type TPortUI = {
  name: string;
  direction?: 'INPUT' | 'OUTPUT';
  scope?: string;
  order: number;
  label: string;
  hidden: boolean;
  placement: TPortPlacement;
  failure?: boolean;
};

/**
 * UI-specific node type metadata for rendering
 */
export type TNodeTypeUI = {
  name: string;
  label: string;
  ports: TPortUI[];
};

/**
 * UI-specific node instance metadata for rendering
 */
export type TNodeUI = {
  name: string;
  label: string;
  ports: TPortUI[];
  x: number;
  y: number;
  width?: number;
  height?: number;
  expandedX?: number;
  expandedY?: number;
  expandedWidth?: number;
  expandedHeight?: number;
  minimized?: boolean;
  lastTouched?: number;
};

/**
 * UI-specific workflow metadata for rendering
 */
export type TWorkFlowFunctionUI = {
  nodeTypes: TNodeTypeUI[];
  instances: TNodeUI[];
  disablePan: boolean;
  disableZoom: boolean;
  /** In-memory only: stage transformation matrix (not persisted to file) */
  transformation?: number[];
};

/**
 * Pattern AST - A reusable workflow fragment that can be applied to workflows.
 *
 * Patterns are like workflow templates with IN/OUT pseudo-nodes instead of Start/Exit.
 * They can be applied to workflows to insert nodes, connections, and types.
 *
 * ```
 * ┌─────────────────────────────────────────────────────────────┐
 * │                        PATTERN                               │
 * │  ┌─────────────────┐    ┌─────────────────┐                 │
 * │  │  NODE TYPES     │    │  NODE INSTANCES │                 │
 * │  │  (inline/refs)  │◄───│  (pattern nodes)│                 │
 * │  └─────────────────┘    └─────────────────┘                 │
 * │                              │                               │
 * │  ┌───────────────────────────▼───────────────────────────┐  │
 * │  │                   CONNECTIONS                          │  │
 * │  │  IN.port → node.port, node.port → OUT.port             │  │
 * │  └────────────────────────────────────────────────────────┘  │
 * │  inputPorts{} ─────────────────────────────► outputPorts{}   │
 * └─────────────────────────────────────────────────────────────┘
 * ```
 *
 * @example
 * ```typescript
 * const pattern: TPatternAST = {
 *   type: "Pattern",
 *   name: "validateTransform",
 *   description: "Validate then transform data",
 *   nodeTypes: [...],
 *   instances: [...],
 *   connections: [...],
 *   inputPorts: { data: { description: "Input data" } },
 *   outputPorts: { result: { description: "Transformed result" } }
 * };
 * ```
 */
export type TPatternAST = {
  type: 'Pattern';
  /** Source file path */
  sourceFile: string;
  /** Pattern name (from @name) */
  name: string;
  /** Description from @description */
  description?: string;
  /**
   * Node types defined inline in this pattern.
   * Referenced node types are not included here.
   */
  nodeTypes: TNodeTypeAST[];
  /**
   * Instances are the nodes in the pattern graph.
   * Each instance references a node type by name.
   */
  instances: TNodeInstanceAST[];
  /** Connections between pattern nodes and IN/OUT */
  connections: TConnectionAST[];
  /** Input ports (connections from IN pseudo-node) */
  inputPorts: Record<string, TPatternPortDefinition>;
  /** Output ports (connections to OUT pseudo-node) */
  outputPorts: Record<string, TPatternPortDefinition>;
  /** Source location of the pattern annotation */
  sourceLocation?: TSourceLocation;
  /** Reserved for plugin extensibility */
  metadata?: Record<string, unknown>;
};

/**
 * Pattern Port Definition - A port on the IN or OUT pseudo-nodes.
 */
export type TPatternPortDefinition = {
  /** Port description from @port annotation */
  description?: string;
  /** Data type if known */
  dataType?: TDataType;
  /** Original TypeScript type string */
  tsType?: string;
};

/**
 * Convenience alias - TPortType = TDataType
 */
export type TPortType = TDataType;

/**
 * Module Format - The JavaScript module system to use for generated code.
 *
 * - `esm` - ECMAScript modules (import/export)
 * - `cjs` - CommonJS modules (require/module.exports)
 */
export type TModuleFormat = 'esm' | 'cjs';
