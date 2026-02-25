import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock the docs module ──────────────────────────────────────────────────────
const mockListTopics = vi.fn();
const mockReadTopic = vi.fn();
const mockSearchDocs = vi.fn();

vi.mock('../../../src/docs/index.js', () => ({
  listTopics: (...args: unknown[]) => mockListTopics(...args),
  readTopic: (...args: unknown[]) => mockReadTopic(...args),
  searchDocs: (...args: unknown[]) => mockSearchDocs(...args),
}));

// ── Mock the MCP SDK ──────────────────────────────────────────────────────────
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
import { registerDocsTools } from '../../../src/mcp/tools-docs.js';

function parseResult(result: unknown): { success: boolean; data?: unknown; error?: unknown } {
  const r = result as { content: Array<{ text: string }>; isError?: boolean };
  return JSON.parse(r.content[0].text);
}

describe('tools-docs (fw_docs)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    toolHandlers.clear();
    const mcp = new McpServer({ name: 'test', version: '1.0.0' });
    registerDocsTools(mcp);
  });

  function callDocs(args: Record<string, unknown>) {
    const handler = toolHandlers.get('fw_docs')!;
    expect(handler).toBeDefined();
    return handler(args);
  }

  describe('action="list"', () => {
    it('returns all available topics', async () => {
      mockListTopics.mockReturnValue([
        { slug: 'getting-started', name: 'Getting Started', description: 'Intro', keywords: ['intro'] },
        { slug: 'annotations', name: 'Annotations', description: 'Reference', keywords: ['syntax'] },
      ]);

      const result = parseResult(await callDocs({ action: 'list' }));
      expect(result.success).toBe(true);
      expect((result.data as { topics: unknown[] }).topics).toHaveLength(2);
      expect((result.data as { topics: Array<{ slug: string }> }).topics[0].slug).toBe('getting-started');
    });

    it('returns empty list when no topics exist', async () => {
      mockListTopics.mockReturnValue([]);

      const result = parseResult(await callDocs({ action: 'list' }));
      expect(result.success).toBe(true);
      expect((result.data as { topics: unknown[] }).topics).toHaveLength(0);
    });
  });

  describe('action="read"', () => {
    it('returns topic content when found', async () => {
      mockReadTopic.mockReturnValue({
        slug: 'annotations',
        name: 'Annotations',
        description: 'Annotation reference',
        content: '# Annotations\n\nUse @flowWeaver to...',
      });

      const result = parseResult(await callDocs({ action: 'read', topic: 'annotations' }));
      expect(result.success).toBe(true);
      const data = result.data as { name: string; content: string };
      expect(data.name).toBe('Annotations');
      expect(data.content).toContain('@flowWeaver');
    });

    it('passes compact flag to readTopic', async () => {
      mockReadTopic.mockReturnValue({
        slug: 'x',
        name: 'X',
        description: 'd',
        content: 'compact version',
      });

      await callDocs({ action: 'read', topic: 'x', compact: true });
      expect(mockReadTopic).toHaveBeenCalledWith('x', true);
    });

    it('defaults compact to false', async () => {
      mockReadTopic.mockReturnValue({
        slug: 'x',
        name: 'X',
        description: 'd',
        content: 'full version',
      });

      await callDocs({ action: 'read', topic: 'x' });
      expect(mockReadTopic).toHaveBeenCalledWith('x', false);
    });

    it('returns error when topic param is missing', async () => {
      const result = parseResult(await callDocs({ action: 'read' }));
      expect(result.success).toBe(false);
      expect((result.error as { code: string }).code).toBe('MISSING_PARAM');
    });

    it('returns error when topic is not found', async () => {
      mockReadTopic.mockReturnValue(null);
      mockListTopics.mockReturnValue([
        { slug: 'annotations', name: 'Annotations', description: '', keywords: [] },
      ]);

      const result = parseResult(await callDocs({ action: 'read', topic: 'nonexistent' }));
      expect(result.success).toBe(false);
      expect((result.error as { code: string }).code).toBe('TOPIC_NOT_FOUND');
      expect((result.error as { message: string }).message).toContain('annotations');
    });
  });

  describe('action="search"', () => {
    it('returns search results', async () => {
      mockSearchDocs.mockReturnValue([
        {
          topic: 'Annotations',
          slug: 'annotations',
          heading: 'Node Annotation',
          excerpt: 'Use @node to define...',
          relevance: 10,
        },
      ]);

      const result = parseResult(await callDocs({ action: 'search', query: 'node annotation' }));
      expect(result.success).toBe(true);
      const data = result.data as { query: string; results: unknown[] };
      expect(data.query).toBe('node annotation');
      expect(data.results).toHaveLength(1);
    });

    it('truncates results to 20', async () => {
      const manyResults = Array.from({ length: 30 }, (_, i) => ({
        topic: `Topic ${i}`,
        slug: `topic-${i}`,
        heading: `Heading ${i}`,
        excerpt: `Content ${i}`,
        relevance: 30 - i,
      }));
      mockSearchDocs.mockReturnValue(manyResults);

      const result = parseResult(await callDocs({ action: 'search', query: 'test' }));
      expect(result.success).toBe(true);
      expect((result.data as { results: unknown[] }).results).toHaveLength(20);
    });

    it('returns error when query param is missing', async () => {
      const result = parseResult(await callDocs({ action: 'search' }));
      expect(result.success).toBe(false);
      expect((result.error as { code: string }).code).toBe('MISSING_PARAM');
    });
  });

  it('catches unexpected errors and returns DOCS_ERROR', async () => {
    mockListTopics.mockImplementation(() => {
      throw new Error('disk read failure');
    });

    const result = parseResult(await callDocs({ action: 'list' }));
    expect(result.success).toBe(false);
    expect((result.error as { code: string }).code).toBe('DOCS_ERROR');
    expect((result.error as { message: string }).message).toContain('disk read failure');
  });

  it('handles non-Error throws and returns DOCS_ERROR', async () => {
    mockSearchDocs.mockImplementation(() => {
      throw 'unexpected string error';
    });

    const result = parseResult(await callDocs({ action: 'search', query: 'test' }));
    expect(result.success).toBe(false);
    expect((result.error as { code: string }).code).toBe('DOCS_ERROR');
    expect((result.error as { message: string }).message).toContain('unexpected string error');
  });

  it('returns empty search results for no matches', async () => {
    mockSearchDocs.mockReturnValue([]);

    const result = parseResult(await callDocs({ action: 'search', query: 'zzzznotfound' }));
    expect(result.success).toBe(true);
    const data = result.data as { query: string; results: unknown[] };
    expect(data.results).toHaveLength(0);
  });
});
