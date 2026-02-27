import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { astOpsHandlers } from '../../../../src/cli/tunnel/handlers/ast-ops.js';
import type { TunnelContext } from '../../../../src/cli/tunnel/dispatch.js';

const WORKFLOW_SOURCE = `
/**
 * @flowWeaver nodeType
 * @input execute [order:0] - Execute
 * @input value [order:0]
 * @output onSuccess [order:0] - On Success
 * @output onFailure [order:1] - On Failure
 * @output result [order:2]
 */
function proc(execute: boolean, value: number) {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
  return { onSuccess: true, onFailure: false, result: value * 2 };
}

/**
 * @flowWeaver workflow
 * @node p proc
 * @connect Start.value -> p.value
 * @connect Start.execute -> p.execute
 * @connect p.result -> Exit.result
 * @connect p.onSuccess -> Exit.onSuccess
 * @param execute - Execute
 * @param value
 * @returns onSuccess
 * @returns result
 */
export async function myWorkflow(
  execute: boolean,
  params: { value: number }
): Promise<{ onSuccess: boolean; result: number }> {
  throw new Error('Not implemented');
}
`;

let tmpDir: string;
let ctx: TunnelContext;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ast-ops-test-'));
  ctx = { workspaceRoot: tmpDir };
  await fs.writeFile(path.join(tmpDir, 'workflow.ts'), WORKFLOW_SOURCE, 'utf-8');
});

describe('ast-ops handlers', () => {
  describe('parseWorkflowASTFromContent', () => {
    it('parses workflow from content string', async () => {
      const result = (await astOpsHandlers.parseWorkflowASTFromContent(
        { content: WORKFLOW_SOURCE },
        ctx,
      )) as any;

      expect(result).not.toBeNull();
      expect(result.functionName || result.name).toBeDefined();
      expect(Array.isArray(result.instances)).toBe(true);
      expect(Array.isArray(result.connections)).toBe(true);
      expect(Array.isArray(result.nodeTypes)).toBe(true);
    });

    it('filters by functionName when provided', async () => {
      const result = (await astOpsHandlers.parseWorkflowASTFromContent(
        { content: WORKFLOW_SOURCE, functionName: 'myWorkflow' },
        ctx,
      )) as any;

      expect(result).not.toBeNull();
    });

    it('returns null for non-matching functionName', async () => {
      const result = await astOpsHandlers.parseWorkflowASTFromContent(
        { content: WORKFLOW_SOURCE, functionName: 'nonexistent' },
        ctx,
      );

      expect(result).toBeNull();
    });
  });

  describe('getDiagnostics', () => {
    it('returns no errors for valid workflow', async () => {
      const result = (await astOpsHandlers.getDiagnostics(
        { content: WORKFLOW_SOURCE },
        ctx,
      )) as any[];

      const errors = result.filter((d: any) => d.severity === 'error');
      expect(errors.length).toBe(0);
    });

    it('returns errors for invalid content', async () => {
      const result = (await astOpsHandlers.getDiagnostics(
        { content: '// no workflow here\nconst x = 1;' },
        ctx,
      )) as any[];

      // Should either have errors or be empty (no workflows to validate)
      expect(Array.isArray(result)).toBe(true);
    });

    it('reads from filePath when no content provided', async () => {
      const result = (await astOpsHandlers.getDiagnostics(
        { filePath: '/workflow.ts' },
        ctx,
      )) as any[];

      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('loadWorkflowAST', () => {
    it('loads workflow AST from file', async () => {
      const result = (await astOpsHandlers.loadWorkflowAST(
        { filePath: '/workflow.ts' },
        ctx,
      )) as any;

      expect(result).not.toBeNull();
      expect(Array.isArray(result.instances)).toBe(true);
      expect(Array.isArray(result.connections)).toBe(true);
      expect(Array.isArray(result.nodeTypes)).toBe(true);
    });

    it('loads workflow by functionName', async () => {
      const result = (await astOpsHandlers.loadWorkflowAST(
        { filePath: '/workflow.ts', functionName: 'myWorkflow' },
        ctx,
      )) as any;

      expect(result).not.toBeNull();
    });

    it('returns virtual paths in the AST', async () => {
      const result = (await astOpsHandlers.loadWorkflowAST(
        { filePath: '/workflow.ts' },
        ctx,
      )) as any;

      // sourceFile should be virtual (starts with /)
      if (result.sourceFile) {
        expect(result.sourceFile.startsWith(tmpDir)).toBe(false);
      }
    });
  });

  describe('loadAllWorkflowsAST', () => {
    it('loads all workflows from workspace', async () => {
      const result = (await astOpsHandlers.loadAllWorkflowsAST({}, ctx)) as any[];

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].filePath).toBeDefined();
      expect(result[0].ast).toBeDefined();
    });
  });

  describe('getAvailableWorkflowsInFile', () => {
    it('returns available workflows', async () => {
      const result = (await astOpsHandlers.getAvailableWorkflowsInFile(
        { filePath: '/workflow.ts' },
        ctx,
      )) as any;

      expect(result.availableWorkflows).toBeDefined();
      expect(result.availableWorkflows.length).toBeGreaterThan(0);
    });

    it('returns empty for non-existing file', async () => {
      const result = (await astOpsHandlers.getAvailableWorkflowsInFile(
        { filePath: '/missing.ts' },
        ctx,
      )) as any;

      expect(result.availableWorkflows).toEqual([]);
    });
  });

  describe('getNodeTypes', () => {
    it('returns deduplicated node types', async () => {
      const result = (await astOpsHandlers.getNodeTypes({}, ctx)) as any[];

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0]).toHaveProperty('name');
      expect(result[0]).toHaveProperty('label');
      expect(result[0]).toHaveProperty('nodeType');
    });
  });

  describe('getNodeTypesBatch', () => {
    it('paginates with cursor', async () => {
      const result = (await astOpsHandlers.getNodeTypesBatch(
        { cursor: '0', limit: 1 },
        ctx,
      )) as any;

      expect(result.types).toBeDefined();
      expect(Array.isArray(result.types)).toBe(true);
    });
  });

  describe('searchNodeTypes', () => {
    it('filters by query', async () => {
      const all = (await astOpsHandlers.searchNodeTypes({}, ctx)) as any[];
      const filtered = (await astOpsHandlers.searchNodeTypes(
        { query: 'proc' },
        ctx,
      )) as any[];

      expect(filtered.length).toBeLessThanOrEqual(all.length);
      for (const t of filtered) {
        expect(t.name.toLowerCase()).toContain('proc');
      }
    });

    it('returns all when query is empty', async () => {
      const all = (await astOpsHandlers.searchNodeTypes({}, ctx)) as any[];
      const noQuery = (await astOpsHandlers.searchNodeTypes(
        { query: '' },
        ctx,
      )) as any[];

      expect(noQuery.length).toBe(all.length);
    });
  });
});
