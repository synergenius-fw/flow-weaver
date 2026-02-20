import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { listTopics, readTopic, searchDocs } from '../docs/index.js';
import { makeToolResult, makeErrorResult } from './response-utils.js';

export function registerDocsTools(mcp: McpServer): void {
  mcp.tool(
    'fw_docs',
    'Browse Flow Weaver documentation and reference guides. Use action="list" to see topics, action="read" to read a topic, action="search" to search across all docs.',
    {
      action: z.enum(['list', 'read', 'search']).describe('What to do: list topics, read a topic, or search'),
      topic: z.string().optional().describe('Topic slug to read (for action="read")'),
      query: z.string().optional().describe('Search query (for action="search")'),
      compact: z.boolean().optional().describe('Return compact LLM-friendly version (default: false)'),
    },
    async (args: { action: 'list' | 'read' | 'search'; topic?: string; query?: string; compact?: boolean }) => {
      try {
        switch (args.action) {
          case 'list': {
            const topics = listTopics();
            return makeToolResult({
              topics: topics.map((t) => ({
                slug: t.slug,
                name: t.name,
                description: t.description,
                keywords: t.keywords,
              })),
            });
          }

          case 'read': {
            if (!args.topic) {
              return makeErrorResult('MISSING_PARAM', 'The "topic" parameter is required for action="read"');
            }
            const doc = readTopic(args.topic, args.compact ?? false);
            if (!doc) {
              const available = listTopics().map((t) => t.slug);
              return makeErrorResult(
                'TOPIC_NOT_FOUND',
                `Unknown topic "${args.topic}". Available topics: ${available.join(', ')}`
              );
            }
            return makeToolResult({
              name: doc.name,
              description: doc.description,
              content: doc.content,
            });
          }

          case 'search': {
            if (!args.query) {
              return makeErrorResult('MISSING_PARAM', 'The "query" parameter is required for action="search"');
            }
            const results = searchDocs(args.query);
            return makeToolResult({
              query: args.query,
              results: results.slice(0, 20).map((r) => ({
                topic: r.topic,
                slug: r.slug,
                heading: r.heading,
                excerpt: r.excerpt,
                relevance: r.relevance,
              })),
            });
          }
        }
      } catch (err) {
        return makeErrorResult(
          'DOCS_ERROR',
          `fw_docs failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  );
}
