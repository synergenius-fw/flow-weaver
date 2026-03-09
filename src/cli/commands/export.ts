/**
 * Export command - generate serverless function handlers for deployment
 */

import { exportWorkflow, type ExportTarget } from '../../export/index.js';
import { logger } from '../utils/logger.js';

export interface ExportOptions {
  /** Target platform (provided by installed packs) */
  target: string;
  /** Output directory */
  output: string;
  /** Specific workflow name to export */
  workflow?: string;
  /** Production mode (default: true) */
  production?: boolean;
  /** Bundle into single file (future feature) */
  bundle?: boolean;
  /** Dry run - preview without writing files */
  dryRun?: boolean;
  /** Export all workflows in file as a single multi-workflow service */
  multi?: boolean;
  /** Comma-separated list of specific workflows to export (subset of file) */
  workflows?: string;
  /** Include API documentation routes (/docs and /openapi.json) */
  docs?: boolean;
  /** Use deep generator with per-node durable steps */
  durableSteps?: boolean;
}

/**
 * Export a workflow as a serverless function.
 *
 * @param input - Path to the workflow file
 * @param options - Export options
 *
 * @example
 * ```bash
 * # Export for a target (install the corresponding pack first)
 * fw export workflow.ts --target <target> --output dist/
 *
 * # Export specific workflow from multi-workflow file
 * fw export multi-workflow.ts --target <target> --output api/ --workflow calculate
 *
 * # Export all workflows as a single service
 * fw export workflows.ts --target <target> --output dist/ --multi
 *
 * # Export with API documentation routes
 * fw export workflow.ts --target <target> --output dist/ --docs
 * ```
 */
export async function exportCommand(input: string, options: ExportOptions): Promise<void> {
  // Validate target is provided
  if (!options.target) {
    throw new Error('--target is required. Install a target pack first.');
  }

  const isDryRun = options.dryRun ?? false;
  const t = logger.timer();

  const isMulti = options.multi ?? false;
  const workflowsList = options.workflows
    ? options.workflows.split(',').map((w) => w.trim())
    : undefined;

  logger.section(isDryRun ? 'Export Preview (Dry Run)' : 'Exporting Workflow');
  logger.info(`Input: ${input}`);
  logger.info(`Target: ${options.target}`);
  logger.info(`Output: ${options.output}`);
  if (isMulti) {
    logger.info('Mode: Multi-workflow service');
    if (workflowsList) {
      logger.info(`Workflows: ${workflowsList.join(', ')}`);
    } else {
      logger.info('Workflows: All workflows in file');
    }
  } else if (options.workflow) {
    logger.info(`Workflow: ${options.workflow}`);
  }
  if (options.docs) {
    logger.info('Include docs: Yes (/docs and /openapi.json routes)');
  }
  if (options.durableSteps) {
    logger.info('Durable steps: Yes');
  }
  if (isDryRun) {
    logger.info('Mode: DRY RUN (no files will be written)');
  }
  logger.newline();

  const result = await exportWorkflow({
    target: options.target as ExportTarget,
    input,
    output: options.output,
    workflow: options.workflow,
    production: options.production ?? true,
    bundle: options.bundle,
    dryRun: isDryRun,
    multi: isMulti,
    workflows: workflowsList,
    includeDocs: options.docs,
    durableSteps: options.durableSteps,
  });

  if (isDryRun) {
    if (result.workflows && result.workflows.length > 1) {
      logger.success(
        `Preview for multi-workflow service "${result.workflow}" with ${result.workflows.length} workflows (${result.target})`
      );
    } else {
      logger.success(`Preview for workflow "${result.workflow}" (${result.target})`);
    }
  } else {
    if (result.workflows && result.workflows.length > 1) {
      logger.success(
        `Exported multi-workflow service "${result.workflow}" with ${result.workflows.length} workflows for ${result.target}`
      );
      logger.info(`Workflows: ${result.workflows.join(', ')}`);
    } else {
      logger.success(`Exported workflow "${result.workflow}" for ${result.target}`);
    }
    logger.info(`done in ${t.elapsed()}`);
  }
  logger.newline();

  logger.section(isDryRun ? 'Files That Would Be Generated' : 'Generated Files');
  for (const file of result.files) {
    logger.log(`  ${file.path}`);
  }

  // In dry-run mode, show a preview of the handler file
  if (isDryRun) {
    logger.newline();
    logger.section('Handler Preview');
    const handlerFile = result.files.find(
      (f) =>
        f.path.endsWith('handler.ts') ||
        f.path.endsWith(`${result.workflow}.ts`) ||
        f.path.endsWith('index.ts') ||
        f.path.endsWith('.yml') ||
        f.path.endsWith('.yaml')
    );
    if (handlerFile) {
      // Show first 40 lines of handler
      const lines = handlerFile.content.split('\n');
      const preview = lines.slice(0, 40).join('\n');
      logger.log(preview);
      if (lines.length > 40) {
        logger.info(`... (${lines.length - 40} more lines)`);
      }
    }
  }

  // Show warnings about unsupported annotations
  if (result.warnings && result.warnings.length > 0) {
    logger.newline();
    logger.section('Warnings');
    for (const warning of result.warnings) {
      logger.warn(warning);
    }
  }

  // Get deploy instructions from the target
  logger.newline();
  logger.section('Next Steps');

  const { createTargetRegistry } = await import('../../deployment/index.js');
  const registry = await createTargetRegistry(process.cwd());
  const target = registry.get(result.target);

  if (target) {
    // Use the target's own deploy instructions
    const instructions = target.getDeployInstructions({
      files: [],
      target: result.target,
      workflowName: result.workflow,
      entryPoint: '',
    });
    for (let i = 0; i < instructions.steps.length; i++) {
      logger.log(`  ${i + 1}. ${instructions.steps[i]}`);
    }
    if (instructions.prerequisites.length > 0) {
      logger.newline();
      logger.info(`Requires: ${instructions.prerequisites.join(', ')}`);
    }
  } else {
    logger.log('  See target documentation for deployment instructions.');
  }
}
