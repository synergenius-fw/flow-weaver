/**
 * MCP Resource Tool - fw_list_resources
 *
 * Returns available icons, colors, and annotation tags so AI agents
 * can use valid values when building workflows.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { VALID_NODE_ICONS } from '../diagram/theme.js';
import { VALID_NODE_COLORS, KNOWN_NODETYPE_TAGS, KNOWN_WORKFLOW_TAGS } from '../constants.js';
import { makeToolResult } from './response-utils.js';

export function registerResourceTools(mcp: McpServer): void {
  mcp.tool(
    'fw_list_resources',
    'List the colors, the annotation tags, and the icons the SVG artifacts draw with a path. Any Material Symbols name (fonts.google.com/icons, snake_case or camelCase) is a valid @icon. The ones listed here also appear in the SVG and PDF artifacts, the rest are drawn as a dot there.',
    {
      type: z
        .enum(['icons', 'colors', 'tags', 'all'])
        .default('all')
        .describe('Resource type to list (default: all)'),
    },
    async (args: { type: 'icons' | 'colors' | 'tags' | 'all' }) => {
      const type = args.type ?? 'all';

      switch (type) {
        case 'icons':
          return makeToolResult([...VALID_NODE_ICONS]);
        case 'colors':
          return makeToolResult([...VALID_NODE_COLORS]);
        case 'tags':
          return makeToolResult({
            nodeType: [...KNOWN_NODETYPE_TAGS],
            workflow: [...KNOWN_WORKFLOW_TAGS],
          });
        case 'all':
          return makeToolResult({
            icons: [...VALID_NODE_ICONS],
            colors: [...VALID_NODE_COLORS],
            tags: {
              nodeType: [...KNOWN_NODETYPE_TAGS],
              workflow: [...KNOWN_WORKFLOW_TAGS],
            },
          });
      }
    },
  );
}
