/**
 * What the JSDoc parser hands back.
 *
 * A `@flowWeaver nodeType` block becomes a `JSDocNodeTypeConfig` and a
 * `@flowWeaver workflow` block a `JSDocWorkflowConfig`: plain records of what
 * the tags said, with port types already read from the function signature.
 * Turning them into AST nodes, expanding the sugar tags and validating the
 * graph happen later, in node-inference and workflow-extraction.
 */
import type {
  TDataType,
  TPortConfig,
  TMergeStrategy,
  TNodeTagAST,
  TSerializableValue,
  THttpRoute,
  TCoerceTargetType,
} from '../../ast/types';

export interface JSDocNodeTypeConfig {
  name?: string;
  label?: string;
  description?: string;
  color?: string;
  icon?: string;
  tags?: Array<{ label: string; tooltip?: string }>;
  executeWhen?: string;
  scope?: string;
  expression?: boolean;
  /** Retry/fallback behavior implemented inside the node adapter. */
  resilience?: { retries?: number; fallback?: string };
  defaultConfig?: {
    pullExecution?: { triggerPort: string };
    label?: string;
    description?: string;
  };
  inputs?: Record<
    string,
    {
      type: TDataType;
      defaultValue?: unknown;
      optional?: boolean;
      label?: string;
      expression?: string;
      scope?: string;
      mergeStrategy?: TMergeStrategy;
      hidden?: boolean;
      metadata?: { order?: number };
      tsType?: string;
    }
  >;
  outputs?: Record<
    string,
    {
      type: TDataType;
      label?: string;
      scope?: string;
      hidden?: boolean;
      metadata?: { order?: number };
      tsType?: string;
    }
  >;
  /** Per-target deploy config from @deploy annotations on nodeType */
  deploy?: Record<string, Record<string, unknown>>;
}

export interface JSDocWorkflowConfig {
  name?: string;
  description?: string;
  strictTypes?: boolean;
  /** NPM package imports - external node types persisted in JSDoc */
  imports?: Array<{
    name: string; // e.g., "npm/autoprefixer/autoprefixer"
    functionName: string; // e.g., "autoprefixer"
    importSource: string; // e.g., "autoprefixer"
  }>;
  instances?: Array<{
    id: string;
    type: string;
    parentScope?: string;
    label?: string;
    portConfigs?: TPortConfig[];
    pullExecution?: { triggerPort: string };
    minimized?: boolean;
    color?: string;
    icon?: string;
    tags?: TNodeTagAST[];
    width?: number;
    height?: number;
    sourceLocation?: { line: number; column: number };
    /** Generic `[key: "value"]` bracket attributes, kept for packs to read. */
    attributes?: Record<string, string>;
    suppressWarnings?: string[];
  }>;
  connections?: Array<{
    from: { node: string; port: string; scope?: string };
    to: { node: string; port: string; scope?: string };
    sourceLocation?: { line: number; column: number };
    /** Explicit coercion from `@connect a.b -> c.d as <type>`. */
    coerce?: TCoerceTargetType;
  }>;
  scopes?: Record<string, string[]>;
  startPorts?: Record<
    string,
    {
      dataType?: TDataType;
      label?: string;
      optional?: boolean;
      default?: TSerializableValue;
      metadata?: { order?: number };
    }
  >;
  returnPorts?: Record<
    string,
    { dataType: TDataType; label?: string; metadata?: { order?: number } }
  >;
  /** When true, auto-wire linear connections between nodes in declaration order */
  autoConnect?: boolean;
  /** @map sugar macros that expand to full scope patterns */
  maps?: Array<{
    instanceId: string;
    childId: string;
    sourceNode: string;
    sourcePort: string;
    inputPort?: string;
    outputPort?: string;
  }>;
  /** @path sugar macros that expand to multi-step execution routes with scope walking */
  paths?: Array<{
    steps: Array<{ node: string; route?: 'ok' | 'fail' }>;
  }>;
  /** @fanOut macros that expand to 1-to-N connections */
  fanOuts?: Array<{
    source: { node: string; port: string };
    targets: Array<{ node: string; port?: string }>;
  }>;
  /** @fanIn macros that expand to N-to-1 connections */
  fanIns?: Array<{
    sources: Array<{ node: string; port?: string }>;
    target: { node: string; port: string };
  }>;
  /** @coerce macros that expand to synthetic coercion nodes + connections */
  coercions?: Array<{
    instanceId: string;
    source: { node: string; port: string };
    target: { node: string; port: string };
    targetType: 'string' | 'number' | 'boolean' | 'json' | 'object';
  }>;
  /** @trigger annotation: event name and/or cron schedule */
  trigger?: { event?: string; cron?: string };
  /** @http annotations: the routes the workflow is served on */
  http?: THttpRoute[];
  /** @cancelOn annotation: cancel on matching external event */
  cancelOn?: { event: string; match?: string; timeout?: string };
  /** @retries annotation: retry count */
  retries?: number;
  /** @timeout annotation: function-level timeout */
  timeout?: string;
  /** @throttle annotation: rate limiting */
  throttle?: { limit: number; period?: string };

  // ── Per-target deployment config from @deploy annotations ──────
  /** @deploy target key=value pairs */
  deploy?: Record<string, Record<string, unknown>>;
}
