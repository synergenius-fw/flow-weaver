/**
 * Artifact command — a workflow as something to hand to a person: the brief
 * as a page or a PDF, or the spine as an SVG.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseWorkflow } from '../../api/parse.js';
import { renderArtifact, ARTIFACT_KINDS, type ArtifactKind } from '../../artifacts/index.js';
import { logger } from '../utils/logger.js';
import { safeWriteFile } from '../utils/safe-write.js';

export interface ArtifactCommandOptions {
  kind?: string;
  workflowName?: string;
  theme?: 'light' | 'dark';
  subtitle?: string;
  output?: string;
  browser?: string;
}

export async function artifactCommand(input: string, options: ArtifactCommandOptions = {}): Promise<void> {
  const kind = (options.kind ?? 'brief') as ArtifactKind;
  if (!ARTIFACT_KINDS.includes(kind)) throw new Error(`Unknown artifact "${options.kind}". One of: ${ARTIFACT_KINDS.join(', ')}`);
  const filePath = path.resolve(input);
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);

  const { ast, errors } = await parseWorkflow(filePath, { workflowName: options.workflowName, projectDir: path.dirname(filePath) });
  if (!ast || errors.length) throw new Error(`Parse errors:\n${errors.join('\n')}`);

  const artifact = await renderArtifact(ast, kind, {
    theme: options.theme,
    subtitle: options.subtitle ?? path.basename(path.dirname(filePath)),
    pdf: options.browser ? { browser: options.browser } : undefined,
  });

  // Text goes to stdout unless a file was asked for; a PDF always goes to a
  // file, beside the workflow when none was named.
  const output = options.output ?? (kind === 'pdf' ? path.join(path.dirname(filePath), `${ast.functionName}${artifact.extension}`) : undefined);
  if (output) {
    const outputPath = path.resolve(output);
    if (typeof artifact.body === 'string') safeWriteFile(outputPath, artifact.body);
    else { fs.mkdirSync(path.dirname(outputPath), { recursive: true }); fs.writeFileSync(outputPath, artifact.body); }
    logger.success(`${kind === 'svg' ? 'Diagram' : kind === 'pdf' ? 'Brief (PDF)' : 'Brief'} written to ${outputPath}`);
  } else {
    process.stdout.write(artifact.body as string);
  }
}
