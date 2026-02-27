/**
 * Template operation handlers for the tunnel CLI.
 * Ported from flow-weaver-platform/src/services/ast-helpers.ts template operations.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { parser } from '../../../parser.js';
import {
  workflowTemplates,
  nodeTemplates,
  getWorkflowTemplate,
  getNodeTemplate,
} from '../../templates/index.js';
import { resolvePath } from '../path-resolver.js';
import type { HandlerFn } from '../dispatch.js';

function mapTemplate(t: any): { id: string; name: string; description: string; category: string; configSchema?: unknown } {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    category: t.category,
    ...(t.configSchema && { configSchema: t.configSchema }),
  };
}

export const templateHandlers: Record<string, HandlerFn> = {
  listTemplates: async (params) => {
    const type = (params.type as string) || 'workflow';
    const templates = type === 'node' ? nodeTemplates : workflowTemplates;
    return { templates: templates.map(mapTemplate) };
  },

  getTemplate: async (params) => {
    const type = (params.type as string) || 'workflow';
    const id = params.id as string;
    if (!id) throw new Error('id is required');

    const template = type === 'node' ? getNodeTemplate(id) : getWorkflowTemplate(id);
    return template ? mapTemplate(template) : null;
  },

  getTemplatePreviewAST: async (params) => {
    const templateId = params.templateId as string;
    if (!templateId) return { ast: null };

    const template = getWorkflowTemplate(templateId);
    if (!template) return { ast: null };

    try {
      const code = template.generate({ workflowName: 'preview' });
      const parsed = parser.parseFromString(code);
      const workflows = parsed.workflows || [];
      return { ast: workflows[0] || null };
    } catch {
      return { ast: null };
    }
  },

  generateWorkflowCode: async (params) => {
    const templateId = params.templateId as string;
    const workflowName = params.workflowName as string;
    if (!templateId || !workflowName) throw new Error('templateId and workflowName are required');

    const template = getWorkflowTemplate(templateId);
    if (!template) throw new Error(`Template "${templateId}" not found`);

    const options: Record<string, unknown> = { workflowName };
    if (params.async !== undefined) options.async = params.async;
    if (params.config) options.config = params.config;

    const code = template.generate(options as any);
    return { code };
  },

  generateNodeCode: async (params) => {
    const templateId = params.templateId as string;
    const name = params.name as string;
    if (!templateId || !name) throw new Error('templateId and name are required');

    const template = getNodeTemplate(templateId);
    if (!template) throw new Error(`Node template "${templateId}" not found`);

    const code = template.generate(name, params.config as any);
    return { code };
  },

  getNodeTemplatePreview: async (params) => {
    const templateId = params.templateId as string;
    const name = (params.name as string) || 'preview';

    const template = getNodeTemplate(templateId);
    if (!template) return null;

    try {
      const code = template.generate(name);
      const parsed = parser.parseFromString(code);
      const workflows = parsed.workflows || [];
      const nodeTypes = workflows[0]?.nodeTypes || [];
      if (nodeTypes.length === 0) return null;

      const nt = nodeTypes[0] as any;
      return {
        name: nt.name,
        inputs: nt.inputs || nt.ports?.filter((p: any) => p.direction === 'input') || [],
        outputs: nt.outputs || nt.ports?.filter((p: any) => p.direction === 'output') || [],
      };
    } catch {
      return null;
    }
  },

  createWorkflowFromTemplate: async (params, ctx) => {
    const templateId = params.templateId as string;
    const workflowName = params.workflowName as string;
    const fileName = params.fileName as string;
    if (!templateId || !workflowName) throw new Error('templateId and workflowName are required');

    const template = getWorkflowTemplate(templateId);
    if (!template) throw new Error(`Template "${templateId}" not found`);

    const genOpts: Record<string, unknown> = { workflowName };
    if (params.async !== undefined) genOpts.async = params.async;
    if (params.config) genOpts.config = params.config;
    const code = template.generate(genOpts as any);

    const targetFileName = fileName || `${workflowName}.ts`;
    const resolved = resolvePath(ctx.workspaceRoot, targetFileName);
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, code, 'utf-8');

    return { success: true, filePath: '/' + targetFileName };
  },
};
