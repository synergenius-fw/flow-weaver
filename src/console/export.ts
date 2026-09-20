/**
 * Exporting a workflow from the console.
 *
 * Core ships no export target: every one comes from an installed pack, so
 * what can be exported to is a fact about the project. This lists those
 * targets with the pack each came from and the `@deploy` keys it reads,
 * and runs an export the way `fw export` does -- preview first, files
 * written only when asked, the target's own deploy instructions after.
 */
import * as path from 'node:path';
import { createTargetRegistry } from '../deployment/index.js';
import type { DeployInstructions, DeploySchema, ExportArtifacts } from '../deployment/targets/base.js';
import { exportWorkflow } from '../export/index.js';
import { describePacks } from './packs.js';

export interface TargetView {
  name: string;
  description: string;
  /** The pack that provides it, when it can be told. */
  pack: string | null;
  /** The `@deploy` keys the target reads on a workflow. */
  deploySchema: DeploySchema | null;
}

export interface ExportRequest {
  file: string;
  name: string;
  target: string;
  /** Where the files go. Defaults to `dist/<target>` beside the file. */
  outputDir?: string;
  /** Generate without writing. */
  preview: boolean;
}

export interface ExportOutcome {
  target: string;
  outputDir: string;
  written: boolean;
  files: Array<{ path: string; content: string }>;
  warnings: string[];
  instructions: DeployInstructions | null;
}

/** Where an export lands unless told otherwise. */
export const defaultOutputDir = (file: string, target: string): string => path.join(path.dirname(file), 'dist', target);

/** The targets the project's packs provide. */
export async function listTargets(projectDir: string): Promise<TargetView[]> {
  const registry = await createTargetRegistry(projectDir);
  const packs = await describePacks(projectDir);
  const owner = new Map<string, string>();
  for (const p of packs) for (const t of p.exportTargets) owner.set(t.name, p.name);
  return registry.getNames()
    .map((name) => {
      const t = registry.get(name)!;
      return { name, description: t.description, pack: owner.get(name) ?? null, deploySchema: t.deploySchema ?? null };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Run one export. Throws with the target's or the parser's own message. */
export async function runExport(projectDir: string, req: ExportRequest): Promise<ExportOutcome> {
  const outputDir = path.resolve(req.outputDir ?? defaultOutputDir(req.file, req.target));
  const result = await exportWorkflow({
    target: req.target, input: req.file, output: outputDir, workflow: req.name,
    dryRun: req.preview, production: true, projectDir,
  });
  const files = result.files.map((f) => ({ path: path.relative(outputDir, f.path).split(path.sep).join('/'), content: f.content }));
  // The instructions come from the target, given what was generated -- as
  // `fw export` prints them once the files are written.
  const registry = await createTargetRegistry(projectDir);
  const target = registry.get(req.target);
  let instructions: DeployInstructions | null = null;
  if (target && files.length) {
    const artifacts: ExportArtifacts = {
      target: req.target,
      workflowName: result.workflow,
      entryPoint: files[0].path,
      files: files.map((f) => ({ relativePath: f.path, absolutePath: path.join(outputDir, f.path), content: f.content, type: 'other' as const })),
      warnings: result.warnings,
    };
    try { instructions = target.getDeployInstructions(artifacts); } catch { instructions = null; }
  }
  return { target: req.target, outputDir, written: !req.preview, files, warnings: result.warnings ?? [], instructions };
}
