import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock the API ─────────────────────────────────────────────────────────────
const mockParseWorkflow = vi.fn();
const mockValidateWorkflow = vi.fn();
const mockCompileWorkflow = vi.fn();

vi.mock('../../../src/api/index.js', () => ({
  parseWorkflow: (...args: unknown[]) => mockParseWorkflow(...args),
  validateWorkflow: (...args: unknown[]) => mockValidateWorkflow(...args),
  compileWorkflow: (...args: unknown[]) => mockCompileWorkflow(...args),
}));

// ── Mock query functions ─────────────────────────────────────────────────────
const mockGetNodes = vi.fn();
const mockGetConnections = vi.fn();
const mockGetDependencies = vi.fn();
const mockGetDependents = vi.fn();
const mockGetDataDependencies = vi.fn();
const mockGetTopologicalOrder = vi.fn();
const mockFindIsolatedNodes = vi.fn();
const mockFindDeadEndDetails = vi.fn();
const mockFindDisconnectedOutputPorts = vi.fn();

vi.mock('../../../src/api/query.js', () => ({
  getNodes: (...args: unknown[]) => mockGetNodes(...args),
  getConnections: (...args: unknown[]) => mockGetConnections(...args),
  getDependencies: (...args: unknown[]) => mockGetDependencies(...args),
  getDependents: (...args: unknown[]) => mockGetDependents(...args),
  getDataDependencies: (...args: unknown[]) => mockGetDataDependencies(...args),
  getTopologicalOrder: (...args: unknown[]) => mockGetTopologicalOrder(...args),
  findIsolatedNodes: (...args: unknown[]) => mockFindIsolatedNodes(...args),
  findDeadEndDetails: (...args: unknown[]) => mockFindDeadEndDetails(...args),
  findDisconnectedOutputPorts: (...args: unknown[]) => mockFindDisconnectedOutputPorts(...args),
}));

// ── Mock describe command ────────────────────────────────────────────────────
const mockDescribeWorkflow = vi.fn();
const mockFormatDescribeOutput = vi.fn();

vi.mock('../../../src/cli/commands/describe.js', () => ({
  describeWorkflow: (...args: unknown[]) => mockDescribeWorkflow(...args),
  formatDescribeOutput: (...args: unknown[]) => mockFormatDescribeOutput(...args),
}));

// ── Mock doctor command ──────────────────────────────────────────────────────
const mockRunDoctorChecks = vi.fn();

vi.mock('../../../src/cli/commands/doctor.js', () => ({
  runDoctorChecks: (...args: unknown[]) => mockRunDoctorChecks(...args),
}));

// ── Mock diff module ─────────────────────────────────────────────────────────
const mockCompare = vi.fn();
const mockFormatDiff = vi.fn();

vi.mock('../../../src/diff/WorkflowDiffer.js', () => ({
  WorkflowDiffer: { compare: (...args: unknown[]) => mockCompare(...args) },
}));

vi.mock('../../../src/diff/formatDiff.js', () => ({
  formatDiff: (...args: unknown[]) => mockFormatDiff(...args),
}));

// ── Mock inngest generator ───────────────────────────────────────────────────
const mockGenerateInngestFunction = vi.fn();

vi.mock('../../../src/generator/inngest.js', () => ({
  generateInngestFunction: (...args: unknown[]) => mockGenerateInngestFunction(...args),
}));

// ── Mock parser ──────────────────────────────────────────────────────────────
const mockAnnotationParserParse = vi.fn();

vi.mock('../../../src/parser.js', () => {
  class MockAnnotationParser {
    parse(...args: unknown[]) {
      return mockAnnotationParserParse(...args);
    }
  }
  return { AnnotationParser: MockAnnotationParser };
});

