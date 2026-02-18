/**
 * MCP Export Tool - fw_export
 *
 * Allows Claude Code to export workflows as serverless deployments
 * without the GUI. Generates handler code, platform config, and deploy instructions.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import * as path from 'path';
import * as fs from 'fs';
import { parseWorkflow } from '../api/index.js';
import { createTargetRegistry } from '../deployment/index.js';
import { makeToolResult, makeErrorResult } from './response-utils.js';

export function registerExportTools(mcp: McpServer): void {
  mcp.tool(
    'fw_export',
    'Export workflows as serverless deployments. Generates handler code, platform config, and deploy instructions.',
    {
      filePath: z.string().describe('Path to the workflow .ts file'),
      target: z
        .enum(['lambda', 'vercel', 'cloudflare', 'inngest'])
        .describe('Deployment target platform'),
      outputDir: z.string().describe('Output directory for generated files'),
      serviceName: z
        .string()
        .optional()
        .describe('Service name (default: derived from filename)'),
      workflows: z
        .array(z.string())
        .optional()
        .describe('Specific workflow function names to include (default: all)'),
      nodeTypes: z
        .array(z.string())
        .optional()
        .describe('Specific node type names to include'),
      includeDocs: z
        .boolean()
        .optional()
        .describe('Include OpenAPI/Swagger routes (default: true)'),
      preview: z
        .boolean()
        .optional()
        .describe('Preview without writing files to disk (default: false)'),
      durableSteps: z
        .boolean()
        .optional()
        .describe('Use deep generator with per-node Inngest steps for durability (inngest target only)'),
    },
    async (args: {
      filePath: string;
      target: 'lambda' | 'vercel' | 'cloudflare' | 'inngest';
      outputDir: string;
      serviceName?: string;
      workflows?: string[];
      nodeTypes?: string[];
      includeDocs?: boolean;
      preview?: boolean;
      durableSteps?: boolean;
    }) => {
      try {
        const filePath = path.resolve(args.filePath);
        const outputDir = path.resolve(args.outputDir);
        const preview = args.preview ?? false;
        const includeDocs = args.includeDocs ?? true;

        // 1. Validate file exists
        try {
          await fs.promises.access(filePath);
        } catch {
          return makeErrorResult('FILE_NOT_FOUND', `File not found: ${filePath}`);
        }

        // 2. Parse the file to discover workflows and node types
        let parseResult;
        try {
          parseResult = await parseWorkflow(filePath, { nodeTypesOnly: false });
        } catch (err) {
          return makeErrorResult(
            'PARSE_ERROR',
            `Failed to parse ${filePath}: ${err instanceof Error ? err.message : String(err)}`
          );
        }

        if (parseResult.errors.length > 0) {
          // Try node-types-only parse
          try {
            const ntResult = await parseWorkflow(filePath, { nodeTypesOnly: true });
            if (ntResult.errors.length === 0) {
              parseResult = ntResult;
            }
          } catch {
            // Use original errors
          }

          if (parseResult.errors.length > 0) {
            return makeErrorResult(
              'PARSE_ERROR',
              `Parse errors in ${filePath}: ${parseResult.errors.join('; ')}`
            );
          }
        }

        // 3. Get the export target
        const registry = createTargetRegistry();
        const exportTarget = registry.get(args.target);

        if (!exportTarget) {
          return makeErrorResult(
            'INVALID_TARGET',
            `Unknown target: ${args.target}. Supported: lambda, vercel, cloudflare, inngest`
          );
        }

        if (!exportTarget.generateBundle) {
          return makeErrorResult(
            'INVALID_TARGET',
            `Target ${args.target} does not support bundle export`
          );
        }

        // 4. Build workflow and node type lists
        // parseResult.allWorkflows has all TWorkflowAST[] from the file;
        // each workflow's nodeTypes are in workflow.nodeTypes (TNodeTypeAST[])
        const allWorkflows = parseResult.allWorkflows || [];
        const allNodeTypes = allWorkflows.flatMap((w) => w.nodeTypes || []);
        // Deduplicate node types by name (same type may appear in multiple workflows)
        const uniqueNodeTypes = [
          ...new Map(allNodeTypes.map((nt) => [nt.name, nt])).values(),
        ];

        const serviceName =
          args.serviceName || path.basename(filePath, '.ts').replace(/[^a-zA-Z0-9-]/g, '-');

        // Filter to requested items
        const bundleWorkflows = allWorkflows
          .filter((w) => (args.workflows ? args.workflows.includes(w.name) : true))
          .map((w) => ({
            name: w.name,
            functionName: w.functionName,
            description: w.description,
            expose: true,
          }));

        const bundleNodeTypes = uniqueNodeTypes
          .filter((nt) => (args.nodeTypes ? args.nodeTypes.includes(nt.name) : false))
          .map((nt) => ({
            name: nt.name,
            functionName: nt.functionName,
            description: undefined as string | undefined,
            inputs: Object.fromEntries(
              Object.entries(nt.inputs).map(([k, v]) => [
                k,
                { dataType: v.dataType, tsType: v.tsType, label: v.label, optional: v.optional },
              ])
            ),
            outputs: Object.fromEntries(
              Object.entries(nt.outputs).map(([k, v]) => [
                k,
                { dataType: v.dataType, tsType: v.tsType, label: v.label },
              ])
            ),
            expose: true,
          }));

        if (bundleWorkflows.length === 0 && bundleNodeTypes.length === 0) {
          return makeErrorResult(
            'EXPORT_ERROR',
            'No workflows or node types selected for export. ' +
              `Found ${allWorkflows.length} workflows and ${allNodeTypes.length} node types in file.`
          );
        }

        // 5. Generate the bundle
        const artifacts = await exportTarget.generateBundle(
          bundleWorkflows,
          bundleNodeTypes,
          {
            sourceFile: filePath,
            workflowName: serviceName,
            displayName: serviceName,
            outputDir,
            production: true,
            includeDocs,
            targetOptions: args.durableSteps ? { durableSteps: true } : undefined,
          }
        );

        // 6. Write files if not preview
        if (!preview) {
          await fs.promises.mkdir(outputDir, { recursive: true });
          for (const file of artifacts.files) {
            const fullPath = path.join(outputDir, file.relativePath);
            await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
            await fs.promises.writeFile(fullPath, file.content, 'utf-8');
          }
        }

        // 7. Get deploy instructions
        const instructions = exportTarget.getDeployInstructions(artifacts);

        // 8. Return result
        return makeToolResult({
          preview,
          target: args.target,
          serviceName,
          outputDir,
          files: artifacts.files.map((f) => ({
            path: f.relativePath,
            type: f.type,
            size: f.content.length,
          })),
          endpoints: bundleWorkflows.map(
            (w: { name: string; functionName: string }) => ({
              method: 'POST',
              path: `/workflows/${w.functionName}`,
              name: w.name,
            })
          ),
          instructions: {
            title: instructions.title,
            steps: instructions.steps,
            prerequisites: instructions.prerequisites,
          },
          summary: preview
            ? `Preview: ${artifacts.files.length} files would be generated in ${outputDir}`
            : `Exported ${artifacts.files.length} files to ${outputDir}`,
        });
      } catch (err) {
        return makeErrorResult(
          'EXPORT_ERROR',
          `Export failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  );
}
