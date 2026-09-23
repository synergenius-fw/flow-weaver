import type { TWorkflowAST } from '../ast/types';
import { parser } from '../parser/annotation-parser';
import { buildDiagramGraph } from './geometry';
import { renderASCII, renderASCIICompact, renderText } from './ascii-renderer';
import { renderSpineSVG } from './spine';
import type { DiagramOptions } from './types';

export type { DiagramOptions } from './types';
export { renderASCII, renderASCIICompact, renderText } from './ascii-renderer';
export { buildProcessModel } from './process-view';
export type { ProcessModel, ProcessStep, ProcessKind } from './process-view';
export { renderSpineSVG } from './spine';
export type { SpineOptions } from './spine';
export { buildLanes, edgePath } from './lanes';
export type { LaneGraph, LaneRow, LaneEdge, LaneStep, LaneModel, EdgeKind } from './lanes';
export { stepLabel } from './labels';

/**
 * Render a workflow AST as an SVG: the spine the console draws -- steps in
 * run order with the control flow as lanes beside them -- made still.
 */
export function workflowToSVG(ast: TWorkflowAST, options: DiagramOptions = {}): string {
  return renderSpineSVG(ast, { theme: options.theme, title: options.title, subtitle: options.subtitle });
}

/** Parse TypeScript source and render the first (or named) workflow as an SVG. */
export function sourceToSVG(code: string, options: DiagramOptions = {}): string {
  const result = parser.parseFromString(code);
  return workflowToSVG(pickWorkflow(result.workflows, options), options);
}

/** Parse a workflow file (resolving imports) and render the first (or named) workflow as an SVG. */
export function fileToSVG(filePath: string, options: DiagramOptions = {}): string {
  const result = parser.parse(filePath);
  return workflowToSVG(pickWorkflow(result.workflows, options), options);
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
