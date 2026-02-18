/**
 * Public Template API
 *
 * Provides access to workflow and node templates for creating new flows.
 * Templates are starters that can be customized for specific use cases.
 *
 * @module
 */

import {
  workflowTemplates,
  nodeTemplates,
  getWorkflowTemplate as getWorkflowTemplateById,
  getNodeTemplate as getNodeTemplateById,
  type WorkflowTemplate,
  type NodeTemplate,
  type WorkflowTemplateOptions,
} from "../cli/templates";

// Re-export types for consumers
export type { WorkflowTemplate, NodeTemplate, WorkflowTemplateOptions };

/**
 * List all available workflow templates
 *
 * @returns Array of workflow template definitions
 *
 * @example
 * ```typescript
 * const templates = listWorkflowTemplates();
 * templates.forEach(t => console.log(`${t.id}: ${t.description}`));
 * ```
 */
export function listWorkflowTemplates(): WorkflowTemplate[] {
  return workflowTemplates;
}

/**
 * List all available node templates
 *
 * @returns Array of node template definitions
 *
 * @example
 * ```typescript
 * const templates = listNodeTemplates();
 * templates.forEach(t => console.log(`${t.id}: ${t.description}`));
 * ```
 */
export function listNodeTemplates(): NodeTemplate[] {
  return nodeTemplates;
}

/**
 * Get a workflow template by ID
 *
 * @param id - Template identifier (e.g., "sequential", "foreach", "ai-agent")
 * @returns Template definition or undefined if not found
 *
 * @example
 * ```typescript
 * const template = getWorkflowTemplate("sequential");
 * if (template) {
 *   console.log(template.description);
 * }
 * ```
 */
export function getWorkflowTemplate(id: string): WorkflowTemplate | undefined {
  return getWorkflowTemplateById(id);
}

/**
 * Get a node template by ID
 *
 * @param id - Template identifier (e.g., "validator", "transformer", "llm-call")
 * @returns Template definition or undefined if not found
 *
 * @example
 * ```typescript
 * const template = getNodeTemplate("validator");
 * if (template) {
 *   console.log(template.description);
 * }
 * ```
 */
export function getNodeTemplate(id: string): NodeTemplate | undefined {
  return getNodeTemplateById(id);
}

/**
 * Generate workflow code from a template
 *
 * @param templateId - Template identifier
 * @param options - Generation options including workflow name
 * @returns Generated TypeScript code
 * @throws Error if template not found
 *
 * @example
 * ```typescript
 * const code = generateWorkflowFromTemplate("sequential", {
 *   workflowName: "processOrder",
 *   async: true,
 * });
 * fs.writeFileSync("processOrder.ts", code);
 * ```
 */
export function generateWorkflowFromTemplate(
  templateId: string,
  options: WorkflowTemplateOptions
): string {
  const template = getWorkflowTemplateById(templateId);
  if (!template) {
    throw new Error(`Workflow template "${templateId}" not found`);
  }
  return template.generate(options);
}

/**
 * Generate node type code from a template
 *
 * @param templateId - Template identifier
 * @param name - Name for the generated node function
 * @returns Generated TypeScript code
 * @throws Error if template not found
 *
 * @example
 * ```typescript
 * const code = generateNodeFromTemplate("validator", "validateInput");
 * // Insert into existing file or create new one
 * ```
 */
export function generateNodeFromTemplate(
  templateId: string,
  name: string,
  config?: Record<string, unknown>
): string {
  const template = getNodeTemplateById(templateId);
  if (!template) {
    throw new Error(`Node template "${templateId}" not found`);
  }
  return template.generate(name, config);
}
