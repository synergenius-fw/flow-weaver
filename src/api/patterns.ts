/**
 * Pure pattern API — no I/O, no console, no filesystem writes.
 *
 * Provides business logic for listing patterns, applying patterns to workflows,
 * and generating node type code. CLI and MCP layers call these functions
 * and handle their own I/O.
 */

import { glob } from 'glob';
import { AnnotationParser } from '../parser.js';
import type { TPatternAST, TNodeTypeAST, TWorkflowAST, TConnectionAST } from '../ast/types.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PatternInfo {
  name: string;
  description?: string;
  inputPorts: Array<{ name: string; description?: string }>;
  outputPorts: Array<{ name: string; description?: string }>;
  nodes: string[];
}

export interface WorkflowFileInfo {
  filePath: string;
  workflows: Array<{
    name: string;
    functionName: string;
    nodeCount: number;
    connectionCount: number;
  }>;
}

export interface ExtractPatternOptions {
  workflowAST: TWorkflowAST;
  nodeTypes: TNodeTypeAST[];
  nodeIds: string[];
  name?: string;
}

export interface ExtractPatternResult {
  patternCode: string;
  patternName: string;
  nodes: string[];
  inputPorts: string[];
  outputPorts: string[];
  internalConnectionCount: number;
}

export interface ApplyPatternOptions {
  /** The pattern AST to apply */
  patternAST: TPatternAST;
  /** Raw text content of the target workflow file */
  targetContent: string;
  /** Node type names already present in the target workflow */
  targetNodeTypes: Set<string>;
  /** Optional prefix for node IDs to avoid conflicts */
  prefix?: string;
}

export interface ApplyPatternResult {
  /** Modified file content with the pattern applied */
  modifiedContent: string;
  /** Number of node instances added */
  nodesAdded: number;
  /** Number of connections added */
  connectionsAdded: number;
  /** Names of node types added (those not already in the target) */
  nodeTypesAdded: string[];
  /** Node type names that conflict (exist in both pattern and target) */
  conflicts: string[];
  /** Human-readable instructions for wiring IN/OUT ports */
  wiringInstructions: string[];
  /** Structured fw_modify_batch operations for wiring IN/OUT ports */
  wiringOperations: Array<{
    operation: 'addConnection';
    params: { from: string; to: string };
  }>;
}

// ─── List Patterns ───────────────────────────────────────────────────────────

/**
 * Parse a file and return metadata for all patterns found.
 *
 * Pure: reads file via AnnotationParser, returns structured data.
 */
export function listPatterns(filePath: string): PatternInfo[] {
  const parser = new AnnotationParser();
  const result = parser.parse(filePath);

  return result.patterns.map((p) => ({
    name: p.name,
    description: p.description,
    inputPorts: Object.keys(p.inputPorts).map((name) => ({
      name: `IN.${name}`,
      description: p.inputPorts[name].description,
    })),
    outputPorts: Object.keys(p.outputPorts).map((name) => ({
      name: `OUT.${name}`,
      description: p.outputPorts[name].description,
    })),
    nodes: p.instances.map((i) => i.id),
  }));
}

// ─── Apply Pattern ───────────────────────────────────────────────────────────

/**
 * Compute the result of applying a pattern to a workflow.
 *
 * Pure: takes AST + content + options, returns the modified content
 * and structured metadata (conflicts, wiring instructions, etc.).
 * Does **not** write to disk.
 */
