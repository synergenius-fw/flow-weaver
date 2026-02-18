/**
 * MCP Diagram Tool - fw_diagram
 *
 * Generates SVG diagrams from workflow files.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import { fileToSVG } from '../diagram/index.js';
import { makeToolResult, makeErrorResult } from './response-utils.js';

export function registerDiagramTools(mcp: McpServer): void {
  mcp.tool(
    'fw_diagram',
    'Generate an SVG diagram of a workflow. Returns SVG string or writes to a file.',
    {
      filePath: z.string().describe('Path to the workflow .ts file'),
      outputPath: z
        .string()
        .optional()
        .describe('Output file path for the SVG. If omitted, returns SVG as text.'),
      workflowName: z
        .string()
        .optional()
        .describe('Specific workflow name if file has multiple'),
      theme: z
        .enum(['dark', 'light'])
        .optional()
        .describe('Color theme (default: dark)'),
      showPortLabels: z
        .boolean()
        .optional()
        .describe('Show port labels on diagram (default: true)'),
    },
    async (args: {
      filePath: string;
      outputPath?: string;
      workflowName?: string;
      theme?: 'dark' | 'light';
      showPortLabels?: boolean;
    }) => {
      try {
        const resolvedPath = path.resolve(args.filePath);
        if (!fs.existsSync(resolvedPath)) {
          return makeErrorResult('FILE_NOT_FOUND', `File not found: ${resolvedPath}`);
        }

        const svg = fileToSVG(resolvedPath, {
          workflowName: args.workflowName,
          theme: args.theme,
          showPortLabels: args.showPortLabels,
        });

        if (args.outputPath) {
          const outputResolved = path.resolve(args.outputPath);
          fs.writeFileSync(outputResolved, svg, 'utf-8');
          return makeToolResult({ written: outputResolved, size: svg.length });
        }

        return makeToolResult(svg);
      } catch (error) {
        return makeErrorResult(
          'DIAGRAM_ERROR',
          `Diagram generation failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );
}
