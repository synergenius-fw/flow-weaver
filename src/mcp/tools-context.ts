import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { buildContext, PRESET_NAMES, type ContextPreset, type ContextProfile } from '../context/index.js';
import { makeToolResult, makeErrorResult } from './response-utils.js';

export function registerContextTools(mcp: McpServer): void {
  mcp.tool(
    'fw_context',
    'Generate a self-contained LLM context bundle with Flow Weaver documentation, grammar, and conventions. Use preset="core" for basics, "authoring" for writing workflows, "full" for everything, "ops" for CLI/deployment reference.',
    {
      preset: z
        .enum(['core', 'authoring', 'full', 'ops'])
        .optional()
        .default('core')
        .describe('Topic preset'),
      profile: z
        .enum(['standalone', 'assistant'])
        .optional()
        .default('assistant')
        .describe('standalone = full self-contained dump, assistant = assumes MCP tools available'),
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
        .describe('Include EBNF annotation grammar section'),
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
