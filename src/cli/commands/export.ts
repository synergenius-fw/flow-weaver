/**
 * Export command - generate serverless function handlers for deployment
 */

import { exportWorkflow, getSupportedTargets, type ExportTarget } from '../../export/index.js';
import { logger } from '../utils/logger.js';

export interface ExportOptions {
  /** Target platform (lambda, vercel, cloudflare, inngest) */
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
  /** Use deep generator with per-node Inngest steps for durability (inngest target only) */
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
 * # Export for Vercel
 * flow-weaver export workflow.ts --target vercel --output api/
 *
 * # Export for AWS Lambda
 * flow-weaver export workflow.ts --target lambda --output dist/lambda/
 *
 * # Export for Cloudflare Workers
 * flow-weaver export workflow.ts --target cloudflare --output workers/
 *
 * # Export specific workflow from multi-workflow file
 * flow-weaver export multi-workflow.ts --target vercel --output api/ --workflow calculate
 *
 * # Export all workflows as a single service (multi-workflow mode)
 * flow-weaver export workflows.ts --target lambda --output dist/ --multi
 *
 * # Export specific workflows from a file as a service
 * flow-weaver export workflows.ts --target lambda --output dist/ --multi --workflows "workflowA,workflowB"
 *
 * # Export with API documentation routes
 * flow-weaver export workflow.ts --target lambda --output dist/ --docs
 * ```
 */
export async function exportCommand(input: string, options: ExportOptions): Promise<void> {
  const validTargets = getSupportedTargets();

  // Validate target
  if (!validTargets.includes(options.target as ExportTarget)) {
    throw new Error(
      `Invalid target "${options.target}". Valid targets: ${validTargets.join(', ')}`
    );
  }

  const isDryRun = options.dryRun ?? false;

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
    logger.info('Durable steps: Yes (per-node step.run for Inngest)');
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
        f.path.endsWith('index.ts')
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

  logger.newline();
  logger.section('Next Steps');

  switch (result.target) {
    case 'lambda':
      logger.log('  1. cd ' + options.output);
      logger.log('  2. npm install');
      logger.log('  3. npm run build');
      logger.log('  4. sam build && sam deploy --guided');
      logger.newline();
      logger.info('Requires: AWS SAM CLI (https://aws.amazon.com/serverless/sam/)');
      break;

    case 'vercel':
      logger.log("  1. Move files to your Vercel project's api/ directory:");
      logger.log(`     mv ${options.output}/*.ts your-project/api/`);
      logger.log('  2. vercel deploy');
      logger.newline();
      logger.info('Requires: Vercel CLI (npm install -g vercel)');
      logger.info(`Endpoint will be: https://your-project.vercel.app/api/${result.workflow}`);
      break;

    case 'cloudflare':
      logger.log('  1. cd ' + options.output);
      logger.log('  2. npm install');
      logger.log('  3. npm run deploy');
      logger.newline();
      logger.info('Requires: Wrangler CLI (npm install -g wrangler)');
      logger.info('First run: wrangler login');
      break;

    case 'inngest':
      logger.log('  1. cd ' + options.output);
      logger.log('  2. npm install');
      logger.log('  3. npm run dev');
      logger.newline();
      logger.info('Inngest Dev Server will start at http://localhost:8288');
      logger.info('Send test events from the Inngest Dev Server UI');
      logger.info('Docs: https://www.inngest.com/docs');
      break;
  }
}
