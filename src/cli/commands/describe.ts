/* eslint-disable no-console */
/**
 * Describe command - outputs workflow structure in LLM-friendly formats
 */

import * as fs from 'fs';
import * as path from 'path';
import { parseWorkflow, generateInPlace } from '../../api/index.js';
import { validator } from '../../validator.js';
import { getNode, getIncomingConnections, getOutgoingConnections } from '../../api/query.js';
import { logger } from '../utils/logger.js';
import { getErrorMessage } from '../../utils/error-utils.js';
import type { TWorkflowAST, TNodeInstanceAST, TNodeTypeAST } from '../../ast/types.js';
import { buildDiagramGraph } from '../../diagram/geometry.js';
import { renderASCII, renderASCIICompact } from '../../diagram/ascii-renderer.js';

export interface DescribeOptions {
  format?: 'json' | 'text' | 'mermaid' | 'paths' | 'ascii' | 'ascii-compact';
  node?: string;
  workflowName?: string;
  compile?: boolean;
}

export interface NodeInfo {
  id: string;
  type: string;
  inputs: string[];
  outputs: string[];
}

export interface ConnectionInfo {
  from: string;
  to: string;
}

export interface DescribeOutput {
  name: string;
  description: string | null;
  nodes: NodeInfo[];
  connections: ConnectionInfo[];
  graph: string;
  validation: {
    valid: boolean;
    errors: string[];
    warnings: string[];
  };
}

export interface FocusedNodeOutput {
  focusNode: string;
  node: NodeInfo;
  incoming: ConnectionInfo[];
  outgoing: ConnectionInfo[];
  validation: {
    valid: boolean;
    errors: string[];
    warnings: string[];
  };
}

export function buildNodeInfo(
  instance: TNodeInstanceAST,
  nodeType: TNodeTypeAST | undefined
): NodeInfo {
  return {
    id: instance.id,
    type: instance.nodeType,
    inputs: nodeType ? Object.keys(nodeType.inputs) : [],
    outputs: nodeType ? Object.keys(nodeType.outputs) : [],
  };
}

/**
 * Build adjacency structures from workflow connections.
 * Shared by buildGraph and enumeratePaths.
 */
function buildAdjacency(ast: TWorkflowAST): {
  fromStart: string[];
  toExit: Set<string>;
  edges: Map<string, string[]>;
} {
  const fromStart: string[] = [];
  const toExit = new Set<string>();
  const edges = new Map<string, string[]>();

  ast.connections.forEach((conn) => {
    if (conn.from.node === 'Start') {
      if (!fromStart.includes(conn.to.node)) {
        fromStart.push(conn.to.node);
      }
    } else if (conn.to.node === 'Exit') {
      toExit.add(conn.from.node);
    } else {
      const targets = edges.get(conn.from.node) || [];
      if (!targets.includes(conn.to.node)) {
        targets.push(conn.to.node);
      }
      edges.set(conn.from.node, targets);
    }
  });

  return { fromStart, toExit, edges };
}

/**
 * Enumerate all Start-to-Exit paths via DFS.
 * Returns an array of path arrays (each path is string[] including Start and Exit).
 */
export function enumeratePaths(ast: TWorkflowAST): string[][] {
  const { fromStart, toExit, edges } = buildAdjacency(ast);
  const paths: string[][] = [];

  function dfs(current: string, path: string[], visited: Set<string>): void {
    if (toExit.has(current)) {
      paths.push([...path, 'Exit']);
    }
    const targets = edges.get(current) || [];
    for (const next of targets) {
      if (!visited.has(next)) {
        visited.add(next);
        path.push(next);
        dfs(next, path, visited);
        path.pop();
        visited.delete(next);
      }
    }
  }

  fromStart.forEach((startNode) => {
    const visited = new Set<string>([startNode]);
    dfs(startNode, ['Start', startNode], visited);
  });

  return paths;
}

