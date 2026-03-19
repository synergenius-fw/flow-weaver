/**
 * Core metadata extractor.
 *
 * Provides runtime-accessible arrays and objects for data types, strategies,
 * reserved names, templates, and package exports — derived from the actual
 * source constants so documentation stays in sync automatically.
 */

import {
  RESERVED_NODE_NAMES,
  RESERVED_PORT_NAMES,
  SCOPED_PORT_NAMES,
  EXECUTION_STRATEGIES,
  BRANCHING_STRATEGIES,
  VALID_NODE_COLORS,
} from '../../constants.js';

import {
  workflowTemplates,
  nodeTemplates,
  type WorkflowTemplate,
  type NodeTemplate,
} from '../../cli/templates/index.js';

// ── Data Types ──────────────────────────────────────────────────────────

/** All supported port data types (runtime array, mirrors TDataType union). */
export const DATA_TYPES = [
  'STRING',
  'NUMBER',
  'BOOLEAN',
  'OBJECT',
  'ARRAY',
  'FUNCTION',
  'STEP',
  'ANY',
] as const;

/** All supported merge strategies (runtime array, mirrors TMergeStrategy union). */
export const MERGE_STRATEGIES = ['FIRST', 'LAST', 'COLLECT', 'MERGE', 'CONCAT'] as const;

/** All supported branching strategies (runtime array, mirrors TBranchingStrategy union). */
export const BRANCHING_STRATEGY_VALUES = ['value-based', 'exception-based', 'none'] as const;

/** All supported execution strategies (runtime array, mirrors TExecuteWhen union). */
export const EXECUTION_STRATEGY_VALUES = ['CONJUNCTION', 'DISJUNCTION', 'CUSTOM'] as const;

// ── Reserved Names ──────────────────────────────────────────────────────

export { RESERVED_NODE_NAMES, RESERVED_PORT_NAMES, SCOPED_PORT_NAMES };
export { EXECUTION_STRATEGIES, BRANCHING_STRATEGIES, VALID_NODE_COLORS };

// ── Templates ───────────────────────────────────────────────────────────

/** Summary of a workflow template (without the generate function). */
export interface TemplateSummary {
  id: string;
  name: string;
  description: string;
  category: string;
}

/** All registered workflow templates (id, name, description, category). */
export const WORKFLOW_TEMPLATES: TemplateSummary[] = workflowTemplates.map(
  ({ id, name, description, category }) => ({ id, name, description, category }),
);

/** All registered node templates (id, name, description, category). */
export const NODE_TEMPLATES: TemplateSummary[] = nodeTemplates.map(
  ({ id, name, description, category }) => ({ id, name, description, category }),
);

// Re-export full template types for consumers that need them
export type { WorkflowTemplate, NodeTemplate };

// ── Package Exports ─────────────────────────────────────────────────────

/** All named export subpaths from @synergenius/flow-weaver/package.json. */
export const PACKAGE_EXPORTS = [
  { subpath: '.', description: 'Core library (parser, validator, compiler)' },
  { subpath: './runtime', description: 'Workflow runtime executor' },
  { subpath: './built-in-nodes', description: 'Standard node type library' },
  { subpath: './diagram', description: 'Diagram rendering (SVG/Mermaid)' },
  { subpath: './describe', description: 'Workflow description formatter' },
  { subpath: './doc-metadata', description: 'Documentation metadata extractors' },
  { subpath: './docs', description: 'Documentation generation utilities' },
  { subpath: './ast', description: 'AST type definitions and builders' },
  { subpath: './api', description: 'Public API (parseWorkflow, validateWorkflow, etc.)' },
  { subpath: './diff', description: 'Workflow semantic diff engine' },
  { subpath: './editor', description: 'Editor completions and diagnostics' },
  { subpath: './browser', description: 'Browser-compatible JSDoc port sync' },
  { subpath: './generated-branding', description: 'Generated branding configuration' },
  { subpath: './npm-packages', description: 'NPM package metadata' },
  { subpath: './deployment', description: 'Deployment target configurations' },
  { subpath: './marketplace', description: 'Extension/pack marketplace APIs' },
  { subpath: './testing', description: 'Testing utilities' },
  { subpath: './generator', description: 'Code generation' },
  { subpath: './constants', description: 'Constants and reserved names' },
  { subpath: './cli', description: 'CLI command definitions' },
  { subpath: './executor', description: 'MCP workflow executor' },
  { subpath: './context', description: 'LLM context generation' },
] as const;
