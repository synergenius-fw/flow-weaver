/**
 * Artifacts: a workflow as something to hand to a person.
 *
 * - the brief, as a page (interactive) or laid out for paper (print)
 * - the brief as a PDF, printed by the browser on the machine
 * - the spine as an SVG (from the diagram module)
 *
 * `fw artifact`, the console's Share menu and the MCP tools all come here.
 */
import type { TWorkflowAST } from '../ast/types.js';
import { renderBrief, type BriefOptions } from './brief.js';
import { htmlToPdf, type PdfOptions } from './pdf.js';
import { workflowToSVG } from '../diagram/index.js';

export { renderBrief, type BriefOptions } from './brief.js';
export { htmlToPdf, findBrowser, BrowserNotFoundError, type PdfOptions } from './pdf.js';

export type ArtifactKind = 'brief' | 'pdf' | 'svg';
export const ARTIFACT_KINDS: readonly ArtifactKind[] = ['brief', 'pdf', 'svg'];

export interface ArtifactOptions extends BriefOptions {
  pdf?: PdfOptions;
}

export interface Artifact {
  kind: ArtifactKind;
  /** The bytes; a string for text formats. */
  body: string | Buffer;
  /** MIME type for a download. */
  type: string;
  /** File extension including the dot, e.g. `.brief.html`. */
  extension: string;
}

/** Produce one artifact from a parsed workflow. */
export async function renderArtifact(ast: TWorkflowAST, kind: ArtifactKind, options: ArtifactOptions = {}): Promise<Artifact> {
  const { pdf, ...brief } = options;
  switch (kind) {
    case 'brief':
      return { kind, body: renderBrief(ast, { ...brief, mode: brief.mode ?? 'interactive' }), type: 'text/html; charset=utf-8', extension: '.brief.html' };
    case 'pdf':
      return { kind, body: await htmlToPdf(renderBrief(ast, { ...brief, mode: 'print' }), pdf), type: 'application/pdf', extension: '.brief.pdf' };
    case 'svg':
      return { kind, body: workflowToSVG(ast, { theme: brief.theme, subtitle: brief.subtitle }), type: 'image/svg+xml', extension: '.svg' };
  }
}
