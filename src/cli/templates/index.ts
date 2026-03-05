/**
 * Flow Weaver Template Registry
 * Central registry for workflow and node templates
 */

// Import workflow templates
import { sequentialTemplate } from './workflows/sequential';
import { foreachTemplate } from './workflows/foreach';
import { conditionalTemplate } from './workflows/conditional';
import { aiAgentTemplate } from './workflows/ai-agent';
import { aiReactTemplate } from './workflows/ai-react';
import { aiRagTemplate } from './workflows/ai-rag';
import { aiChatTemplate } from './workflows/ai-chat';
import { aggregatorTemplate } from './workflows/aggregator';
import { webhookTemplate } from './workflows/webhook';
import { errorHandlerTemplate } from './workflows/error-handler';

// Import node templates
import { validatorNodeTemplate } from './nodes/validator';
import { transformerNodeTemplate } from './nodes/transformer';
import { httpNodeTemplate } from './nodes/http';
import { aggregatorNodeTemplate } from './nodes/aggregator';

// Import AI node templates
import { llmCallNodeTemplate } from './nodes/llm-call';
import { toolExecutorNodeTemplate } from './nodes/tool-executor';
import { conversationMemoryNodeTemplate } from './nodes/conversation-memory';

// Import agent node templates
import { promptTemplateNodeTemplate } from './nodes/prompt-template';
import { jsonExtractorNodeTemplate } from './nodes/json-extractor';
import { humanApprovalNodeTemplate } from './nodes/human-approval';
import { agentRouterNodeTemplate } from './nodes/agent-router';
import { ragRetrieverNodeTemplate } from './nodes/rag-retriever';

/**
 * Configuration field types
 */
export type ConfigFieldType = 'select' | 'string' | 'boolean' | 'number';

/**
 * A configuration field definition
 */
export interface ConfigField {
  type: ConfigFieldType;
  label: string;
  description?: string;
  default?: unknown;
  options?: Array<{ value: string; label: string }>; // for select
  placeholder?: string; // for string/number
  dependsOn?: {
    field: string;
    values: string[]; // only show if parent field has one of these values
  };
}

/**
 * Configuration schema for a template
 */
export interface ConfigSchema {
  [fieldName: string]: ConfigField;
}

/**
 * Options for generating a workflow template
 */
export interface WorkflowTemplateOptions {
  /** Name for the workflow function */
  workflowName: string;
  /** Whether to generate an async workflow */
  async?: boolean;
  /** Configuration values for the template */
  config?: Record<string, unknown>;
}

/**
 * A workflow template definition
 */
export interface WorkflowTemplate {
  /** Unique template ID (used in CLI) */
  id: string;
  /** Display name */
  name: string;
  /** Brief description of the template */
  description: string;
  /** Category for grouping */
  category: 'data-processing' | 'automation' | 'ai' | 'integration' | 'utility';
  /** Configuration schema for the template */
  configSchema?: ConfigSchema;
  /** Generate the template code */
  generate: (options: WorkflowTemplateOptions) => string;
}

/**
 * A node type template definition
 */
export interface NodeTemplate {
  /** Unique template ID */
  id: string;
  /** Display name */
  name: string;
  /** Brief description */
  description: string;
  /** Category for grouping */
  category: 'ai' | 'validation' | 'data' | 'integration' | 'workflow';
  /** Configuration schema for the template (optional) */
  configSchema?: ConfigSchema;
  /** Generate the template code */
  generate: (name: string, config?: Record<string, unknown>) => string;
}

/**
 * All available workflow templates
 */
export const workflowTemplates: WorkflowTemplate[] = [
  sequentialTemplate,
  foreachTemplate,
  conditionalTemplate,
  aiAgentTemplate,
  aiReactTemplate,
  aiRagTemplate,
  aiChatTemplate,
  aggregatorTemplate,
  webhookTemplate,
  errorHandlerTemplate,
];

/**
 * All available node templates
 */
