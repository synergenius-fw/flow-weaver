/**
 * Execution handlers for the tunnel CLI.
 * executeFile, compileFile, generateDiagram
 */

import * as fs from 'node:fs/promises';
import { compileWorkflow } from '../../../api/compile.js';
import { resolvePath } from '../path-resolver.js';
import type { HandlerFn } from '../dispatch.js';

let sourceToSVG: ((code: string, options?: any) => string) | undefined;

async function loadDiagram(): Promise<typeof sourceToSVG> {
  if (sourceToSVG) return sourceToSVG;
  try {
    const mod = await import('../../../diagram/index.js');
    sourceToSVG = mod.sourceToSVG;
    return sourceToSVG;
  } catch {
    return undefined;
  }
}

export const executionHandlers: Record<string, HandlerFn> = {
  executeFile: async (params, ctx) => {
    const filePath = params.filePath as string;
    if (!filePath) throw new Error('filePath is required');

    const resolved = resolvePath(ctx.workspaceRoot, filePath);
    const inputData = (params.inputData || params.input || {}) as Record<string, unknown>;

    try {
      // Dynamic import to avoid bundling issues — uses the MCP workflow executor
      const { executeWorkflowFromFile } = await import('../../../mcp/workflow-executor.js');
      const result = await executeWorkflowFromFile(resolved, inputData);
      return result;
    } catch (err: unknown) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },

  compileFile: async (params, ctx) => {
    const filePath = params.filePath as string;
    if (!filePath) throw new Error('filePath is required');

    const resolved = resolvePath(ctx.workspaceRoot, filePath);

    try {
      const result = await compileWorkflow(resolved);
      return result;
    } catch (err: unknown) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },

  generateDiagram: async (params, ctx) => {
    const filePath = params.filePath as string;
    const content = params.content as string | undefined;

    let source: string;
    if (content) {
      source = content;
    } else if (filePath) {
      const resolved = resolvePath(ctx.workspaceRoot, filePath);
      source = await fs.readFile(resolved, 'utf-8');
    } else {
      throw new Error('filePath or content is required');
    }

    const render = await loadDiagram();
    if (!render) {
      return { success: false, error: 'Diagram module not available' };
    }

    try {
      const svg = render(source, {
        workflowName: params.workflowName as string | undefined,
      });
      return { success: true, svg };
    } catch (err: unknown) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};
