/**
 * MCP Diagram Tool - fw_diagram
 *
 * The workflow as an SVG of its spine, or as text for a chat.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import { fileToSVG, fileToASCII, sourceToSVG, sourceToASCII } from '../diagram/index.js';
import { makeToolResult, makeErrorResult } from './response-utils.js';

const ASCII_FORMATS = new Set(['ascii', 'ascii-compact', 'text']);

export function registerDiagramTools(mcp: McpServer): void {
  mcp.tool(
    'fw_diagram',
    'Generate a diagram of a workflow. Formats: svg draws the spine (steps in run order, control flow as lanes: failure arms, loop bodies, pulled steps) as a vector image; ascii/ascii-compact/text produce plain text readable in terminal. ' +
      'Provide either filePath (workflow .ts file) or source (inline code).',
    {
      filePath: z
        .string()
        .optional()
        .describe('Path to the workflow .ts file (required if source is not provided)'),
      source: z
        .string()
        .optional()
        .describe('Inline workflow source code (required if filePath is not provided)'),
      outputPath: z
        .string()
        .optional()
        .describe('Output file path. If omitted, returns content as text.'),
      workflowName: z
        .string()
        .optional()
        .describe('Specific workflow name if file has multiple'),
      theme: z
        .enum(['dark', 'light'])
        .optional()
        .describe('Color theme (default: dark)'),
      format: z
        .enum(['svg', 'ascii', 'ascii-compact', 'text'])
        .optional()
        .describe('Output format: svg (default; the spine as a vector image), ascii (port-level detail), ascii-compact (compact boxes), text (structured list)'),
    },
    async (args: {
      filePath?: string;
      source?: string;
      outputPath?: string;
      workflowName?: string;
      theme?: 'dark' | 'light';
      format?: 'svg' | 'ascii' | 'ascii-compact' | 'text';
    }) => {
      try {
        if (!args.filePath && !args.source) {
          return makeErrorResult('MISSING_PARAM', 'Provide either filePath or source parameter');
        }

        const format = args.format ?? 'svg';
        const diagramOptions = {
          workflowName: args.workflowName,
          theme: args.theme,
          format,
        };

        let result: string;

        if (args.source) {
          // Inline source code
          if (ASCII_FORMATS.has(format)) {
            result = sourceToASCII(args.source, diagramOptions);
          } else {
            result = sourceToSVG(args.source, diagramOptions);
          }
        } else {
          // File path
          const resolvedPath = path.resolve(args.filePath!);
          if (!fs.existsSync(resolvedPath)) {
            return makeErrorResult('FILE_NOT_FOUND', `File not found: ${resolvedPath}`);
          }

          if (ASCII_FORMATS.has(format)) {
            result = fileToASCII(resolvedPath, diagramOptions);
          } else {
            result = fileToSVG(resolvedPath, diagramOptions);
          }
        }

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
