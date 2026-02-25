import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// ── Mock the API ──────────────────────────────────────────────────────────────
const mockParseWorkflow = vi.fn();

vi.mock('../../../src/api/index.js', () => ({
  parseWorkflow: (...args: unknown[]) => mockParseWorkflow(...args),
}));

// ── Mock the deployment module ────────────────────────────────────────────────
const mockGenerateBundle = vi.fn();
const mockGetDeployInstructions = vi.fn();
const mockRegistryGet = vi.fn();

vi.mock('../../../src/deployment/index.js', () => ({
  createTargetRegistry: () => ({
    get: (...args: unknown[]) => mockRegistryGet(...args),
  }),
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
import { registerExportTools } from '../../../src/mcp/tools-export.js';

function parseResult(result: unknown): { success: boolean; data?: unknown; error?: unknown } {
  const r = result as { content: Array<{ text: string }>; isError?: boolean };
  return JSON.parse(r.content[0].text);
}

describe('tools-export (fw_export)', () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    toolHandlers.clear();
    const mcp = new McpServer({ name: 'test', version: '1.0.0' });
    registerExportTools(mcp);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-export-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function callExport(args: Record<string, unknown>) {
    const handler = toolHandlers.get('fw_export')!;
    expect(handler).toBeDefined();
    return handler(args);
  }

  function setupMocks(overrides: {
    parseResult?: unknown;
    registryTarget?: unknown;
    bundleFiles?: Array<{ relativePath: string; content: string; type: string }>;
    instructions?: { title: string; steps: string[]; prerequisites: string[] };
    workflows?: unknown[];
  } = {}) {
    const wfFile = path.join(tmpDir, 'workflow.ts');
    fs.writeFileSync(wfFile, '// workflow source');

    const workflows = overrides.workflows ?? [
      {
        name: 'myWorkflow',
        functionName: 'myWorkflow',
        description: 'Test workflow',
        nodeTypes: [
          {
            name: 'step1',
            functionName: 'step1',
            inputs: { x: { dataType: 'STRING', tsType: 'string', label: 'X', optional: false } },
            outputs: { y: { dataType: 'STRING', tsType: 'string', label: 'Y' } },
          },
        ],
      },
    ];

    mockParseWorkflow.mockResolvedValue(
      overrides.parseResult ?? {
        errors: [],
        ast: workflows[0],
        allWorkflows: workflows,
      },
    );

    const files = overrides.bundleFiles ?? [
      { relativePath: 'handler.ts', content: 'export default handler;', type: 'handler' },
      { relativePath: 'config.json', content: '{}', type: 'config' },
    ];

    mockGenerateBundle.mockResolvedValue({ files });
    mockGetDeployInstructions.mockReturnValue(
      overrides.instructions ?? {
        title: 'Deploy to Lambda',
        steps: ['npm install', 'cdk deploy'],
        prerequisites: ['AWS CLI'],
      },
    );

    mockRegistryGet.mockReturnValue(
      overrides.registryTarget ?? {
        generateBundle: (...args: unknown[]) => mockGenerateBundle(...args),
        getDeployInstructions: (...args: unknown[]) => mockGetDeployInstructions(...args),
      },
    );

    return { wfFile };
  }

  it('exports a workflow and writes files to disk', async () => {
    const { wfFile } = setupMocks();
    const outputDir = path.join(tmpDir, 'output');

    const result = parseResult(
      await callExport({
        filePath: wfFile,
        target: 'lambda',
        outputDir,
      }),
    );

    expect(result.success).toBe(true);
    const data = result.data as {
      preview: boolean;
      target: string;
      serviceName: string;
      files: Array<{ path: string; type: string; size: number }>;
      endpoints: unknown[];
      instructions: { title: string; steps: string[] };
      summary: string;
    };
    expect(data.preview).toBe(false);
    expect(data.target).toBe('lambda');
    expect(data.files).toHaveLength(2);
    expect(data.endpoints).toHaveLength(1);
    expect(data.instructions.title).toBe('Deploy to Lambda');
    expect(data.summary).toContain('Exported 2 files');

    // Files should be written
    expect(fs.existsSync(path.join(outputDir, 'handler.ts'))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, 'config.json'))).toBe(true);
  });

  it('preview mode does not write files', async () => {
    const { wfFile } = setupMocks();
    const outputDir = path.join(tmpDir, 'preview-output');

    const result = parseResult(
      await callExport({
        filePath: wfFile,
        target: 'lambda',
        outputDir,
        preview: true,
      }),
    );

    expect(result.success).toBe(true);
    const data = result.data as { preview: boolean; summary: string };
    expect(data.preview).toBe(true);
    expect(data.summary).toContain('Preview');
    expect(fs.existsSync(outputDir)).toBe(false);
  });

  it('returns FILE_NOT_FOUND when workflow file does not exist', async () => {
    const result = parseResult(
      await callExport({
        filePath: '/nonexistent/workflow.ts',
        target: 'lambda',
        outputDir: path.join(tmpDir, 'out'),
      }),
    );

    expect(result.success).toBe(false);
    expect((result.error as { code: string }).code).toBe('FILE_NOT_FOUND');
  });

  it('returns PARSE_ERROR when file cannot be parsed', async () => {
    const wfFile = path.join(tmpDir, 'bad.ts');
    fs.writeFileSync(wfFile, 'broken');

    mockParseWorkflow.mockResolvedValue({
      errors: ['Syntax error'],
      ast: null,
      allWorkflows: [],
    });

    const result = parseResult(
      await callExport({
        filePath: wfFile,
        target: 'lambda',
        outputDir: path.join(tmpDir, 'out'),
      }),
    );

    expect(result.success).toBe(false);
    expect((result.error as { code: string }).code).toBe('PARSE_ERROR');
  });

  it('falls back to nodeTypesOnly parse when full parse has errors', async () => {
    const wfFile = path.join(tmpDir, 'partial.ts');
    fs.writeFileSync(wfFile, '// partial');

    // First parse: errors. Second parse (nodeTypesOnly): success.
    mockParseWorkflow
      .mockResolvedValueOnce({
        errors: ['Missing workflow annotation'],
        ast: null,
        allWorkflows: [],
      })
      .mockResolvedValueOnce({
        errors: [],
        ast: { name: 'wf', nodeTypes: [{ name: 'n1', functionName: 'n1', inputs: {}, outputs: {} }] },
        allWorkflows: [{ name: 'wf', functionName: 'wf', nodeTypes: [{ name: 'n1', functionName: 'n1', inputs: {}, outputs: {} }] }],
      });

    mockRegistryGet.mockReturnValue({
      generateBundle: mockGenerateBundle,
      getDeployInstructions: mockGetDeployInstructions,
    });
    mockGenerateBundle.mockResolvedValue({ files: [{ relativePath: 'h.ts', content: 'x', type: 'handler' }] });
    mockGetDeployInstructions.mockReturnValue({ title: 'T', steps: [], prerequisites: [] });

    const result = parseResult(
      await callExport({
        filePath: wfFile,
        target: 'lambda',
        outputDir: path.join(tmpDir, 'out'),
      }),
    );

    expect(result.success).toBe(true);
    expect(mockParseWorkflow).toHaveBeenCalledTimes(2);
  });

  it('returns INVALID_TARGET when target is unknown', async () => {
    const wfFile = path.join(tmpDir, 'wf.ts');
    fs.writeFileSync(wfFile, '// ok');
    mockParseWorkflow.mockResolvedValue({
      errors: [],
      ast: {},
      allWorkflows: [{ name: 'w', functionName: 'w', nodeTypes: [] }],
    });
    mockRegistryGet.mockReturnValue(null);

    const result = parseResult(
      await callExport({
        filePath: wfFile,
        target: 'lambda',
        outputDir: path.join(tmpDir, 'out'),
      }),
    );

    expect(result.success).toBe(false);
    expect((result.error as { code: string }).code).toBe('INVALID_TARGET');
  });

  it('returns INVALID_TARGET when target does not support generateBundle', async () => {
    const wfFile = path.join(tmpDir, 'wf.ts');
    fs.writeFileSync(wfFile, '// ok');
    mockParseWorkflow.mockResolvedValue({
      errors: [],
      ast: {},
      allWorkflows: [{ name: 'w', functionName: 'w', nodeTypes: [] }],
    });
    mockRegistryGet.mockReturnValue({ generateBundle: null });

    const result = parseResult(
      await callExport({
        filePath: wfFile,
        target: 'lambda',
        outputDir: path.join(tmpDir, 'out'),
      }),
    );

    expect(result.success).toBe(false);
    expect((result.error as { code: string }).code).toBe('INVALID_TARGET');
  });

  it('returns EXPORT_ERROR when no workflows or node types are selected', async () => {
    const wfFile = path.join(tmpDir, 'wf.ts');
    fs.writeFileSync(wfFile, '// ok');
    mockParseWorkflow.mockResolvedValue({
      errors: [],
      ast: {},
      allWorkflows: [], // no workflows
    });
    mockRegistryGet.mockReturnValue({
      generateBundle: mockGenerateBundle,
      getDeployInstructions: mockGetDeployInstructions,
    });

    const result = parseResult(
      await callExport({
        filePath: wfFile,
        target: 'lambda',
        outputDir: path.join(tmpDir, 'out'),
      }),
    );

    expect(result.success).toBe(false);
    expect((result.error as { code: string }).code).toBe('EXPORT_ERROR');
    expect((result.error as { message: string }).message).toContain('No workflows or node types selected');
  });

  it('filters workflows by name when workflows option is provided', async () => {
    const wfFile = path.join(tmpDir, 'multi.ts');
    fs.writeFileSync(wfFile, '// multi');
    mockParseWorkflow.mockResolvedValue({
      errors: [],
      ast: {},
      allWorkflows: [
        { name: 'alpha', functionName: 'alpha', description: 'A', nodeTypes: [] },
        { name: 'beta', functionName: 'beta', description: 'B', nodeTypes: [] },
      ],
    });
    mockRegistryGet.mockReturnValue({
      generateBundle: mockGenerateBundle,
      getDeployInstructions: mockGetDeployInstructions,
    });
    mockGenerateBundle.mockResolvedValue({ files: [{ relativePath: 'h.ts', content: 'x', type: 'handler' }] });
    mockGetDeployInstructions.mockReturnValue({ title: 'T', steps: [], prerequisites: [] });

    const result = parseResult(
      await callExport({
        filePath: wfFile,
        target: 'lambda',
        outputDir: path.join(tmpDir, 'out'),
        workflows: ['alpha'],
      }),
    );

    expect(result.success).toBe(true);
    // generateBundle should only receive alpha
    const bundleWorkflows = mockGenerateBundle.mock.calls[0][0];
    expect(bundleWorkflows).toHaveLength(1);
    expect(bundleWorkflows[0].name).toBe('alpha');
  });

  it('derives service name from filename when not provided', async () => {
    const { wfFile } = setupMocks();

    const result = parseResult(
      await callExport({
        filePath: wfFile,
        target: 'lambda',
        outputDir: path.join(tmpDir, 'out'),
      }),
    );

    expect(result.success).toBe(true);
    const data = result.data as { serviceName: string };
    expect(data.serviceName).toBe('workflow');
  });

  it('uses provided serviceName', async () => {
    const { wfFile } = setupMocks();

    const result = parseResult(
      await callExport({
        filePath: wfFile,
        target: 'lambda',
        outputDir: path.join(tmpDir, 'out'),
        serviceName: 'my-service',
      }),
    );

    expect(result.success).toBe(true);
    const data = result.data as { serviceName: string };
    expect(data.serviceName).toBe('my-service');
  });

  it('passes durableSteps option for inngest target', async () => {
    const { wfFile } = setupMocks();

    await callExport({
      filePath: wfFile,
      target: 'inngest',
      outputDir: path.join(tmpDir, 'out'),
      durableSteps: true,
    });

    const bundleOptions = mockGenerateBundle.mock.calls[0][2];
    expect(bundleOptions.targetOptions).toEqual({ durableSteps: true });
  });

  it('catches unexpected errors as EXPORT_ERROR', async () => {
    const wfFile = path.join(tmpDir, 'wf.ts');
    fs.writeFileSync(wfFile, '// ok');
    mockParseWorkflow.mockRejectedValue(new Error('unexpected crash'));

    const result = parseResult(
      await callExport({
        filePath: wfFile,
        target: 'lambda',
        outputDir: path.join(tmpDir, 'out'),
      }),
    );

    expect(result.success).toBe(false);
    expect((result.error as { code: string }).code).toBe('PARSE_ERROR');
    expect((result.error as { message: string }).message).toContain('unexpected crash');
  });

  it('passes includeDocs=true by default', async () => {
    const { wfFile } = setupMocks();

    await callExport({
      filePath: wfFile,
      target: 'lambda',
      outputDir: path.join(tmpDir, 'out'),
    });

    const bundleOptions = mockGenerateBundle.mock.calls[0][2];
    expect(bundleOptions.includeDocs).toBe(true);
  });

  it('respects includeDocs=false', async () => {
    const { wfFile } = setupMocks();

    await callExport({
      filePath: wfFile,
      target: 'lambda',
      outputDir: path.join(tmpDir, 'out'),
      includeDocs: false,
    });

    const bundleOptions = mockGenerateBundle.mock.calls[0][2];
    expect(bundleOptions.includeDocs).toBe(false);
  });

  it('includes selected node types when nodeTypes option is provided', async () => {
    const wfFile = path.join(tmpDir, 'with-nt.ts');
    fs.writeFileSync(wfFile, '// ok');

    const nt = {
      name: 'MyNode',
      functionName: 'myNode',
      inputs: {
        x: { dataType: 'STRING', tsType: 'string', label: 'X', optional: false },
      },
      outputs: {
        y: { dataType: 'NUMBER', tsType: 'number', label: 'Y' },
      },
    };

    mockParseWorkflow.mockResolvedValue({
      errors: [],
      ast: {},
      allWorkflows: [
        { name: 'wf', functionName: 'wf', description: 'test', nodeTypes: [nt] },
      ],
    });

    mockRegistryGet.mockReturnValue({
      generateBundle: mockGenerateBundle,
      getDeployInstructions: mockGetDeployInstructions,
    });
    mockGenerateBundle.mockResolvedValue({
      files: [{ relativePath: 'h.ts', content: 'x', type: 'handler' }],
    });
    mockGetDeployInstructions.mockReturnValue({ title: 'T', steps: [], prerequisites: [] });

    const result = parseResult(
      await callExport({
        filePath: wfFile,
        target: 'lambda',
        outputDir: path.join(tmpDir, 'out'),
        nodeTypes: ['MyNode'],
      }),
    );

    expect(result.success).toBe(true);
    const bundleNodeTypes = mockGenerateBundle.mock.calls[0][1];
    expect(bundleNodeTypes).toHaveLength(1);
    expect(bundleNodeTypes[0].name).toBe('MyNode');
    expect(bundleNodeTypes[0].inputs.x.dataType).toBe('STRING');
    expect(bundleNodeTypes[0].outputs.y.dataType).toBe('NUMBER');
  });

  it('deduplicates node types that appear in multiple workflows', async () => {
    const wfFile = path.join(tmpDir, 'dedup-nt.ts');
    fs.writeFileSync(wfFile, '// ok');

    const sharedNt = {
      name: 'SharedNode',
      functionName: 'sharedNode',
      inputs: { a: { dataType: 'STRING', tsType: 'string', label: 'A', optional: false } },
      outputs: { b: { dataType: 'STRING', tsType: 'string', label: 'B' } },
    };

    mockParseWorkflow.mockResolvedValue({
      errors: [],
      ast: {},
      allWorkflows: [
        { name: 'wf1', functionName: 'wf1', description: '', nodeTypes: [sharedNt] },
        { name: 'wf2', functionName: 'wf2', description: '', nodeTypes: [sharedNt] },
      ],
    });

    mockRegistryGet.mockReturnValue({
      generateBundle: mockGenerateBundle,
      getDeployInstructions: mockGetDeployInstructions,
    });
    mockGenerateBundle.mockResolvedValue({
      files: [{ relativePath: 'h.ts', content: 'x', type: 'handler' }],
    });
    mockGetDeployInstructions.mockReturnValue({ title: 'T', steps: [], prerequisites: [] });

    const result = parseResult(
      await callExport({
        filePath: wfFile,
        target: 'lambda',
        outputDir: path.join(tmpDir, 'out'),
        nodeTypes: ['SharedNode'],
      }),
    );

    expect(result.success).toBe(true);
    // Only one copy of SharedNode should be passed despite appearing in two workflows
    const bundleNodeTypes = mockGenerateBundle.mock.calls[0][1];
    expect(bundleNodeTypes).toHaveLength(1);
  });

  it('wraps non-Error throws as EXPORT_ERROR', async () => {
    const wfFile = path.join(tmpDir, 'throw-str.ts');
    fs.writeFileSync(wfFile, '// ok');
    mockParseWorkflow.mockResolvedValue({
      errors: [],
      ast: {},
      allWorkflows: [{ name: 'w', functionName: 'w', description: '', nodeTypes: [] }],
    });
    mockRegistryGet.mockReturnValue({
      generateBundle: mockGenerateBundle,
      getDeployInstructions: mockGetDeployInstructions,
    });
    mockGenerateBundle.mockRejectedValue('string error');

    const result = parseResult(
      await callExport({
        filePath: wfFile,
        target: 'lambda',
        outputDir: path.join(tmpDir, 'out'),
      }),
    );

    expect(result.success).toBe(false);
    expect((result.error as { code: string }).code).toBe('EXPORT_ERROR');
    expect((result.error as { message: string }).message).toContain('string error');
  });

  it('handles nodeTypesOnly fallback that also throws', async () => {
    const wfFile = path.join(tmpDir, 'double-fail.ts');
    fs.writeFileSync(wfFile, '// bad');

    mockParseWorkflow
      .mockResolvedValueOnce({
        errors: ['parse error'],
        ast: null,
        allWorkflows: [],
      })
      .mockRejectedValueOnce(new Error('nodeTypes parse also failed'));

    const result = parseResult(
      await callExport({
        filePath: wfFile,
        target: 'lambda',
        outputDir: path.join(tmpDir, 'out'),
      }),
    );

    expect(result.success).toBe(false);
    expect((result.error as { code: string }).code).toBe('PARSE_ERROR');
    // Original error should be used since the fallback threw
    expect((result.error as { message: string }).message).toContain('parse error');
  });
});
