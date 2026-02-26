import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import * as path from 'path';
import { parseWorkflow, validateWorkflow, compileWorkflow } from '../api/index.js';
import {
  getNodes,
  getConnections,
  getDependencies,
  getDependents,
  getDataDependencies,
  getTopologicalOrder,
  findIsolatedNodes,
  findDeadEndDetails,
  findDisconnectedOutputPorts,
} from '../api/query.js';
import { describeWorkflow, formatDescribeOutput } from '../cli/commands/describe.js';
import { runDoctorChecks } from '../cli/commands/doctor.js';
import { WorkflowDiffer } from '../diff/WorkflowDiffer.js';
import { formatDiff } from '../diff/formatDiff.js';
import { makeToolResult, makeErrorResult, addHintsToItems } from './response-utils.js';
import { getFriendlyError } from '../friendly-errors.js';
import { generateInngestFunction } from '../generator/inngest.js';
import { AnnotationParser } from '../parser.js';

/** Detect MULTIPLE_WORKFLOWS_FOUND marker in parse errors and return the right error code */
function parseErrorCode(errors: string[]): string {
  if (errors.some((e) => e.includes('[MULTIPLE_WORKFLOWS_FOUND]'))) {
    return 'MULTIPLE_WORKFLOWS_FOUND';
  }
  return 'PARSE_ERROR';
}

