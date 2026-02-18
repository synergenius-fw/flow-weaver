import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import * as path from 'path';
import * as fs from 'fs';
import {
  listWorkflowTemplates,
  listNodeTemplates,
  getWorkflowTemplate,
  getNodeTemplate,
  generateWorkflowFromTemplate,
  generateNodeFromTemplate,
} from '../api/templates.js';
import { makeToolResult, makeErrorResult } from './response-utils.js';

/**
 * Registers MCP tools for listing and scaffolding workflow/node templates.
 * Registers two tools:
 * - `fw_list_templates` - lists available scaffold templates, optionally filtered by type.
 * - `fw_scaffold` - generates a workflow or node file from a named template.
 * @param mcp - The MCP server instance to register tools on.
 */
export function registerTemplateTools(mcp: McpServer): void {
  mcp.tool(
    'fw_list_templates',
    'List available scaffold templates for workflows and nodes.',
    {
      type: z
        .enum(['workflow', 'node', 'all'])
        .optional()
        .describe('Filter template type (default: all)'),
    },
    async (args: { type?: 'workflow' | 'node' | 'all' }) => {
      const filterType = args.type ?? 'all';
      const result: Array<{
        id: string;
        name: string;
        description: string;
        type: string;
        category?: string;
      }> = [];
      if (filterType === 'workflow' || filterType === 'all') {
        for (const t of listWorkflowTemplates()) {
          result.push({
            id: t.id,
            name: t.name,
            description: t.description,
            type: 'workflow',
            category: t.category,
          });
        }
      }
      if (filterType === 'node' || filterType === 'all') {
        for (const t of listNodeTemplates()) {
          result.push({ id: t.id, name: t.name, description: t.description, type: 'node' });
        }
      }
      return makeToolResult(result);
    }
  );

  mcp.tool(
    'fw_scaffold',
    'Create a workflow or node from a template.',
    {
      template: z.string().describe('Template name (e.g. "sequential", "validator")'),
      filePath: z.string().describe('Output file path'),
      name: z.string().optional().describe('Workflow/node function name'),
      preview: z
        .boolean()
        .optional()
        .describe('Preview only — return generated code without writing (default: false)'),
      config: z
        .record(z.unknown())
        .optional()
        .describe('Template configuration (e.g. { nodes: ["fetch", "parse"], input: "rawData" })'),
    },
    async (args: {
      template: string;
      filePath: string;
      name?: string;
      preview?: boolean;
      config?: Record<string, unknown>;
    }) => {
      try {
        const outPath = path.resolve(args.filePath);
        // Try workflow template first
        const wt = getWorkflowTemplate(args.template);
        if (wt) {
          const code = generateWorkflowFromTemplate(args.template, {
            workflowName: args.name ?? 'myWorkflow',
            config: args.config,
          });
          if (args.preview) {
            return makeToolResult({
              success: true,
              preview: true,
              type: 'workflow',
              template: args.template,
              code,
            });
          }
          // Append to file if it exists, otherwise create
          if (fs.existsSync(outPath)) {
            fs.appendFileSync(outPath, '\n\n' + code, 'utf8');
          } else {
            fs.writeFileSync(outPath, code, 'utf8');
          }
          return makeToolResult({
            success: true,
            filePath: outPath,
            type: 'workflow',
            template: args.template,
          });
        }
        // Try node template
        const nt = getNodeTemplate(args.template);
        if (nt) {
          const code = generateNodeFromTemplate(args.template, args.name ?? 'myNode', args.config);
          if (args.preview) {
            return makeToolResult({
              success: true,
              preview: true,
              type: 'node',
              template: args.template,
              code,
            });
          }
          // Append to file if it exists, otherwise create
          if (fs.existsSync(outPath)) {
            fs.appendFileSync(outPath, '\n\n' + code, 'utf8');
          } else {
            fs.writeFileSync(outPath, code, 'utf8');
          }
          return makeToolResult({
            success: true,
            filePath: outPath,
            type: 'node',
            template: args.template,
          });
        }
        return makeErrorResult(
          'TEMPLATE_NOT_FOUND',
          `Template "${args.template}" not found. Use fw_list_templates to see available templates.`
        );
      } catch (err) {
        return makeErrorResult(
          'SCAFFOLD_ERROR',
          `fw_scaffold failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  );
}
