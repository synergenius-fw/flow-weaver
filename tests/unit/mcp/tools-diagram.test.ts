import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// ── Mock diagram module ───────────────────────────────────────────────────────
const mockFileToSVG = vi.fn();
const mockFileToHTML = vi.fn();

vi.mock('../../../src/diagram/index.js', () => ({
  fileToSVG: (...args: unknown[]) => mockFileToSVG(...args),
  fileToHTML: (...args: unknown[]) => mockFileToHTML(...args),
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
import { registerDiagramTools } from '../../../src/mcp/tools-diagram.js';

function parseResult(result: unknown): { success: boolean; data?: unknown; error?: unknown } {
  const r = result as { content: Array<{ text: string }>; isError?: boolean };
  return JSON.parse(r.content[0].text);
}

describe('tools-diagram (fw_diagram)', () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    toolHandlers.clear();
    const mcp = new McpServer({ name: 'test', version: '1.0.0' });
    registerDiagramTools(mcp);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-diagram-test-'));
  });

  function callDiagram(args: Record<string, unknown>) {
    const handler = toolHandlers.get('fw_diagram')!;
    expect(handler).toBeDefined();
    return handler(args);
  }

  it('returns FILE_NOT_FOUND when the workflow file does not exist', async () => {
    const result = parseResult(await callDiagram({ filePath: '/nonexistent/workflow.ts' }));
    expect(result.success).toBe(false);
    expect((result.error as { code: string }).code).toBe('FILE_NOT_FOUND');
  });

  it('generates SVG and returns it as text (no output path)', async () => {
    const workflowFile = path.join(tmpDir, 'wf.ts');
    fs.writeFileSync(workflowFile, '// workflow stub');
    mockFileToSVG.mockReturnValue('<svg>diagram</svg>');

    const result = parseResult(await callDiagram({ filePath: workflowFile }));
    expect(result.success).toBe(true);
    expect(result.data).toBe('<svg>diagram</svg>');
    expect(mockFileToSVG).toHaveBeenCalledWith(
      workflowFile,
      expect.objectContaining({ workflowName: undefined }),
    );
  });

  it('writes SVG to output path when specified', async () => {
    const workflowFile = path.join(tmpDir, 'wf.ts');
    const outputFile = path.join(tmpDir, 'out.svg');
    fs.writeFileSync(workflowFile, '// workflow stub');
    mockFileToSVG.mockReturnValue('<svg>written</svg>');

    const result = parseResult(
      await callDiagram({ filePath: workflowFile, outputPath: outputFile }),
    );
    expect(result.success).toBe(true);
    const data = result.data as { written: string; size: number };
    expect(data.written).toBe(outputFile);
    expect(data.size).toBe('<svg>written</svg>'.length);

    const onDisk = fs.readFileSync(outputFile, 'utf-8');
    expect(onDisk).toBe('<svg>written</svg>');
  });

  it('passes workflowName, theme, and showPortLabels to the generator', async () => {
    const workflowFile = path.join(tmpDir, 'wf.ts');
    fs.writeFileSync(workflowFile, '// stub');
    mockFileToSVG.mockReturnValue('<svg/>');

    await callDiagram({
      filePath: workflowFile,
      workflowName: 'myWorkflow',
      theme: 'light',
      showPortLabels: false,
    });

    expect(mockFileToSVG).toHaveBeenCalledWith(workflowFile, {
      workflowName: 'myWorkflow',
      theme: 'light',
      showPortLabels: false,
    });
  });

  it('uses fileToHTML when format="html"', async () => {
    const workflowFile = path.join(tmpDir, 'wf.ts');
    fs.writeFileSync(workflowFile, '// stub');
    mockFileToHTML.mockReturnValue('<html>interactive</html>');

    const result = parseResult(
      await callDiagram({ filePath: workflowFile, format: 'html' }),
    );
    expect(result.success).toBe(true);
    expect(result.data).toBe('<html>interactive</html>');
    expect(mockFileToHTML).toHaveBeenCalled();
    expect(mockFileToSVG).not.toHaveBeenCalled();
  });

  it('writes HTML to output path when format="html" and outputPath is set', async () => {
    const workflowFile = path.join(tmpDir, 'wf.ts');
    const outputFile = path.join(tmpDir, 'out.html');
    fs.writeFileSync(workflowFile, '// stub');
    mockFileToHTML.mockReturnValue('<html>viewer</html>');

    const result = parseResult(
      await callDiagram({
        filePath: workflowFile,
        format: 'html',
        outputPath: outputFile,
      }),
    );
    expect(result.success).toBe(true);
    expect(fs.readFileSync(outputFile, 'utf-8')).toBe('<html>viewer</html>');
  });

  it('uses fileToSVG when format="svg" (explicit)', async () => {
    const workflowFile = path.join(tmpDir, 'wf.ts');
    fs.writeFileSync(workflowFile, '// stub');
    mockFileToSVG.mockReturnValue('<svg/>');

    await callDiagram({ filePath: workflowFile, format: 'svg' });
    expect(mockFileToSVG).toHaveBeenCalled();
    expect(mockFileToHTML).not.toHaveBeenCalled();
  });

  it('catches generator errors and returns DIAGRAM_ERROR', async () => {
    const workflowFile = path.join(tmpDir, 'wf.ts');
    fs.writeFileSync(workflowFile, '// stub');
    mockFileToSVG.mockImplementation(() => {
      throw new Error('layout engine crash');
    });

    const result = parseResult(await callDiagram({ filePath: workflowFile }));
    expect(result.success).toBe(false);
    expect((result.error as { code: string }).code).toBe('DIAGRAM_ERROR');
    expect((result.error as { message: string }).message).toContain('layout engine crash');
  });

  it('handles non-Error throws in generator', async () => {
    const workflowFile = path.join(tmpDir, 'wf.ts');
    fs.writeFileSync(workflowFile, '// stub');
    mockFileToSVG.mockImplementation(() => {
      throw 'string error thrown';
    });

    const result = parseResult(await callDiagram({ filePath: workflowFile }));
    expect(result.success).toBe(false);
    expect((result.error as { code: string }).code).toBe('DIAGRAM_ERROR');
    expect((result.error as { message: string }).message).toContain('string error thrown');
  });
});
