import type { TDataType } from "./ast/types";

/**
 * Configuration for a single port on a node type.
 * Defines the data type, display label, default value, and behavioral flags.
 */
export interface PortConfig {
  type: TDataType;
  label?: string;
  defaultValue?: unknown;
  expression?: string;
  optional?: boolean;
  hidden?: boolean;
  failure?: boolean;
}

/**
 * Determines how a node evaluates incoming execution signals before firing.
 * - `"CONJUNCTION"` - All incoming signals must be present (AND logic).
 * - `"DISJUNCTION"` - Any single incoming signal triggers execution (OR logic).
 * - `"CUSTOM"` - Execution timing is controlled by custom logic.
 */
export type ExecutionSignalEvaluation =
  | "CONJUNCTION"
  | "DISJUNCTION"
  | "CUSTOM";

/**
 * Default configuration embedded in a node type definition.
 * Provides pull-execution settings, label, and description that apply
 * unless overridden at the instance level.
 */
export interface ParsedTNodeTypeDefaultConfig {
  pullExecution?: {
    triggerPort: string;
  };
  label?: string;
  description?: string;
}

/**
 * A fully parsed node type definition extracted from source code.
 * Contains the node's name, function reference, port definitions, execution
 * semantics, and source location metadata.
 */
export interface ParsedNodeType {
  name: string;
  functionName: string;
  inputs: Record<string, PortConfig>;
  outputs: Record<string, PortConfig>;
  functionText: string;
  executeWhen: ExecutionSignalEvaluation;
  defaultConfig?: ParsedTNodeTypeDefaultConfig;
  scope?: string;
  label?: string;
  description?: string;
  sourceLocation: {
    file: string;
    line: number;
  };
}

/**
 * Per-instance configuration for a node within a workflow.
 * Overrides the node type's default config with instance-specific
 * settings such as position, label, and execution behavior.
 */
export interface ParsedTNodeInstanceConfig {
  pullExecution?: {
    triggerPort: string;
  };
  label?: string;
  description?: string;
  executeWhen?: ExecutionSignalEvaluation;
  x?: number;
  y?: number;
  color?: string;
}

/**
 * A parsed node instance within a workflow definition.
 * References a node type by name and carries optional per-instance configuration,
 * scope membership, and visual state.
 */
export interface ParsedNodeInstance {
  id: string;
  type: string;
  config?: ParsedTNodeInstanceConfig;
  parentScope?: string;
  minimized?: boolean;
}

/**
 * A reference to a specific port on a specific node, used in connection definitions.
 */
export interface TPortReference {
  node: string;
  port: string;
}

/**
 * A fully parsed workflow definition extracted from source code.
 * Contains the workflow's node instances, connections, port definitions,
 * optional layout/scope metadata, and source location.
 */
export interface ParsedWorkflowDefinition {
  name: string;
  functionName: string;
  instances: ParsedNodeInstance[];
  connections: Array<{
    from: TPortReference;
    to: TPortReference;
  }>;
  scopes?: Record<string, string[]>;
  /**
   * Optional layout information for visual editor integration.
   * Maps node names to {x, y} coordinates.
   * Not required for code-first workflows.
   */
  layout?: Record<string, { x: number; y: number }>;
  startPorts: Record<string, PortConfig>;
  exitPorts: Record<string, PortConfig>;
  description?: string;
  sourceLocation: {
    file: string;
    line: number;
  };
}

/**
 * Top-level parse result for a single source file.
 * Aggregates all node type definitions and workflow definitions found in the file.
 */
export interface ParsedWorkflow {
  filePath: string;
  nodeTypes: ParsedNodeType[];
  workflows: ParsedWorkflowDefinition[];
}

/**
 * Normalizes a port definition to a full {@link PortConfig} object.
 * If the input is a string, it is treated as the data type name and wrapped
 * in a minimal PortConfig. If already a PortConfig, it is returned as-is.
 *
 * @param portDef - A data type string or a full PortConfig object.
 * @returns A normalized PortConfig.
 */
export function normalizePortConfig(portDef: string | PortConfig): PortConfig {
  if (typeof portDef === "string") {
    return { type: portDef as TDataType };
  }
  return portDef;
}
