import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { templateHandlers } from '../../../../src/cli/tunnel/handlers/templates.js';
import type { TunnelContext } from '../../../../src/cli/tunnel/dispatch.js';

let tmpDir: string;
let ctx: TunnelContext;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'templates-test-'));
  ctx = { workspaceRoot: tmpDir };
});

describe('template handlers', () => {
  describe('listTemplates', () => {
    it('returns workflow templates by default', async () => {
      const result = (await templateHandlers.listTemplates({}, ctx)) as any;
      expect(result.templates).toBeDefined();
      expect(Array.isArray(result.templates)).toBe(true);
      expect(result.templates.length).toBeGreaterThan(0);
      expect(result.templates[0]).toHaveProperty('id');
      expect(result.templates[0]).toHaveProperty('name');
    });

    it('returns node templates when type=node', async () => {
      const result = (await templateHandlers.listTemplates({ type: 'node' }, ctx)) as any;
      expect(result.templates).toBeDefined();
      expect(result.templates.length).toBeGreaterThan(0);
    });
  });

  describe('getTemplate', () => {
    it('returns template by id', async () => {
      const result = await templateHandlers.getTemplate({ id: 'sequential' }, ctx);
      expect(result).not.toBeNull();
      expect((result as any).id).toBe('sequential');
    });

    it('returns null for unknown id', async () => {
      const result = await templateHandlers.getTemplate({ id: 'nonexistent' }, ctx);
      expect(result).toBeNull();
    });
  });

  describe('generateWorkflowCode', () => {
    it('generates code from template', async () => {
      const result = (await templateHandlers.generateWorkflowCode(
        { templateId: 'sequential', workflowName: 'testFlow' },
        ctx,
      )) as any;

      expect(result.code).toBeDefined();
      expect(typeof result.code).toBe('string');
      expect(result.code.length).toBeGreaterThan(0);
    });

    it('throws for missing templateId', async () => {
      await expect(
        templateHandlers.generateWorkflowCode({ workflowName: 'test' }, ctx),
      ).rejects.toThrow();
    });
  });

  describe('generateNodeCode', () => {
    it('generates node code from template', async () => {
      const result = (await templateHandlers.generateNodeCode(
        { templateId: 'llm-call', name: 'myNode' },
        ctx,
      )) as any;

      expect(result.code).toBeDefined();
      expect(typeof result.code).toBe('string');
    });
  });

  describe('getTemplatePreviewAST', () => {
    it('returns preview AST for valid template', async () => {
      const result = (await templateHandlers.getTemplatePreviewAST(
        { templateId: 'sequential' },
        ctx,
      )) as any;

      expect(result.ast).not.toBeNull();
    });

    it('returns null AST for unknown template', async () => {
      const result = (await templateHandlers.getTemplatePreviewAST(
        { templateId: 'nonexistent' },
        ctx,
      )) as any;

      expect(result.ast).toBeNull();
    });
  });

  describe('createWorkflowFromTemplate', () => {
    it('creates a workflow file from template', async () => {
      const result = (await templateHandlers.createWorkflowFromTemplate(
        {
          templateId: 'sequential',
          workflowName: 'newFlow',
          fileName: 'new-flow.ts',
        },
        ctx,
      )) as any;

      expect(result.success).toBe(true);
      expect(result.filePath).toBe('/new-flow.ts');

      const content = await fs.readFile(path.join(tmpDir, 'new-flow.ts'), 'utf-8');
      expect(content.length).toBeGreaterThan(0);
    });

    it('uses workflowName as filename when fileName not provided', async () => {
      const result = (await templateHandlers.createWorkflowFromTemplate(
        { templateId: 'sequential', workflowName: 'autoName' },
        ctx,
      )) as any;

      expect(result.success).toBe(true);
      const exists = await fs.access(path.join(tmpDir, 'autoName.ts')).then(
        () => true,
        () => false,
      );
      expect(exists).toBe(true);
    });
  });
});
