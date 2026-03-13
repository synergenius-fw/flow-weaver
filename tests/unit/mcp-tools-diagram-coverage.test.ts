vi.mock('../../src/diagram/index', () => ({
  fileToSVG: vi.fn().mockReturnValue('<svg>file</svg>'),
  fileToHTML: vi.fn().mockReturnValue('<html>file</html>'),
  fileToASCII: vi.fn().mockReturnValue('ASCII file diagram'),
  sourceToSVG: vi.fn().mockReturnValue('<svg>source</svg>'),
  sourceToHTML: vi.fn().mockReturnValue('<html>source</html>'),
  sourceToASCII: vi.fn().mockReturnValue('ASCII source diagram'),
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(true),
    writeFileSync: vi.fn(),
  };
});

import * as fs from 'fs';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerDiagramTools } from '../../src/mcp/tools-diagram';
import { sourceToSVG, sourceToHTML, sourceToASCII, fileToSVG, fileToHTML, fileToASCII } from '../../src/diagram/index';

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

describe('fw_diagram tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const mcp = createMockMcp();
    registerDiagramTools(mcp);
  });

  it('returns error when neither filePath nor source provided', async () => {
    const result = await toolHandler({});
    const parsed = parseResult(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error.code).toBe('MISSING_PARAM');
  });

  it('generates SVG from source (default format)', async () => {
    const result = await toolHandler({ source: 'workflow code' });
    const parsed = parseResult(result);
    expect(parsed.success).toBe(true);
    expect(sourceToSVG).toHaveBeenCalled();
  });

  it('generates HTML from source', async () => {
    const result = await toolHandler({ source: 'workflow code', format: 'html' });
    const parsed = parseResult(result);
    expect(parsed.success).toBe(true);
    expect(sourceToHTML).toHaveBeenCalled();
  });

  it('generates ASCII from source with ascii format', async () => {
    const result = await toolHandler({ source: 'workflow code', format: 'ascii' });
    const parsed = parseResult(result);
    expect(parsed.success).toBe(true);
    expect(sourceToASCII).toHaveBeenCalled();
  });

  it('generates ASCII from source with ascii-compact format', async () => {
    const result = await toolHandler({ source: 'workflow code', format: 'ascii-compact' });
    expect(sourceToASCII).toHaveBeenCalled();
  });

  it('generates ASCII from source with text format', async () => {
    const result = await toolHandler({ source: 'workflow code', format: 'text' });
    expect(sourceToASCII).toHaveBeenCalled();
  });

  it('returns error when file not found', async () => {
    vi.mocked(fs.existsSync).mockReturnValueOnce(false);
    const result = await toolHandler({ filePath: '/nonexistent/file.ts' });
    const parsed = parseResult(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error.code).toBe('FILE_NOT_FOUND');
  });

  it('generates SVG from file (default format)', async () => {
    const result = await toolHandler({ filePath: '/test/workflow.ts' });
    const parsed = parseResult(result);
    expect(parsed.success).toBe(true);
    expect(fileToSVG).toHaveBeenCalled();
  });

  it('generates HTML from file', async () => {
    const result = await toolHandler({ filePath: '/test/workflow.ts', format: 'html' });
    const parsed = parseResult(result);
    expect(parsed.success).toBe(true);
    expect(fileToHTML).toHaveBeenCalled();
  });

  it('generates ASCII from file', async () => {
    const result = await toolHandler({ filePath: '/test/workflow.ts', format: 'ascii' });
    const parsed = parseResult(result);
    expect(parsed.success).toBe(true);
    expect(fileToASCII).toHaveBeenCalled();
  });

  it('writes to outputPath when specified', async () => {
    const result = await toolHandler({
      source: 'workflow code',
      outputPath: '/output/diagram.svg',
    });
    const parsed = parseResult(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data.written).toBeTruthy();
    expect(parsed.data.size).toBeGreaterThan(0);
    expect(fs.writeFileSync).toHaveBeenCalled();
  });

  it('returns DIAGRAM_ERROR when generation throws', async () => {
    vi.mocked(sourceToSVG).mockImplementationOnce(() => {
      throw new Error('parse failed');
    });

    const result = await toolHandler({ source: 'bad code' });
    const parsed = parseResult(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error.code).toBe('DIAGRAM_ERROR');
    expect(parsed.error.message).toContain('parse failed');
  });

  it('handles non-Error throws in catch block', async () => {
    vi.mocked(sourceToSVG).mockImplementationOnce(() => {
      throw 'string error';
    });

    const result = await toolHandler({ source: 'bad code' });
    const parsed = parseResult(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error.message).toContain('string error');
  });

  it('passes diagram options through correctly', async () => {
    await toolHandler({
      source: 'code',
      workflowName: 'myWorkflow',
      theme: 'light',
      showPortLabels: false,
      format: 'svg',
    });

    expect(sourceToSVG).toHaveBeenCalledWith('code', {
      workflowName: 'myWorkflow',
      theme: 'light',
      showPortLabels: false,
      format: 'svg',
    });
  });
});
