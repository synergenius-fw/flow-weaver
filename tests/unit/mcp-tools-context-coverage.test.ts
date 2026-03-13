vi.mock('../../src/context/index', () => ({
  buildContext: vi.fn().mockReturnValue({
    profile: 'assistant',
    topicCount: 3,
    lineCount: 100,
    topicSlugs: ['overview', 'annotations', 'cli'],
    content: '# Context bundle',
  }),
  PRESET_NAMES: ['core', 'authoring', 'full', 'ops'],
}));

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerContextTools } from '../../src/mcp/tools-context';
import { buildContext } from '../../src/context/index';

type ToolHandler = (args: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}>;

let toolHandler: ToolHandler;

function createMockMcp(): McpServer {
  return {
    tool: vi.fn().mockImplementation(
      (_name: string, _desc: string, _schema: unknown, handler: ToolHandler) => {
        toolHandler = handler;
      }
    ),
  } as unknown as McpServer;
}

function parseResult(result: { content: Array<{ type: string; text: string }> }) {
  return JSON.parse(result.content[0].text);
}

describe('fw_context tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const mcp = createMockMcp();
    registerContextTools(mcp);
  });

  it('registers the fw_context tool', () => {
    const mcp = createMockMcp();
    registerContextTools(mcp);
    expect(mcp.tool).toHaveBeenCalledWith(
      'fw_context',
      expect.any(String),
      expect.any(Object),
      expect.any(Function)
    );
  });

  it('calls buildContext with default args and returns success', async () => {
    const result = await toolHandler({
      preset: 'core',
      profile: 'assistant',
      includeGrammar: true,
    });
    const parsed = parseResult(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data.topicCount).toBe(3);
    expect(parsed.data.content).toBe('# Context bundle');
    expect(buildContext).toHaveBeenCalledWith({
      preset: 'core',
      profile: 'assistant',
      topics: undefined,
      addTopics: undefined,
      includeGrammar: true,
    });
  });

  it('splits comma-separated topics string', async () => {
    await toolHandler({
      preset: 'full',
      profile: 'standalone',
      topics: 'overview, annotations',
      includeGrammar: false,
    });
    expect(buildContext).toHaveBeenCalledWith(
      expect.objectContaining({
        topics: ['overview', 'annotations'],
      })
    );
  });

  it('splits comma-separated addTopics string', async () => {
    await toolHandler({
      preset: 'core',
      profile: 'assistant',
      addTopics: 'cli,agents',
      includeGrammar: true,
    });
    expect(buildContext).toHaveBeenCalledWith(
      expect.objectContaining({
        addTopics: ['cli', 'agents'],
      })
    );
  });

  it('returns CONTEXT_ERROR when buildContext throws', async () => {
    vi.mocked(buildContext).mockImplementationOnce(() => {
      throw new Error('bad preset');
    });
    const result = await toolHandler({
      preset: 'core',
      profile: 'assistant',
      includeGrammar: true,
    });
    const parsed = parseResult(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error.code).toBe('CONTEXT_ERROR');
    expect(parsed.error.message).toContain('bad preset');
  });

  it('handles non-Error throws', async () => {
    vi.mocked(buildContext).mockImplementationOnce(() => {
      throw 'string error';
    });
    const result = await toolHandler({
      preset: 'core',
      profile: 'assistant',
      includeGrammar: true,
    });
    const parsed = parseResult(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error.message).toContain('string error');
  });
});