export function buildGraph(ast: TWorkflowAST): string {
  const { fromStart, toExit, edges } = buildAdjacency(ast);
  const lines: string[] = [];

  function dfs(current: string, path: string[], visited: Set<string>): void {
    if (toExit.has(current)) {
      lines.push([...path, 'Exit'].join(' -> '));
    }
    const targets = edges.get(current) || [];
    for (const next of targets) {
      if (!visited.has(next)) {
        visited.add(next);
        path.push(next);
        dfs(next, path, visited);
        path.pop();
        visited.delete(next);
      }
    }
    // Dead-end node (no outgoing edges, doesn't reach Exit)
    if (targets.length === 0 && !toExit.has(current)) {
      lines.push(path.join(' -> '));
    }
  }

  fromStart.forEach((startNode) => {
    const visited = new Set<string>([startNode]);
    dfs(startNode, ['Start', startNode], visited);
  });

  return lines.join('\n');
}

export function formatPaths(ast: TWorkflowAST): string {
  const paths = enumeratePaths(ast);
  if (paths.length === 0) return '(no complete Start-to-Exit paths found)';
  return paths.map((p) => p.join(' -> ')).join('\n');
}

export function generateMermaid(ast: TWorkflowAST): string {
  const lines: string[] = ['graph LR'];

  // Add nodes
  ast.instances.forEach((instance) => {
    lines.push(`  ${instance.id}[${instance.id}: ${instance.nodeType}]`);
  });

  // Add connections (deduplicate edges between same node pairs)
  const seenEdges = new Set<string>();
  ast.connections.forEach((conn) => {
    const edgeKey = `${conn.from.node}->${conn.to.node}`;
    if (!seenEdges.has(edgeKey)) {
      seenEdges.add(edgeKey);
      const from = conn.from.node === 'Start' ? 'Start((Start))' : conn.from.node;
      const to = conn.to.node === 'Exit' ? 'Exit((Exit))' : conn.to.node;
      lines.push(`  ${from} --> ${to}`);
    }
  });

  return lines.join('\n');
}

/**
 * Pure function to describe a workflow - no I/O, returns data
 */
export function describeWorkflow(
  ast: TWorkflowAST,
  options: { node?: string } = {}
): DescribeOutput | FocusedNodeOutput {
  const { node: focusNodeId } = options;

  // Validate
  const validation = validator.validate(ast);
  const validationOutput = {
    valid: validation.valid,
    errors: validation.errors.map((e) => e.message),
    warnings: validation.warnings.map((w) => w.message),
  };

  // Build node type lookup
  const nodeTypeMap = new Map<string, TNodeTypeAST>();
  ast.nodeTypes.forEach((nt) => nodeTypeMap.set(nt.functionName, nt));

  // Focus on specific node?
  if (focusNodeId) {
    const nodeInstance = getNode(ast, focusNodeId);
    if (!nodeInstance) {
      throw new Error(`Node not found: ${focusNodeId}`);
    }

    const nodeType = nodeTypeMap.get(nodeInstance.nodeType);
    const incoming = getIncomingConnections(ast, focusNodeId).map((c) => ({
      from: `${c.from.node}.${c.from.port}`,
      to: `${c.to.node}.${c.to.port}`,
    }));
    const outgoing = getOutgoingConnections(ast, focusNodeId).map((c) => ({
      from: `${c.from.node}.${c.from.port}`,
      to: `${c.to.node}.${c.to.port}`,
    }));

    return {
      focusNode: focusNodeId,
      node: buildNodeInfo(nodeInstance, nodeType),
      incoming,
      outgoing,
      validation: validationOutput,
    };
  }

  // Build full output
  const nodes: NodeInfo[] = ast.instances.map((instance) => {
    const nodeType = nodeTypeMap.get(instance.nodeType);
    return buildNodeInfo(instance, nodeType);
  });

  const connections: ConnectionInfo[] = ast.connections.map((c) => ({
    from: `${c.from.node}.${c.from.port}`,
    to: `${c.to.node}.${c.to.port}`,
  }));

  return {
    name: ast.functionName,
    description: ast.description || null,
    nodes,
    connections,
    graph: buildGraph(ast),
    validation: validationOutput,
  };
}

/**
 * Generate structured human-readable text output
 */