// ── Mock friendly errors ─────────────────────────────────────────────────────
vi.mock('../../../src/friendly-errors.js', () => ({
  getFriendlyError: () => null,
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
import { registerQueryTools } from '../../../src/mcp/tools-query.js';

function parseResult(result: unknown): { success: boolean; data?: unknown; error?: unknown } {
  const r = result as { content: Array<{ text: string }>; isError?: boolean };
  return JSON.parse(r.content[0].text);
}

describe('tools-query', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    toolHandlers.clear();
    const mcp = new McpServer({ name: 'test', version: '1.0.0' });
    registerQueryTools(mcp);
  });

  // ── fw_describe ──────────────────────────────────────────────────────────

  describe('fw_describe', () => {
    function callDescribe(args: Record<string, unknown>) {
      const handler = toolHandlers.get('fw_describe')!;
      expect(handler).toBeDefined();
      return handler(args);
    }

    it('returns JSON description by default', async () => {
      mockParseWorkflow.mockResolvedValue({
        errors: [],
        ast: { name: 'myWorkflow', nodeTypes: [], instances: [] },
      });
      mockDescribeWorkflow.mockReturnValue({ summary: 'test' });
      mockFormatDescribeOutput.mockReturnValue(JSON.stringify({ summary: 'test' }));

      const result = parseResult(await callDescribe({ filePath: '/tmp/wf.ts' }));
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ summary: 'test' });
    });

    it('passes format and node options', async () => {
      mockParseWorkflow.mockResolvedValue({
        errors: [],
        ast: { name: 'wf' },
      });
      mockDescribeWorkflow.mockReturnValue({});
      mockFormatDescribeOutput.mockReturnValue('text output');

      const result = parseResult(
        await callDescribe({ filePath: '/tmp/wf.ts', format: 'text', node: 'step1' }),
      );
      expect(result.success).toBe(true);
      expect(result.data).toBe('text output');
      expect(mockDescribeWorkflow).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ node: 'step1' }),
      );
      expect(mockFormatDescribeOutput).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        'text',
      );
    });

    it('passes workflowName to parseWorkflow', async () => {
      mockParseWorkflow.mockResolvedValue({ errors: [], ast: {} });
      mockDescribeWorkflow.mockReturnValue({});
      mockFormatDescribeOutput.mockReturnValue('{}');

      await callDescribe({ filePath: '/tmp/wf.ts', workflowName: 'target' });
      expect(mockParseWorkflow).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ workflowName: 'target' }),
      );
    });

    it('returns PARSE_ERROR on parse failure', async () => {
      mockParseWorkflow.mockResolvedValue({
        errors: ['Unexpected token'],
        ast: null,
      });

      const result = parseResult(await callDescribe({ filePath: '/tmp/bad.ts' }));
      expect(result.success).toBe(false);
      expect((result.error as { code: string }).code).toBe('PARSE_ERROR');
    });

    it('returns MULTIPLE_WORKFLOWS_FOUND for ambiguous files', async () => {
      mockParseWorkflow.mockResolvedValue({
        errors: ['[MULTIPLE_WORKFLOWS_FOUND] Found 2 workflows, specify workflowName'],
        ast: null,
      });

      const result = parseResult(await callDescribe({ filePath: '/tmp/multi.ts' }));
      expect(result.success).toBe(false);
      expect((result.error as { code: string }).code).toBe('MULTIPLE_WORKFLOWS_FOUND');
    });

    it('falls back to nodeTypesOnly mode when no workflows found', async () => {
      mockParseWorkflow
        .mockResolvedValueOnce({
          errors: ['No workflows found in file'],
          ast: null,
        })
        .mockResolvedValueOnce({
          errors: [],
          ast: {
            nodeTypes: [
              { name: 'MyNode', inputs: { x: {} }, outputs: { y: {} }, isExpression: false },
            ],
          },
        });

      const result = parseResult(await callDescribe({ filePath: '/tmp/nodes.ts' }));
      expect(result.success).toBe(true);
      const data = result.data as { nodeTypesOnly: boolean; nodeTypes: unknown[] };
      expect(data.nodeTypesOnly).toBe(true);
      expect(data.nodeTypes).toHaveLength(1);
    });

    it('returns DESCRIBE_ERROR on unexpected exception', async () => {
      mockParseWorkflow.mockRejectedValue(new Error('disk failure'));

      const result = parseResult(await callDescribe({ filePath: '/tmp/wf.ts' }));
      expect(result.success).toBe(false);
      expect((result.error as { code: string }).code).toBe('DESCRIBE_ERROR');
    });

    it('returns mermaid format as string', async () => {
      mockParseWorkflow.mockResolvedValue({ errors: [], ast: {} });
      mockDescribeWorkflow.mockReturnValue({});
      mockFormatDescribeOutput.mockReturnValue('graph TD\n  A --> B');

      const result = parseResult(
        await callDescribe({ filePath: '/tmp/wf.ts', format: 'mermaid' }),
      );
      expect(result.success).toBe(true);
      expect(result.data).toBe('graph TD\n  A --> B');
    });

    it('returns paths format as string', async () => {
      mockParseWorkflow.mockResolvedValue({ errors: [], ast: {} });
      mockDescribeWorkflow.mockReturnValue({});
      mockFormatDescribeOutput.mockReturnValue('Start -> A -> Exit');

      const result = parseResult(
        await callDescribe({ filePath: '/tmp/wf.ts', format: 'paths' }),
      );
      expect(result.success).toBe(true);
      expect(result.data).toBe('Start -> A -> Exit');
    });
  });

  // ── fw_validate ──────────────────────────────────────────────────────────

  describe('fw_validate', () => {
    function callValidate(args: Record<string, unknown>) {
      const handler = toolHandlers.get('fw_validate')!;
      expect(handler).toBeDefined();
      return handler(args);
    }

    it('returns valid result with no errors', async () => {
      mockParseWorkflow.mockResolvedValue({
        errors: [],
        warnings: [],
        ast: { name: 'wf', nodeTypes: [], instances: [] },
      });
      mockValidateWorkflow.mockReturnValue({
        valid: true,
        errors: [],
        warnings: [],
      });

      const result = parseResult(await callValidate({ filePath: '/tmp/wf.ts' }));
      expect(result.success).toBe(true);
      const data = result.data as { valid: boolean; errors: unknown[]; warnings: unknown[] };
      expect(data.valid).toBe(true);
      expect(data.errors).toHaveLength(0);
    });

    it('returns validation errors and warnings', async () => {
      mockParseWorkflow.mockResolvedValue({
        errors: [],
        warnings: [{ message: 'deprecated syntax', type: 'warning' }],
        ast: { name: 'wf' },
      });
      mockValidateWorkflow.mockReturnValue({
        valid: false,
        errors: [{ message: 'Unused node', type: 'error', node: 'step1', code: 'UNUSED_NODE' }],
        warnings: [{ message: 'Missing label', type: 'warning', node: 'step2', code: 'NO_LABEL' }],
      });

      const result = parseResult(await callValidate({ filePath: '/tmp/wf.ts' }));
      expect(result.success).toBe(true);
      const data = result.data as { valid: boolean; errors: unknown[]; warnings: unknown[] };
      expect(data.valid).toBe(false);
      expect(data.errors).toHaveLength(1);
      // Warnings include both parse warnings and validation warnings
      expect(data.warnings.length).toBeGreaterThanOrEqual(1);
    });

    it('returns parse errors when file cannot be parsed', async () => {
      mockParseWorkflow.mockResolvedValue({
        errors: ['Syntax error at line 3'],
        warnings: ['some warning'],
        ast: null,
      });

      const result = parseResult(await callValidate({ filePath: '/tmp/bad.ts' }));
      expect(result.success).toBe(true);
      const data = result.data as { valid: boolean; errors: string[] };
      expect(data.valid).toBe(false);
      expect(data.errors).toContain('Syntax error at line 3');
    });

    it('falls back to nodeTypesOnly mode when no workflows found', async () => {
      mockParseWorkflow
        .mockResolvedValueOnce({
          errors: ['No workflows found in file'],
          warnings: [],
          ast: null,
        })
        .mockResolvedValueOnce({
          errors: [],
          warnings: [],
          ast: {
            nodeTypes: [
              { name: 'A' },
              { name: 'B' },
            ],
          },
        });

      const result = parseResult(await callValidate({ filePath: '/tmp/nodes.ts' }));
      expect(result.success).toBe(true);
      const data = result.data as { valid: boolean; nodeTypesOnly: boolean; nodeTypeCount: number };
      expect(data.valid).toBe(true);
      expect(data.nodeTypesOnly).toBe(true);
      expect(data.nodeTypeCount).toBe(2);
    });

    it('passes workflowName option', async () => {
      mockParseWorkflow.mockResolvedValue({ errors: [], warnings: [], ast: {} });
      mockValidateWorkflow.mockReturnValue({ valid: true, errors: [], warnings: [] });

      await callValidate({ filePath: '/tmp/wf.ts', workflowName: 'target' });
      expect(mockParseWorkflow).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ workflowName: 'target' }),
      );
    });

    it('returns VALIDATE_ERROR on unexpected exception', async () => {
      mockParseWorkflow.mockRejectedValue(new Error('unexpected'));

      const result = parseResult(await callValidate({ filePath: '/tmp/wf.ts' }));
      expect(result.success).toBe(false);
      expect((result.error as { code: string }).code).toBe('VALIDATE_ERROR');
    });
  });

  // ── fw_compile ───────────────────────────────────────────────────────────

  describe('fw_compile', () => {
    function callCompile(args: Record<string, unknown>) {
      const handler = toolHandlers.get('fw_compile')!;
      expect(handler).toBeDefined();
      return handler(args);
    }

    it('compiles a workflow with default options', async () => {
      mockCompileWorkflow.mockResolvedValue({
        metadata: { outputFile: '/tmp/wf.compiled.ts' },
        analysis: { warnings: [] },
      });

      const result = parseResult(await callCompile({ filePath: '/tmp/wf.ts' }));
      expect(result.success).toBe(true);
      const data = result.data as { outputFile: string; warnings: unknown[] };
      expect(data.outputFile).toBe('/tmp/wf.compiled.ts');
      expect(data.warnings).toEqual([]);
    });

    it('passes write and production options', async () => {
      mockCompileWorkflow.mockResolvedValue({
        metadata: { outputFile: '/tmp/wf.ts' },
        analysis: { warnings: [] },
      });

      await callCompile({ filePath: '/tmp/wf.ts', write: false, production: true });
      expect(mockCompileWorkflow).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          write: false,
          generate: { production: true },
        }),
      );
    });

    it('passes workflowName through parse options', async () => {
      mockCompileWorkflow.mockResolvedValue({ metadata: {}, analysis: {} });

      await callCompile({ filePath: '/tmp/wf.ts', workflowName: 'target' });
      expect(mockCompileWorkflow).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          parse: { workflowName: 'target' },
        }),
      );
    });

    it('uses inngest generator when target=inngest', async () => {
      mockAnnotationParserParse.mockReturnValue({
        errors: [],
        workflows: [
          { name: 'myWf', functionName: 'myWf', nodeTypes: [], options: {} },
        ],
      });
      mockGenerateInngestFunction.mockReturnValue('// inngest code');

      const result = parseResult(
        await callCompile({ filePath: '/tmp/wf.ts', target: 'inngest', write: false }),
      );
      expect(result.success).toBe(true);
      const data = result.data as { target: string; code: string; workflowName: string };
      expect(data.target).toBe('inngest');
      expect(data.code).toBe('// inngest code');
      expect(data.workflowName).toBe('myWf');
    });

    it('returns PARSE_ERROR for inngest target with parse errors', async () => {
      mockAnnotationParserParse.mockReturnValue({
        errors: ['Bad syntax'],
        workflows: [],
      });

      const result = parseResult(
        await callCompile({ filePath: '/tmp/bad.ts', target: 'inngest' }),
      );
      expect(result.success).toBe(false);
      expect((result.error as { code: string }).code).toBe('PARSE_ERROR');
    });

    it('returns PARSE_ERROR for inngest with no workflows', async () => {
      mockAnnotationParserParse.mockReturnValue({
        errors: [],
        workflows: [],
      });

      const result = parseResult(
        await callCompile({ filePath: '/tmp/empty.ts', target: 'inngest' }),
      );
      expect(result.success).toBe(false);
      expect((result.error as { code: string }).code).toBe('PARSE_ERROR');
      expect((result.error as { message: string }).message).toContain('No workflows');
    });

    it('selects named workflow for inngest target', async () => {
      mockAnnotationParserParse.mockReturnValue({
        errors: [],
        workflows: [
          { name: 'alpha', functionName: 'alpha', nodeTypes: [], options: {} },
          { name: 'beta', functionName: 'beta', nodeTypes: [], options: {} },
        ],
      });
      mockGenerateInngestFunction.mockReturnValue('code');

      const result = parseResult(
        await callCompile({
          filePath: '/tmp/multi.ts',
          target: 'inngest',
          workflowName: 'beta',
          write: false,
        }),
      );
      expect(result.success).toBe(true);
      const data = result.data as { workflowName: string };
      expect(data.workflowName).toBe('beta');
    });

    it('returns PARSE_ERROR when named workflow not found in inngest', async () => {
      mockAnnotationParserParse.mockReturnValue({
        errors: [],
        workflows: [
          { name: 'alpha', functionName: 'alpha', nodeTypes: [] },
        ],
      });

      const result = parseResult(
        await callCompile({
          filePath: '/tmp/wf.ts',
          target: 'inngest',
          workflowName: 'missing',
        }),
      );
      expect(result.success).toBe(false);
      expect((result.error as { message: string }).message).toContain('missing');
      expect((result.error as { message: string }).message).toContain('alpha');
    });

    it('passes cron, retries, timeout overrides for inngest', async () => {
      mockAnnotationParserParse.mockReturnValue({
        errors: [],
        workflows: [{ name: 'wf', functionName: 'wf', nodeTypes: [] }],
      });
      mockGenerateInngestFunction.mockReturnValue('code');

      await callCompile({
        filePath: '/tmp/wf.ts',
        target: 'inngest',
        write: false,
        cron: '0 9 * * *',
        retries: 3,
        timeout: '30m',
      });

      // Verify the workflow object was mutated with overrides
      const wfArg = mockGenerateInngestFunction.mock.calls[0][0];
      expect(wfArg.options.trigger.cron).toBe('0 9 * * *');
      expect(wfArg.options.retries).toBe(3);
      expect(wfArg.options.timeout).toBe('30m');
    });

    it('passes serve and framework options for inngest', async () => {
      mockAnnotationParserParse.mockReturnValue({
        errors: [],
        workflows: [{ name: 'wf', functionName: 'wf', nodeTypes: [], options: {} }],
      });
      mockGenerateInngestFunction.mockReturnValue('code');

      await callCompile({
        filePath: '/tmp/wf.ts',
        target: 'inngest',
        write: false,
        serve: true,
        framework: 'next',
        typedEvents: true,
      });

      const opts = mockGenerateInngestFunction.mock.calls[0][2];
      expect(opts.serveHandler).toBe(true);
      expect(opts.framework).toBe('next');
      expect(opts.typedEvents).toBe(true);
    });

    it('returns COMPILE_ERROR on unexpected exception', async () => {
      mockCompileWorkflow.mockRejectedValue(new Error('compile crash'));

      const result = parseResult(await callCompile({ filePath: '/tmp/wf.ts' }));
      expect(result.success).toBe(false);
      expect((result.error as { code: string }).code).toBe('COMPILE_ERROR');
    });
  });

  // ── fw_diff ──────────────────────────────────────────────────────────────

  describe('fw_diff', () => {
    function callDiff(args: Record<string, unknown>) {
      const handler = toolHandlers.get('fw_diff')!;
      expect(handler).toBeDefined();
      return handler(args);
    }

    it('returns text diff by default', async () => {
      mockParseWorkflow
        .mockResolvedValueOnce({ errors: [], ast: { name: 'v1' } })
        .mockResolvedValueOnce({ errors: [], ast: { name: 'v2' } });
      mockCompare.mockReturnValue({ changes: [] });
      mockFormatDiff.mockReturnValue('No changes detected.');

      const result = parseResult(
        await callDiff({ file1: '/tmp/v1.ts', file2: '/tmp/v2.ts' }),
      );
      expect(result.success).toBe(true);
      expect(result.data).toBe('No changes detected.');
    });

    it('returns JSON diff when format=json', async () => {
      mockParseWorkflow
        .mockResolvedValueOnce({ errors: [], ast: { name: 'v1' } })
        .mockResolvedValueOnce({ errors: [], ast: { name: 'v2' } });
      mockCompare.mockReturnValue({ changes: ['added node'] });
      mockFormatDiff.mockReturnValue(JSON.stringify({ changes: ['added node'] }));

      const result = parseResult(
        await callDiff({ file1: '/tmp/v1.ts', file2: '/tmp/v2.ts', format: 'json' }),
      );
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ changes: ['added node'] });
    });

    it('returns error when file1 has parse errors', async () => {
      mockParseWorkflow
        .mockResolvedValueOnce({ errors: ['Bad file1'] })
        .mockResolvedValueOnce({ errors: [], ast: {} });

      const result = parseResult(
        await callDiff({ file1: '/tmp/bad.ts', file2: '/tmp/ok.ts' }),
      );
      expect(result.success).toBe(false);
      expect((result.error as { code: string }).code).toBe('PARSE_ERROR');
    });

    it('returns error when file2 has parse errors', async () => {
      mockParseWorkflow
        .mockResolvedValueOnce({ errors: [], ast: {} })
        .mockResolvedValueOnce({ errors: ['Bad file2'] });

      const result = parseResult(
        await callDiff({ file1: '/tmp/ok.ts', file2: '/tmp/bad.ts' }),
      );
      expect(result.success).toBe(false);
      expect((result.error as { code: string }).code).toBe('PARSE_ERROR');
    });

    it('passes workflowName to both parses', async () => {
      mockParseWorkflow
        .mockResolvedValueOnce({ errors: [], ast: {} })
        .mockResolvedValueOnce({ errors: [], ast: {} });
      mockCompare.mockReturnValue({});
      mockFormatDiff.mockReturnValue('diff');

      await callDiff({
        file1: '/tmp/v1.ts',
        file2: '/tmp/v2.ts',
        workflowName: 'target',
      });

      expect(mockParseWorkflow).toHaveBeenCalledTimes(2);
      expect(mockParseWorkflow.mock.calls[0][1]).toEqual(
        expect.objectContaining({ workflowName: 'target' }),
      );
      expect(mockParseWorkflow.mock.calls[1][1]).toEqual(
        expect.objectContaining({ workflowName: 'target' }),
      );
    });

    it('returns DIFF_ERROR on unexpected exception', async () => {
      mockParseWorkflow.mockRejectedValue(new Error('crash'));

      const result = parseResult(
        await callDiff({ file1: '/tmp/v1.ts', file2: '/tmp/v2.ts' }),
      );
      expect(result.success).toBe(false);
      expect((result.error as { code: string }).code).toBe('DIFF_ERROR');
    });
  });

  // ── fw_query ─────────────────────────────────────────────────────────────

  describe('fw_query', () => {
    function callQuery(args: Record<string, unknown>) {
      const handler = toolHandlers.get('fw_query')!;
      expect(handler).toBeDefined();
      return handler(args);
    }

    function setupParse(ast?: Record<string, unknown>) {
      mockParseWorkflow.mockResolvedValue({
        errors: [],
        ast: ast ?? {
          name: 'wf',
          nodeTypes: [
            { name: 'TypeA', functionName: 'typeA', inputs: { x: {} }, outputs: { y: {} } },
          ],
          instances: [
            { id: 'step1', nodeType: 'TypeA' },
            { id: 'step2', nodeType: 'TypeA' },
          ],
          connections: [],
        },
      });
    }

    it('query=nodes returns all node instances', async () => {
      setupParse();
      mockGetNodes.mockReturnValue([
        { id: 'step1', nodeType: 'TypeA', parent: undefined },
        { id: 'step2', nodeType: 'TypeA', parent: 'scope1' },
      ]);

      const result = parseResult(await callQuery({ filePath: '/tmp/wf.ts', query: 'nodes' }));
      expect(result.success).toBe(true);
      const data = result.data as Array<{ id: string; parent: string | null }>;
      expect(data).toHaveLength(2);
      expect(data[0].parent).toBeNull();
      expect(data[1].parent).toBe('scope1');
    });

    it('query=connections returns formatted connections', async () => {
      setupParse();
      mockGetConnections.mockReturnValue([
        { from: { node: 'Start', port: 'execute' }, to: { node: 'step1', port: 'execute' } },
        { from: { node: 'step1', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } },
      ]);

      const result = parseResult(
        await callQuery({ filePath: '/tmp/wf.ts', query: 'connections' }),
      );
      expect(result.success).toBe(true);
      const data = result.data as Array<{ from: string; to: string }>;
      expect(data[0].from).toBe('Start.execute');
      expect(data[0].to).toBe('step1.execute');
    });

    it('query=connections passes nodeId filter', async () => {
      setupParse();
      mockGetConnections.mockReturnValue([]);

      await callQuery({ filePath: '/tmp/wf.ts', query: 'connections', nodeId: 'step1' });
      expect(mockGetConnections).toHaveBeenCalledWith(expect.anything(), 'step1');
    });

    it('query=deps returns dependencies for a nodeId', async () => {
      setupParse();
      mockGetDependencies.mockReturnValue(['Start', 'step1']);

      const result = parseResult(
        await callQuery({ filePath: '/tmp/wf.ts', query: 'deps', nodeId: 'step2' }),
      );
      expect(result.success).toBe(true);
      expect(result.data).toEqual(['Start', 'step1']);
    });

    it('query=deps returns MISSING_PARAM without nodeId', async () => {
      setupParse();

      const result = parseResult(
        await callQuery({ filePath: '/tmp/wf.ts', query: 'deps' }),
      );
      expect(result.success).toBe(false);
      expect((result.error as { code: string }).code).toBe('MISSING_PARAM');
    });

    it('query=dependents returns downstream nodes', async () => {
      setupParse();
      mockGetDependents.mockReturnValue(['step2', 'Exit']);

      const result = parseResult(
        await callQuery({ filePath: '/tmp/wf.ts', query: 'dependents', nodeId: 'step1' }),
      );
      expect(result.success).toBe(true);
      expect(result.data).toEqual(['step2', 'Exit']);
    });

    it('query=dependents returns MISSING_PARAM without nodeId', async () => {
      setupParse();

      const result = parseResult(
        await callQuery({ filePath: '/tmp/wf.ts', query: 'dependents' }),
      );
      expect(result.success).toBe(false);
      expect((result.error as { code: string }).code).toBe('MISSING_PARAM');
    });

    it('query=data-deps returns data-only dependencies', async () => {
      setupParse();
      mockGetDataDependencies.mockReturnValue(['step1']);

      const result = parseResult(
        await callQuery({ filePath: '/tmp/wf.ts', query: 'data-deps', nodeId: 'step2' }),
      );
      expect(result.success).toBe(true);
      expect(result.data).toEqual(['step1']);
    });

    it('query=data-deps returns MISSING_PARAM without nodeId', async () => {
      setupParse();

      const result = parseResult(
        await callQuery({ filePath: '/tmp/wf.ts', query: 'data-deps' }),
      );
      expect(result.success).toBe(false);
      expect((result.error as { code: string }).code).toBe('MISSING_PARAM');
    });

    it('query=execution-order returns topological sort', async () => {
      setupParse();
      mockGetTopologicalOrder.mockReturnValue(['step1', 'step2']);

      const result = parseResult(
        await callQuery({ filePath: '/tmp/wf.ts', query: 'execution-order' }),
      );
      expect(result.success).toBe(true);
      const data = result.data as { order: string[] };
      expect(data.order).toEqual(['step1', 'step2']);
    });

    it('query=execution-order includes scoped nodes', async () => {
      setupParse({
        name: 'wf',
        nodeTypes: [],
        instances: [
          { id: 'step1' },
          { id: 'step2' },
          { id: 'scoped1' },
        ],
        connections: [],
      });
      // Topological order only includes main-flow nodes
      mockGetTopologicalOrder.mockReturnValue(['step1', 'step2']);

      const result = parseResult(
        await callQuery({ filePath: '/tmp/wf.ts', query: 'execution-order' }),
      );
      expect(result.success).toBe(true);
      const data = result.data as { order: string[]; scopedNodes: string[] };
      expect(data.order).toEqual(['step1', 'step2']);
      expect(data.scopedNodes).toEqual(['scoped1']);
    });

    it('query=execution-order returns CYCLE_DETECTED on cycle', async () => {
      setupParse();
      mockGetTopologicalOrder.mockImplementation(() => {
        throw new Error('Cycle detected: A -> B -> A');
      });

      const result = parseResult(
        await callQuery({ filePath: '/tmp/wf.ts', query: 'execution-order' }),
      );
      expect(result.success).toBe(false);
      expect((result.error as { code: string }).code).toBe('CYCLE_DETECTED');
    });

    it('query=isolated returns isolated nodes', async () => {
      setupParse();
      mockFindIsolatedNodes.mockReturnValue(['orphan1']);

      const result = parseResult(
        await callQuery({ filePath: '/tmp/wf.ts', query: 'isolated' }),
      );
      expect(result.success).toBe(true);
      expect(result.data).toEqual(['orphan1']);
    });

    it('query=dead-ends returns dead-end details', async () => {
      setupParse();
      mockFindDeadEndDetails.mockReturnValue([{ nodeId: 'step1', reason: 'no path to Exit' }]);

      const result = parseResult(
        await callQuery({ filePath: '/tmp/wf.ts', query: 'dead-ends' }),
      );
      expect(result.success).toBe(true);
      const data = result.data as Array<{ nodeId: string }>;
      expect(data).toHaveLength(1);
    });

    it('query=disconnected-outputs returns disconnected output ports', async () => {
      setupParse();
      mockFindDisconnectedOutputPorts.mockReturnValue([
        { nodeId: 'step1', ports: ['y'] },
      ]);

      const result = parseResult(
        await callQuery({ filePath: '/tmp/wf.ts', query: 'disconnected-outputs' }),
      );
      expect(result.success).toBe(true);
      const data = result.data as Array<{ nodeId: string; ports: string[] }>;
      expect(data[0].ports).toEqual(['y']);
    });

    it('query=node-types returns node type definitions', async () => {
      setupParse();

      const result = parseResult(
        await callQuery({ filePath: '/tmp/wf.ts', query: 'node-types' }),
      );
      expect(result.success).toBe(true);
      const data = result.data as Array<{ name: string; inputs: string[]; outputs: string[] }>;
      expect(data[0].name).toBe('TypeA');
      expect(data[0].inputs).toEqual(['x']);
      expect(data[0].outputs).toEqual(['y']);
    });

    it('query=node-types falls back to nodeTypesOnly parse', async () => {
      mockParseWorkflow
        .mockResolvedValueOnce({
          errors: ['No workflows found in file'],
          ast: null,
        })
        .mockResolvedValueOnce({
          errors: [],
          ast: {
            nodeTypes: [
              { name: 'Solo', functionName: 'solo', inputs: {}, outputs: { out: {} } },
            ],
          },
        });

      const result = parseResult(
        await callQuery({ filePath: '/tmp/nodes.ts', query: 'node-types' }),
      );
      expect(result.success).toBe(true);
      const data = result.data as Array<{ name: string }>;
      expect(data[0].name).toBe('Solo');
    });

    it('returns UNKNOWN_QUERY for unknown query type', async () => {
      setupParse();

      const result = parseResult(
        await callQuery({ filePath: '/tmp/wf.ts', query: 'nonexistent' }),
      );
      expect(result.success).toBe(false);
      expect((result.error as { code: string }).code).toBe('UNKNOWN_QUERY');
    });

    it('returns PARSE_ERROR when file cannot be parsed', async () => {
      mockParseWorkflow.mockResolvedValue({
        errors: ['Unexpected token'],
        ast: null,
      });

      const result = parseResult(
        await callQuery({ filePath: '/tmp/bad.ts', query: 'nodes' }),
      );
      expect(result.success).toBe(false);
      expect((result.error as { code: string }).code).toBe('PARSE_ERROR');
    });

    it('returns QUERY_ERROR on unexpected exception', async () => {
      mockParseWorkflow.mockRejectedValue(new Error('crash'));

      const result = parseResult(
        await callQuery({ filePath: '/tmp/wf.ts', query: 'nodes' }),
      );
      expect(result.success).toBe(false);
      expect((result.error as { code: string }).code).toBe('QUERY_ERROR');
    });
  });

  // ── fw_doctor ────────────────────────────────────────────────────────────

  describe('fw_doctor', () => {
    function callDoctor(args: Record<string, unknown>) {
      const handler = toolHandlers.get('fw_doctor')!;
      expect(handler).toBeDefined();
      return handler(args);
    }

    it('returns doctor check results', async () => {
      mockRunDoctorChecks.mockReturnValue({
        checks: [{ name: 'typescript', status: 'pass' }],
        summary: { passed: 1, failed: 0 },
      });

      const result = parseResult(await callDoctor({}));
      expect(result.success).toBe(true);
      const data = result.data as { checks: unknown[]; summary: { passed: number } };
      expect(data.summary.passed).toBe(1);
    });

    it('passes directory to doctor checks', async () => {
      mockRunDoctorChecks.mockReturnValue({ checks: [], summary: {} });

      await callDoctor({ directory: '/my/project' });
      expect(mockRunDoctorChecks).toHaveBeenCalledWith('/my/project');
    });

    it('defaults to cwd when no directory given', async () => {
      mockRunDoctorChecks.mockReturnValue({ checks: [], summary: {} });

      await callDoctor({});
      expect(mockRunDoctorChecks).toHaveBeenCalledWith(expect.any(String));
    });

    it('returns DOCTOR_ERROR on failure', async () => {
      mockRunDoctorChecks.mockImplementation(() => {
        throw new Error('cannot read config');
      });

      const result = parseResult(await callDoctor({}));
      expect(result.success).toBe(false);
      expect((result.error as { code: string }).code).toBe('DOCTOR_ERROR');
    });
  });
});
