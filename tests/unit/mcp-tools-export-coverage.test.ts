vi.mock('../../src/api/index', () => ({
  parseWorkflow: vi.fn(),
}));

vi.mock('../../src/deployment/index', () => ({
  createTargetRegistry: vi.fn(),
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    promises: {
      ...actual.promises,
      access: vi.fn().mockResolvedValue(undefined),
      mkdir: vi.fn().mockResolvedValue(undefined),
      writeFile: vi.fn().mockResolvedValue(undefined),
    },
  };
});

import * as fs from 'fs';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerExportTools } from '../../src/mcp/tools-export';
import { parseWorkflow } from '../../src/api/index';
import { createTargetRegistry } from '../../src/deployment/index';

const mockParseWorkflow = vi.mocked(parseWorkflow);
const mockCreateRegistry = vi.mocked(createTargetRegistry);

type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;

let toolHandler: ToolHandler;

function createMockMcp(): McpServer {
  return {
    tool: vi.fn().mockImplementation((_name: string, _desc: string, _schema: unknown, handler: ToolHandler) => {
      toolHandler = handler;
    }),
  } as unknown as McpServer;
}

function parseResult(result: { content: Array<{ type: string; text: string }> }) {
  return JSON.parse(result.content[0].text);
}

function makeRegistry(target: Record<string, unknown> | null, names: string[] = []) {
  return {
    get: vi.fn().mockReturnValue(target),
    getNames: vi.fn().mockReturnValue(names),
  };
}

function makeArtifacts(files = [{ relativePath: 'handler.ts', type: 'handler', content: 'code' }]) {
  return { files };
}

