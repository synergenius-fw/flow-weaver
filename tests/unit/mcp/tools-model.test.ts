import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// ── Mock the API ──────────────────────────────────────────────────────────────
const mockParseWorkflow = vi.fn();
const mockValidateWorkflow = vi.fn();

vi.mock('../../../src/api/index.js', () => ({
  parseWorkflow: (...args: unknown[]) => mockParseWorkflow(...args),
  validateWorkflow: (...args: unknown[]) => mockValidateWorkflow(...args),
}));

// ── Mock the annotation generator ─────────────────────────────────────────────
const mockGenerateFunctionSignature = vi.fn();

vi.mock('../../../src/annotation-generator.js', () => ({
  generateFunctionSignature: (...args: unknown[]) => mockGenerateFunctionSignature(...args),
}));

// ── Mock MCP SDK ──────────────────────────────────────────────────────────────
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
import { registerModelTools } from '../../../src/mcp/tools-model.js';

function parseResult(result: unknown): { success: boolean; data?: unknown; error?: unknown } {
  const r = result as { content: Array<{ text: string }>; isError?: boolean };
  return JSON.parse(r.content[0].text);
}

describe('tools-model', () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    toolHandlers.clear();
    const mcp = new McpServer({ name: 'test', version: '1.0.0' });
    registerModelTools(mcp);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-model-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── fw_create_model ─────────────────────────────────────────────────────────

  describe('fw_create_model', () => {
    function callCreate(args: Record<string, unknown>) {
      const handler = toolHandlers.get('fw_create_model')!;
      expect(handler).toBeDefined();
      return handler(args);
    }

    it('generates a workflow file with declare function stubs', async () => {
      const outFile = path.join(tmpDir, 'workflow.ts');

      const result = parseResult(
        await callCreate({
          name: 'emailWorkflow',
          description: 'Processes incoming emails',
          steps: [
            { name: 'validateEmail', inputs: { email: 'STRING' }, outputs: { valid: 'BOOLEAN' } },
            { name: 'sendReply', inputs: { to: 'STRING', body: 'STRING' }, outputs: { sent: 'BOOLEAN' } },
          ],
          flow: 'Start -> validateEmail -> sendReply -> Exit',
          filePath: outFile,
        }),
      );

      expect(result.success).toBe(true);
      const data = result.data as { filePath: string; workflowName: string; stubCount: number; nodes: string[] };
      expect(data.workflowName).toBe('emailWorkflow');
      expect(data.stubCount).toBe(2);
      expect(data.nodes).toEqual(['validateEmail', 'sendReply']);

      const content = fs.readFileSync(outFile, 'utf-8');
      expect(content).toContain('declare function validateEmail(email: string): boolean;');
      expect(content).toContain('declare function sendReply(to: string, body: string): boolean;');
      expect(content).toContain('@flowWeaver workflow @autoConnect');
      expect(content).toContain('@node validateEmail validateEmail');
      expect(content).toContain('@node sendReply sendReply');
      expect(content).toContain('@path Start -> validateEmail -> sendReply -> Exit');
      expect(content).toContain("export const emailWorkflow = 'flowWeaver:draft';");
    });

    it('maps data types correctly', async () => {
      const outFile = path.join(tmpDir, 'types.ts');

      await callCreate({
        name: 'typeTest',
        steps: [
          {
            name: 'allTypes',
            inputs: {
              s: 'STRING',
              n: 'NUMBER',
              b: 'BOOLEAN',
              o: 'OBJECT',
              a: 'ARRAY',
              x: 'CUSTOM',
            },
            outputs: { result: 'STRING' },
          },
        ],
        flow: 'Start -> allTypes -> Exit',
        filePath: outFile,
      });

      const content = fs.readFileSync(outFile, 'utf-8');
      expect(content).toContain('s: string');
      expect(content).toContain('n: number');
      expect(content).toContain('b: boolean');
      expect(content).toContain('o: Record<string, unknown>');
      expect(content).toContain('a: unknown[]');
      expect(content).toContain('x: unknown');
    });

    it('generates multi-output return type as an object', async () => {
      const outFile = path.join(tmpDir, 'multi.ts');

      await callCreate({
        name: 'multi',
        steps: [
          {
            name: 'splitter',
            inputs: { data: 'STRING' },
            outputs: { left: 'STRING', right: 'NUMBER' },
          },
        ],
        flow: 'Start -> splitter -> Exit',
        filePath: outFile,
      });

      const content = fs.readFileSync(outFile, 'utf-8');
      expect(content).toContain('declare function splitter(data: string): { left: string; right: number }');
    });

    it('creates nested directories if they do not exist', async () => {
      const outFile = path.join(tmpDir, 'deep', 'nested', 'dir', 'wf.ts');

      const result = parseResult(
        await callCreate({
          name: 'nested',
          steps: [{ name: 'step1', inputs: { x: 'STRING' }, outputs: { y: 'STRING' } }],
          flow: 'Start -> step1 -> Exit',
          filePath: outFile,
        }),
      );

      expect(result.success).toBe(true);
      expect(fs.existsSync(outFile)).toBe(true);
    });

    it('omits description line when no description given', async () => {
      const outFile = path.join(tmpDir, 'nodesc.ts');

      await callCreate({
        name: 'noDesc',
        steps: [{ name: 'a', inputs: { x: 'STRING' }, outputs: { y: 'STRING' } }],
        flow: 'Start -> a -> Exit',
        filePath: outFile,
      });

      const content = fs.readFileSync(outFile, 'utf-8');
      // The workflow JSDoc block is multi-line: "/**\n * @flowWeaver workflow..."
      // (as opposed to the single-line node annotation "/** @flowWeaver node */")
      // Find the multi-line JSDoc that starts the workflow annotation.
      const workflowJsdocIndex = content.indexOf('/**\n');
      expect(workflowJsdocIndex).toBeGreaterThan(-1);
      const nextLine = content.slice(workflowJsdocIndex).split('\n')[1];
      expect(nextLine.trim()).toBe('* @flowWeaver workflow @autoConnect');
    });

    it('returns CREATE_MODEL_ERROR on failure', async () => {
      // Pass an invalid filePath that cannot be written (e.g. empty string triggers path issues)
      // We'll use a path to a readonly directory
      const readonlyDir = path.join(tmpDir, 'readonly');
      fs.mkdirSync(readonlyDir);
      fs.chmodSync(readonlyDir, 0o444);

      const outFile = path.join(readonlyDir, 'subdir', 'wf.ts');
      const result = parseResult(
        await callCreate({
          name: 'fail',
          steps: [{ name: 'a', inputs: { x: 'STRING' }, outputs: { y: 'STRING' } }],
          flow: 'Start -> a -> Exit',
          filePath: outFile,
        }),
      );

      expect(result.success).toBe(false);
      expect((result.error as { code: string }).code).toBe('CREATE_MODEL_ERROR');

      // Clean up permissions
      fs.chmodSync(readonlyDir, 0o755);
    });
  });

  // ── fw_workflow_status ──────────────────────────────────────────────────────

  describe('fw_workflow_status', () => {
    function callStatus(args: Record<string, unknown>) {
      const handler = toolHandlers.get('fw_workflow_status')!;
      expect(handler).toBeDefined();
      return handler(args);
    }

    it('reports implementation progress', async () => {
      mockParseWorkflow.mockResolvedValue({
        errors: [],
        ast: {
          name: 'myWorkflow',
          nodeTypes: [
            {
              name: 'validateEmail',
              functionName: 'validateEmail',
              variant: 'STUB',
              inputs: { email: { dataType: 'STRING' } },
              outputs: { valid: { dataType: 'BOOLEAN' } },
            },
            {
              name: 'sendReply',
              functionName: 'sendReply',
              variant: 'FUNCTION',
              inputs: { to: { dataType: 'STRING' }, execute: { dataType: 'STEP' } },
              outputs: { sent: { dataType: 'BOOLEAN' }, onSuccess: { dataType: 'STEP' } },
            },
          ],
          instances: [
            { nodeType: 'validateEmail' },
            { nodeType: 'sendReply' },
          ],
        },
      });

      mockValidateWorkflow.mockReturnValue({
        errors: [],
        warnings: [],
      });

      const result = parseResult(await callStatus({ filePath: '/tmp/wf.ts' }));
      expect(result.success).toBe(true);
      const data = result.data as {
        workflowName: string;
        implemented: number;
        total: number;
        percentage: number;
        nodes: Array<{ name: string; status: string; inputs: Record<string, string>; outputs: Record<string, string> }>;
        structurallyValid: boolean;
      };
      expect(data.workflowName).toBe('myWorkflow');
      expect(data.implemented).toBe(1);
      expect(data.total).toBe(2);
      expect(data.percentage).toBe(50);
      // execute and onSuccess/onFailure ports are filtered out
      expect(data.nodes[1].inputs).not.toHaveProperty('execute');
      expect(data.nodes[1].outputs).not.toHaveProperty('onSuccess');
      expect(data.structurallyValid).toBe(true);
    });

    it('returns parse errors', async () => {
      mockParseWorkflow.mockResolvedValue({
        errors: ['Unexpected token at line 5'],
        ast: null,
      });

      const result = parseResult(await callStatus({ filePath: '/tmp/bad.ts' }));
      expect(result.success).toBe(false);
      expect((result.error as { code: string }).code).toBe('PARSE_ERROR');
      expect((result.error as { message: string }).message).toContain('Unexpected token');
    });

    it('reports structural validation errors (excluding STUB_NODE)', async () => {
      mockParseWorkflow.mockResolvedValue({
        errors: [],
        ast: {
          name: 'wf',
          nodeTypes: [
            {
              name: 'step',
              functionName: 'step',
              variant: 'STUB',
              inputs: { x: { dataType: 'STRING' } },
              outputs: { y: { dataType: 'STRING' } },
            },
          ],
          instances: [{ nodeType: 'step' }],
        },
      });

      mockValidateWorkflow.mockReturnValue({
        errors: [
          { message: 'Node "step" is a stub', code: 'STUB_NODE', node: 'step' },
          { message: 'Disconnected node "step"', code: 'UNUSED_NODE', node: 'step' },
        ],
        warnings: [],
      });

      const result = parseResult(await callStatus({ filePath: '/tmp/wf.ts' }));
      expect(result.success).toBe(true);
      const data = result.data as { structurallyValid: boolean; structuralErrors: unknown[] };
      // STUB_NODE should be filtered out
      expect(data.structuralErrors).toHaveLength(1);
      expect(data.structurallyValid).toBe(false);
    });

    it('passes workflowName option through', async () => {
      mockParseWorkflow.mockResolvedValue({
        errors: [],
        ast: { name: 'target', nodeTypes: [], instances: [] },
      });
      mockValidateWorkflow.mockReturnValue({ errors: [], warnings: [] });

      await callStatus({ filePath: '/tmp/wf.ts', workflowName: 'target' });
      expect(mockParseWorkflow).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ workflowName: 'target' }),
      );
    });

    it('catches unexpected errors', async () => {
      mockParseWorkflow.mockRejectedValue(new Error('file read error'));

      const result = parseResult(await callStatus({ filePath: '/tmp/wf.ts' }));
      expect(result.success).toBe(false);
      expect((result.error as { code: string }).code).toBe('STATUS_ERROR');
    });

    it('maps node types by functionName when it differs from name', async () => {
      mockParseWorkflow.mockResolvedValue({
        errors: [],
        ast: {
          name: 'aliasWf',
          nodeTypes: [
            {
              name: 'AliasType',
              functionName: 'aliasFunc',
              variant: 'FUNCTION',
              inputs: { x: { dataType: 'STRING' } },
              outputs: { y: { dataType: 'NUMBER' } },
            },
          ],
          instances: [{ nodeType: 'aliasFunc' }],
        },
      });
      mockValidateWorkflow.mockReturnValue({ errors: [], warnings: [] });

      const result = parseResult(await callStatus({ filePath: '/tmp/alias.ts' }));
      expect(result.success).toBe(true);
      const data = result.data as { nodes: Array<{ name: string; status: string }> };
      expect(data.nodes).toHaveLength(1);
      expect(data.nodes[0].name).toBe('aliasFunc');
      expect(data.nodes[0].status).toBe('implemented');
    });

    it('deduplicates nodes so each functionName appears once', async () => {
      mockParseWorkflow.mockResolvedValue({
        errors: [],
        ast: {
          name: 'dedup',
          nodeTypes: [
            {
              name: 'myNode',
              functionName: 'myNode',
              variant: 'FUNCTION',
              inputs: {},
              outputs: {},
            },
          ],
          instances: [
            { nodeType: 'myNode' },
            { nodeType: 'myNode' },
          ],
        },
      });
      mockValidateWorkflow.mockReturnValue({ errors: [], warnings: [] });

      const result = parseResult(await callStatus({ filePath: '/tmp/dedup.ts' }));
      expect(result.success).toBe(true);
      const data = result.data as { nodes: unknown[]; total: number };
      expect(data.total).toBe(1);
    });

    it('returns 100% when no nodes exist', async () => {
      mockParseWorkflow.mockResolvedValue({
        errors: [],
        ast: { name: 'empty', nodeTypes: [], instances: [] },
      });
      mockValidateWorkflow.mockReturnValue({ errors: [], warnings: [] });

      const result = parseResult(await callStatus({ filePath: '/tmp/wf.ts' }));
      expect(result.success).toBe(true);
      const data = result.data as { percentage: number; total: number };
      expect(data.total).toBe(0);
      expect(data.percentage).toBe(100);
    });
  });

  // ── fw_implement_node ───────────────────────────────────────────────────────

  describe('fw_implement_node', () => {
    function callImplement(args: Record<string, unknown>) {
      const handler = toolHandlers.get('fw_implement_node')!;
      expect(handler).toBeDefined();
      return handler(args);
    }

    it('replaces a stub with provided implementation', async () => {
      const wfFile = path.join(tmpDir, 'wf.ts');
      const originalContent = [
        '/** @flowWeaver node */',
        'declare function validateEmail(email: string): boolean;',
        '',
        '/** @flowWeaver workflow */',
        "export const wf = 'flowWeaver:draft';",
      ].join('\n');
      fs.writeFileSync(wfFile, originalContent);

      mockParseWorkflow.mockResolvedValue({
        errors: [],
        ast: {
          name: 'wf',
          nodeTypes: [
            { name: 'validateEmail', functionName: 'validateEmail', variant: 'STUB' },
          ],
          instances: [],
        },
      });

      const implementation = 'function validateEmail(email: string): boolean {\n  return email.includes("@");\n}';

      const result = parseResult(
        await callImplement({
          filePath: wfFile,
          nodeName: 'validateEmail',
          implementation,
        }),
      );

      expect(result.success).toBe(true);
      const data = result.data as { nodeName: string; action: string };
      expect(data.nodeName).toBe('validateEmail');
      expect(data.action).toBe('implemented');

      const updated = fs.readFileSync(wfFile, 'utf-8');
      expect(updated).toContain('return email.includes("@")');
      expect(updated).not.toContain('declare function validateEmail');
    });

    it('generates a skeleton when no implementation provided', async () => {
      const wfFile = path.join(tmpDir, 'wf.ts');
      fs.writeFileSync(wfFile, 'declare function myFunc(x: string): number;');

      mockParseWorkflow.mockResolvedValue({
        errors: [],
        ast: {
          name: 'wf',
          nodeTypes: [
            { name: 'myFunc', functionName: 'myFunc', variant: 'STUB' },
          ],
          instances: [],
        },
      });

      mockGenerateFunctionSignature.mockReturnValue([
        'function myFunc(x: string): number {',
        '  // TODO: implement',
        '  throw new Error("Not implemented");',
        '}',
      ]);

      const result = parseResult(
        await callImplement({ filePath: wfFile, nodeName: 'myFunc' }),
      );

      expect(result.success).toBe(true);
      const data = result.data as { action: string };
      expect(data.action).toBe('scaffolded');
      expect(mockGenerateFunctionSignature).toHaveBeenCalled();
    });

    it('returns FILE_NOT_FOUND when file does not exist', async () => {
      const result = parseResult(
        await callImplement({ filePath: '/nonexistent/file.ts', nodeName: 'x' }),
      );
      expect(result.success).toBe(false);
      expect((result.error as { code: string }).code).toBe('FILE_NOT_FOUND');
    });

    it('returns PARSE_ERROR when parsing fails', async () => {
      const wfFile = path.join(tmpDir, 'bad.ts');
      fs.writeFileSync(wfFile, 'broken content');

      mockParseWorkflow.mockResolvedValue({
        errors: ['Syntax error at line 1'],
        ast: null,
      });

      const result = parseResult(
        await callImplement({ filePath: wfFile, nodeName: 'x' }),
      );
      expect(result.success).toBe(false);
      expect((result.error as { code: string }).code).toBe('PARSE_ERROR');
    });

    it('returns ALREADY_IMPLEMENTED when node is not a stub', async () => {
      const wfFile = path.join(tmpDir, 'impl.ts');
      fs.writeFileSync(wfFile, 'function myFunc() {}');

      mockParseWorkflow.mockResolvedValue({
        errors: [],
        ast: {
          name: 'wf',
          nodeTypes: [
            { name: 'myFunc', functionName: 'myFunc', variant: 'FUNCTION' },
          ],
          instances: [],
        },
      });

      const result = parseResult(
        await callImplement({ filePath: wfFile, nodeName: 'myFunc' }),
      );
      expect(result.success).toBe(false);
      expect((result.error as { code: string }).code).toBe('ALREADY_IMPLEMENTED');
    });

    it('returns NODE_NOT_FOUND when the stub does not exist', async () => {
      const wfFile = path.join(tmpDir, 'nope.ts');
      fs.writeFileSync(wfFile, 'declare function other(x: string): number;');

      mockParseWorkflow.mockResolvedValue({
        errors: [],
        ast: {
          name: 'wf',
          nodeTypes: [
            { name: 'other', functionName: 'other', variant: 'STUB' },
          ],
          instances: [],
        },
      });

      const result = parseResult(
        await callImplement({ filePath: wfFile, nodeName: 'nonexistent' }),
      );
      expect(result.success).toBe(false);
      expect((result.error as { code: string }).code).toBe('NODE_NOT_FOUND');
      expect((result.error as { message: string }).message).toContain('other');
    });

    it('returns SOURCE_MISMATCH when declare function is not found in source', async () => {
      const wfFile = path.join(tmpDir, 'mismatch.ts');
      // Source does not contain the expected declare function pattern
      fs.writeFileSync(wfFile, 'const something = true;');

      mockParseWorkflow.mockResolvedValue({
        errors: [],
        ast: {
          name: 'wf',
          nodeTypes: [
            { name: 'missingFn', functionName: 'missingFn', variant: 'STUB' },
          ],
          instances: [],
        },
      });

      const result = parseResult(
        await callImplement({ filePath: wfFile, nodeName: 'missingFn' }),
      );
      expect(result.success).toBe(false);
      expect((result.error as { code: string }).code).toBe('SOURCE_MISMATCH');
    });

    it('handles multiline declare function stubs', async () => {
      const wfFile = path.join(tmpDir, 'multiline.ts');
      const content = [
        '/** @flowWeaver node */',
        'declare function complex(',
        '  name: string,',
        '  age: number',
        '): boolean;',
        '',
      ].join('\n');
      fs.writeFileSync(wfFile, content);

      mockParseWorkflow.mockResolvedValue({
        errors: [],
        ast: {
          name: 'wf',
          nodeTypes: [
            { name: 'complex', functionName: 'complex', variant: 'STUB' },
          ],
          instances: [],
        },
      });

      const implementation = 'function complex(name: string, age: number): boolean {\n  return age > 0;\n}';

      const result = parseResult(
        await callImplement({
          filePath: wfFile,
          nodeName: 'complex',
          implementation,
        }),
      );

      expect(result.success).toBe(true);
      const updated = fs.readFileSync(wfFile, 'utf-8');
      expect(updated).toContain('return age > 0');
    });

    it('returns IMPLEMENT_ERROR when scaffold generation throws', async () => {
      const wfFile = path.join(tmpDir, 'scaffold-err.ts');
      fs.writeFileSync(wfFile, 'declare function broken(x: string): number;');

      mockParseWorkflow.mockResolvedValue({
        errors: [],
        ast: {
          name: 'wf',
          nodeTypes: [
            { name: 'broken', functionName: 'broken', variant: 'STUB' },
          ],
          instances: [],
        },
      });

      mockGenerateFunctionSignature.mockImplementation(() => {
        throw new Error('signature generation failed');
      });

      const result = parseResult(
        await callImplement({ filePath: wfFile, nodeName: 'broken' }),
      );
      expect(result.success).toBe(false);
      expect((result.error as { code: string }).code).toBe('IMPLEMENT_ERROR');
      expect((result.error as { message: string }).message).toContain('signature generation failed');
    });

    it('preserves indentation when applying implementation', async () => {
      const wfFile = path.join(tmpDir, 'indented.ts');
      const content = [
        '  /** @flowWeaver node */',
        '  declare function indentedFn(x: string): string;',
        '',
      ].join('\n');
      fs.writeFileSync(wfFile, content);

      mockParseWorkflow.mockResolvedValue({
        errors: [],
        ast: {
          name: 'wf',
          nodeTypes: [
            { name: 'indentedFn', functionName: 'indentedFn', variant: 'STUB' },
          ],
          instances: [],
        },
      });

      const result = parseResult(
        await callImplement({
          filePath: wfFile,
          nodeName: 'indentedFn',
          implementation: 'function indentedFn(x: string): string {\n  return x;\n}',
        }),
      );

      expect(result.success).toBe(true);
      const updated = fs.readFileSync(wfFile, 'utf-8');
      // Each line of the implementation should be indented with 2 spaces
      expect(updated).toContain('  function indentedFn');
      expect(updated).toContain('    return x;');
    });
  });
});
