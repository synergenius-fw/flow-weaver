import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import * as path from 'path';
import * as fs from 'fs';
import { globSync } from 'glob';
import type { TWorkflowAST } from '../ast/types.js';
import { parseWorkflow, validateWorkflow } from '../api/index.js';
import { listPatterns, applyPattern, findWorkflows, extractPattern } from '../api/patterns.js';
import { generateInPlace } from '../api/generate-in-place.js';
import { applyMigrations, getRegisteredMigrations } from '../migration/registry.js';
import { describeWorkflow, formatDescribeOutput } from '../cli/commands/describe.js';
import {
  addNode as manipAddNode,
  removeNode as manipRemoveNode,
  renameNode as manipRenameNode,
  addConnection as manipAddConnection,
  removeConnection as manipRemoveConnection,
  setNodePosition as manipSetNodePosition,
  setNodeLabel as manipSetNodeLabel,
} from '../api/manipulation.js';
import { findIsolatedNodes } from '../api/query.js';
import { AnnotationParser } from '../parser.js';
import { makeToolResult, makeErrorResult, addHintsToItems } from './response-utils.js';
import { getFriendlyError } from '../friendly-errors.js';

// Runtime validation schemas for fw_modify operations
const modifyParamsSchemas: Record<string, z.ZodType> = {
  addNode: z.object({
    nodeId: z.string({ required_error: 'nodeId is required' }),
    nodeType: z.string({ required_error: 'nodeType is required' }),
    x: z.number().optional(),
    y: z.number().optional(),
  }),
  removeNode: z.object({
    nodeId: z.string({ required_error: 'nodeId is required' }),
  }),
  renameNode: z.object({
    oldId: z.string({ required_error: 'oldId is required' }),
    newId: z.string({ required_error: 'newId is required' }),
  }),
  addConnection: z.object({
    from: z.string({ required_error: 'from is required (format: "node.port")' }),
    to: z.string({ required_error: 'to is required (format: "node.port")' }),
  }),
  removeConnection: z.object({
    from: z.string({ required_error: 'from is required (format: "node.port")' }),
    to: z.string({ required_error: 'to is required (format: "node.port")' }),
  }),
  setNodePosition: z.object({
    nodeId: z.string({ required_error: 'nodeId is required' }),
    x: z.number({ required_error: 'x is required', invalid_type_error: 'x must be a number' }),
    y: z.number({ required_error: 'y is required', invalid_type_error: 'y must be a number' }),
  }),
  setNodeLabel: z.object({
    nodeId: z.string({ required_error: 'nodeId is required' }),
    label: z.string({ required_error: 'label is required' }),
  }),
};

function validateModifyParams(
  operation: string,
  params: Record<string, unknown>
): { success: true } | { success: false; error: string } {
  const schema = modifyParamsSchemas[operation];
  if (!schema) {
    return { success: false, error: `Unknown operation: ${operation}` };
  }
  const result = schema.safeParse(params);
  if (!result.success) {
    const messages = result.error.issues.map((i) => i.message).join('; ');
    return { success: false, error: `${operation} params invalid: ${messages}` };
  }
  return { success: true };
}

/**
 * Apply a single modify operation to an AST.
 * Shared by fw_modify and fw_modify_batch.
 */