export function applyPattern(options: ApplyPatternOptions): ApplyPatternResult {
  const { patternAST: pattern, targetContent, targetNodeTypes, prefix } = options;
  const nodePrefix = prefix ? `${prefix}_` : '';

  // ── Conflict detection ──────────────────────────────────────────────
  const conflicts: string[] = [];
  for (const nodeType of pattern.nodeTypes) {
    if (targetNodeTypes.has(nodeType.name)) {
      conflicts.push(nodeType.name);
    }
  }

  // ── Build @node declarations (with inline [position:] when present) ──
  const nodeDeclarations = pattern.instances.map((inst) => {
    const posAttr =
      inst.config?.x !== undefined && inst.config?.y !== undefined
        ? ` [position: ${inst.config.x} ${inst.config.y}]`
        : '';
    return ` * @node ${nodePrefix}${inst.id} ${inst.nodeType}${posAttr}`;
  });

  // ── Build @connect declarations + wiring instructions ───────────────
  const connectDeclarations: string[] = [];
  const wiringInstructions: string[] = [];
  const wiringOperations: ApplyPatternResult['wiringOperations'] = [];

  for (const conn of pattern.connections) {
    const fromNode =
      conn.from.node === 'IN' || conn.from.node === 'OUT'
        ? conn.from.node
        : `${nodePrefix}${conn.from.node}`;
    const toNode =
      conn.to.node === 'IN' || conn.to.node === 'OUT'
        ? conn.to.node
        : `${nodePrefix}${conn.to.node}`;

    if (conn.from.node === 'IN') {
      wiringInstructions.push(
        `Connect to ${nodePrefix}${conn.to.node}.${conn.to.port} from IN.${conn.from.port}`
      );
      wiringOperations.push({
        operation: 'addConnection',
        params: {
          from: `<WIRE_FROM>.${conn.from.port}`,
          to: `${nodePrefix}${conn.to.node}.${conn.to.port}`,
        },
      });
    } else if (conn.to.node === 'OUT') {
      wiringInstructions.push(
        `Connect from ${nodePrefix}${conn.from.node}.${conn.from.port} to OUT.${conn.to.port}`
      );
      wiringOperations.push({
        operation: 'addConnection',
        params: {
          from: `${nodePrefix}${conn.from.node}.${conn.from.port}`,
          to: `<WIRE_TO>.${conn.to.port}`,
        },
      });
    } else {
      connectDeclarations.push(
        ` * @connect ${fromNode}.${conn.from.port} -> ${toNode}.${conn.to.port}`
      );
    }
  }

  // ── Generate node type functions (only non-conflicting) ─────────────
  const nodeTypesAdded: string[] = [];
  const nodeTypeFunctions: string[] = [];
  for (const nodeType of pattern.nodeTypes) {
    if (!targetNodeTypes.has(nodeType.name)) {
      nodeTypesAdded.push(nodeType.name);
      nodeTypeFunctions.push(generateNodeTypeCode(nodeType));
    }
  }

  // ── Build annotation block ──────────────────────────────────────────
  const annotationLines = [
    `// --- Pattern: ${pattern.name} ${prefix ? `(prefix: ${prefix})` : ''} ---`,
    ...nodeDeclarations,
    ...connectDeclarations,
  ];

  // ── Insert into target content ──────────────────────────────────────
  const workflowMatch = targetContent.match(/\/\*\*[\s\S]*?@flowWeaver\s+workflow[\s\S]*?\*\//);
  if (!workflowMatch) {
    throw new Error('No @flowWeaver workflow found in target file');
  }

  const insertPosition = workflowMatch.index! + workflowMatch[0].lastIndexOf('*/');
  const newAnnotations = annotationLines.join('\n') + '\n ';

  let modifiedContent =
    targetContent.slice(0, insertPosition) + newAnnotations + targetContent.slice(insertPosition);

  // Strip @autoConnect when pattern adds explicit connections — the explicit @connect
  // annotations would conflict with autoConnect (parser skips auto-wiring when connections exist)
  if (connectDeclarations.length > 0 && modifiedContent.match(/@autoConnect\b/)) {
    modifiedContent = modifiedContent.replace(/^\s*\*\s*@autoConnect\s*\n/m, '');
    wiringInstructions.push('Note: @autoConnect was removed because the pattern adds explicit connections');
  }

  // Append node type functions at end (if not conflicting)
  if (nodeTypeFunctions.length > 0) {
    modifiedContent += '\n\n' + nodeTypeFunctions.join('\n\n');
  }

  return {
    modifiedContent,
    nodesAdded: pattern.instances.length,
    connectionsAdded: connectDeclarations.length,
    nodeTypesAdded,
    conflicts,
    wiringInstructions,
    wiringOperations,
  };
}

// ─── Generate Node Type Code ─────────────────────────────────────────────────

/**
 * Generate a TypeScript stub for a node type.
 *
 * Produces a JSDoc-annotated function with the correct ports.
 */
export function generateNodeTypeCode(nodeType: TNodeTypeAST): string {
  // If original source text is available, use it directly
  if (nodeType.functionText) {
    return nodeType.functionText;
  }

  const lines: string[] = [];
  lines.push('/**');
  lines.push(' * @flowWeaver nodeType');
  if (nodeType.label) {
    lines.push(` * @label ${nodeType.label}`);
  }

  for (const [name, port] of Object.entries(nodeType.inputs)) {
    if (name === 'execute') continue;
    lines.push(` * @input ${name}${port.label ? ` - ${port.label}` : ''}`);
  }

  for (const [name, port] of Object.entries(nodeType.outputs)) {
    if (name === 'onSuccess' || name === 'onFailure') continue;
    lines.push(` * @output ${name}${port.label ? ` - ${port.label}` : ''}`);
  }

  lines.push(' */');

  const inputParams = Object.entries(nodeType.inputs)
    .filter(([name]) => name !== 'execute')
    .map(([name, port]) => `${name}: ${port.tsType || 'any'}`);

  const outputFields = Object.entries(nodeType.outputs)
    .filter(([name]) => name !== 'onSuccess' && name !== 'onFailure')
    .map(([name, port]) => `${name}: ${port.tsType || 'any'}`);

  lines.push(
    `function ${nodeType.name}(execute: boolean${inputParams.length > 0 ? ', ' + inputParams.join(', ') : ''}) {`
  );
  lines.push(
    `  if (!execute) return { onSuccess: false, onFailure: false${outputFields.map((f) => `, ${f.split(':')[0]}: null`).join('')} };`
  );
  lines.push(
    `  return { onSuccess: true, onFailure: false${outputFields.map((f) => `, ${f.split(':')[0]}: null`).join('')} };`
  );
  lines.push('}');

  return lines.join('\n');
}

// ─── Find Workflows ──────────────────────────────────────────────────────────

/**
 * Scan a directory for files containing @flowWeaver workflow annotations
 * and return structured metadata for each.
 *
 * Pure: reads files via AnnotationParser, returns structured data.
 * Skips files that fail to parse.
 */
export async function findWorkflows(
  directory: string,
  pattern?: string
): Promise<WorkflowFileInfo[]> {
  const files = await glob(pattern ?? '**/*.ts', { cwd: directory, absolute: true });
  const parser = new AnnotationParser();
  const results: WorkflowFileInfo[] = [];

  for (const file of files) {
    try {
      const parseResult = parser.parse(file);
      if (parseResult.workflows.length > 0) {
        results.push({
          filePath: file,
          workflows: parseResult.workflows.map((w) => ({
            name: w.name,
            functionName: w.functionName,
            nodeCount: w.instances.length,
            connectionCount: w.connections.length,
          })),
        });
      }
    } catch {
      // Skip files that fail to parse
    }
  }

  return results;
}

// ─── Extract Pattern ─────────────────────────────────────────────────────────

/**
 * Extract a reusable pattern from selected nodes in a workflow.
 *
 * Pure: takes AST + node IDs, returns pattern code and metadata.
 * Does **not** write to disk.
 */
export function extractPattern(options: ExtractPatternOptions): ExtractPatternResult {
  const { workflowAST: workflow, nodeTypes, nodeIds, name } = options;

  // Validate nodes exist
  const instanceMap = new Map(workflow.instances.map((i) => [i.id, i]));
  const missingNodes = nodeIds.filter((id) => !instanceMap.has(id));
  if (missingNodes.length > 0) {
    throw new Error(`Nodes not found: ${missingNodes.join(', ')}`);
  }

  // Get instances to extract
  const extractedInstances = nodeIds.map((id) => instanceMap.get(id)!);

  // Classify connections: internal, input boundary (IN), output boundary (OUT)
  const nodeIdSet = new Set(nodeIds);
  const internalConnections: TConnectionAST[] = [];
  const boundaryConnections: { type: 'IN' | 'OUT'; conn: TConnectionAST }[] = [];

  for (const conn of workflow.connections) {
    const fromInSet = nodeIdSet.has(conn.from.node);
    const toInSet = nodeIdSet.has(conn.to.node);

    if (fromInSet && toInSet) {
      internalConnections.push(conn);
    } else if (fromInSet && !toInSet) {
      boundaryConnections.push({ type: 'OUT', conn });
    } else if (!fromInSet && toInSet) {
      boundaryConnections.push({ type: 'IN', conn });
    }
  }

  // Generate pattern name
  const patternName = name || `extracted_${nodeIds.join('_')}`;

  // Collect node types used by extracted instances
  const usedNodeTypeNames = new Set(extractedInstances.map((i) => i.nodeType));
  const usedNodeTypes = nodeTypes.filter((nt) => usedNodeTypeNames.has(nt.name));

  // Generate pattern code
  const lines: string[] = [];
  lines.push('/**');
  lines.push(` * @flowWeaver pattern`);
  lines.push(` * @name ${patternName}`);

  // Node declarations (with inline [position:] when present)
  for (const inst of extractedInstances) {
    const posAttr =
      inst.config?.x !== undefined && inst.config?.y !== undefined
        ? ` [position: ${inst.config.x} ${inst.config.y}]`
        : '';
    lines.push(` * @node ${inst.id} ${inst.nodeType}${posAttr}`);
  }

  // Internal connections
  for (const conn of internalConnections) {
    lines.push(
      ` * @connect ${conn.from.node}.${conn.from.port} -> ${conn.to.node}.${conn.to.port}`
    );
  }

  // Boundary connections as IN/OUT
  const inputPorts: string[] = [];
  const outputPorts: string[] = [];

  for (const { type, conn } of boundaryConnections) {
    if (type === 'IN') {
      const portName = conn.from.port;
      inputPorts.push(portName);
      lines.push(` * @connect IN.${portName} -> ${conn.to.node}.${conn.to.port}`);
    } else {
      const portName = conn.to.port;
      outputPorts.push(portName);
      lines.push(` * @connect ${conn.from.node}.${conn.from.port} -> OUT.${portName}`);
    }
  }

  // Port declarations
  for (const port of [...new Set(inputPorts)]) {
    lines.push(` * @port IN.${port}`);
  }
  for (const port of [...new Set(outputPorts)]) {
    lines.push(` * @port OUT.${port}`);
  }

  lines.push(' */');
  lines.push('function patternPlaceholder() {}');

  // Add node type functions
  for (const nodeType of usedNodeTypes) {
    lines.push('');
    lines.push(generateNodeTypeCode(nodeType));
  }

  const patternCode = lines.join('\n');

  return {
    patternCode,
    patternName,
    nodes: nodeIds,
    inputPorts: [...new Set(inputPorts)],
    outputPorts: [...new Set(outputPorts)],
    internalConnectionCount: internalConnections.length,
  };
}
