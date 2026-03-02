/**
 * Serverless export orchestrator
 * Generates deployment-ready handlers for various platforms
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

import { compileWorkflow } from '../api/compile.js';
import { AnnotationParser } from '../parser.js';

/**
 * Export target identifier.
 *
 * Widened to `string` so marketplace packs can register arbitrary targets
 * without modifying core. Well-known built-in names (when packs are installed):
 * 'lambda', 'vercel', 'cloudflare', 'inngest', 'github-actions', 'gitlab-ci'
 */
export type ExportTarget = string;

/**
 * Options for exporting a workflow
 */
export interface ExportOptions {
  /** Target platform */
  target: ExportTarget;
  /** Input workflow file */
  input: string;
  /** Output directory */
  output: string;
  /** Specific workflow name (if file has multiple) */
  workflow?: string;
  /** Production mode (no debug events) */
  production?: boolean;
  /** Bundle workflow into single file (future feature) */
  bundle?: boolean;
  /** Dry run - preview without writing files */
  dryRun?: boolean;
  /** Export all workflows in file as a single multi-workflow service */
  multi?: boolean;
  /** Specific workflow names to export (subset when using multi) */
  workflows?: string[];
  /** Include API documentation routes */
  includeDocs?: boolean;
  /** Use deep generator with per-node Inngest steps for durability (inngest target only) */
  durableSteps?: boolean;
}

/**
 * Result of export operation
 */
export interface ExportResult {
  /** Target platform */
  target: ExportTarget;
  /** Generated files */
  files: Array<{ path: string; content: string }>;
  /** Workflow name */
  workflow: string;
  /** Workflow description */
  description?: string;
  /** All workflow names (for multi-workflow export) */
  workflows?: string[];
  /** OpenAPI spec (if generated) */
  openApiSpec?: object;
}

/**
 * Export a workflow for deployment.
 *
 * Delegates to the target registry — every target is a plugin discovered
 * from installed marketplace packs. The legacy template system has been
 * replaced by target classes that generate their own handler + config.
 */
export async function exportWorkflow(options: ExportOptions): Promise<ExportResult> {
  const { createTargetRegistry } = await import('../deployment/index.js');
  const registry = await createTargetRegistry(process.cwd());
  const target = registry.get(options.target);

  if (!target) {
    const available = registry.getNames();
    throw new Error(
      available.length === 0
        ? `No export targets installed. Install a target pack (e.g. npm install flowweaver-pack-${options.target})`
        : `Unknown target "${options.target}". Installed: ${available.join(', ')}`
    );
  }

  const inputPath = path.resolve(options.input);
  const outputDir = path.resolve(options.output);
  const isDryRun = options.dryRun ?? false;

  // Multi-workflow mode
  if (options.multi) {
    return exportMultiWorkflowViaRegistry(
      target, inputPath, outputDir, isDryRun, options
    );
  }

  // Single-workflow mode
  return exportSingleWorkflowViaRegistry(
    target, inputPath, outputDir, isDryRun, options
  );
}

/**
 * Single-workflow export through the target registry.
 */