export const nodeTemplates: NodeTemplate[] = [
  validatorNodeTemplate,
  transformerNodeTemplate,
  httpNodeTemplate,
  aggregatorNodeTemplate,
  llmCallNodeTemplate,
  toolExecutorNodeTemplate,
  conversationMemoryNodeTemplate,
  promptTemplateNodeTemplate,
  jsonExtractorNodeTemplate,
  humanApprovalNodeTemplate,
  agentRouterNodeTemplate,
  ragRetrieverNodeTemplate,
];

/**
 * Get a workflow template by ID.
 * Checks both core templates and any dynamically loaded pack templates.
 */
export function getWorkflowTemplate(id: string): WorkflowTemplate | undefined {
  return workflowTemplates.find((t) => t.id === id)
    ?? packWorkflowTemplates.find((t) => t.id === id);
}

/**
 * Get a node template by ID
 */
export function getNodeTemplate(id: string): NodeTemplate | undefined {
  return nodeTemplates.find((t) => t.id === id);
}

/**
 * Dynamically loaded pack templates. Populated by loadPackTemplates().
 */
const packWorkflowTemplates: WorkflowTemplate[] = [];

/**
 * Get all workflow templates including pack-contributed ones.
 */
export function getAllWorkflowTemplates(): WorkflowTemplate[] {
  return [...workflowTemplates, ...packWorkflowTemplates];
}

/**
 * Register workflow templates contributed by a built-in extension.
 * Unlike loadPackTemplates (which scans npm packages), this is for
 * in-tree extensions that register at bootstrap time.
 */
export function registerWorkflowTemplates(templates: WorkflowTemplate[]): void {
  for (const tmpl of templates) {
    if (!packWorkflowTemplates.some((t) => t.id === tmpl.id)) {
      packWorkflowTemplates.push(tmpl);
    }
  }
}

/**
 * Load workflow templates from installed pack manifests.
 * Templates declared in `initContributions.templates` are dynamically imported
 * and appended to the available template list.
 *
 * @param projectDir - Project root to scan for installed packs
 */
export async function loadPackTemplates(projectDir: string): Promise<void> {
  try {
    const { listInstalledPackages } = await import('../../marketplace/registry.js');
    const { registerPackUseCase } = await import('../commands/init-personas.js');
    const packages = await listInstalledPackages(projectDir);

    for (const pkg of packages) {
      const contributions = pkg.manifest.initContributions;
      if (!contributions?.templates) continue;

      // Register use case if declared
      if (contributions.useCase) {
        registerPackUseCase(contributions.useCase, contributions.templates);
      }

      // Pack templates must be exported from the pack's main entry point
      // or from a templates.js file alongside the manifest
      try {
        const templatesPath = await import('path').then((p) =>
          p.join(pkg.path, 'templates.js'),
        );
        const { existsSync } = await import('fs');
        if (!existsSync(templatesPath)) continue;

        const mod = await import(templatesPath);
        if (mod.workflowTemplates && Array.isArray(mod.workflowTemplates)) {
          for (const tmpl of mod.workflowTemplates) {
            if (contributions.templates.includes(tmpl.id)) {
              if (!packWorkflowTemplates.some((t) => t.id === tmpl.id)) {
                packWorkflowTemplates.push(tmpl);
              }
            }
          }
        }
      } catch {
        // Skip packs that fail to load templates
      }
    }
  } catch {
    // Marketplace scanning not available (e.g., no node_modules)
  }
}

/**
 * Convert a string to camelCase
 */
export function toCamelCase(str: string): string {
  // Preserve leading underscores/dollar signs
  const leadingMatch = str.match(/^[_$]+/);
  const leading = leadingMatch ? leadingMatch[0] : '';
  const rest = leading ? str.slice(leading.length) : str;

  const result = rest
    .replace(/[-_\s]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ''))
    .replace(/^[^a-zA-Z_$]+/, '') // Strip leading non-identifier chars
    .replace(/^./, (c) => c.toLowerCase());

  const final = leading + result;
  return final || '_' + str.replace(/[^a-zA-Z0-9_$]/g, '');
}

/**
 * Convert a string to PascalCase (for labels)
 */
export function toPascalCase(str: string): string {
  const camel = toCamelCase(str);
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}
