/**
 * Semantic diff types for workflow comparison.
 * Compares semantic fields, ignores visual/metadata fields.
 */

import type { TPortDefinition, TPortConfig, TExecuteWhen, TBranchingStrategy } from '../ast/types.js';

/** Impact level of a change */
export type TImpactLevel = 'CRITICAL' | 'BREAKING' | 'MINOR' | 'COSMETIC';

/** Change operation type */
export type TChangeType = 'ADDED' | 'REMOVED' | 'MODIFIED';

/** Base change record */
export interface TChange<T = unknown> {
  type: TChangeType;
  before?: T;
  after?: T;
}

/** Port definition change */
export interface TPortChange extends TChange<TPortDefinition> {
  portName: string;
  direction: 'INPUT' | 'OUTPUT';
}

/** Node type semantic diff */
export interface TNodeTypeDiff {
  name: string;
  changeType: TChangeType;
  changes: {
    functionName?: TChange<string>;
    inputs?: TPortChange[];
    outputs?: TPortChange[];
    executeWhen?: TChange<TExecuteWhen>;
    branchingStrategy?: TChange<TBranchingStrategy>;
    isAsync?: TChange<boolean>;
    scope?: TChange<string | undefined>;
    variant?: TChange<string | undefined>;
  };
}

/** Instance config change */
export interface TInstanceConfigChange {
  pullExecution?: TChange<{ triggerPort: string } | undefined>;
  portConfigs?: TChange<TPortConfig[] | undefined>;
}

/** Instance UI change (position, label, etc.) */
export interface TInstanceUIChange {
  label?: TChange<string>;
  position?: TChange<{ x: number; y: number }>;
  size?: TChange<{ width: number; height: number }>;
  minimized?: TChange<boolean>;
}

/** Node instance semantic diff */
export interface TInstanceDiff {
  id: string;
  changeType: TChangeType;
  changes: {
    nodeType?: TChange<string>;
    config?: TInstanceConfigChange;
    parent?: TChange<{ id: string; scope: string } | null | undefined>;
    ui?: TInstanceUIChange;
  };
}

/** Port reference for connections */
export interface TPortRef {
  node: string;
  port: string;
  scope?: string;
}

/** Connection semantic diff */
export interface TConnectionDiff {
  changeType: TChangeType;
  from: TPortRef;
  to: TPortRef;
}

/** Start/Exit port diff */
export interface TWorkflowPortsDiff {
  added: Array<{ name: string; definition: TPortDefinition }>;
  removed: Array<{ name: string; definition: TPortDefinition }>;
  modified: Array<{ name: string; before: TPortDefinition; after: TPortDefinition }>;
}

/** Scope diff */
export interface TScopeDiff {
  name: string;
  changeType: TChangeType;
  before?: string[];
  after?: string[];
}

/** Complete workflow diff */
export interface TWorkflowDiff {
  /** Whether workflows are semantically identical */
  identical: boolean;
  /** Overall impact level */
  impact: TImpactLevel;
  /** Summary counts */
  summary: {
    nodeTypesAdded: number;
    nodeTypesRemoved: number;
    nodeTypesModified: number;
    instancesAdded: number;
    instancesRemoved: number;
    instancesModified: number;
    instancesUIModified: number;
    connectionsAdded: number;
    connectionsRemoved: number;
  };
  /** Detailed changes */
  nodeTypes: TNodeTypeDiff[];
  instances: TInstanceDiff[];
  connections: TConnectionDiff[];
  startPorts: TWorkflowPortsDiff;
  exitPorts: TWorkflowPortsDiff;
  scopes: TScopeDiff[];
}

/**
 * Fields to compare for semantic diff.
 * Everything else is ignored (visual, metadata, computed).
 */
export const SEMANTIC_NODE_TYPE_FIELDS = [
  'name',
  'functionName',
  'inputs',
  'outputs',
  'executeWhen',
  'branchingStrategy',
  'isAsync',
  'scope',
  'variant',
] as const;

export const SEMANTIC_INSTANCE_FIELDS = [
  'id',
  'nodeType',
  'config.pullExecution',
  'config.portConfigs',
  'parent',
] as const;

export const SEMANTIC_CONNECTION_FIELDS = [
  'from.node',
  'from.port',
  'from.scope',
  'to.node',
  'to.port',
  'to.scope',
] as const;