describe('fw_export tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const mcp = createMockMcp();
    registerExportTools(mcp);
  });

  it('returns FILE_NOT_FOUND when file does not exist', async () => {
    vi.mocked(fs.promises.access).mockRejectedValueOnce(new Error('ENOENT'));

    const result = await toolHandler({
      filePath: '/nonexistent.ts',
      target: 'cloudflare',
      outputDir: '/out',
    });
    const parsed = parseResult(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error.code).toBe('FILE_NOT_FOUND');
  });

  it('returns INVALID_TARGET with no targets installed', async () => {
    mockCreateRegistry.mockResolvedValue(makeRegistry(null, []) as any);

    const result = await toolHandler({
      filePath: '/test.ts',
      target: 'unknown',
      outputDir: '/out',
    });
    const parsed = parseResult(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error.code).toBe('INVALID_TARGET');
    expect(parsed.error.message).toContain('No export targets installed');
  });

  it('returns INVALID_TARGET listing available targets', async () => {
    mockCreateRegistry.mockResolvedValue(makeRegistry(null, ['cloudflare', 'aws']) as any);

    const result = await toolHandler({
      filePath: '/test.ts',
      target: 'unknown',
      outputDir: '/out',
    });
    const parsed = parseResult(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error.code).toBe('INVALID_TARGET');
    expect(parsed.error.message).toContain('cloudflare, aws');
  });

  it('handles target without generateBundle (CI/CD target) in non-preview mode', async () => {
    const artifacts = makeArtifacts();
    const target = {
      generate: vi.fn().mockResolvedValue(artifacts),
      getDeployInstructions: vi.fn().mockReturnValue({
        title: 'Deploy',
        steps: ['step 1'],
        prerequisites: ['prereq'],
      }),
      // No generateBundle
    };
    mockCreateRegistry.mockResolvedValue(makeRegistry(target) as any);
    mockParseWorkflow.mockResolvedValue({
      errors: [],
      allWorkflows: [],
      ast: {} as any,
    } as any);

    const result = await toolHandler({
      filePath: '/test.ts',
      target: 'github-actions',
      outputDir: '/out',
    });
    const parsed = parseResult(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data.files).toHaveLength(1);
    expect(parsed.data.summary).toContain('Exported');
    expect(fs.promises.mkdir).toHaveBeenCalled();
    expect(fs.promises.writeFile).toHaveBeenCalled();
  });

  it('handles CI/CD target in preview mode (no file writes)', async () => {
    const artifacts = makeArtifacts();
    const target = {
      generate: vi.fn().mockResolvedValue(artifacts),
      getDeployInstructions: vi.fn().mockReturnValue({
        title: 'Deploy',
        steps: [],
        prerequisites: [],
      }),
    };
    mockCreateRegistry.mockResolvedValue(makeRegistry(target) as any);
    mockParseWorkflow.mockResolvedValue({
      errors: [],
      allWorkflows: [],
      ast: {} as any,
    } as any);

    const result = await toolHandler({
      filePath: '/test.ts',
      target: 'github-actions',
      outputDir: '/out',
      preview: true,
    });
    const parsed = parseResult(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data.preview).toBe(true);
    expect(parsed.data.summary).toContain('Preview');
    // writeFile should not be called in preview mode for this path
    expect(fs.promises.writeFile).not.toHaveBeenCalled();
  });

  it('returns PARSE_ERROR when parsing fails with exception', async () => {
    const target = { generateBundle: vi.fn() };
    mockCreateRegistry.mockResolvedValue(makeRegistry(target) as any);
    mockParseWorkflow.mockRejectedValue(new Error('syntax error'));

    const result = await toolHandler({
      filePath: '/test.ts',
      target: 'cloudflare',
      outputDir: '/out',
    });
    const parsed = parseResult(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error.code).toBe('PARSE_ERROR');
  });

  it('falls back to nodeTypesOnly parse when initial parse has errors', async () => {
    const target = {
      generateBundle: vi.fn().mockResolvedValue(makeArtifacts()),
      getDeployInstructions: vi.fn().mockReturnValue({ title: '', steps: [], prerequisites: [] }),
    };
    mockCreateRegistry.mockResolvedValue(makeRegistry(target) as any);

    // First call: has errors. Second call (nodeTypesOnly): succeeds with workflows.
    mockParseWorkflow
      .mockResolvedValueOnce({
        errors: ['some error'],
        allWorkflows: [],
        ast: {} as any,
      } as any)
      .mockResolvedValueOnce({
        errors: [],
        allWorkflows: [
          {
            name: 'TestWorkflow',
            functionName: 'testWorkflow',
            description: 'test',
            nodeTypes: [],
          },
        ],
        ast: {} as any,
      } as any);

    const result = await toolHandler({
      filePath: '/test.ts',
      target: 'cloudflare',
      outputDir: '/out',
    });
    const parsed = parseResult(result);
    expect(parsed.success).toBe(true);
  });

  it('returns PARSE_ERROR when both parse attempts have errors', async () => {
    const target = { generateBundle: vi.fn() };
    mockCreateRegistry.mockResolvedValue(makeRegistry(target) as any);

    mockParseWorkflow
      .mockResolvedValueOnce({
        errors: ['error 1'],
        allWorkflows: [],
        ast: {} as any,
      } as any)
      .mockResolvedValueOnce({
        errors: ['error 2'],
        allWorkflows: [],
        ast: {} as any,
      } as any);

    const result = await toolHandler({
      filePath: '/test.ts',
      target: 'cloudflare',
      outputDir: '/out',
    });
    const parsed = parseResult(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error.code).toBe('PARSE_ERROR');
  });

  it('returns PARSE_ERROR when first parse has errors and nodeTypesOnly parse throws', async () => {
    const target = { generateBundle: vi.fn() };
    mockCreateRegistry.mockResolvedValue(makeRegistry(target) as any);

    mockParseWorkflow
      .mockResolvedValueOnce({
        errors: ['error 1'],
        allWorkflows: [],
        ast: {} as any,
      } as any)
      .mockRejectedValueOnce(new Error('crash'));

    const result = await toolHandler({
      filePath: '/test.ts',
      target: 'cloudflare',
      outputDir: '/out',
    });
    const parsed = parseResult(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error.code).toBe('PARSE_ERROR');
  });

  it('returns EXPORT_ERROR when no workflows or node types selected', async () => {
    const target = { generateBundle: vi.fn() };
    mockCreateRegistry.mockResolvedValue(makeRegistry(target) as any);

    mockParseWorkflow.mockResolvedValue({
      errors: [],
      allWorkflows: [],
      ast: {} as any,
    } as any);

    const result = await toolHandler({
      filePath: '/test.ts',
      target: 'cloudflare',
      outputDir: '/out',
    });
    const parsed = parseResult(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error.code).toBe('EXPORT_ERROR');
    expect(parsed.error.message).toContain('No workflows or node types');
  });

  it('generates bundle and writes files in non-preview mode', async () => {
    const artifacts = makeArtifacts([
      { relativePath: 'handler.ts', type: 'handler', content: 'export default {}' },
      { relativePath: 'config.json', type: 'config', content: '{}' },
    ]);
    const target = {
      generateBundle: vi.fn().mockResolvedValue(artifacts),
      getDeployInstructions: vi.fn().mockReturnValue({
        title: 'Deploy to CF',
        steps: ['wrangler deploy'],
        prerequisites: ['wrangler'],
      }),
    };
    mockCreateRegistry.mockResolvedValue(makeRegistry(target) as any);

    mockParseWorkflow.mockResolvedValue({
      errors: [],
      allWorkflows: [
        {
          name: 'MyWorkflow',
          functionName: 'myWorkflow',
          description: 'desc',
          nodeTypes: [],
        },
      ],
      ast: {} as any,
    } as any);

    const result = await toolHandler({
      filePath: '/test.ts',
      target: 'cloudflare',
      outputDir: '/out',
    });
    const parsed = parseResult(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data.files).toHaveLength(2);
    expect(parsed.data.endpoints).toHaveLength(1);
    expect(parsed.data.endpoints[0].path).toBe('/workflows/myWorkflow');
    expect(parsed.data.instructions.title).toBe('Deploy to CF');
    expect(parsed.data.summary).toContain('Exported');
    expect(fs.promises.writeFile).toHaveBeenCalledTimes(2);
  });

  it('generates bundle in preview mode without writing files', async () => {
    const artifacts = makeArtifacts();
    const target = {
      generateBundle: vi.fn().mockResolvedValue(artifacts),
      getDeployInstructions: vi.fn().mockReturnValue({ title: '', steps: [], prerequisites: [] }),
    };
    mockCreateRegistry.mockResolvedValue(makeRegistry(target) as any);

    mockParseWorkflow.mockResolvedValue({
      errors: [],
      allWorkflows: [
        { name: 'W', functionName: 'w', description: '', nodeTypes: [] },
      ],
      ast: {} as any,
    } as any);

    const result = await toolHandler({
      filePath: '/test.ts',
      target: 'cloudflare',
      outputDir: '/out',
      preview: true,
    });
    const parsed = parseResult(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data.preview).toBe(true);
    expect(fs.promises.writeFile).not.toHaveBeenCalled();
  });

  it('catches top-level errors and returns EXPORT_ERROR', async () => {
    mockCreateRegistry.mockRejectedValue(new Error('registry boom'));

    const result = await toolHandler({
      filePath: '/test.ts',
      target: 'cloudflare',
      outputDir: '/out',
    });
    const parsed = parseResult(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error.code).toBe('EXPORT_ERROR');
    expect(parsed.error.message).toContain('registry boom');
  });

  it('passes durableSteps and deploy options to generateBundle', async () => {
    const artifacts = makeArtifacts();
    const generateBundle = vi.fn().mockResolvedValue(artifacts);
    const target = {
      generateBundle,
      getDeployInstructions: vi.fn().mockReturnValue({ title: '', steps: [], prerequisites: [] }),
    };
    mockCreateRegistry.mockResolvedValue(makeRegistry(target) as any);

    mockParseWorkflow.mockResolvedValue({
      errors: [],
      allWorkflows: [
        {
          name: 'W',
          functionName: 'w',
          description: '',
          nodeTypes: [],
          options: { deploy: { region: 'us-east-1' } },
        },
      ],
      ast: {} as any,
    } as any);

    await toolHandler({
      filePath: '/test.ts',
      target: 'cloudflare',
      outputDir: '/out',
      durableSteps: true,
    });

    const callArgs = generateBundle.mock.calls[0][2];
    expect(callArgs.targetOptions.durableSteps).toBe(true);
    expect(callArgs.targetOptions.deploy).toEqual({ region: 'us-east-1' });
  });

  it('filters workflows and node types based on args', async () => {
    const artifacts = makeArtifacts();
    const generateBundle = vi.fn().mockResolvedValue(artifacts);
    const target = {
      generateBundle,
      getDeployInstructions: vi.fn().mockReturnValue({ title: '', steps: [], prerequisites: [] }),
    };
    mockCreateRegistry.mockResolvedValue(makeRegistry(target) as any);

    mockParseWorkflow.mockResolvedValue({
      errors: [],
      allWorkflows: [
        {
          name: 'W1',
          functionName: 'w1',
          description: '',
          nodeTypes: [
            {
              name: 'NT1',
              functionName: 'nt1',
              inputs: { inp: { dataType: 'STRING', tsType: 'string', label: 'inp' } },
              outputs: { out: { dataType: 'NUMBER', tsType: 'number', label: 'out' } },
            },
          ],
        },
        {
          name: 'W2',
          functionName: 'w2',
          description: '',
          nodeTypes: [],
        },
      ],
      ast: {} as any,
    } as any);

    await toolHandler({
      filePath: '/test.ts',
      target: 'cloudflare',
      outputDir: '/out',
      workflows: ['W1'],
      nodeTypes: ['NT1'],
    });

    const [bundleWorkflows, bundleNodeTypes] = generateBundle.mock.calls[0];
    expect(bundleWorkflows).toHaveLength(1);
    expect(bundleWorkflows[0].name).toBe('W1');
    expect(bundleNodeTypes).toHaveLength(1);
    expect(bundleNodeTypes[0].name).toBe('NT1');
  });
});