async function exportSingleWorkflowViaRegistry(
  target: import('../deployment/targets/base.js').ExportTarget,
  inputPath: string,
  outputDir: string,
  isDryRun: boolean,
  options: ExportOptions
): Promise<ExportResult> {
  // Validate input file exists
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputPath}`);
  }

  // Parse to find workflows
  const parser = new AnnotationParser();
  const parseResult = parser.parse(inputPath);

  if (parseResult.workflows.length === 0) {
    throw new Error(`No workflows found in ${inputPath}`);
  }

  // Select workflow
  const workflow = options.workflow
    ? parseResult.workflows.find(
        (w) => w.name === options.workflow || w.functionName === options.workflow
      )
    : parseResult.workflows[0];

  if (!workflow) {
    const available = parseResult.workflows.map((w) => w.name).join(', ');
    throw new Error(`Workflow "${options.workflow}" not found. Available: ${available}`);
  }

  // Generate artifacts via target
  const artifacts = await target.generate({
    sourceFile: inputPath,
    workflowName: workflow.functionName,
    displayName: workflow.name,
    outputDir,
    description: workflow.description,
    production: options.production ?? true,
    includeDocs: options.includeDocs,
    targetOptions: {
      ...(options.durableSteps && { durableSteps: true }),
    },
  });

  // If the target's handler references a workflow import, compile and include it
  const needsCompiledWorkflow = artifacts.files.some(
    (f) => f.type === 'handler' && f.content.includes("from './workflow")
  );

  let compiledContent: string | undefined;
  if (needsCompiledWorkflow) {
    const workDir = isDryRun
      ? path.join(os.tmpdir(), `fw-export-dryrun-${Date.now()}`)
      : outputDir;

    fs.mkdirSync(workDir, { recursive: true });

    try {
      const compiledPath = await compileToOutput(
        inputPath, workflow.functionName, workDir, options.production
      );
      compiledContent = fs.readFileSync(compiledPath, 'utf8');
    } finally {
      if (isDryRun) {
        try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* ignore */ }
      }
    }
  }

  // Collect all output files
  const files: Array<{ path: string; content: string }> = artifacts.files.map((f) => ({
    path: path.join(outputDir, f.relativePath),
    content: f.content,
  }));

  if (compiledContent) {
    const workflowOutputPath = path.join(outputDir, 'workflow.ts');
    files.push({ path: workflowOutputPath, content: compiledContent });
  }

  // Write files if not dry-run
  if (!isDryRun) {
    for (const file of files) {
      const dirPath = path.dirname(file.path);
      fs.mkdirSync(dirPath, { recursive: true });
      fs.writeFileSync(file.path, file.content, 'utf-8');
    }
  }

  return {
    target: options.target,
    files,
    workflow: workflow.name,
    description: workflow.description,
  };
}

/**
 * Multi-workflow export through the target registry.
 */
async function exportMultiWorkflowViaRegistry(
  target: import('../deployment/targets/base.js').ExportTarget,
  inputPath: string,
  outputDir: string,
  isDryRun: boolean,
  options: ExportOptions
): Promise<ExportResult> {
  // Validate input file exists
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputPath}`);
  }

  // Parse to find workflows
  const parser = new AnnotationParser();
  const parseResult = parser.parse(inputPath);

  if (parseResult.workflows.length === 0) {
    throw new Error(`No workflows found in ${inputPath}`);
  }

  // Filter workflows if specific ones are requested
  let selectedWorkflows = parseResult.workflows;
  if (options.workflows && options.workflows.length > 0) {
    selectedWorkflows = parseResult.workflows.filter(
      (w) => options.workflows!.includes(w.name) || options.workflows!.includes(w.functionName)
    );
    if (selectedWorkflows.length === 0) {
      const available = parseResult.workflows.map((w) => w.name).join(', ');
      throw new Error(`None of the requested workflows found. Available: ${available}`);
    }
  }

  const serviceName =
    path.basename(options.input, path.extname(options.input)) + '-service';

  // Build bundle items
  const bundleWorkflows = selectedWorkflows.map((w) => ({
    name: w.name,
    functionName: w.functionName,
    description: w.description,
    expose: true,
  }));

  if (!target.generateBundle) {
    throw new Error(
      `Target "${options.target}" does not support multi-workflow export`
    );
  }

  const artifacts = await target.generateBundle(bundleWorkflows, [], {
    sourceFile: inputPath,
    workflowName: serviceName,
    displayName: serviceName,
    outputDir,
    production: options.production ?? true,
    includeDocs: options.includeDocs,
    targetOptions: {
      ...(options.durableSteps && { durableSteps: true }),
    },
  });

  // Collect output files
  const files: Array<{ path: string; content: string }> = artifacts.files.map(
    (f) => ({
      path: path.join(outputDir, f.relativePath),
      content: f.content,
    })
  );

  // Write files if not dry-run
  if (!isDryRun) {
    for (const file of files) {
      const dirPath = path.dirname(file.path);
      fs.mkdirSync(dirPath, { recursive: true });
      fs.writeFileSync(file.path, file.content, 'utf-8');
    }
  }

  return {
    target: options.target,
    files,
    workflow: serviceName,
    workflows: selectedWorkflows.map((w) => w.name),
  };
}

/**
 * Compile workflow to output directory
 */
async function compileToOutput(
  inputPath: string,
  functionName: string,
  outputDir: string,
  production?: boolean
): Promise<string> {
  const outputPath = path.join(outputDir, 'workflow.ts');

  // Copy source file to output
  fs.copyFileSync(inputPath, outputPath);

  // Compile in-place in the output directory
  await compileWorkflow(outputPath, {
    write: true,
    inPlace: true,
    parse: { workflowName: functionName },
    generate: { production: production ?? true },
  });

  return outputPath;
}

/**
 * List installed export targets by querying the registry.
 */
export async function getSupportedTargets(projectDir?: string): Promise<string[]> {
  const { createTargetRegistry } = await import('../deployment/index.js');
  const registry = await createTargetRegistry(projectDir ?? process.cwd());
  return registry.getNames();
}
