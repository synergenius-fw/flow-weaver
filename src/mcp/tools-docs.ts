import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { listTopics, readTopic, searchDocs } from '../docs/index.js';
import { makeToolResult, makeErrorResult } from './response-utils.js';

const SEARCH_LIMIT_DEFAULT = 8;
const SEARCH_LIMIT_MAX = 20;
const EXCERPT_MAX_CHARS = 300;

function trimExcerpt(excerpt: string): string {
  return excerpt.length > EXCERPT_MAX_CHARS ? `${excerpt.slice(0, EXCERPT_MAX_CHARS)}…` : excerpt;
}

export function registerDocsTools(mcp: McpServer): void {
  mcp.tool(
    'fw_docs',
    'Browse Flow Weaver documentation and reference guides. Use action="list" to see topics, action="read" to read a topic, action="search" to search across all docs.',
    {
      action: z.enum(['list', 'read', 'search']).describe('What to do: list topics, read a topic, or search'),
      topic: z.string().optional().describe('Topic slug to read (for action="read")'),
      query: z.string().optional().describe('Search query (for action="search")'),
      compact: z.boolean().optional().describe('Return compact LLM-friendly version (default: false)'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(SEARCH_LIMIT_MAX)
        .optional()
        .describe(`Number of search hits to return (default: ${SEARCH_LIMIT_DEFAULT}, max: ${SEARCH_LIMIT_MAX})`),
    },
    async (args: {
      action: 'list' | 'read' | 'search';
      topic?: string;
      query?: string;
      compact?: boolean;
      limit?: number;
    }) => {
      try {
        switch (args.action) {
          case 'list': {
            // Keywords exist to drive `search`; listing them for every topic
            // multiplied this result by roughly five without helping a caller
            // choose, so the list carries only what identifies a topic — plus
            // the compact size, which is what lets a caller budget a read.
            const topics = listTopics();
            return makeToolResult({
              topics: topics.map((t) => ({
                slug: t.slug,
                name: t.name,
                description: t.description,
                compactBytes: readTopic(t.slug, true)?.content.length ?? 0,
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
            // Every hit is paid for in the assistant's context, and the top
            // few carry the answer: return a short list by default, say how
            // many matched, and keep each excerpt to a glance.
            const limit = Math.min(Math.max(args.limit ?? SEARCH_LIMIT_DEFAULT, 1), SEARCH_LIMIT_MAX);
            return makeToolResult({
              query: args.query,
              total: results.length,
              results: results.slice(0, limit).map((r) => ({
                topic: r.topic,
                slug: r.slug,
                heading: r.heading,
                excerpt: trimExcerpt(r.excerpt),
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
