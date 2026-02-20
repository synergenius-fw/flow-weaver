/**
 * MCP Diagram Tool - fw_diagram
 *
 * Generates SVG or interactive HTML diagrams from workflow files.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import { fileToSVG, fileToHTML } from '../diagram/index.js';
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
      format: z
        .enum(['svg', 'html'])
        .optional()
        .describe('Output format: svg (default) or html (interactive viewer)'),
    },
    async (args: {
      filePath: string;
      outputPath?: string;
      workflowName?: string;
      theme?: 'dark' | 'light';
      showPortLabels?: boolean;
      format?: 'svg' | 'html';
    }) => {
      try {
        const resolvedPath = path.resolve(args.filePath);
        if (!fs.existsSync(resolvedPath)) {
          return makeErrorResult('FILE_NOT_FOUND', `File not found: ${resolvedPath}`);
        }

        const diagramOptions = {
          workflowName: args.workflowName,
          theme: args.theme,
          showPortLabels: args.showPortLabels,
        };

        const isHtml = args.format === 'html';
        const result = isHtml
          ? fileToHTML(resolvedPath, diagramOptions)
          : fileToSVG(resolvedPath, diagramOptions);

        if (args.outputPath) {
          const outputResolved = path.resolve(args.outputPath);
          fs.writeFileSync(outputResolved, result, 'utf-8');
          return makeToolResult({ written: outputResolved, size: result.length });
        }

        return makeToolResult(result);
      } catch (error) {
        return makeErrorResult(
          'DIAGRAM_ERROR',
          `Diagram generation failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );
}