export function formatTextOutput(
  ast: TWorkflowAST,
  output: DescribeOutput | FocusedNodeOutput
): string {
  if ('focusNode' in output) {
    const focused = output as FocusedNodeOutput;
    const lines: string[] = [];
    lines.push(`Node: ${focused.node.id} [${focused.node.type}]`);
    lines.push(`  Inputs:  ${focused.node.inputs.join(', ') || '(none)'}`);
    lines.push(`  Outputs: ${focused.node.outputs.join(', ') || '(none)'}`);
    if (focused.incoming.length > 0) {
      lines.push('');
      lines.push('Incoming:');
      focused.incoming.forEach((c) => lines.push(`  ${c.from} -> ${c.to}`));
    }
    if (focused.outgoing.length > 0) {
      lines.push('');
      lines.push('Outgoing:');
      focused.outgoing.forEach((c) => lines.push(`  ${c.from} -> ${c.to}`));
    }
    return lines.join('\n');
  }

  const desc = output as DescribeOutput;
  const lines: string[] = [];

  lines.push(`Workflow: ${desc.name}`);
  if (desc.description) {
    lines.push(`  ${desc.description}`);
  }

  // Build node type lookup for port info
  const nodeTypeMap = new Map<string, TNodeTypeAST>();
  ast.nodeTypes.forEach((nt) => nodeTypeMap.set(nt.functionName, nt));

  lines.push('');
  lines.push(`Nodes (${desc.nodes.length}):`);

  // Calculate column widths for alignment
  const maxIdLen = Math.max(...desc.nodes.map((n) => n.id.length), 2);
  const maxTypeLen = Math.max(...desc.nodes.map((n) => n.type.length), 2);

  desc.nodes.forEach((node) => {
    const id = node.id.padEnd(maxIdLen);
    const type = `[${node.type}]`.padEnd(maxTypeLen + 2);

    // Check if node type has scoped ports
    const nodeType = nodeTypeMap.get(node.type);
    const isExpression = nodeType?.expression === true;
    const scopeNames = nodeType?.scopes ?? (nodeType?.scope ? [nodeType.scope] : []);

    // Filter ports for expression nodes: suppress STEP/control flow ports
    const filterPorts = (ports: string[], direction: 'input' | 'output'): string[] => {
      if (!isExpression || !nodeType) return ports;
      return ports.filter((portName) => {
        if (portName === 'execute' || portName === 'onSuccess' || portName === 'onFailure') {
          return false;
        }
        const portDef =
          direction === 'input' ? nodeType.inputs[portName] : nodeType.outputs[portName];
        return !(portDef?.isControlFlow || portDef?.dataType === 'STEP');
      });
    };

    if (scopeNames.length > 0 && nodeType) {
      // Separate regular ports from scoped ports
      const regularInputs: string[] = [];
      const regularOutputs: string[] = [];
      const scopedPorts: Record<
        string,
        { sends: string[]; receives: string[]; children: string[] }
      > = {};

      scopeNames.forEach((s) => {
        scopedPorts[s] = { sends: [], receives: [], children: [] };
      });

      Object.entries(nodeType.inputs).forEach(([name, port]) => {
        if (port.scope && scopedPorts[port.scope]) {
          scopedPorts[port.scope].receives.push(name + (port.isControlFlow ? ' (STEP)' : ''));
        } else {
          regularInputs.push(name);
        }
      });

      Object.entries(nodeType.outputs).forEach(([name, port]) => {
        if (port.scope && scopedPorts[port.scope]) {
          scopedPorts[port.scope].sends.push(name + (port.isControlFlow ? ' (STEP)' : ''));
        } else {
          regularOutputs.push(name);
        }
      });

      // Find children for each scope
      if (ast.scopes) {
        for (const [scopeKey, childIds] of Object.entries(ast.scopes)) {
          // scopeKey format is typically "nodeId.scopeName"
          const dotIdx = scopeKey.indexOf('.');
          const scopeName = dotIdx >= 0 ? scopeKey.substring(dotIdx + 1) : scopeKey;
          if (scopedPorts[scopeName]) {
            scopedPorts[scopeName].children.push(...childIds);
          }
        }
      }

      const ins = regularInputs.length > 0 ? `IN: ${regularInputs.join(', ')}` : '';
      const outs = regularOutputs.length > 0 ? `OUT: ${regularOutputs.join(', ')}` : '';
      const ports = [ins, outs].filter(Boolean).join('  ');
      lines.push(`  ${id}  ${type}  ${ports}`);

      for (const [scopeName, info] of Object.entries(scopedPorts)) {
        lines.push(`    Scope "${scopeName}":`);
        if (info.sends.length > 0) {
          lines.push(`      Sends to children: ${info.sends.join(', ')}`);
        }
        if (info.receives.length > 0) {
          lines.push(`      Receives from children: ${info.receives.join(', ')}`);
        }
        if (info.children.length > 0) {
          lines.push(`      Children: ${info.children.join(', ')}`);
        }
      }
    } else {
      const filteredInputs = filterPorts(node.inputs, 'input');
      const filteredOutputs = filterPorts(node.outputs, 'output');
      const ins = filteredInputs.length > 0 ? `IN: ${filteredInputs.join(', ')}` : '';
      const outs = filteredOutputs.length > 0 ? `OUT: ${filteredOutputs.join(', ')}` : '';
      const ports = [ins, outs].filter(Boolean).join('  ');
      lines.push(`  ${id}  ${type}  ${ports}`);
    }
  });

  if (desc.graph) {
    lines.push('');
    const paths = enumeratePaths(ast);
    if (paths.length > 1) {
      // Multiple paths: label each one
      lines.push(`Paths (${paths.length}):`);
      paths.forEach((p, i) => {
        lines.push(`  Path ${i + 1}: ${p.join(' -> ')}`);
      });
    } else {
      lines.push('Flow:');
      desc.graph.split('\n').forEach((flowLine) => {
        lines.push(`  ${flowLine}`);
      });
    }
  }

  lines.push('');
  lines.push(
    `Validation: ${desc.validation.errors.length} errors, ${desc.validation.warnings.length} warnings`
  );

  return lines.join('\n');
}