function applyModifyOperation(
  ast: TWorkflowAST,
  operation: string,
  params: Record<string, unknown>
): { ast: TWorkflowAST; warnings: string[]; extraData: Record<string, unknown> } {
  const p = params;
  const warnings: string[] = [];
  const extraData: Record<string, unknown> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AST manipulation functions use loose typing
  let modifiedAST = ast as any;

  switch (operation) {
    case 'addNode': {
      const nodeId = p.nodeId as string;
      const nodeType = p.nodeType as string;
      const nodeTypeExists = modifiedAST.nodeTypes.some(
        (nt: { name: string; functionName: string }) =>
          nt.name === nodeType || nt.functionName === nodeType
      );
      if (!nodeTypeExists) {
        warnings.push(
          `Node type "${nodeType}" is not defined in the file. ` +
            `The node will be added but may not render until the type is defined.`
        );
      }

      let autoX = typeof p.x === 'number' ? p.x : undefined;
      let autoY = typeof p.y === 'number' ? p.y : undefined;
      if (autoX === undefined || autoY === undefined) {
        const positions = modifiedAST.instances
          .map((inst: { config?: { x?: number; y?: number } }) => inst.config)
          .filter(
            (c: unknown): c is { x: number; y: number } =>
              c !== undefined &&
              c !== null &&
              typeof (c as Record<string, unknown>).x === 'number' &&
              typeof (c as Record<string, unknown>).y === 'number'
          );
        if (positions.length > 0) {
          const maxX = Math.max(...positions.map((pos: { x: number }) => pos.x));
          if (autoX === undefined) autoX = maxX + 180;
          if (autoY === undefined) autoY = 0;
        } else {
          if (autoX === undefined) autoX = 0;
          if (autoY === undefined) autoY = 0;
        }
      }

      modifiedAST = manipAddNode(modifiedAST, {
        type: 'NodeInstance',
        id: nodeId,
        nodeType,
        config: { x: autoX, y: autoY },
      });
      break;
    }
    case 'removeNode': {
      const nodeId = p.nodeId as string;
      const removedConnections = modifiedAST.connections
        .filter(
          (c: { from: { node: string }; to: { node: string } }) =>
            c.from.node === nodeId || c.to.node === nodeId
        )
        .map((c: { from: { node: string; port: string }; to: { node: string; port: string } }) => ({
          from: `${c.from.node}.${c.from.port}`,
          to: `${c.to.node}.${c.to.port}`,
        }));
      modifiedAST = manipRemoveNode(modifiedAST, nodeId);
      if (removedConnections.length > 0) {
        extraData.removedConnections = removedConnections;
      }
      break;
    }
    case 'renameNode': {
      modifiedAST = manipRenameNode(modifiedAST, p.oldId as string, p.newId as string);
      break;
    }
    case 'addConnection': {
      const from = p.from as string;
      const to = p.to as string;
      const [fromNode, fromPort] = from.split('.');
      const [toNode, toPort] = to.split('.');

      if (!fromPort || !toPort) {
        throw new Error('Connection format must be "node.port" (e.g., "Start.execute")');
      }

      const validNodes = [
        'Start',
        'Exit',
        ...modifiedAST.instances.map((i: { id: string }) => i.id),
      ];
      if (!validNodes.includes(fromNode)) {
        throw new Error(`Source node "${fromNode}" not found. Available: ${validNodes.join(', ')}`);
      }
      if (!validNodes.includes(toNode)) {
        throw new Error(`Target node "${toNode}" not found. Available: ${validNodes.join(', ')}`);
      }

      if (fromNode !== 'Start' && fromNode !== 'Exit') {
        const inst = modifiedAST.instances.find((i: { id: string }) => i.id === fromNode);
        const nt = modifiedAST.nodeTypes.find(
          (t: { name: string }) => t.name === (inst as { nodeType: string })?.nodeType
        );
        if (nt && !(nt.outputs as Record<string, unknown>)[fromPort]) {
          throw new Error(
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
          throw new Error(
            `Node "${toNode}" has no input "${toPort}". Available: ${Object.keys(nt.inputs).join(', ')}`
          );
        }
      }

      modifiedAST = manipAddConnection(modifiedAST, from, to);
      // Transition from autoConnect to explicit mode when connections are manually modified
      if (modifiedAST.options?.autoConnect) {
        modifiedAST = { ...modifiedAST, options: { ...modifiedAST.options, autoConnect: undefined } };
        warnings.push('autoConnect was disabled because connections were manually modified');
      }
      break;
    }
    case 'removeConnection': {
      modifiedAST = manipRemoveConnection(modifiedAST, p.from as string, p.to as string);
      // Transition from autoConnect to explicit mode when connections are manually modified
      if (modifiedAST.options?.autoConnect) {
        modifiedAST = { ...modifiedAST, options: { ...modifiedAST.options, autoConnect: undefined } };
        warnings.push('autoConnect was disabled because connections were manually modified');
      }
      const newlyIsolated = findIsolatedNodes(modifiedAST);
      if (newlyIsolated.length > 0) {
        extraData.newlyIsolatedNodes = newlyIsolated;
      }
      break;
    }
    case 'setNodePosition': {
      modifiedAST = manipSetNodePosition(
        modifiedAST,
        p.nodeId as string,
        p.x as number,
        p.y as number
      );
      break;
    }
    case 'setNodeLabel': {
      modifiedAST = manipSetNodeLabel(modifiedAST, p.nodeId as string, p.label as string);
      break;
    }
    default:
      throw new Error(`Unknown operation: ${operation}`);
  }

  return { ast: modifiedAST, warnings, extraData };
}

export function registerPatternTools(mcp: McpServer): void {
  mcp.tool(
    'fw_list_patterns',
    'List reusable patterns defined in a file.',
    {
      filePath: z.string().describe('Path to file containing patterns'),
    },
    async (args: { filePath: string }) => {
      try {
        const filePath = path.resolve(args.filePath);
        const patterns = listPatterns(filePath);
        return makeToolResult(patterns);
      } catch (err) {
        return makeErrorResult(
          'LIST_PATTERNS_ERROR',
          `fw_list_patterns failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  );

  mcp.tool(
    'fw_apply_pattern',
    'Apply a reusable pattern to a workflow file.',
    {
      patternFile: z.string().describe('Path to file containing the pattern'),
      targetFile: z.string().describe('Path to target workflow file'),
      patternName: z.string().optional().describe('Specific pattern name if file has multiple'),
      prefix: z.string().optional().describe('Node ID prefix to avoid conflicts'),
      preview: z.boolean().optional().describe("Preview only, don't write (default: false)"),
    },
    async (args: {
      patternFile: string;
      targetFile: string;
      patternName?: string;
      prefix?: string;
      preview?: boolean;
    }) => {
      try {
        const patternFilePath = path.resolve(args.patternFile);
        const targetFilePath = path.resolve(args.targetFile);
        const annotationParser = new AnnotationParser();

        // Parse pattern file
        const patternResult = annotationParser.parse(patternFilePath);
        if (patternResult.patterns.length === 0) {
          return makeErrorResult('PATTERN_NOT_FOUND', `No patterns found in ${args.patternFile}`);
        }

        // Select pattern
        let pattern;
        if (args.patternName) {
          pattern = patternResult.patterns.find((p) => p.name === args.patternName);
          if (!pattern) {
            return makeErrorResult(
              'PATTERN_NOT_FOUND',
              `Pattern "${args.patternName}" not found in ${args.patternFile}`
            );
          }
        } else {
          pattern = patternResult.patterns[0];
        }

        // Read target file and parse for existing node types
        const targetContent = fs.readFileSync(targetFilePath, 'utf8');
        const targetResult = annotationParser.parse(targetFilePath);
        const existingNodeTypes = new Set(targetResult.nodeTypes.map((nt) => nt.name));

        // Apply pattern via pure API
        const result = applyPattern({
          patternAST: pattern,
          targetContent,
          targetNodeTypes: existingNodeTypes,
          prefix: args.prefix,
        });

        if (args.preview) {
          return makeToolResult({
            success: true,
            preview: true,
            nodesAdded: result.nodesAdded,
            connectionsAdded: result.connectionsAdded,
            nodeTypesAdded: result.nodeTypesAdded,
            conflicts: result.conflicts,
            wiringInstructions: result.wiringInstructions,
            content: result.modifiedContent,
          });
        }

        fs.writeFileSync(targetFilePath, result.modifiedContent, 'utf8');
        return makeToolResult({
          success: true,
          nodesAdded: result.nodesAdded,
          connectionsAdded: result.connectionsAdded,
          nodeTypesAdded: result.nodeTypesAdded,
          conflicts: result.conflicts,
          wiringInstructions: result.wiringInstructions,
        });
      } catch (err) {
        return makeErrorResult(
          'APPLY_PATTERN_ERROR',
          `fw_apply_pattern failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  );

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
    'Modify a workflow file: add/remove/rename nodes, add/remove connections, set positions/labels. Parses the file, applies the mutation, and regenerates annotations in-place. Returns auto-validation results and a text description of the updated workflow. For addNode: if x/y are omitted, the node is placed to the right of the rightmost existing node.',
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
          'setNodePosition',
          'setNodeLabel',
        ])
        .describe('The mutation to perform'),
      params: z
        .record(z.unknown())
        .describe(
          'Operation-specific parameters. ' +
            'addNode: {nodeId, nodeType, x?, y?}. ' +
            'removeNode: {nodeId}. ' +
            'renameNode: {oldId, newId}. ' +
            'addConnection: {from, to} ("node.port" format). ' +
            'removeConnection: {from, to} ("node.port" format). ' +
            'setNodePosition: {nodeId, x, y}. ' +
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

            // Auto-position: if x/y not provided, place to the right of the rightmost node
            let autoX = typeof p.x === 'number' ? p.x : undefined;
            let autoY = typeof p.y === 'number' ? p.y : undefined;
            if (autoX === undefined || autoY === undefined) {
              const positions = parseResult.ast.instances
                .map((inst: { config?: { x?: number; y?: number } }) => inst.config)
                .filter(
                  (c): c is { x: number; y: number } =>
                    c !== undefined && typeof c.x === 'number' && typeof c.y === 'number'
                );
              if (positions.length > 0) {
                const maxX = Math.max(...positions.map((pos) => pos.x));
                if (autoX === undefined) autoX = maxX + 180;
                if (autoY === undefined) autoY = 0;
              } else {
                if (autoX === undefined) autoX = 0;
                if (autoY === undefined) autoY = 0;
              }
            }

            modifiedAST = manipAddNode(modifiedAST, {
              type: 'NodeInstance',
              id: nodeId,
              nodeType,
              config: {
                x: autoX,
                y: autoY,
              },
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
          case 'setNodePosition': {
            const nodeId = p.nodeId as string;
            const x = p.x as number;
            const y = p.y as number;
            if (!nodeId || typeof x !== 'number' || typeof y !== 'number') {
              return makeErrorResult(
                'INVALID_PARAMS',
                'setNodePosition requires params: nodeId, x, y'
              );
            }
            modifiedAST = manipSetNodePosition(modifiedAST, nodeId, x, y);
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

        // Regenerate the file in-place
        const genResult = generateInPlace(sourceCode, modifiedAST);

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
    'Apply multiple modify operations in a single parse/write/validate cycle. More efficient than calling fw_modify multiple times.',
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
              'setNodePosition',
              'setNodeLabel',
            ]),
            params: z.record(z.unknown()),
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

        // Generate once
        const genResult = generateInPlace(sourceCode, currentAST);

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
    'fw_extract_pattern',
    'Extract a reusable pattern from selected nodes in a workflow. Identifies internal connections and boundary IN/OUT ports automatically.',
    {
      sourceFile: z.string().describe('Path to workflow file'),
      nodes: z.string().describe('Comma-separated node IDs to extract'),
      name: z.string().optional().describe('Pattern name'),
      outputFile: z.string().optional().describe('Output file path (omit for preview only)'),
    },
    async (args: { sourceFile: string; nodes: string; name?: string; outputFile?: string }) => {
      try {
        const filePath = path.resolve(args.sourceFile);
        const parseResult = await parseWorkflow(filePath);
        if (parseResult.errors.length > 0) {
          return makeErrorResult('PARSE_ERROR', `Parse errors:\n${parseResult.errors.join('\n')}`);
        }

        const annotationParser = new AnnotationParser();
        const fullParse = annotationParser.parse(filePath);

        const nodeIds = args.nodes.split(',').map((s) => s.trim());

        const result = extractPattern({
          workflowAST: parseResult.ast,
          nodeTypes: fullParse.nodeTypes,
          nodeIds,
          name: args.name,
        });

        if (args.outputFile) {
          const outPath = path.resolve(args.outputFile);
          fs.writeFileSync(outPath, result.patternCode, 'utf8');
          return makeToolResult({
            success: true,
            filePath: outPath,
            patternName: result.patternName,
            nodes: result.nodes,
            inputPorts: result.inputPorts,
            outputPorts: result.outputPorts,
            internalConnectionCount: result.internalConnectionCount,
          });
        }

        return makeToolResult({
          success: true,
          preview: true,
          patternName: result.patternName,
          nodes: result.nodes,
          inputPorts: result.inputPorts,
          outputPorts: result.outputPorts,
          internalConnectionCount: result.internalConnectionCount,
          code: result.patternCode,
        });
      } catch (err) {
        return makeErrorResult(
          'EXTRACT_PATTERN_ERROR',
          `fw_extract_pattern failed: ${err instanceof Error ? err.message : String(err)}`
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
