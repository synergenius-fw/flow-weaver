import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// ── Mock the templates module ────────────────────────────────────────────────
const mockListWorkflowTemplates = vi.fn();
const mockListNodeTemplates = vi.fn();
const mockGetWorkflowTemplate = vi.fn();
const mockGetNodeTemplate = vi.fn();
const mockGenerateWorkflowFromTemplate = vi.fn();
const mockGenerateNodeFromTemplate = vi.fn();

vi.mock('../../../src/api/templates.js', () => ({
  listWorkflowTemplates: (...args: unknown[]) => mockListWorkflowTemplates(...args),
  listNodeTemplates: (...args: unknown[]) => mockListNodeTemplates(...args),
  getWorkflowTemplate: (...args: unknown[]) => mockGetWorkflowTemplate(...args),
  getNodeTemplate: (...args: unknown[]) => mockGetNodeTemplate(...args),
  generateWorkflowFromTemplate: (...args: unknown[]) => mockGenerateWorkflowFromTemplate(...args),
  generateNodeFromTemplate: (...args: unknown[]) => mockGenerateNodeFromTemplate(...args),
}));

// ── Mock MCP SDK ─────────────────────────────────────────────────────────────
const toolHandlers = new Map<string, (args: unknown) => Promise<unknown>>();

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => {
  class MockMcpServer {
    tool(
      name: string,
      _description: string,
      _schema: Record<string, unknown>,
      handler: (args: unknown) => Promise<unknown>,
    ): void {
      toolHandlers.set(name, handler);
    }
  }
  return { McpServer: MockMcpServer };
});

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTemplateTools } from '../../../src/mcp/tools-template.js';

function parseResult(result: unknown): { success: boolean; data?: unknown; error?: unknown } {
  const r = result as { content: Array<{ text: string }>; isError?: boolean };
  return JSON.parse(r.content[0].text);
}

