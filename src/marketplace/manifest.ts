/**
 * Manifest generation — converts parsed ASTs into a flowweaver.manifest.json file.
 *
 * The manifest mirrors AST types so the editor can consume it directly
 * without re-parsing source files.
 */

import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import { AnnotationParser } from '../parser.js';
import type {
  TNodeTypeAST,
  TWorkflowAST,
  TPatternAST,
  TPortDefinition,
  TPatternPortDefinition,
} from '../ast/types.js';
import type {
  TMarketplaceManifest,
  TManifestNodeType,
  TManifestWorkflow,
  TManifestPattern,
  TManifestPort,
} from './types.js';

// ── Port mapping ─────────────────────────────────────────────────────────────

function toManifestPort(port: TPortDefinition): TManifestPort {
  return {
    dataType: port.dataType,
    ...(port.description && { description: port.description }),
    ...(port.optional && { optional: true }),
  };
}

function toManifestPortFromPattern(port: TPatternPortDefinition): TManifestPort {
  return {
    dataType: port.dataType ?? 'ANY',
    ...(port.description && { description: port.description }),
  };
}

function toManifestPorts(ports: Record<string, TPortDefinition>): Record<string, TManifestPort> {
  const result: Record<string, TManifestPort> = {};
  for (const [name, def] of Object.entries(ports)) {
    result[name] = toManifestPort(def);
  }
  return result;
}

// ── AST → Manifest mapping ──────────────────────────────────────────────────

function nodeTypeToManifest(nt: TNodeTypeAST, relativeFile: string): TManifestNodeType {
  return {
    name: nt.name,
    ...(nt.description && { description: nt.description }),
    file: relativeFile,
    functionName: nt.functionName,
    isAsync: nt.isAsync,
    inputs: toManifestPorts(nt.inputs),
    outputs: toManifestPorts(nt.outputs),
    ...(nt.visuals && {
      visuals: {
        ...(nt.visuals.color && { color: nt.visuals.color }),
        ...(nt.visuals.icon && { icon: nt.visuals.icon }),
        ...(nt.visuals.tags && { tags: nt.visuals.tags }),
      },
    }),
  };
}

function workflowToManifest(wf: TWorkflowAST, relativeFile: string): TManifestWorkflow {
  return {
    name: wf.name,
    ...(wf.description && { description: wf.description }),
    file: relativeFile,
    functionName: wf.functionName,
    startPorts: toManifestPorts(wf.startPorts),
    exitPorts: toManifestPorts(wf.exitPorts),
    nodeCount: wf.instances.length,
    connectionCount: wf.connections.length,
  };
}

function patternToManifest(pat: TPatternAST, relativeFile: string): TManifestPattern {
  const inputPorts: Record<string, TManifestPort> = {};
  for (const [name, def] of Object.entries(pat.inputPorts)) {
    inputPorts[name] = toManifestPortFromPattern(def);
  }
  const outputPorts: Record<string, TManifestPort> = {};
  for (const [name, def] of Object.entries(pat.outputPorts)) {
    outputPorts[name] = toManifestPortFromPattern(def);
  }

  return {
    name: pat.name,
    ...(pat.description && { description: pat.description }),
    file: relativeFile,
    inputPorts,
    outputPorts,
    nodeCount: pat.instances.length,
  };
}

// ── Public API ───────────────────────────────────────────────────────────────

export interface GenerateManifestOptions {
  /** Root directory of the marketplace package */
  directory: string;
  /** Source directory to scan (default: "src") */
  srcDir?: string;
  /** Dist directory for compiled output paths (default: "dist") */
  distDir?: string;
}

export interface GenerateManifestResult {
  manifest: TMarketplaceManifest;
  /** Source files that were parsed */
  parsedFiles: string[];
  /** Parse errors encountered */
  errors: string[];
}

/**
 * Generate a marketplace manifest by parsing all annotated source files
 * in the package directory.
 */
export async function generateManifest(
  options: GenerateManifestOptions
): Promise<GenerateManifestResult> {
  const { directory, srcDir = 'src', distDir = 'dist' } = options;

  // Read package.json
  const pkgPath = path.join(directory, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    return {
      manifest: emptyManifest('unknown', '0.0.0'),
      parsedFiles: [],
      errors: ['package.json not found'],
    };
  }

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  const srcRoot = path.join(directory, srcDir);

  // Find all TypeScript files in src/
  const pattern = path.join(srcRoot, '**/*.ts').replace(/\\/g, '/');
  const files = await glob(pattern, { absolute: true });
  const tsFiles = files.filter((f) => !f.endsWith('.d.ts') && !f.includes('node_modules'));

  const parser = new AnnotationParser();
  const allNodeTypes: TManifestNodeType[] = [];
  const allWorkflows: TManifestWorkflow[] = [];
  const allPatterns: TManifestPattern[] = [];
  const errors: string[] = [];
  const parsedFiles: string[] = [];

  for (const file of tsFiles) {
    try {
      const result = parser.parse(file);
      parsedFiles.push(file);

      // Map source paths to dist paths: src/foo/bar.ts → dist/foo/bar.js
      const relFromSrc = path.relative(srcRoot, file);
      const distRelative = path.join(distDir, relFromSrc.replace(/\.ts$/, '.js'));

      // Collect standalone node types (not embedded in workflows)
      for (const nt of result.nodeTypes) {
        allNodeTypes.push(nodeTypeToManifest(nt, distRelative));
      }

      // Collect workflows
      for (const wf of result.workflows) {
        allWorkflows.push(workflowToManifest(wf, distRelative));
      }

      // Collect patterns
      for (const pat of result.patterns) {
        allPatterns.push(patternToManifest(pat, distRelative));
      }

      if (result.errors.length > 0) {
        errors.push(...result.errors.map((e) => `${file}: ${e}`));
      }
    } catch (err) {
      errors.push(`Failed to parse ${file}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const manifest: TMarketplaceManifest = {
    manifestVersion: 1,
    name: pkg.name ?? 'unknown',
    version: pkg.version ?? '0.0.0',
    ...(pkg.description && { description: pkg.description }),
    ...(pkg.flowWeaver?.engineVersion && { engineVersion: pkg.flowWeaver.engineVersion }),
    ...(pkg.flowWeaver?.categories && { categories: pkg.flowWeaver.categories }),
    nodeTypes: allNodeTypes,
    workflows: allWorkflows,
    patterns: allPatterns,
    ...(Object.keys(pkg.dependencies ?? {}).length > 0 && {
      dependencies: {
        npm: pkg.dependencies,
      },
    }),
  };

  return { manifest, parsedFiles, errors };
}

/** Write manifest JSON to disk. */
export function writeManifest(directory: string, manifest: TMarketplaceManifest): string {
  const outPath = path.join(directory, 'flowweaver.manifest.json');
  fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
  return outPath;
}

/** Read manifest JSON from disk. */
export function readManifest(directory: string): TMarketplaceManifest | null {
  const manifestPath = path.join(directory, 'flowweaver.manifest.json');
  if (!fs.existsSync(manifestPath)) return null;
  return JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
}

function emptyManifest(name: string, version: string): TMarketplaceManifest {
  return {
    manifestVersion: 1,
    name,
    version,
    nodeTypes: [],
    workflows: [],
    patterns: [],
  };
}
