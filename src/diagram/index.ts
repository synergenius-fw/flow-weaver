import type { TWorkflowAST } from '../ast/types';
import { parser } from '../parser';
import { buildDiagramGraph } from './geometry';
import { renderSVG } from './renderer';
import { wrapSVGInHTML } from './html-viewer';
import { renderASCII, renderASCIICompact, renderText } from './ascii-renderer';
import type { DiagramOptions } from './types';

export type { DiagramOptions } from './types';
export { renderASCII, renderASCIICompact, renderText } from './ascii-renderer';

/**
 * Render a workflow AST to an SVG string.
 */
export function workflowToSVG(ast: TWorkflowAST, options: DiagramOptions = {}): string {
  const graph = buildDiagramGraph(ast, options);
  return renderSVG(graph, options);
}

/**
 * Parse TypeScript source code and render the first (or named) workflow to SVG.
 */
export function sourceToSVG(code: string, options: DiagramOptions = {}): string {
  const result = parser.parseFromString(code);
  return pickAndRender(result.workflows, options);
}

/**
 * Parse a workflow file (resolves imports) and render the first (or named) workflow to SVG.
 */
export function fileToSVG(filePath: string, options: DiagramOptions = {}): string {
  const result = parser.parse(filePath);
  return pickAndRender(result.workflows, options);
}

/**
 * Render a workflow AST to a self-contained interactive HTML page.
 */
export function workflowToHTML(ast: TWorkflowAST, options: DiagramOptions = {}): string {
  const svg = workflowToSVG(ast, options);
  return wrapSVGInHTML(svg, { title: options.workflowName ?? ast.name, theme: options.theme, nodeSources: buildNodeSourceMap(ast) });
}

/**
 * Parse TypeScript source code and render the first (or named) workflow to interactive HTML.
 */
export function sourceToHTML(code: string, options: DiagramOptions = {}): string {
  const result = parser.parseFromString(code);
  const ast = pickWorkflow(result.workflows, options);
  const svg = workflowToSVG(ast, options);
  return wrapSVGInHTML(svg, { title: options.workflowName ?? ast.name, theme: options.theme, nodeSources: buildNodeSourceMap(ast) });
}

/**
 * Parse a workflow file and render the first (or named) workflow to interactive HTML.
 */
export function fileToHTML(filePath: string, options: DiagramOptions = {}): string {
  const result = parser.parse(filePath);
  const ast = pickWorkflow(result.workflows, options);
  const svg = workflowToSVG(ast, options);
  return wrapSVGInHTML(svg, { title: options.workflowName ?? ast.name, theme: options.theme, nodeSources: buildNodeSourceMap(ast) });
}

type PortInfo = { type: string; tsType?: string };
type NodeSourceInfo = { description?: string; source?: string; ports?: Record<string, PortInfo> };

function buildNodeSourceMap(ast: TWorkflowAST): Record<string, NodeSourceInfo> {
  const typeMap = new Map(ast.nodeTypes.map(nt => [nt.functionName, nt]));
  const map: Record<string, NodeSourceInfo> = {};
  for (const inst of ast.instances) {
    const nt = typeMap.get(inst.nodeType);
    if (!nt) continue;
    const ports: Record<string, PortInfo> = {};
    for (const [name, def] of Object.entries(nt.inputs ?? {})) {
      ports[name] = { type: def.dataType, tsType: def.tsType };
    }
    for (const [name, def] of Object.entries(nt.outputs ?? {})) {
      ports[name] = { type: def.dataType, tsType: def.tsType };
    }
    map[inst.id] = { description: nt.description, source: nt.functionText, ports };
  }
  // Virtual Start/Exit nodes get their port types from the workflow definition
  const startPorts: Record<string, PortInfo> = {};
  for (const [name, def] of Object.entries(ast.startPorts ?? {})) {
    startPorts[name] = { type: def.dataType, tsType: def.tsType };
  }
  if (Object.keys(startPorts).length) {
    map['Start'] = { description: ast.description, ports: startPorts };
  }
  const exitPorts: Record<string, PortInfo> = {};
  for (const [name, def] of Object.entries(ast.exitPorts ?? {})) {
    exitPorts[name] = { type: def.dataType, tsType: def.tsType };
  }
  if (Object.keys(exitPorts).length) {
    map['Exit'] = { ports: exitPorts };
  }
  return map;
}

function pickWorkflow(workflows: TWorkflowAST[], options: DiagramOptions): TWorkflowAST {
  if (workflows.length === 0) {
    throw new Error('No workflows found in source code');
  }
  if (options.workflowName) {
    const found = workflows.find(w => w.name === options.workflowName);
    if (!found) {
      throw new Error(`Workflow "${options.workflowName}" not found. Available: ${workflows.map(w => w.name).join(', ')}`);
    }
    return found;
  }
  return workflows[0];
}

function pickAndRender(workflows: TWorkflowAST[], options: DiagramOptions): string {
  return workflowToSVG(pickWorkflow(workflows, options), options);
}

// ── ASCII / Text convenience functions ───────────────────────────────────────

function renderByFormat(graph: ReturnType<typeof buildDiagramGraph>, format: 'ascii' | 'ascii-compact' | 'text'): string {
  switch (format) {
    case 'ascii': return renderASCII(graph);
    case 'ascii-compact': return renderASCIICompact(graph);
    case 'text': return renderText(graph);
  }
}

export function workflowToASCII(ast: TWorkflowAST, options: DiagramOptions = {}): string {
  const graph = buildDiagramGraph(ast, options);
  return renderByFormat(graph, options.format as 'ascii' | 'ascii-compact' | 'text' ?? 'ascii');
}

export function sourceToASCII(code: string, options: DiagramOptions = {}): string {
  const result = parser.parseFromString(code);
  const ast = pickWorkflow(result.workflows, options);
  const graph = buildDiagramGraph(ast, options);
  return renderByFormat(graph, options.format as 'ascii' | 'ascii-compact' | 'text' ?? 'ascii');
}

export function fileToASCII(filePath: string, options: DiagramOptions = {}): string {
  const result = parser.parse(filePath);
  const ast = pickWorkflow(result.workflows, options);
  const graph = buildDiagramGraph(ast, options);
  return renderByFormat(graph, options.format as 'ascii' | 'ascii-compact' | 'text' ?? 'ascii');
}
