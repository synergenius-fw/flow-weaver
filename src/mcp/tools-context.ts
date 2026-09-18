import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { buildContext, type ContextPreset, type ContextProfile } from '../context/index.js';
import { makeErrorResult } from './response-utils.js';

/**
 * fw_context is the first call an assistant makes in a session, so it is
 * shaped for progressive loading: the default `core` preset is one short
 * orientation topic, and every result ends with the list of topics it did
 * not include and their sizes. The larger presets remain for callers that
 * want a self-contained dump and know the cost.
 *
 * The result is the bundle itself as markdown text, not a JSON envelope. The
 * bundle is a document to read, and the envelope used to repeat the closing
 * topic list as a JSON array and add counters nobody acted on.
 */
export function registerContextTools(mcp: McpServer): void {
  mcp.tool(
    'fw_context',
    'Flow Weaver orientation: the model, the tool loop, which topic answers which task, and every other topic with its size. Call once at session start, then read topics with fw_docs. preset "core" (default, ~6 KB) is that map; "authoring" (~75 KB), "ops" (~100 KB) and "full" (~195 KB) bundle whole references.',
    {
      preset: z
        .enum(['core', 'authoring', 'full', 'ops'])
        .optional()
        .default('core')
        .describe('core (default), authoring, ops, or full'),
      profile: z
        .enum(['standalone', 'assistant'])
        .optional()
        .default('assistant')
        .describe('assistant (default) assumes the MCP tools; standalone is self-contained text'),
      topics: z.string().optional().describe('Comma-separated slugs, replacing the preset'),
      addTopics: z.string().optional().describe('Comma-separated slugs added to the preset'),
      includeGrammar: z
        .boolean()
        .optional()
        .default(false)
        .describe('Append the generated EBNF for port, node, connect and scope lines (~3 KB); the jsdoc-grammar topic covers the same syntax'),
    },
    async (args) => {
      try {
        const result = buildContext({
          preset: args.preset as ContextPreset,
          profile: args.profile as ContextProfile,
          topics: args.topics ? args.topics.split(',').map((s) => s.trim()) : undefined,
          addTopics: args.addTopics ? args.addTopics.split(',').map((s) => s.trim()) : undefined,
          includeGrammar: args.includeGrammar,
        });

        return { content: [{ type: 'text' as const, text: result.content }] };
      } catch (err) {
        return makeErrorResult(
          'CONTEXT_ERROR',
          `fw_context failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  );
}
