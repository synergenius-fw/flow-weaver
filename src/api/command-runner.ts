/**
 * Programmatic command runner for flow-weaver operations.
 * Provides a unified dispatch interface that maps command names to
 * the existing programmatic APIs, suitable for bot/agent consumption.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseWorkflow } from './parse.js';
import { validateWorkflow } from './validate.js';
import { compileWorkflow } from './compile.js';
import { generateInPlace } from './generate-in-place.js';
import { applyModifyOperation, validateModifyParams } from './modify-operation.js';
import { generateWorkflowFromTemplate } from './templates.js';
import {
  getNode, getNodes, getConnections, getTopologicalOrder,
  findIsolatedNodes, findDeadEnds, countNodes, countConnections,
} from './query.js';
import { WorkflowDiffer } from '../diff/WorkflowDiffer.js';
import { formatDiff } from '../diff/formatDiff.js';

export interface CommandResult {
  output?: string;
  files?: string[];
  data?: unknown;
}

type CommandHandler = (args: Record<string, unknown>) => Promise<CommandResult>;

function resolveFile(args: Record<string, unknown>, cwd?: string): string {
  const file = String(args.file);
  return cwd ? path.resolve(cwd, file) : path.resolve(file);
}

const handlers: Record<string, CommandHandler> = {
  compile: async (args) => {
    const filePath = resolveFile(args, args.cwd as string | undefined);
    await compileWorkflow(filePath);
    return { files: [filePath] };
  },

  validate: async (args) => {
    const filePath = resolveFile(args, args.cwd as string | undefined);
    const parseResult = await parseWorkflow(filePath);
    if (parseResult.errors.length > 0) {
      return { data: { valid: false, errors: parseResult.errors, warnings: parseResult.warnings } };
    }
    const validation = validateWorkflow(parseResult.ast);
    const errors = validation.errors.map((e) => typeof e === 'string' ? e : e.message);
    const warnings = validation.warnings.map((w) => typeof w === 'string' ? w : w.message);
    return { data: { valid: errors.length === 0, errors, warnings } };
  },

  describe: async (args) => {
    const filePath = resolveFile(args, args.cwd as string | undefined);
    const { describeWorkflow, formatTextOutput } = await import('../cli/commands/describe.js');
    const parseResult = await parseWorkflow(filePath);
    if (parseResult.errors.length > 0) {
      throw new Error(`Parse errors:\n${parseResult.errors.join('\n')}`);
    }
    const output = describeWorkflow(parseResult.ast);
    return { output: formatTextOutput(parseResult.ast, output) };
  },

  diagram: async (args) => {
    const filePath = resolveFile(args, args.cwd as string | undefined);
    const { fileToSVG, fileToASCII } = await import('../diagram/index.js');
    const format = (args.format as string) ?? 'ascii';
    const output = format === 'svg' ? fileToSVG(filePath) : fileToASCII(filePath);
    return { output };
  },

  mermaid: async (args) => {
    const filePath = resolveFile(args, args.cwd as string | undefined);
    const { generateMermaid } = await import('../cli/commands/describe.js');
    const parseResult = await parseWorkflow(filePath);
    if (parseResult.errors.length > 0) {
      throw new Error(`Parse errors:\n${parseResult.errors.join('\n')}`);
    }
    return { output: generateMermaid(parseResult.ast) };
  },

  diff: async (args) => {
    const cwd = args.cwd as string | undefined;
    const fileA = cwd ? path.resolve(cwd, String(args.fileA ?? args.file)) : path.resolve(String(args.fileA ?? args.file));
    const fileB = cwd ? path.resolve(cwd, String(args.fileB)) : path.resolve(String(args.fileB));
    const parseA = await parseWorkflow(fileA);
    const parseB = await parseWorkflow(fileB);
    if (parseA.errors.length > 0) throw new Error(`Parse errors in ${fileA}:\n${parseA.errors.join('\n')}`);
    if (parseB.errors.length > 0) throw new Error(`Parse errors in ${fileB}:\n${parseB.errors.join('\n')}`);
    const diff = WorkflowDiffer.compare(parseA.ast, parseB.ast);
    const format = (args.format as string) ?? 'text';
    return { output: formatDiff(diff, format === 'json' ? 'json' : 'text') };
  },

  context: async (args) => {
    const { buildContext } = await import('../context/index.js');
    const preset = args.preset as 'core' | 'authoring' | 'ops' | 'full' | undefined;
    const result = buildContext(preset ? { preset } : undefined);
    return { output: result.content };
  },

  modify: async (args) => {
    const filePath = resolveFile(args, args.cwd as string | undefined);
    const operation = String(args.operation);
    const params = (args.params as Record<string, unknown>) ?? {};
    const validation = validateModifyParams(operation, params);
    if (!validation.success) {
      throw new Error(validation.error);
    }
    const source = fs.readFileSync(filePath, 'utf-8');
    const parseResult = await parseWorkflow(filePath);
    if (parseResult.errors.length > 0) {
      throw new Error(`Parse errors:\n${parseResult.errors.join('\n')}`);
    }
    const { ast: modifiedAST } = applyModifyOperation(parseResult.ast, operation, params);
    const result = generateInPlace(source, modifiedAST);
    fs.writeFileSync(filePath, result.code, 'utf-8');
    return { files: [filePath] };
  },

  'add-node': async (args) => {
    const filePath = resolveFile(args, args.cwd as string | undefined);
    const source = fs.readFileSync(filePath, 'utf-8');
    const parseResult = await parseWorkflow(filePath);
    if (parseResult.errors.length > 0) {
      throw new Error(`Parse errors:\n${parseResult.errors.join('\n')}`);
    }
    const { ast } = applyModifyOperation(parseResult.ast, 'addNode', {
      nodeId: String(args.nodeId), nodeType: String(args.nodeType),
    });
    const result = generateInPlace(source, ast);
    fs.writeFileSync(filePath, result.code, 'utf-8');
    return { files: [filePath] };
  },

  'remove-node': async (args) => {
    const filePath = resolveFile(args, args.cwd as string | undefined);
    const source = fs.readFileSync(filePath, 'utf-8');
    const parseResult = await parseWorkflow(filePath);
    if (parseResult.errors.length > 0) {
      throw new Error(`Parse errors:\n${parseResult.errors.join('\n')}`);
    }
    const { ast } = applyModifyOperation(parseResult.ast, 'removeNode', { nodeId: String(args.nodeId) });
    const result = generateInPlace(source, ast);
    fs.writeFileSync(filePath, result.code, 'utf-8');
    return { files: [filePath] };
  },

  'add-connection': async (args) => {
    const filePath = resolveFile(args, args.cwd as string | undefined);
    const source = fs.readFileSync(filePath, 'utf-8');
    const parseResult = await parseWorkflow(filePath);
    if (parseResult.errors.length > 0) {
      throw new Error(`Parse errors:\n${parseResult.errors.join('\n')}`);
    }
    const { ast } = applyModifyOperation(parseResult.ast, 'addConnection', {
      from: String(args.from), to: String(args.to),
    });
    const result = generateInPlace(source, ast);
    fs.writeFileSync(filePath, result.code, 'utf-8');
    return { files: [filePath] };
  },

  'remove-connection': async (args) => {
    const filePath = resolveFile(args, args.cwd as string | undefined);
    const source = fs.readFileSync(filePath, 'utf-8');
    const parseResult = await parseWorkflow(filePath);
    if (parseResult.errors.length > 0) {
      throw new Error(`Parse errors:\n${parseResult.errors.join('\n')}`);
    }
    const { ast } = applyModifyOperation(parseResult.ast, 'removeConnection', {
      from: String(args.from), to: String(args.to),
    });
    const result = generateInPlace(source, ast);
    fs.writeFileSync(filePath, result.code, 'utf-8');
    return { files: [filePath] };
  },

  scaffold: async (args) => {
    const filePath = resolveFile(args, args.cwd as string | undefined);
    const workflowName = path.basename(filePath, '.ts');
    const code = generateWorkflowFromTemplate(String(args.template), { workflowName });
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, code, 'utf-8');
    return { files: [filePath] };
  },

  query: async (args) => {
    const filePath = resolveFile(args, args.cwd as string | undefined);
    const parseResult = await parseWorkflow(filePath);
    if (parseResult.errors.length > 0) {
      throw new Error(`Parse errors:\n${parseResult.errors.join('\n')}`);
    }
    const ast = parseResult.ast;
    const queryType = String(args.query);

    let data: Record<string, unknown>;
    switch (queryType) {
      case 'nodes':
        data = { nodes: getNodes(ast).map((n) => ({ id: n.id, type: n.nodeType })) };
        break;
      case 'connections':
        data = { connections: getConnections(ast).map((c) => ({ from: `${c.from.node}.${c.from.port}`, to: `${c.to.node}.${c.to.port}` })) };
        break;
      case 'isolated':
        data = { isolated: findIsolatedNodes(ast) };
        break;
      case 'dead-ends':
        data = { deadEnds: findDeadEnds(ast) };
        break;
      case 'topology':
        data = { order: getTopologicalOrder(ast) };
        break;
      case 'stats':
        data = { nodeCount: countNodes(ast), connectionCount: countConnections(ast), isolatedNodes: findIsolatedNodes(ast), deadEnds: findDeadEnds(ast) };
        break;
      default:
        throw new Error(`Unknown query type: ${queryType}. Valid types: nodes, connections, isolated, dead-ends, topology, stats`);
    }
    return { data };
  },

  run: async (args) => {
    const filePath = resolveFile(args, args.cwd as string | undefined);
    const { executeWorkflowFromFile } = await import('../mcp/workflow-executor.js');
    const params = (args.params as Record<string, unknown>) ?? {};
    const result = await executeWorkflowFromFile(filePath, params, {
      workflowName: args.workflow as string | undefined,
    });
    return { data: result };
  },
};

export async function runCommand(
  name: string,
  args: Record<string, unknown>,
): Promise<CommandResult> {
  const handler = handlers[name];
  if (!handler) {
    throw new Error(`Unknown command: ${name}. Available: ${Object.keys(handlers).join(', ')}`);
  }
  return handler(args);
}

export function getAvailableCommands(): string[] {
  return Object.keys(handlers);
}
