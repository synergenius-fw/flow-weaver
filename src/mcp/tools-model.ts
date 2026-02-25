import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import { parseWorkflow, validateWorkflow } from '../api/index.js';
import { generateFunctionSignature } from '../annotation-generator.js';
import { makeToolResult, makeErrorResult } from './response-utils.js';
import type { TNodeTypeAST } from '../ast/types.js';

const stepSchema = z.object({
  name: z.string().describe('Function name for this node'),
  description: z.string().optional().describe('Brief description of what this node does'),
  inputs: z.record(z.string()).describe('Input ports as { portName: dataType } (e.g. { email: "STRING" })'),
  outputs: z.record(z.string()).describe('Output ports as { portName: dataType }'),
});

/**
 * Find a `declare function <name>(...): ...;` declaration in source text,
 * handling multiline signatures. Returns the full matched text and its
 * leading indentation, or null if not found.
 */
function findDeclareFunction(source: string, functionName: string): { match: string; indent: string } | null {
  const lines = source.split('\n');
  const startPattern = new RegExp(`^(\\s*)declare\\s+function\\s+${escapeRegex(functionName)}\\s*\\(`);

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(startPattern);
    if (!m) continue;

    const indent = m[1] || '';
    // Accumulate lines until we find one ending with ;
    let accumulated = lines[i];
    let j = i;
    while (!accumulated.trimEnd().endsWith(';') && j < lines.length - 1) {
      j++;
      accumulated += '\n' + lines[j];
    }
    return { match: accumulated, indent };
  }
  return null;
}