describe('tools-template', () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    toolHandlers.clear();
    const mcp = new McpServer({ name: 'test', version: '1.0.0' });
    registerTemplateTools(mcp);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-template-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── fw_list_templates ────────────────────────────────────────────────────

  describe('fw_list_templates', () => {
    function callList(args: Record<string, unknown>) {
      const handler = toolHandlers.get('fw_list_templates')!;
      expect(handler).toBeDefined();
      return handler(args);
    }

    it('returns all templates when type is "all"', async () => {
      mockListWorkflowTemplates.mockReturnValue([
        { id: 'sequential', name: 'Sequential', description: 'A sequential workflow', category: 'basic' },
      ]);
      mockListNodeTemplates.mockReturnValue([
        { id: 'validator', name: 'Validator', description: 'A validator node' },
      ]);

      const result = parseResult(await callList({ type: 'all' }));
      expect(result.success).toBe(true);
      const data = result.data as Array<{ id: string; type: string }>;
      expect(data).toHaveLength(2);
      expect(data[0].type).toBe('workflow');
      expect(data[1].type).toBe('node');
    });

    it('defaults to "all" when no type specified', async () => {
      mockListWorkflowTemplates.mockReturnValue([
        { id: 'seq', name: 'Seq', description: 'd', category: 'basic' },
      ]);
      mockListNodeTemplates.mockReturnValue([]);

      const result = parseResult(await callList({}));
      expect(result.success).toBe(true);
      expect(mockListWorkflowTemplates).toHaveBeenCalled();
      expect(mockListNodeTemplates).toHaveBeenCalled();
    });

    it('filters to workflow templates only', async () => {
      mockListWorkflowTemplates.mockReturnValue([
        { id: 'sequential', name: 'Sequential', description: 'desc', category: 'basic' },
      ]);

      const result = parseResult(await callList({ type: 'workflow' }));
      expect(result.success).toBe(true);
      const data = result.data as Array<{ type: string }>;
      expect(data).toHaveLength(1);
      expect(data[0].type).toBe('workflow');
      expect(mockListNodeTemplates).not.toHaveBeenCalled();
    });

    it('filters to node templates only', async () => {
      mockListNodeTemplates.mockReturnValue([
        { id: 'validator', name: 'Validator', description: 'desc' },
      ]);

      const result = parseResult(await callList({ type: 'node' }));
      expect(result.success).toBe(true);
      const data = result.data as Array<{ type: string }>;
      expect(data).toHaveLength(1);
      expect(data[0].type).toBe('node');
      expect(mockListWorkflowTemplates).not.toHaveBeenCalled();
    });

    it('includes category field for workflow templates', async () => {
      mockListWorkflowTemplates.mockReturnValue([
        { id: 'parallel', name: 'Parallel', description: 'desc', category: 'advanced' },
      ]);
      mockListNodeTemplates.mockReturnValue([]);

      const result = parseResult(await callList({ type: 'all' }));
      expect(result.success).toBe(true);
      const data = result.data as Array<{ category?: string }>;
      expect(data[0].category).toBe('advanced');
    });

    it('returns empty list when no templates exist', async () => {
      mockListWorkflowTemplates.mockReturnValue([]);
      mockListNodeTemplates.mockReturnValue([]);

      const result = parseResult(await callList({}));
      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });
  });

  // ── fw_scaffold ──────────────────────────────────────────────────────────

  describe('fw_scaffold', () => {
    function callScaffold(args: Record<string, unknown>) {
      const handler = toolHandlers.get('fw_scaffold')!;
      expect(handler).toBeDefined();
      return handler(args);
    }

    it('scaffolds a workflow template and writes the file', async () => {
      const outFile = path.join(tmpDir, 'wf.ts');
      mockGetWorkflowTemplate.mockReturnValue({ id: 'sequential', name: 'Sequential' });
      mockGenerateWorkflowFromTemplate.mockReturnValue('// generated workflow code');

      const result = parseResult(await callScaffold({ template: 'sequential', filePath: outFile }));
      expect(result.success).toBe(true);
      const data = result.data as { filePath: string; type: string; template: string };
      expect(data.type).toBe('workflow');
      expect(data.template).toBe('sequential');
      expect(data.filePath).toBe(outFile);
      expect(fs.readFileSync(outFile, 'utf-8')).toBe('// generated workflow code');
    });

    it('uses default name "myWorkflow" when no name provided', async () => {
      const outFile = path.join(tmpDir, 'wf.ts');
      mockGetWorkflowTemplate.mockReturnValue({ id: 'sequential' });
      mockGenerateWorkflowFromTemplate.mockReturnValue('code');

      await callScaffold({ template: 'sequential', filePath: outFile });
      expect(mockGenerateWorkflowFromTemplate).toHaveBeenCalledWith('sequential', {
        workflowName: 'myWorkflow',
        config: undefined,
      });
    });

    it('passes custom name and config for workflow templates', async () => {
      const outFile = path.join(tmpDir, 'wf.ts');
      mockGetWorkflowTemplate.mockReturnValue({ id: 'sequential' });
      mockGenerateWorkflowFromTemplate.mockReturnValue('code');

      await callScaffold({
        template: 'sequential',
        filePath: outFile,
        name: 'emailFlow',
        config: { nodes: ['fetch', 'parse'] },
      });
      expect(mockGenerateWorkflowFromTemplate).toHaveBeenCalledWith('sequential', {
        workflowName: 'emailFlow',
        config: { nodes: ['fetch', 'parse'] },
      });
    });

    it('returns preview without writing when preview=true for workflow templates', async () => {
      const outFile = path.join(tmpDir, 'wf.ts');
      mockGetWorkflowTemplate.mockReturnValue({ id: 'sequential' });
      mockGenerateWorkflowFromTemplate.mockReturnValue('// preview code');

      const result = parseResult(
        await callScaffold({ template: 'sequential', filePath: outFile, preview: true }),
      );
      expect(result.success).toBe(true);
      const data = result.data as { preview: boolean; code: string; type: string };
      expect(data.preview).toBe(true);
      expect(data.code).toBe('// preview code');
      expect(data.type).toBe('workflow');
      expect(fs.existsSync(outFile)).toBe(false);
    });

    it('scaffolds a node template and writes the file', async () => {
      const outFile = path.join(tmpDir, 'node.ts');
      mockGetWorkflowTemplate.mockReturnValue(null);
      mockGetNodeTemplate.mockReturnValue({ id: 'validator', name: 'Validator' });
      mockGenerateNodeFromTemplate.mockReturnValue('// generated node code');

      const result = parseResult(await callScaffold({ template: 'validator', filePath: outFile }));
      expect(result.success).toBe(true);
      const data = result.data as { type: string; template: string };
      expect(data.type).toBe('node');
      expect(data.template).toBe('validator');
      expect(fs.readFileSync(outFile, 'utf-8')).toBe('// generated node code');
    });

    it('uses default name "myNode" for node templates when no name provided', async () => {
      const outFile = path.join(tmpDir, 'node.ts');
      mockGetWorkflowTemplate.mockReturnValue(null);
      mockGetNodeTemplate.mockReturnValue({ id: 'validator' });
      mockGenerateNodeFromTemplate.mockReturnValue('code');

      await callScaffold({ template: 'validator', filePath: outFile });
      expect(mockGenerateNodeFromTemplate).toHaveBeenCalledWith('validator', 'myNode', undefined);
    });

    it('returns preview for node templates', async () => {
      const outFile = path.join(tmpDir, 'node.ts');
      mockGetWorkflowTemplate.mockReturnValue(null);
      mockGetNodeTemplate.mockReturnValue({ id: 'validator' });
      mockGenerateNodeFromTemplate.mockReturnValue('// node preview');

      const result = parseResult(
        await callScaffold({ template: 'validator', filePath: outFile, preview: true }),
      );
      expect(result.success).toBe(true);
      const data = result.data as { preview: boolean; code: string; type: string };
      expect(data.preview).toBe(true);
      expect(data.type).toBe('node');
      expect(data.code).toBe('// node preview');
    });

    it('appends to existing file instead of overwriting', async () => {
      const outFile = path.join(tmpDir, 'existing.ts');
      fs.writeFileSync(outFile, '// existing content');
      mockGetWorkflowTemplate.mockReturnValue({ id: 'sequential' });
      mockGenerateWorkflowFromTemplate.mockReturnValue('// new code');

      await callScaffold({ template: 'sequential', filePath: outFile });
      const content = fs.readFileSync(outFile, 'utf-8');
      expect(content).toContain('// existing content');
      expect(content).toContain('// new code');
    });

    it('returns TEMPLATE_NOT_FOUND when template does not exist', async () => {
      mockGetWorkflowTemplate.mockReturnValue(null);
      mockGetNodeTemplate.mockReturnValue(null);

      const result = parseResult(
        await callScaffold({ template: 'nonexistent', filePath: path.join(tmpDir, 'out.ts') }),
      );
      expect(result.success).toBe(false);
      expect((result.error as { code: string }).code).toBe('TEMPLATE_NOT_FOUND');
      expect((result.error as { message: string }).message).toContain('nonexistent');
      expect((result.error as { message: string }).message).toContain('fw_list_templates');
    });

    it('returns SCAFFOLD_ERROR when generation throws', async () => {
      mockGetWorkflowTemplate.mockReturnValue({ id: 'sequential' });
      mockGenerateWorkflowFromTemplate.mockImplementation(() => {
        throw new Error('generation failed');
      });

      const result = parseResult(
        await callScaffold({ template: 'sequential', filePath: path.join(tmpDir, 'out.ts') }),
      );
      expect(result.success).toBe(false);
      expect((result.error as { code: string }).code).toBe('SCAFFOLD_ERROR');
      expect((result.error as { message: string }).message).toContain('generation failed');
    });

    it('handles non-Error throws in scaffold', async () => {
      mockGetWorkflowTemplate.mockReturnValue({ id: 'sequential' });
      mockGenerateWorkflowFromTemplate.mockImplementation(() => {
        throw 'string error';
      });

      const result = parseResult(
        await callScaffold({ template: 'sequential', filePath: path.join(tmpDir, 'out.ts') }),
      );
      expect(result.success).toBe(false);
      expect((result.error as { code: string }).code).toBe('SCAFFOLD_ERROR');
      expect((result.error as { message: string }).message).toContain('string error');
    });
  });
});
