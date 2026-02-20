import type { TWorkflowAST } from '../ast/types';
import { parser } from '../parser';
import { buildDiagramGraph } from './geometry';
import { renderSVG } from './renderer';
import { wrapSVGInHTML } from './html-viewer';
import type { DiagramOptions } from './types';

export type { DiagramOptions } from './types';

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
  return wrapSVGInHTML(svg, { title: options.workflowName ?? ast.name, theme: options.theme });
}

/**
 * Parse TypeScript source code and render the first (or named) workflow to interactive HTML.
 */
export function sourceToHTML(code: string, options: DiagramOptions = {}): string {
  const svg = sourceToSVG(code, options);
  return wrapSVGInHTML(svg, { title: options.workflowName, theme: options.theme });
}

/**
 * Parse a workflow file and render the first (or named) workflow to interactive HTML.
 */
export function fileToHTML(filePath: string, options: DiagramOptions = {}): string {
  const svg = fileToSVG(filePath, options);
  return wrapSVGInHTML(svg, { title: options.workflowName, theme: options.theme });
}

function pickAndRender(workflows: TWorkflowAST[], options: DiagramOptions): string {
  if (workflows.length === 0) {
    throw new Error('No workflows found in source code');
  }

  let workflow: TWorkflowAST;
  if (options.workflowName) {
    const found = workflows.find(w => w.name === options.workflowName);
    if (!found) {
      throw new Error(`Workflow "${options.workflowName}" not found. Available: ${workflows.map(w => w.name).join(', ')}`);
    }
    workflow = found;
  } else {
    workflow = workflows[0];
  }

  return workflowToSVG(workflow, options);
}
