import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import * as path from 'path';
import * as fs from 'fs';
import { globSync } from 'glob';
import { parseWorkflow, validateWorkflow } from '../api/index.js';
import { generateInPlace, hasInPlaceMarkers } from '../api/generate-in-place.js';
import { applyMigrations, getRegisteredMigrations } from '../migration/registry.js';
import { describeWorkflow, formatDescribeOutput } from '../cli/commands/describe.js';
import { applyModifyOperation, validateModifyParams } from '../api/modify-operation.js';
import {
  addNode as manipAddNode,
  removeNode as manipRemoveNode,
  renameNode as manipRenameNode,
  addConnection as manipAddConnection,
  removeConnection as manipRemoveConnection,
  setNodeLabel as manipSetNodeLabel,
} from '../api/manipulation/index.js';
import { findIsolatedNodes, findWorkflows } from '../api/query.js';
import { makeToolResult, makeErrorResult, addHintsToItems } from './response-utils.js';
import { getFriendlyError } from '../validation/friendly-errors.js';

export function registerWorkflowTools(mcp: McpServer): void {
  mcp.tool(
    'fw_find_workflows',
    'Scan a directory for workflow files containing @flowWeaver workflow annotations. Returns file paths and workflow metadata.',
    {
      directory: z.string().describe('Directory to search for workflow files'),
      pattern: z.string().optional().describe('Glob pattern (default: **/*.ts)'),
    },
    async (args: { directory: string; pattern?: string }) => {
      try {
        const dir = path.resolve(args.directory);
        const results = await findWorkflows(dir, args.pattern);
        return makeToolResult(results);
      } catch (err) {
        return makeErrorResult(
          'FIND_WORKFLOWS_ERROR',
          `fw_find_workflows failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  );

  mcp.tool(
    'fw_modify',
    'Modify a workflow file: add/remove/rename nodes, add/remove connections, set labels. Parses the file, applies the mutation, and rewrites only the JSDoc annotations. A file that was already compiled in place is recompiled so its generated body stays consistent. An uncompiled file stays uncompiled. Returns auto-validation results and a text description of the updated workflow.',
    {
      filePath: z.string().describe('Path to the workflow file'),
      workflowName: z.string().optional().describe('Specific workflow if file has multiple'),
      operation: z
        .enum([
          'addNode',
          'removeNode',
          'renameNode',
          'addConnection',
          'removeConnection',
          'setNodeLabel',
        ])
        .describe('The mutation to perform'),
      params: z
        .record(z.string(), z.unknown())
        .describe(
          'Operation-specific parameters. ' +
            'addNode: {nodeId, nodeType}. ' +
            'removeNode: {nodeId}. ' +
            'renameNode: {oldId, newId}. ' +
            'addConnection: {from, to} ("node.port" format). ' +
            'removeConnection: {from, to} ("node.port" format). ' +
            'setNodeLabel: {nodeId, label}.'
        ),
      preview: z.boolean().optional().describe('Preview without writing (default: false)'),
    },
    async (args: {
      filePath: string;
      workflowName?: string;
      operation: string;
      params: Record<string, unknown>;
      preview?: boolean;
    }) => {
      try {
        // Validate params against schema for the operation
        const paramValidation = validateModifyParams(args.operation, args.params);
        if (!paramValidation.success) {
          return makeErrorResult('INVALID_PARAMS', paramValidation.error);
        }

        const filePath = path.resolve(args.filePath);
        const sourceCode = fs.readFileSync(filePath, 'utf8');

        // Parse the workflow
        const parseResult = await parseWorkflow(filePath, { workflowName: args.workflowName });
        if (parseResult.errors.length > 0) {
          return makeErrorResult('PARSE_ERROR', `Parse errors:\n${parseResult.errors.join('\n')}`);
        }

        let modifiedAST = parseResult.ast;
        const p = args.params;
        const warnings: string[] = [];
        const extraResponseData: Record<string, unknown> = {};

        // Apply the requested operation
        switch (args.operation) {
          case 'addNode': {
            const nodeId = p.nodeId as string;
            const nodeType = p.nodeType as string;
            if (!nodeId || !nodeType) {
              return makeErrorResult('INVALID_PARAMS', 'addNode requires params: nodeId, nodeType');
            }
            const nodeTypeExists = parseResult.ast.nodeTypes.some(
              (nt: { name: string; functionName: string }) =>
                nt.name === nodeType || nt.functionName === nodeType
            );
            if (!nodeTypeExists) {
              warnings.push(
                `Node type "${nodeType}" is not defined in the file. ` +
                  `The node will be added but may not render until the type is defined.`
              );
            }

            modifiedAST = manipAddNode(modifiedAST, {
              type: 'NodeInstance',
              id: nodeId,
              nodeType,
            });
            break;
          }
          case 'removeNode': {
            const nodeId = p.nodeId as string;
            if (!nodeId)
              return makeErrorResult('INVALID_PARAMS', 'removeNode requires params: nodeId');
            // Snapshot connections that will be removed along with the node
            const removedConnections = parseResult.ast.connections
              .filter((c) => c.from.node === nodeId || c.to.node === nodeId)
              .map((c) => ({
                from: `${c.from.node}.${c.from.port}`,
                to: `${c.to.node}.${c.to.port}`,
              }));
            modifiedAST = manipRemoveNode(modifiedAST, nodeId);
            if (removedConnections.length > 0) {
              extraResponseData.removedConnections = removedConnections;
            }
            break;
          }
          case 'renameNode': {
            const oldId = p.oldId as string;
            const newId = p.newId as string;
            if (!oldId || !newId) {
              return makeErrorResult('INVALID_PARAMS', 'renameNode requires params: oldId, newId');
            }
            modifiedAST = manipRenameNode(modifiedAST, oldId, newId);
            break;
          }
          case 'addConnection': {
            const from = p.from as string;
            const to = p.to as string;
            if (!from || !to) {
              return makeErrorResult(
                'INVALID_PARAMS',
                'addConnection requires params: from, to (format: "node.port")'
              );
            }

            const [fromNode, fromPort] = from.split('.');
            const [toNode, toPort] = to.split('.');

            if (!fromPort || !toPort) {
              return makeErrorResult(
                'INVALID_PARAMS',
                'Connection format must be "node.port" (e.g., "Start.execute")'
              );
            }

            // Pre-validate nodes exist
            const validNodes = [
              'Start',
              'Exit',
              ...modifiedAST.instances.map((i: { id: string }) => i.id),
            ];
            if (!validNodes.includes(fromNode)) {
              return makeErrorResult(
                'UNKNOWN_SOURCE_NODE',
                `Source node "${fromNode}" not found. Available: ${validNodes.join(', ')}`
              );
            }
            if (!validNodes.includes(toNode)) {
              return makeErrorResult(
                'UNKNOWN_TARGET_NODE',
                `Target node "${toNode}" not found. Available: ${validNodes.join(', ')}`
              );
            }

            // Pre-validate ports exist for non-Start/Exit nodes
            if (fromNode !== 'Start' && fromNode !== 'Exit') {
              const inst = modifiedAST.instances.find((i: { id: string }) => i.id === fromNode);
              const nt = modifiedAST.nodeTypes.find(
                (t: { name: string }) => t.name === (inst as { nodeType: string })?.nodeType
              );
              if (nt && !(nt.outputs as Record<string, unknown>)[fromPort]) {
                return makeErrorResult(
                  'UNKNOWN_SOURCE_PORT',
                  `Node "${fromNode}" has no output "${fromPort}". Available: ${Object.keys(nt.outputs).join(', ')}`
                );
              }
            }

            if (toNode !== 'Start' && toNode !== 'Exit') {
              const inst = modifiedAST.instances.find((i: { id: string }) => i.id === toNode);
              const nt = modifiedAST.nodeTypes.find(
                (t: { name: string }) => t.name === (inst as { nodeType: string })?.nodeType
              );
              if (nt && !(nt.inputs as Record<string, unknown>)[toPort]) {
                return makeErrorResult(
                  'UNKNOWN_TARGET_PORT',
                  `Node "${toNode}" has no input "${toPort}". Available: ${Object.keys(nt.inputs).join(', ')}`
                );
              }
            }

            // Idempotent: an existing connection is reported, not an error
            const alreadyConnected = (modifiedAST.connections as Array<{
              from: { node: string; port: string; scope?: string };
              to: { node: string; port: string; scope?: string };
            }>).some(
              (c) =>
                c.from.node === fromNode &&
                c.from.port === fromPort &&
                !c.from.scope &&
                c.to.node === toNode &&
                c.to.port === toPort &&
                !c.to.scope
            );
            if (alreadyConnected) {
              warnings.push(`Connection ${from} -> ${to} already exists, so it was skipped`);
              break;
            }

            modifiedAST = manipAddConnection(modifiedAST, from, to);
            break;
          }
          case 'removeConnection': {
            const from = p.from as string;
            const to = p.to as string;
            if (!from || !to) {
              return makeErrorResult(
                'INVALID_PARAMS',
                'removeConnection requires params: from, to (format: "node.port")'
              );
            }
            modifiedAST = manipRemoveConnection(modifiedAST, from, to);
            // Check if any nodes became isolated after removing the connection
            const newlyIsolated = findIsolatedNodes(modifiedAST);
            if (newlyIsolated.length > 0) {
              extraResponseData.newlyIsolatedNodes = newlyIsolated;
            }
            break;
          }
          case 'setNodeLabel': {
            const nodeId = p.nodeId as string;
            const label = p.label as string;
            if (!nodeId || typeof label !== 'string') {
              return makeErrorResult(
                'INVALID_PARAMS',
                'setNodeLabel requires params: nodeId, label'
              );
            }
            modifiedAST = manipSetNodeLabel(modifiedAST, nodeId, label);
            break;
          }
          default:
            return makeErrorResult('UNKNOWN_OPERATION', `Unknown operation: ${args.operation}`);
        }

        // Rewrite the annotations. Only a file that is already compiled in
        // place gets its generated sections regenerated too.
        const genResult = generateInPlace(sourceCode, modifiedAST, {
          annotationsOnly: !hasInPlaceMarkers(sourceCode),
        });

        if (args.preview) {
          return makeToolResult({
            success: true,
            preview: true,
            hasChanges: genResult.hasChanges,
            code: genResult.code,
          });
        }

        if (genResult.hasChanges) {
          fs.writeFileSync(filePath, genResult.code, 'utf8');
        }

        // Auto-validate and describe after successful modification
        let validation: { valid: boolean; errors: unknown[]; warnings: unknown[] } | undefined;
        let description: string | undefined;

        if (!args.preview) {
          try {
            const reParseResult = await parseWorkflow(filePath, {
              workflowName: args.workflowName,
            });
            if (reParseResult.errors.length === 0) {
              const valResult = validateWorkflow(reParseResult.ast);
              const errors = valResult.errors.map((e) => ({
                message: e.message,
                severity: e.type,
                nodeId: e.node,
                code: e.code,
              }));
              const valWarnings = [
                ...reParseResult.warnings,
                ...valResult.warnings.map((w) => ({
                  message: w.message,
                  severity: w.type,
                  nodeId: w.node,
                  code: w.code,
                })),
              ];
              validation = {
                valid: valResult.valid,
                errors: addHintsToItems(errors, getFriendlyError),
                warnings: addHintsToItems(
                  valWarnings as Array<{
                    message: string;
                    severity: string;
                    nodeId?: string;
                    code?: string;
                  }>,
                  getFriendlyError
                ),
              };

              // Generate text description
              try {
                const output = describeWorkflow(reParseResult.ast);
                description = formatDescribeOutput(reParseResult.ast, output, 'text');
              } catch {
                // Description is best-effort; don't fail the operation
              }
            } else {
              validation = {
                valid: false,
                errors: reParseResult.errors.map((msg) => ({ message: msg, severity: 'error' })),
                warnings: reParseResult.warnings,
              };
            }
          } catch (valErr) {
            // Validation is best-effort after modify; include parse warning
            warnings.push(
              `Post-modify validation failed: ${valErr instanceof Error ? valErr.message : String(valErr)}. The file was still written.`
            );
          }
        }

        return makeToolResult({
          success: true,
          hasChanges: genResult.hasChanges,
          operation: args.operation,
          ...(warnings.length > 0 && { warnings }),
          ...extraResponseData,
          ...(validation && { validation }),
          ...(description && { description }),
        });
      } catch (err) {
        return makeErrorResult(
          'MODIFY_ERROR',
          `fw_modify failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  );

  mcp.tool(
    'fw_modify_batch',
    'Apply multiple modify operations in a single parse/write/validate cycle. More efficient than calling fw_modify multiple times. Like fw_modify, it rewrites only the annotations unless the file was already compiled in place. An addConnection whose connection already exists is skipped with a warning rather than failing the batch.',
    {
      filePath: z.string().describe('Path to the workflow file'),
      workflowName: z.string().optional().describe('Specific workflow if file has multiple'),
      operations: z
        .array(
          z.object({
            operation: z.enum([
              'addNode',
              'removeNode',
              'renameNode',
              'addConnection',
              'removeConnection',
              'setNodeLabel',
            ]),
            params: z.record(z.string(), z.unknown()),
          })
        )
        .describe('Array of operations to apply sequentially'),
      preview: z.boolean().optional().describe('Preview without writing (default: false)'),
    },
    async (args: {
      filePath: string;
      workflowName?: string;
      operations: Array<{ operation: string; params: Record<string, unknown> }>;
      preview?: boolean;
    }) => {
      try {
        // Pre-validate all operation params before applying any
        for (let i = 0; i < args.operations.length; i++) {
          const op = args.operations[i];
          const paramValidation = validateModifyParams(op.operation, op.params);
          if (!paramValidation.success) {
            return makeErrorResult(
              'INVALID_PARAMS',
              `Operation ${i} (${op.operation}): ${paramValidation.error}`
            );
          }
        }

        const filePath = path.resolve(args.filePath);
        const sourceCode = fs.readFileSync(filePath, 'utf8');

        // Parse once
        const parseResult = await parseWorkflow(filePath, { workflowName: args.workflowName });
        if (parseResult.errors.length > 0) {
          return makeErrorResult('PARSE_ERROR', `Parse errors:\n${parseResult.errors.join('\n')}`);
        }

        // Apply all operations sequentially to the AST
        let currentAST = parseResult.ast;
        const allWarnings: string[] = [];
        const allExtraData: Record<string, unknown> = {};

        for (let i = 0; i < args.operations.length; i++) {
          const op = args.operations[i];
          try {
            const result = applyModifyOperation(currentAST, op.operation, op.params);
            currentAST = result.ast;
            allWarnings.push(...result.warnings);
            Object.assign(allExtraData, result.extraData);
          } catch (opErr) {
            return makeErrorResult(
              'MODIFY_ERROR',
              `Operation ${i} (${op.operation}) failed: ${opErr instanceof Error ? opErr.message : String(opErr)}`
            );
          }
        }

        // Generate once; annotations only unless the file is compiled in place
        const genResult = generateInPlace(sourceCode, currentAST, {
          annotationsOnly: !hasInPlaceMarkers(sourceCode),
        });

        if (args.preview) {
          return makeToolResult({
            success: true,
            preview: true,
            operationsApplied: args.operations.length,
            hasChanges: genResult.hasChanges,
            code: genResult.code,
          });
        }

        // Write once
        if (genResult.hasChanges) {
          fs.writeFileSync(filePath, genResult.code, 'utf8');
        }

        // Validate once
        let validation: { valid: boolean; errors: unknown[]; warnings: unknown[] } | undefined;
        let description: string | undefined;

        try {
          const reParseResult = await parseWorkflow(filePath, { workflowName: args.workflowName });
          if (reParseResult.errors.length === 0) {
            const valResult = validateWorkflow(reParseResult.ast);
            const errors = valResult.errors.map((e) => ({
              message: e.message,
              severity: e.type,
              nodeId: e.node,
              code: e.code,
            }));
            const valWarnings = [
              ...reParseResult.warnings,
              ...valResult.warnings.map((w) => ({
                message: w.message,
                severity: w.type,
                nodeId: w.node,
                code: w.code,
              })),
            ];
            validation = {
              valid: valResult.valid,
              errors: addHintsToItems(errors, getFriendlyError),
              warnings: addHintsToItems(
                valWarnings as Array<{
                  message: string;
                  severity: string;
                  nodeId?: string;
                  code?: string;
                }>,
                getFriendlyError
              ),
            };
            try {
              const output = describeWorkflow(reParseResult.ast);
              description = formatDescribeOutput(reParseResult.ast, output, 'text');
            } catch {
              // Description is best-effort
            }
          } else {
            validation = {
              valid: false,
              errors: reParseResult.errors.map((msg) => ({ message: msg, severity: 'error' })),
              warnings: reParseResult.warnings,
            };
          }
        } catch (valErr) {
          allWarnings.push(
            `Post-modify validation failed: ${valErr instanceof Error ? valErr.message : String(valErr)}. The file was still written.`
          );
        }

        return makeToolResult({
          success: true,
          operationsApplied: args.operations.length,
          hasChanges: genResult.hasChanges,
          ...(allWarnings.length > 0 && { warnings: allWarnings }),
          ...allExtraData,
          ...(validation && { validation }),
          ...(description && { description }),
        });
      } catch (err) {
        return makeErrorResult(
          'MODIFY_ERROR',
          `fw_modify_batch failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  );

  mcp.tool(
    'fw_migrate',
    'Migrate workflow files to current syntax via parse → regenerate round-trip. The parser adds defaults for missing fields, edge-case migrations transform the AST, and generateInPlace writes current syntax back.',
    {
      glob: z.string().describe('Glob pattern for workflow files to migrate (e.g., "src/**/*.ts")'),
      dryRun: z.boolean().optional().describe('Preview changes without writing files (default: false)'),
    },
    async (args: { glob: string; dryRun?: boolean }) => {
      try {
        const files = globSync(args.glob, { ignore: ['**/node_modules/**', '**/*.generated.ts'] });

        if (files.length === 0) {
          return makeToolResult({ success: true, message: `No files matched pattern: ${args.glob}`, files: [] });
        }

        const results: Array<{ file: string; status: 'migrated' | 'current' | 'error'; error?: string }> = [];

        for (const file of files) {
          const filePath = path.resolve(file);
          try {
            const sourceCode = fs.readFileSync(filePath, 'utf8');
            const parseResult = await parseWorkflow(filePath);

            if (parseResult.errors.length > 0) {
              results.push({ file, status: 'error', error: parseResult.errors.join('; ') });
              continue;
            }

            let ast = parseResult.ast;
            ast = applyMigrations(ast);

            const genResult = generateInPlace(sourceCode, ast, {
              allWorkflows: parseResult.allWorkflows,
            });

            if (!genResult.hasChanges) {
              results.push({ file, status: 'current' });
              continue;
            }

            if (!args.dryRun) {
              fs.writeFileSync(filePath, genResult.code, 'utf8');
            }
            results.push({ file, status: 'migrated' });
          } catch (err) {
            results.push({ file, status: 'error', error: err instanceof Error ? err.message : String(err) });
          }
        }

        const migrated = results.filter((r) => r.status === 'migrated').length;
        const current = results.filter((r) => r.status === 'current').length;
        const errors = results.filter((r) => r.status === 'error').length;

        return makeToolResult({
          success: true,
          dryRun: args.dryRun ?? false,
          summary: { migrated, current, errors, total: files.length },
          registeredMigrations: getRegisteredMigrations(),
          files: results,
        });
      } catch (err) {
        return makeErrorResult(
          'MIGRATE_ERROR',
          `fw_migrate failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  );
}