export function registerQueryTools(mcp: McpServer): void {
  mcp.tool(
    'fw_describe',
    'Describe a workflow in LLM-friendly format (nodes, connections, graph, validation).',
    {
      filePath: z.string().describe('Path to the workflow .ts file'),
      format: z
        .enum(['json', 'text', 'mermaid', 'paths', 'ascii', 'ascii-compact'])
        .optional()
        .describe('Output format (default: json). ascii/ascii-compact produce terminal-readable diagrams.'),
      node: z.string().optional().describe('Focus on a specific node ID'),
      workflowName: z.string().optional().describe('Specific workflow if file has multiple'),
    },
    async (args: {
      filePath: string;
      format?: 'json' | 'text' | 'mermaid' | 'paths' | 'ascii' | 'ascii-compact';
      node?: string;
      workflowName?: string;
    }) => {
      try {
        const filePath = path.resolve(args.filePath);
        const parseResult = await parseWorkflow(filePath, { workflowName: args.workflowName });

        // If no workflows found, try node-type-only mode
        if (
          parseResult.errors.length > 0 &&
          parseResult.errors.some((e) => typeof e === 'string' && e.includes('No workflows found'))
        ) {
          try {
            const ntResult = await parseWorkflow(filePath, { nodeTypesOnly: true });
            if (ntResult.errors.length === 0 && ntResult.ast.nodeTypes?.length > 0) {
              return makeToolResult({
                nodeTypesOnly: true,
                nodeTypes: ntResult.ast.nodeTypes.map(
                  (nt: {
                    name: string;
                    inputs: Record<string, unknown>;
                    outputs: Record<string, unknown>;
                    isExpression?: boolean;
                  }) => ({
                    name: nt.name,
                    inputs: Object.keys(nt.inputs),
                    outputs: Object.keys(nt.outputs),
                    isExpression: nt.isExpression ?? false,
                  })
                ),
              });
            }
          } catch {
            /* fall through to original error */
          }
        }

        if (parseResult.errors.length > 0) {
          return makeErrorResult(
            parseErrorCode(parseResult.errors),
            `Parse errors:\n${parseResult.errors.join('\n')}`
          );
        }
        const output = describeWorkflow(parseResult.ast, { node: args.node });
        const format = args.format ?? 'json';
        const formatted = formatDescribeOutput(parseResult.ast, output, format);
        return makeToolResult(format === 'json' ? JSON.parse(formatted) : formatted);
      } catch (err) {
        return makeErrorResult(
          'DESCRIBE_ERROR',
          `fw_describe failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  );

  mcp.tool(
    'fw_validate',
    'Validate a workflow file and return errors/warnings.',
    {
      filePath: z.string().describe('Path to the workflow file'),
      workflowName: z.string().optional().describe('Specific workflow name'),
    },
    async (args: { filePath: string; workflowName?: string }) => {
      try {
        const filePath = path.resolve(args.filePath);
        const parseResult = await parseWorkflow(filePath, { workflowName: args.workflowName });

        // If no workflows found, try node-type-only mode
        if (
          parseResult.errors.length > 0 &&
          parseResult.errors.some((e) => typeof e === 'string' && e.includes('No workflows found'))
        ) {
          try {
            const ntResult = await parseWorkflow(filePath, { nodeTypesOnly: true });
            if (ntResult.errors.length === 0 && ntResult.ast.nodeTypes?.length > 0) {
              const count = ntResult.ast.nodeTypes.length;
              return makeToolResult({
                valid: true,
                nodeTypesOnly: true,
                nodeTypeCount: count,
                warnings: [
                  {
                    message: `No workflow function found (found ${count} node type${count === 1 ? '' : 's'}). Add a /** @flowWeaver workflow */ annotation above an exported function to define a workflow.`,
                    severity: 'warning',
                    code: 'NO_WORKFLOW_FOUND',
                  },
                ],
              });
            }
          } catch {
            /* fall through to original error */
          }
        }

        if (parseResult.errors.length > 0) {
          return makeToolResult({
            valid: false,
            errors: parseResult.errors,
            warnings: parseResult.warnings,
          });
        }
        const result = validateWorkflow(parseResult.ast);
        const errors = result.errors.map((e) => ({
          message: e.message,
          severity: e.type,
          nodeId: e.node,
          code: e.code,
        }));
        const warnings = [
          ...parseResult.warnings,
          ...result.warnings.map((w) => ({
            message: w.message,
            severity: w.type,
            nodeId: w.node,
            code: w.code,
          })),
        ];
        return makeToolResult({
          valid: result.valid,
          errors: addHintsToItems(errors, getFriendlyError),
          warnings: addHintsToItems(
            warnings as Array<{ message: string; severity: string; nodeId?: string; code?: string }>,
            getFriendlyError
          ),
        });
      } catch (err) {
        return makeErrorResult(
          'VALIDATE_ERROR',
          `fw_validate failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  );

  mcp.tool(
    'fw_compile',
    'Compile a workflow to executable code. Only regenerates code inside @flow-weaver-runtime ' +
      'and @flow-weaver-body marker sections — user code outside markers is preserved. ' +
      'Set production: true to strip debug instrumentation. Use target=inngest for per-node step.run() durability.',
    {
      filePath: z.string().describe('Path to the workflow file'),
      write: z.boolean().optional().describe('Whether to write the output file (default: true)'),
      production: z
        .boolean()
        .optional()
        .describe('Production mode — no debug events (default: false)'),
      workflowName: z.string().optional().describe('Specific workflow name'),
      target: z
        .enum(['typescript', 'inngest'])
        .optional()
        .describe('Compilation target: typescript (default) or inngest (per-node step.run)'),
      cron: z.string().optional().describe('Cron schedule expression (e.g. "0 9 * * *"). Overrides @trigger annotation.'),
      serve: z.boolean().optional().describe('Generate serve() handler for HTTP framework integration'),
      framework: z.enum(['next', 'express', 'hono', 'fastify', 'remix']).optional().describe('Framework adapter for serve handler (requires serve=true)'),
      typedEvents: z.boolean().optional().describe('Generate Zod event schemas from workflow @param annotations'),
      retries: z.number().int().min(0).optional().describe('Number of retries per function. Overrides @retries annotation.'),
      timeout: z.string().optional().describe('Function timeout (e.g. "30m", "1h"). Overrides @timeout annotation.'),
    },
    async (args: {
      filePath: string;
      write?: boolean;
      production?: boolean;
      workflowName?: string;
      target?: 'typescript' | 'inngest';
      cron?: string;
      serve?: boolean;
      framework?: 'next' | 'express' | 'hono' | 'fastify' | 'remix';
      typedEvents?: boolean;
      retries?: number;
      timeout?: string;
    }) => {
      try {
        const filePath = path.resolve(args.filePath);

        if (args.target === 'inngest') {
          // Use deep Inngest generator
          const parser = new AnnotationParser();
          const parseResult = parser.parse(filePath);

          if (parseResult.errors.length > 0) {
            return makeErrorResult('PARSE_ERROR', `Parse errors:\n${parseResult.errors.join('\n')}`);
          }
          if (parseResult.workflows.length === 0) {
            return makeErrorResult('PARSE_ERROR', 'No workflows found in file');
          }

          const workflow = args.workflowName
            ? parseResult.workflows.find((w) => w.name === args.workflowName || w.functionName === args.workflowName)
            : parseResult.workflows[0];

          if (!workflow) {
            const available = parseResult.workflows.map((w) => w.name).join(', ');
            return makeErrorResult('PARSE_ERROR', `Workflow "${args.workflowName}" not found. Available: ${available}`);
          }

          const allNodeTypes = [...(workflow.nodeTypes || [])];

          // Apply CLI overrides to workflow options
          if (args.cron) {
            workflow.options = workflow.options || {};
            workflow.options.trigger = { ...workflow.options.trigger, cron: args.cron };
          }
          if (args.retries !== undefined) {
            workflow.options = workflow.options || {};
            workflow.options.retries = args.retries;
          }
          if (args.timeout) {
            workflow.options = workflow.options || {};
            workflow.options.timeout = args.timeout;
          }

          const code = generateInngestFunction(workflow, allNodeTypes, {
            production: args.production ?? false,
            typedEvents: args.typedEvents,
            serveHandler: args.serve,
            framework: args.framework,
          });

          const outputFile = filePath.replace(/\.ts$/, '.inngest.ts');
          if (args.write !== false) {
            const fs = await import('fs');
            fs.writeFileSync(outputFile, code, 'utf8');
          }

          return makeToolResult({
            target: 'inngest',
            outputFile,
            workflowName: workflow.name,
            code: args.write === false ? code : undefined,
          });
        }

        const result = await compileWorkflow(filePath, {
          write: args.write ?? true,
          parse: { workflowName: args.workflowName },
          generate: { production: args.production ?? false },
        });
        return makeToolResult({
          outputFile: result.metadata?.outputFile ?? filePath,
          warnings: result.analysis?.warnings ?? [],
        });
      } catch (err) {
        return makeErrorResult(
          'COMPILE_ERROR',
          `fw_compile failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  );

  mcp.tool(
    'fw_diff',
    'Semantic diff between two workflow files — node type changes, instance changes, connection changes, breaking changes.',
    {
      file1: z.string().describe('Path to first workflow file'),
      file2: z.string().describe('Path to second workflow file'),
      format: z
        .enum(['text', 'json', 'compact'])
        .optional()
        .describe('Output format (default: text)'),
      workflowName: z.string().optional().describe('Specific workflow name'),
    },
    async (args: {
      file1: string;
      file2: string;
      format?: 'text' | 'json' | 'compact';
      workflowName?: string;
    }) => {
      try {
        const [result1, result2] = await Promise.all([
          parseWorkflow(path.resolve(args.file1), { workflowName: args.workflowName }),
          parseWorkflow(path.resolve(args.file2), { workflowName: args.workflowName }),
        ]);
        if (result1.errors.length > 0) {
          return makeErrorResult(
            parseErrorCode(result1.errors),
            `Parse errors in file1:\n${result1.errors.join('\n')}`
          );
        }
        if (result2.errors.length > 0) {
          return makeErrorResult(
            parseErrorCode(result2.errors),
            `Parse errors in file2:\n${result2.errors.join('\n')}`
          );
        }
        const diff = WorkflowDiffer.compare(result1.ast, result2.ast);
        const format = args.format ?? 'text';
        const formatted = formatDiff(diff, format);
        return makeToolResult(format === 'json' ? JSON.parse(formatted) : formatted);
      } catch (err) {
        return makeErrorResult(
          'DIFF_ERROR',
          `fw_diff failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  );

  mcp.tool(
    'fw_query',
    'Query workflow structure.\n\nQuery types:\n- nodes: All node instances [{id, nodeType, parent}]\n- connections: All connections [{from, to}] in "node.port" format. Optional: nodeId to filter.\n- deps: Direct upstream dependencies [nodeId[]]. Requires: nodeId\n- dependents: Direct downstream dependents [nodeId[]]. Requires: nodeId\n- data-deps: Data-only upstream dependencies (excludes control flow). Requires: nodeId\n- execution-order: Topological sort of main-flow nodes. Scoped nodes are listed separately.\n- isolated: Nodes with no connections [nodeId[]]\n- dead-ends: Nodes that don\'t reach Exit [nodeId[]]\n- disconnected-outputs: Output ports not connected to anything [{nodeId, ports[]}]\n- node-types: All node type definitions [{name, functionName, inputs[], outputs[]}]',
    {
      filePath: z.string().describe('Path to the workflow file'),
      query: z
        .enum([
          'nodes',
          'connections',
          'deps',
          'dependents',
          'data-deps',
          'execution-order',
          'isolated',
          'dead-ends',
          'disconnected-outputs',
          'node-types',
        ])
        .describe('Query type'),
      nodeId: z
        .string()
        .optional()
        .describe('Required for deps/dependents. Optional filter for connections.'),
      workflowName: z.string().optional().describe('Specific workflow name'),
    },
    async (args: { filePath: string; query: string; nodeId?: string; workflowName?: string }) => {
      try {
        const filePath = path.resolve(args.filePath);
        let parseResult = await parseWorkflow(filePath, { workflowName: args.workflowName });

        // For node-types query, fall back to nodeTypesOnly mode if no workflows found
        if (
          parseResult.errors.length > 0 &&
          args.query === 'node-types' &&
          parseResult.errors.some((e) => typeof e === 'string' && e.includes('No workflows found'))
        ) {
          try {
            const ntResult = await parseWorkflow(filePath, { nodeTypesOnly: true });
            if (ntResult.errors.length === 0) {
              parseResult = ntResult;
            }
          } catch {
            /* fall through to original error */
          }
        }

        if (parseResult.errors.length > 0) {
          return makeErrorResult(
            parseErrorCode(parseResult.errors),
            `Parse errors:\n${parseResult.errors.join('\n')}`
          );
        }
        const ast = parseResult.ast;

        switch (args.query) {
          case 'nodes':
            return makeToolResult(
              getNodes(ast).map((n) => ({
                id: n.id,
                nodeType: n.nodeType,
                parent: n.parent ?? null,
              }))
            );
          case 'connections':
            return makeToolResult(
              getConnections(ast, args.nodeId).map((c) => ({
                from: `${c.from.node}.${c.from.port}`,
                to: `${c.to.node}.${c.to.port}`,
              }))
            );
          case 'deps':
            if (!args.nodeId)
              return makeErrorResult('MISSING_PARAM', 'nodeId is required for "deps" query');
            return makeToolResult(getDependencies(ast, args.nodeId));
          case 'dependents':
            if (!args.nodeId)
              return makeErrorResult('MISSING_PARAM', 'nodeId is required for "dependents" query');
            return makeToolResult(getDependents(ast, args.nodeId));
          case 'execution-order':
            try {
              const order = getTopologicalOrder(ast);
              const allNodeIds = ast.instances.map((n: { id: string }) => n.id);
              const scopedNodes = allNodeIds.filter((id: string) => !order.includes(id));
              return makeToolResult({
                order,
                ...(scopedNodes.length > 0 && {
                  scopedNodes,
                  note: 'Scoped nodes execute within their parent scope and are excluded from top-level execution order.',
                }),
              });
            } catch (cycleErr) {
              return makeErrorResult(
                'CYCLE_DETECTED',
                cycleErr instanceof Error ? cycleErr.message : String(cycleErr)
              );
            }
          case 'isolated':
            return makeToolResult(findIsolatedNodes(ast));
          case 'data-deps':
            if (!args.nodeId)
              return makeErrorResult('MISSING_PARAM', 'nodeId is required for "data-deps" query');
            return makeToolResult(getDataDependencies(ast, args.nodeId));
          case 'dead-ends':
            return makeToolResult(findDeadEndDetails(ast));
          case 'disconnected-outputs':
            return makeToolResult(findDisconnectedOutputPorts(ast));
          case 'node-types':
            return makeToolResult(
              ast.nodeTypes.map((nt) => ({
                name: nt.name,
                functionName: nt.functionName,
                inputs: Object.keys(nt.inputs),
                outputs: Object.keys(nt.outputs),
              }))
            );
          default:
            return makeErrorResult('UNKNOWN_QUERY', `Unknown query type: ${args.query}`);
        }
      } catch (err) {
        return makeErrorResult(
          'QUERY_ERROR',
          `fw_query failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  );

  mcp.tool(
    'fw_doctor',
    'Check project environment and configuration for flow-weaver compatibility.',
    {
      directory: z
        .string()
        .optional()
        .describe('Directory to check (default: cwd)'),
    },
    async (args: { directory?: string }) => {
      try {
        const dir = path.resolve(args.directory ?? process.cwd());
        const report = runDoctorChecks(dir);
        return makeToolResult(report);
      } catch (err) {
        return makeErrorResult(
          'DOCTOR_ERROR',
          `fw_doctor failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  );
}
