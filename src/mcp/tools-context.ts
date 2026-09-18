import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { buildContext, PRESET_NAMES, type ContextPreset, type ContextProfile } from '../context/index.js';
import { makeToolResult, makeErrorResult } from './response-utils.js';

/**
 * fw_context is the first call an assistant makes in a session, so it is
 * shaped for progressive loading: the default `core` preset is one short
 * orientation topic plus the annotation grammar, and every result ends with
 * the list of topics it did not include and their sizes. The larger presets
 * remain for callers that want a self-contained dump and know the cost.
 */
export function registerContextTools(mcp: McpServer): void {
  mcp.tool(
    'fw_context',
    'Orientation for working with Flow Weaver. preset="core" (default, ~10 KB) is the map: the model, the tool loop, and which topic to read for which task, followed by every other topic with its size. Read further topics with fw_docs as the task needs them. "authoring" (~75 KB), "ops" (~130 KB) and "full" (~220 KB) bundle whole references; use them only when you must have everything at once.',
    {
      preset: z
        .enum(['core', 'authoring', 'full', 'ops'])
        .optional()
        .default('core')
        .describe('core: the short map (default). authoring: writing workflows. ops: CLI and deployment. full: everything.'),
      profile: z
        .enum(['standalone', 'assistant'])
        .optional()
        .default('assistant')
        .describe('standalone = self-contained text, assistant = assumes MCP tools are available'),
      topics: z
        .string()
        .optional()
        .describe('Comma-separated topic slugs (overrides preset)'),
      addTopics: z
        .string()
        .optional()
        .describe('Comma-separated slugs to add to preset'),
      includeGrammar: z
        .boolean()
        .optional()
        .default(true)
        .describe('Include the EBNF annotation grammar (~3 KB)'),
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

        return makeToolResult({
          profile: result.profile,
          topicCount: result.topicCount,
          lineCount: result.lineCount,
          topicSlugs: result.topicSlugs,
          availableTopics: result.availableTopics ?? [],
          presets: PRESET_NAMES,
          content: result.content,
        });
      } catch (err) {
        return makeErrorResult(
          'CONTEXT_ERROR',
          `fw_context failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  );
}
