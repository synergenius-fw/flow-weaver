import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import * as path from 'path';
import { parseWorkflow, validateWorkflow, compileWorkflow } from '../api/index.js';
import { isMultipleWorkflows, MULTIPLE_WORKFLOWS_MARKER } from '../api/parse.js';
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
import { getFriendlyError } from '../validation/friendly-errors.js';

/** Detect MULTIPLE_WORKFLOWS_FOUND marker in parse errors and return the right error code */
function parseErrorCode(errors: string[]): string {
  if (errors.some((e) => e.includes(MULTIPLE_WORKFLOWS_MARKER))) {
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
        const parseResult = await parseWorkflow(filePath, { workflowName: args.workflowName, projectDir: path.dirname(filePath) });

        // If no workflows found, try node-type-only mode
        if (
          parseResult.errors.length > 0 &&
          parseResult.errors.some((e) => typeof e === 'string' && e.includes('No workflows found'))
        ) {
          try {
            const ntResult = await parseWorkflow(filePath, { nodeTypesOnly: true, projectDir: path.dirname(filePath) });
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

  /** One workflow's validation result, in the shape fw_validate returns. */
  function validationReport(parseResult: Awaited<ReturnType<typeof parseWorkflow>>, draft?: boolean) {
    if (parseResult.errors.length > 0) {
      return { valid: false, errors: parseResult.errors, warnings: parseResult.warnings };
    }
    const result = validateWorkflow(parseResult.ast, draft ? { mode: 'draft' } : undefined);
    // The same item shape `fw validate --json` prints: a location lets an
    // editor place the finding on its line, a docUrl names the reference.
    const item = (e: (typeof result.errors)[number]) => ({
      message: e.message,
      severity: e.type,
      nodeId: e.node,
      code: e.code,
      ...(e.location && { location: e.location }),
      ...(e.docUrl && { docUrl: e.docUrl }),
    });
    const errors = result.errors.map(item);
    const warnings = [...parseResult.warnings, ...result.warnings.map(item)];
    return {
      valid: result.valid,
      errors: addHintsToItems(errors, getFriendlyError),
      warnings: addHintsToItems(
        warnings as Array<{ message: string; severity: string; nodeId?: string; code?: string }>,
        getFriendlyError
      ),
    };
  }

  mcp.tool(
    'fw_validate',
    'Validate a workflow file and return errors/warnings.',
    {
      filePath: z.string().describe('Path to the workflow file'),
      workflowName: z.string().optional().describe('Specific workflow name (default: every workflow in the file)'),
      draft: z.boolean().optional().describe('Draft mode - suppresses STUB_NODE errors for unimplemented nodes (default: false)'),
    },
    async (args: { filePath: string; workflowName?: string; draft?: boolean }) => {
      try {
        const filePath = path.resolve(args.filePath);
        const parseResult = await parseWorkflow(filePath, { workflowName: args.workflowName, projectDir: path.dirname(filePath) });

        // If no workflows found, try node-type-only mode
        if (
          parseResult.errors.length > 0 &&
          parseResult.errors.some((e) => typeof e === 'string' && e.includes('No workflows found'))
        ) {
          try {
            const ntResult = await parseWorkflow(filePath, { nodeTypesOnly: true, projectDir: path.dirname(filePath) });
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

        // Several workflows and none named: validate each one.
        if (!args.workflowName && isMultipleWorkflows(parseResult.errors) && parseResult.availableWorkflows.length > 1) {
          const workflows = [];
          for (const name of parseResult.availableWorkflows) {
            const one = await parseWorkflow(filePath, { workflowName: name, projectDir: path.dirname(filePath) });
            workflows.push({ workflowName: name, ...validationReport(one, args.draft) });
          }
          return makeToolResult({ valid: workflows.every((w) => w.valid), workflows });
        }

        return makeToolResult(validationReport(parseResult, args.draft));
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
      'and @flow-weaver-body marker sections, so user code outside markers is preserved. ' +
      'Set production: true to strip debug instrumentation.',
    {
      filePath: z.string().describe('Path to the workflow file'),
      write: z.boolean().optional().describe('Whether to write the output file (default: true)'),
      production: z
        .boolean()
        .optional()
        .describe('Production mode, meaning no debug events (default: false)'),
      workflowName: z.string().optional().describe('Specific workflow name (default: every workflow in the file)'),
      draft: z.boolean().optional().describe('Draft mode - suppresses STUB_NODE validation errors so partially implemented workflows can compile (default: false)'),
    },
    async (args: {
      filePath: string;
      write?: boolean;
      production?: boolean;
      workflowName?: string;
      draft?: boolean;
    }) => {
      try {
        const filePath = path.resolve(args.filePath);

        const compileOne = (workflowName: string | undefined) =>
          compileWorkflow(filePath, {
            write: args.write ?? true,
            parse: { workflowName },
            generate: { production: args.production ?? false },
            validationMode: args.draft ? 'draft' : undefined,
          });

        let result;
        try {
          result = await compileOne(args.workflowName);
        } catch (err) {
          // Several workflows and none named: compile each one in turn. Each
          // compile reads the file the previous one wrote, so the bodies stack.
          if (args.workflowName || !String(err instanceof Error ? err.message : err).includes(MULTIPLE_WORKFLOWS_MARKER)) throw err;
          const { availableWorkflows } = await parseWorkflow(filePath, { projectDir: path.dirname(filePath) });
          const warnings = [];
          for (const name of availableWorkflows) {
            const one = await compileOne(name);
            warnings.push(...(one.analysis?.warnings ?? []).map((w) => ({ workflowName: name, ...w })));
          }
          return makeToolResult({ outputFile: filePath, workflows: availableWorkflows, warnings });
        }
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
    'Semantic diff between two workflow files: node type changes, instance changes, connection changes, breaking changes.',
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
        const file1 = path.resolve(args.file1);
        const file2 = path.resolve(args.file2);
        const [result1, result2] = await Promise.all([
          parseWorkflow(file1, { workflowName: args.workflowName, projectDir: path.dirname(file1) }),
          parseWorkflow(file2, { workflowName: args.workflowName, projectDir: path.dirname(file2) }),
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
        let parseResult = await parseWorkflow(filePath, { workflowName: args.workflowName, projectDir: path.dirname(filePath) });

        // For node-types query, fall back to nodeTypesOnly mode if no workflows found
        if (
          parseResult.errors.length > 0 &&
          args.query === 'node-types' &&
          parseResult.errors.some((e) => typeof e === 'string' && e.includes('No workflows found'))
        ) {
          try {
            const ntResult = await parseWorkflow(filePath, { nodeTypesOnly: true, projectDir: path.dirname(filePath) });
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
