import { describe, it, expect, vi, beforeEach } from 'vitest';

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
import { registerResourceTools } from '../../../src/mcp/tools-resources.js';

function parseResult(result: unknown): { success: boolean; data?: unknown; error?: unknown } {
  const r = result as { content: Array<{ text: string }>; isError?: boolean };
  return JSON.parse(r.content[0].text);
}

describe('fw_list_resources', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    toolHandlers.clear();
    const mcp = new McpServer({ name: 'test', version: '1.0.0' });
    registerResourceTools(mcp);
  });

  function callListResources(args: Record<string, unknown>) {
    const handler = toolHandlers.get('fw_list_resources')!;
    expect(handler).toBeDefined();
    return handler(args);
  }

  it('should return icons when type=icons', async () => {
    const result = parseResult(await callListResources({ type: 'icons' }));
    expect(result.success).toBe(true);
    const data = result.data as string[];
    expect(Array.isArray(data)).toBe(true);
    expect(data).toContain('code');
    expect(data).toContain('api');
    expect(data).toContain('person');
    expect(data).toContain('webhook');
    expect(data.length).toBeGreaterThan(90);
  });

  it('should return colors when type=colors', async () => {
    const result = parseResult(await callListResources({ type: 'colors' }));
    expect(result.success).toBe(true);
    const data = result.data as string[];
    expect(data).toEqual(
      expect.arrayContaining(['blue', 'purple', 'cyan', 'orange', 'pink', 'green', 'red', 'yellow', 'teal']),
    );
  });

  it('should return tags when type=tags', async () => {
    const result = parseResult(await callListResources({ type: 'tags' }));
    expect(result.success).toBe(true);
    const data = result.data as { nodeType: string[]; workflow: string[] };
    expect(data.nodeType).toContain('flowWeaver');
    expect(data.nodeType).toContain('expression');
    expect(data.nodeType).toContain('deploy');
    expect(data.workflow).toContain('node');
    expect(data.workflow).toContain('path');
    expect(data.workflow).toContain('connect');
  });

  it('should return everything when type=all', async () => {
    const result = parseResult(await callListResources({ type: 'all' }));
    expect(result.success).toBe(true);
    const data = result.data as { icons: string[]; colors: string[]; tags: unknown };
    expect(data.icons.length).toBeGreaterThan(90);
    expect(data.colors.length).toBe(9);
    expect(data.tags).toBeDefined();
  });

  it('should default to type=all when no type provided', async () => {
    const result = parseResult(await callListResources({}));
    expect(result.success).toBe(true);
    const data = result.data as { icons: string[]; colors: string[]; tags: unknown };
    expect(data.icons).toBeDefined();
    expect(data.colors).toBeDefined();
    expect(data.tags).toBeDefined();
  });
});