export function registerModelTools(mcp: McpServer): void {
  mcp.tool(
    'fw_create_model',
    'Create a new stub workflow model from a structured description. ' +
      'Generates a TypeScript file with declare function stubs and workflow annotations. ' +
      'The model can be validated structurally before any node is implemented.',
    {
      name: z.string().describe('Workflow name (used as export name)'),
      description: z.string().optional().describe('Workflow description'),
      steps: z.array(stepSchema).min(1).describe('Node definitions in execution order'),
      flow: z
        .string()
        .describe('Execution path, e.g. "Start -> validateEmail -> checkUserExists -> Exit"'),
      filePath: z.string().describe('Output file path'),
    },
    async (args: {
      name: string;
      description?: string;
      steps: Array<{
        name: string;
        description?: string;
        inputs: Record<string, string>;
        outputs: Record<string, string>;
      }>;
      flow: string;
      filePath: string;
    }) => {
      try {
        const outputPath = path.resolve(args.filePath);

        const lines: string[] = [];

        // Generate declare function stubs
        for (const step of args.steps) {
          lines.push('/** @flowWeaver node */');

          const params = Object.entries(step.inputs)
            .map(([name, type]) => `${name}: ${mapTypeToTS(type)}`)
            .join(', ');

          const outputEntries = Object.entries(step.outputs);
          const returnType =
            outputEntries.length === 1
              ? mapTypeToTS(outputEntries[0][1])
              : `{ ${outputEntries.map(([name, type]) => `${name}: ${mapTypeToTS(type)}`).join('; ')} }`;

          lines.push(`declare function ${step.name}(${params}): ${returnType};`);
          lines.push('');
        }

        // Parse the flow string — use full function names as instance IDs
        const flowSteps = args.flow
          .split('->')
          .map((s) => s.trim())
          .filter(Boolean);

        // Build @node annotations using full name as both ID and type
        const nodeAnnotations = args.steps.map((step) => `@node ${step.name} ${step.name}`);

        // @path uses the same full names directly from the flow string
        const pathAnnotation = `@path ${flowSteps.join(' -> ')}`;

        // Generate workflow annotation
        const jsdocLines = ['/**'];
        if (args.description) {
          jsdocLines.push(` * ${args.description}`);
          jsdocLines.push(' *');
        }
        jsdocLines.push(' * @flowWeaver workflow @autoConnect');
        for (const nodeAnn of nodeAnnotations) {
          jsdocLines.push(` * ${nodeAnn}`);
        }
        jsdocLines.push(` * ${pathAnnotation}`);
        jsdocLines.push(' */');
        jsdocLines.push(`export const ${args.name} = 'flowWeaver:draft';`);

        lines.push(...jsdocLines);
        lines.push('');

        const content = lines.join('\n');

        const dir = path.dirname(outputPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        fs.writeFileSync(outputPath, content, 'utf8');

        return makeToolResult({
          filePath: outputPath,
          workflowName: args.name,
          stubCount: args.steps.length,
          nodes: args.steps.map((s) => s.name),
        });
      } catch (err) {
        return makeErrorResult(
          'CREATE_MODEL_ERROR',
          `fw_create_model failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  );

  mcp.tool(
    'fw_workflow_status',
    'Report implementation progress for a workflow — which nodes are stubs, ' +
      'which are implemented, and whether the graph structure is valid.',
    {
      filePath: z.string().describe('Path to the workflow file'),
      workflowName: z.string().optional().describe('Specific workflow name if file has multiple'),
    },
    async (args: { filePath: string; workflowName?: string }) => {
      try {
        const filePath = path.resolve(args.filePath);
        const parseResult = await parseWorkflow(filePath, { workflowName: args.workflowName });

        if (parseResult.errors.length > 0) {
          return makeErrorResult('PARSE_ERROR', `Parse errors:\n${parseResult.errors.join('\n')}`);
        }

        const ast = parseResult.ast;

        const instanceTypeMap = new Map<string, TNodeTypeAST>();
        for (const nt of ast.nodeTypes) {
          instanceTypeMap.set(nt.name, nt);
          if (nt.functionName !== nt.name) {
            instanceTypeMap.set(nt.functionName, nt);
          }
        }

        const nodes: Array<{
          name: string;
          status: 'stub' | 'implemented';
          inputs: Record<string, string>;
          outputs: Record<string, string>;
        }> = [];
        const seen = new Set<string>();

        for (const instance of ast.instances) {
          const nt = instanceTypeMap.get(instance.nodeType);
          if (!nt || seen.has(nt.functionName)) continue;
          seen.add(nt.functionName);

          const inputs: Record<string, string> = {};
          const outputs: Record<string, string> = {};

          for (const [name, port] of Object.entries(nt.inputs)) {
            if (name === 'execute') continue;
            inputs[name] = port.dataType;
          }
          for (const [name, port] of Object.entries(nt.outputs)) {
            if (name === 'onSuccess' || name === 'onFailure') continue;
            outputs[name] = port.dataType;
          }

          nodes.push({
            name: nt.functionName,
            status: nt.variant === 'STUB' ? 'stub' : 'implemented',
            inputs,
            outputs,
          });
        }

        const implemented = nodes.filter((n) => n.status === 'implemented').length;
        const total = nodes.length;

        // Draft validation for structural issues
        const validation = validateWorkflow(ast, { mode: 'draft' });
        const structuralErrors = validation.errors
          .filter((e) => e.code !== 'STUB_NODE')
          .map((e) => ({ message: e.message, code: e.code, node: e.node }));

        return makeToolResult({
          workflowName: ast.name,
          implemented,
          total,
          percentage: total > 0 ? Math.round((implemented / total) * 100) : 100,
          nodes,
          structurallyValid: structuralErrors.length === 0,
          structuralErrors,
        });
      } catch (err) {
        return makeErrorResult(
          'STATUS_ERROR',
          `fw_workflow_status failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  );

  mcp.tool(
    'fw_implement_node',
    'Replace a stub node (declare function) with a real function skeleton, ' +
      'or write a provided implementation directly. Preserves existing JSDoc annotations.',
    {
      filePath: z.string().describe('Path to the workflow file'),
      nodeName: z.string().describe('Function name of the stub node to implement'),
      implementation: z
        .string()
        .optional()
        .describe('Full function body to write. If omitted, generates a skeleton.'),
      workflowName: z.string().optional().describe('Specific workflow name'),
    },
    async (args: {
      filePath: string;
      nodeName: string;
      implementation?: string;
      workflowName?: string;
    }) => {
      try {
        const filePath = path.resolve(args.filePath);

        if (!fs.existsSync(filePath)) {
          return makeErrorResult('FILE_NOT_FOUND', `File not found: ${args.filePath}`);
        }

        const parseResult = await parseWorkflow(filePath, { workflowName: args.workflowName });

        if (parseResult.errors.length > 0) {
          return makeErrorResult('PARSE_ERROR', `Parse errors:\n${parseResult.errors.join('\n')}`);
        }

        const ast = parseResult.ast;

        const stubNt = ast.nodeTypes.find(
          (nt: TNodeTypeAST) =>
            nt.variant === 'STUB' && (nt.functionName === args.nodeName || nt.name === args.nodeName),
        );

        if (!stubNt) {
          const existing = ast.nodeTypes.find(
            (nt: TNodeTypeAST) => nt.functionName === args.nodeName || nt.name === args.nodeName,
          );
          if (existing) {
            return makeErrorResult('ALREADY_IMPLEMENTED', `Node "${args.nodeName}" is already implemented.`);
          }
          const stubs = ast.nodeTypes
            .filter((nt: TNodeTypeAST) => nt.variant === 'STUB')
            .map((nt: TNodeTypeAST) => nt.functionName);
          return makeErrorResult(
            'NODE_NOT_FOUND',
            `Stub "${args.nodeName}" not found. Available stubs: ${stubs.join(', ') || 'none'}`,
          );
        }

        const source = fs.readFileSync(filePath, 'utf8');
        const found = findDeclareFunction(source, stubNt.functionName);

        if (!found) {
          return makeErrorResult(
            'SOURCE_MISMATCH',
            `Could not find "declare function ${stubNt.functionName}" in source file.`,
          );
        }

        let replacement: string;

        if (args.implementation) {
          replacement = args.implementation
            .split('\n')
            .map((line) => found.indent + line)
            .join('\n');
        } else {
          const implementedType: TNodeTypeAST = { ...stubNt, variant: 'FUNCTION' };
          const signatureLines = generateFunctionSignature(implementedType);
          replacement = signatureLines.map((line: string) => found.indent + line).join('\n');
        }

        const updated = source.replace(found.match, replacement);
        fs.writeFileSync(filePath, updated, 'utf8');

        return makeToolResult({
          nodeName: stubNt.functionName,
          filePath,
          action: args.implementation ? 'implemented' : 'scaffolded',
        });
      } catch (err) {
        return makeErrorResult(
          'IMPLEMENT_ERROR',
          `fw_implement_node failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  );
}

function mapTypeToTS(dataType: string): string {
  const upper = dataType.toUpperCase();
  switch (upper) {
    case 'STRING':
      return 'string';
    case 'NUMBER':
      return 'number';
    case 'BOOLEAN':
      return 'boolean';
    case 'OBJECT':
      return 'Record<string, unknown>';
    case 'ARRAY':
      return 'unknown[]';
    default:
      return 'unknown';
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
