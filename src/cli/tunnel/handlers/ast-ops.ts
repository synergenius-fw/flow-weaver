/**
 * AST read-operation handlers for the tunnel CLI.
 * Ported from flow-weaver-platform/src/routes/studio-rpc.ts + src/services/ast-helpers.ts.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { parser, resolveNpmNodeTypes } from '../../../parser.js';
import { validateWorkflow } from '../../../api/validate.js';
import type { TWorkflowAST, TNodeTypeAST } from '../../../ast/types.js';
import { resolvePath, toVirtualPath } from '../path-resolver.js';
import type { HandlerFn } from '../dispatch.js';

// ---------------------------------------------------------------------------
// Helpers — ported from studio-rpc.ts lines 98-186
// ---------------------------------------------------------------------------

function ensureASTDefaults<T extends Record<string, unknown>>(ast: T): T {
  return {
    ...ast,
    instances: (ast as any).instances ?? [],
    connections: (ast as any).connections ?? [],
    nodeTypes: (ast as any).nodeTypes ?? [],
  };
}

function virtualizeASTPaths<T extends Record<string, unknown>>(ast: T, wsPath: string): T {
  const result = { ...ast } as any;

  // 1. sourceFile
  if (typeof result.sourceFile === 'string' && result.sourceFile.startsWith(wsPath)) {
    result.sourceFile = toVirtualPath(wsPath, result.sourceFile);
  }

  // 2. nodeTypes[].sourceLocation.file and nodeTypes[].path
  if (Array.isArray(result.nodeTypes)) {
    result.nodeTypes = result.nodeTypes.map((nt: any) => {
      const copy = { ...nt };
      if (copy.sourceLocation?.file?.startsWith(wsPath)) {
        copy.sourceLocation = { ...copy.sourceLocation, file: toVirtualPath(wsPath, copy.sourceLocation.file) };
      }
      if (typeof copy.path === 'string' && copy.path.startsWith(wsPath)) {
        copy.path = toVirtualPath(wsPath, copy.path);
      }
      return copy;
    });
  }

  // 3. instances[].sourceLocation.file
  if (Array.isArray(result.instances)) {
    result.instances = result.instances.map((inst: any) => {
      if (inst.sourceLocation?.file?.startsWith(wsPath)) {
        return {
          ...inst,
          sourceLocation: { ...inst.sourceLocation, file: toVirtualPath(wsPath, inst.sourceLocation.file) },
        };
      }
      return inst;
    });
  }

  return result;
}

function prepareMutationResult(ast: Record<string, unknown>, wsPath: string): Record<string, unknown> {
  return virtualizeASTPaths(ensureASTDefaults(ast), wsPath);
}

function getWorkflowName(params: Record<string, unknown>): string | undefined {
  return (params.functionName || params.workflowName || params.exportName) as string | undefined;
}

// ---------------------------------------------------------------------------
// Core AST operations — ported from ast-helpers.ts
// ---------------------------------------------------------------------------

async function loadWorkflowAST(
  filePath: string,
  functionName?: string,
): Promise<TWorkflowAST> {
  const parsed = parser.parse(filePath);
  const workflows = parsed.workflows || [];

  if (workflows.length === 0) {
    throw new Error(`No workflows found in ${filePath}`);
  }

  const target = functionName
    ? workflows.find((w: any) => w.functionName === functionName)
    : workflows[0];

  if (!target) {
    throw new Error(`Workflow "${functionName}" not found in ${filePath}`);
  }

  return resolveNpmNodeTypes(target, path.dirname(filePath));
}

async function loadAllWorkflowsAST(
  wsPath: string,
): Promise<Array<{ filePath: string; ast: TWorkflowAST }>> {
  const entries = await fs.readdir(wsPath, { withFileTypes: true });
  const results: Array<{ filePath: string; ast: TWorkflowAST }> = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
    if (entry.name === 'tsconfig.json' || entry.name === 'package.json') continue;

    const fullPath = path.join(wsPath, entry.name);
    try {
      const parsed = parser.parse(fullPath);
      const workflows = parsed.workflows || [];
      for (const wf of workflows) {
        const resolved = await resolveNpmNodeTypes(wf, wsPath);
        results.push({ filePath: fullPath, ast: resolved });
      }
    } catch {
      // Skip files that fail to parse
    }
  }

  return results;
}

function parseWorkflowFromContent(content: string): Array<{ name: string; ast: TWorkflowAST }> {
  const parsed = parser.parseFromString(content);
  const workflows = parsed.workflows || [];
  return workflows.map((wf: any) => ({
    name: wf.name || wf.functionName,
    ast: wf,
  }));
}

function getDiagnostics(source: string): { valid: boolean; errors: unknown[]; warnings: unknown[] } {
  const parsed = parser.parseFromString(source);

  if ((parsed.errors && parsed.errors.length > 0) || !parsed.workflows?.length) {
    return {
      valid: false,
      errors: (parsed.errors || []).map((e: any) => ({ message: typeof e === 'string' ? e : e.message || String(e) })),
      warnings: [],
    };
  }

  const allErrors: unknown[] = [];
  const allWarnings: unknown[] = [];

  for (const wf of parsed.workflows) {
    const result = validateWorkflow(wf);
    if (result.errors) allErrors.push(...result.errors);
    if (result.warnings) allWarnings.push(...result.warnings);
  }

  return { valid: allErrors.length === 0, errors: allErrors, warnings: allWarnings };
}

async function extractAllNodeTypes(wsPath: string): Promise<TNodeTypeAST[]> {
  const all = await loadAllWorkflowsAST(wsPath);
  const typeMap = new Map<string, TNodeTypeAST>();

  for (const { ast } of all) {
    for (const nt of (ast as any).nodeTypes || []) {
      if (!typeMap.has(nt.name)) {
        typeMap.set(nt.name, nt);
      }
    }
  }

  return Array.from(typeMap.values());
}

// ---------------------------------------------------------------------------
// Exported handlers
// ---------------------------------------------------------------------------

export { prepareMutationResult, getWorkflowName };

export const astOpsHandlers: Record<string, HandlerFn> = {
  loadWorkflowAST: async (params, ctx) => {
    const filePath = params.filePath as string;
    if (!filePath) throw new Error('filePath is required');

    const functionName = getWorkflowName(params);
    const resolved = resolvePath(ctx.workspaceRoot, filePath);
    const ast = await loadWorkflowAST(resolved, functionName);
    return virtualizeASTPaths(ensureASTDefaults(ast as any), ctx.workspaceRoot);
  },

  loadAllWorkflowsAST: async (_params, ctx) => {
    const all = await loadAllWorkflowsAST(ctx.workspaceRoot);
    return all.map(({ filePath, ast }) => ({
      filePath: toVirtualPath(ctx.workspaceRoot, filePath),
      ast: virtualizeASTPaths(ensureASTDefaults(ast as any), ctx.workspaceRoot),
    }));
  },

  parseWorkflowASTFromContent: async (params) => {
    const content = params.content as string;
    if (!content) throw new Error('content is required');

    const functionName = getWorkflowName(params);
    const results = parseWorkflowFromContent(content);

    if (functionName) {
      const match = results.find(
        (r) => r.name === functionName || (r.ast as any)?.functionName === functionName,
      );
      return match ? ensureASTDefaults(match.ast as any) : null;
    }

    return results.length > 0 ? ensureASTDefaults(results[0].ast as any) : null;
  },

  getAvailableWorkflowsInFile: async (params, ctx) => {
    const filePath = params.filePath as string;
    if (!filePath) return { availableWorkflows: [] };

    try {
      const resolved = resolvePath(ctx.workspaceRoot, filePath);
      const source = await fs.readFile(resolved, 'utf-8');
      const results = parseWorkflowFromContent(source);
      return {
        availableWorkflows: results.map((w) => ({
          name: (w.ast as any)?.name || w.name,
          functionName: (w.ast as any)?.functionName || w.name,
          isExported: true,
        })),
      };
    } catch {
      return { availableWorkflows: [] };
    }
  },

  getDiagnostics: async (params, ctx) => {
    // Source resolution priority: openFiles > content > file on disk
    let source: string | undefined;

    const openFiles = params.openFiles as Record<string, string> | undefined;
    const filePath = params.filePath as string | undefined;

    if (openFiles && filePath && openFiles[filePath]) {
      source = openFiles[filePath];
    } else if (typeof params.content === 'string') {
      source = params.content;
    } else if (filePath) {
      const resolved = resolvePath(ctx.workspaceRoot, filePath);
      source = await fs.readFile(resolved, 'utf-8');
    }

    if (!source) throw new Error('No source provided for diagnostics');

    const { errors, warnings } = getDiagnostics(source);

    // Transform to flat array for FileEditorPane
    const result: unknown[] = [];
    for (const e of errors) {
      result.push({
        severity: 'error',
        message: (e as any).message || String(e),
        start: (e as any).location ?? { line: 1, column: 0 },
      });
    }
    for (const w of warnings) {
      result.push({
        severity: 'warning',
        message: (w as any).message || String(w),
        start: (w as any).location ?? { line: 1, column: 0 },
      });
    }
    return result;
  },

  getNodeTypes: async (_params, ctx) => {
    const types = await extractAllNodeTypes(ctx.workspaceRoot);
    return types.map((t) => ({ name: t.name, label: t.name, nodeType: t }));
  },

  getNodeTypesBatch: async (params, ctx) => {
    const cursor = (params.cursor as string) || '0';
    const limit = (params.limit as number) || 50;
    const offset = parseInt(cursor, 10) || 0;

    const types = await extractAllNodeTypes(ctx.workspaceRoot);
    const all = types.map((t) => ({ name: t.name, label: t.name, nodeType: t }));
    const page = all.slice(offset, offset + limit);
    const nextCursor = offset + limit < all.length ? String(offset + limit) : null;

    return { types: page, cursor: nextCursor };
  },

  searchNodeTypes: async (params, ctx) => {
    const query = ((params.query as string) || '').toLowerCase();
    const types = await extractAllNodeTypes(ctx.workspaceRoot);
    const all = types.map((t) => ({ name: t.name, label: t.name, nodeType: t }));

    if (!query) return all;

    return all.filter(
      (t) => t.name.toLowerCase().includes(query) || t.label.toLowerCase().includes(query),
    );
  },
};