/**
 * Format the describe output based on format option
 */
export function formatDescribeOutput(
  ast: TWorkflowAST,
  output: DescribeOutput | FocusedNodeOutput,
  format: 'json' | 'text' | 'mermaid' | 'paths' | 'ascii' | 'ascii-compact'
): string {
  switch (format) {
    case 'text':
      return formatTextOutput(ast, output);
    case 'mermaid':
      return generateMermaid(ast);
    case 'paths':
      return formatPaths(ast);
    case 'ascii':
      return renderASCII(buildDiagramGraph(ast));
    case 'ascii-compact':
      return renderASCIICompact(buildDiagramGraph(ast));
    case 'json':
    default:
      return JSON.stringify(output, null, 2);
  }
}

export async function describeCommand(input: string, options: DescribeOptions = {}): Promise<void> {
  const { format = 'json', node: focusNodeId, workflowName, compile = false } = options;
  const filePath = path.resolve(input);

  if (!fs.existsSync(filePath)) {
    logger.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  try {
    // Parse the workflow
    const parseResult = await parseWorkflow(filePath, { workflowName });

    if (parseResult.errors.length > 0) {
      logger.error(`Parse errors:`);
      parseResult.errors.forEach((err) => logger.error(`  ${err}`));
      process.exit(1);
    }

    const ast = parseResult.ast;

    // Only update runtime markers when explicitly requested via --compile
    // (describe is a read-only inspection command by default)
    if (compile) {
      const sourceCode = fs.readFileSync(filePath, 'utf8');
      const generated = generateInPlace(sourceCode, ast, { production: false });
      if (generated.hasChanges) {
        fs.writeFileSync(filePath, generated.code, 'utf8');
        logger.info(`Updated runtime markers in ${path.basename(filePath)}`);
      }
    }

    // Use pure function to build output
    const output = describeWorkflow(ast, { node: focusNodeId });

    // Format and print
    console.log(formatDescribeOutput(ast, output, format));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Node not found:')) {
      logger.error(error.message);
      process.exit(1);
    }
    logger.error(`Failed to describe workflow: ${getErrorMessage(error)}`);
    process.exit(1);
  }
}
