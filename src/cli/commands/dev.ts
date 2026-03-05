/**
 * Dev command - watch, compile, and run workflow on changes
 */

import * as path from 'path';
import * as fs from 'fs';
import { glob } from 'glob';
import { compileCommand, type CompileOptions } from './compile.js';
import { executeWorkflowFromFile } from '../../mcp/workflow-executor.js';
import { logger } from '../utils/logger.js';
import { getErrorMessage } from '../../utils/error-utils.js';
import { getFriendlyError } from '../../friendly-errors.js';
import { devModeRegistry } from '../../generator/dev-mode-registry.js';

function timestamp(): string {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function cycleSeparator(file?: string): void {
  const ts = timestamp();
  const pad = '─'.repeat(40);
  logger.log(`\n  ${logger.dim(`─── ${ts} ${pad}`)}`);
  if (file) {
    logger.log(`  ${logger.dim('File changed:')} ${path.basename(file)}`);
  }
}

export interface DevOptions {
  /** Input parameters as JSON string */
  params?: string;
  /** Path to JSON file containing input parameters */
  paramsFile?: string;
  /** Specific workflow name to run (if file contains multiple workflows) */
  workflow?: string;
  /** Run in production mode (no trace events) */
  production?: boolean;
  /** Module format for generated code */
  format?: 'esm' | 'cjs' | 'auto';
  /** Omit redundant @param/@returns annotations */
  clean?: boolean;
  /** Run once then exit (for testing) */
  once?: boolean;
  /** Output result as JSON (for scripting) */
  json?: boolean;
  /** Compilation target (default: typescript in-place) */
  target?: string;
  /** Framework for serve handler */
  framework?: 'next' | 'express' | 'hono' | 'fastify' | 'remix';
  /** Port for the dev server */
  port?: number;
}

/**
 * Parse params from --params or --params-file.
 */
function parseParams(options: DevOptions): Record<string, unknown> {
  if (options.params) {
    try {
      return JSON.parse(options.params);
    } catch {
      throw new Error(`Invalid JSON in --params: ${options.params}`);
    }
  }
  if (options.paramsFile) {
    const paramsFilePath = path.resolve(options.paramsFile);
    if (!fs.existsSync(paramsFilePath)) {
      throw new Error(`Params file not found: ${paramsFilePath}`);
    }
    try {
      const content = fs.readFileSync(paramsFilePath, 'utf8');
      return JSON.parse(content);
    } catch {
      throw new Error(`Failed to parse params file: ${options.paramsFile}`);
    }
  }
  return {};
}

/**
 * Run a single compile + execute cycle.
 * Returns true if both compile and run succeeded.
 */
async function compileAndRun(
  filePath: string,
  params: Record<string, unknown>,
  options: DevOptions
): Promise<boolean> {
  // Step 1: Compile
  const compileOpts: CompileOptions = {
    format: options.format,
    clean: options.clean,
  };

  try {
    const ct = logger.timer();
    await compileCommand(filePath, compileOpts);
    if (!options.json) {
      logger.success(`Compiled in ${ct.elapsed()}`);
    }
  } catch (error) {
    const errorMsg = getErrorMessage(error);
    const errorObj = error as { code?: string; errors?: Array<{ code: string; message: string; node?: string }> };

    if (errorObj.errors && Array.isArray(errorObj.errors)) {
      logger.error('Compile failed:');
      for (const err of errorObj.errors) {
        const friendly = getFriendlyError(err);
        if (friendly) {
          logger.error(`  ${friendly.title}: ${friendly.explanation}`);
          logger.warn(`    How to fix: ${friendly.fix}`);
        } else {
          logger.error(`  - ${err.message}`);
        }
      }
    } else {
      logger.error(`Compile failed: ${errorMsg}`);
    }
    return false;
  }

  // Step 2: Run
  try {
    const result = await executeWorkflowFromFile(filePath, params, {
      workflowName: options.workflow,
      production: options.production ?? false,
      includeTrace: !options.production,
    });

    if (options.json) {
      process.stdout.write(
        JSON.stringify(
          {
            success: true,
            workflow: result.functionName,
            executionTime: result.executionTime,
            result: result.result,
          },
          null,
          2
        ) + '\n'
      );
    } else {
      logger.success(`Workflow "${result.functionName}" completed in ${result.executionTime}ms`);
      logger.log(JSON.stringify(result.result, null, 2));
    }
    return true;
  } catch (error) {
    const errorMsg = getErrorMessage(error);

    if (options.json) {
      process.stdout.write(
        JSON.stringify({ success: false, error: errorMsg }, null, 2) + '\n'
      );
    } else {
      logger.error(`Run failed: ${errorMsg}`);
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// Main Command
// ---------------------------------------------------------------------------

/**
 * Dev command: watch + compile + run in a single loop.
 */
export async function devCommand(input: string, options: DevOptions = {}): Promise<void> {
  const filePath = path.resolve(input);

  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  // Delegate to a registered dev mode provider if one exists for the target
  if (options.target) {
    const provider = devModeRegistry.get(options.target);
    if (provider) {
      return provider.run(filePath, options);
    }
  }

  const params = parseParams(options);

  if (!options.json) {
    logger.section('Dev Mode');
    logger.info(`File: ${path.basename(filePath)}`);
    if (Object.keys(params).length > 0) {
      logger.info(`Params: ${JSON.stringify(params)}`);
    }
    logger.newline();
  }

  // Initial compile + run
  await compileAndRun(filePath, params, options);

  // If --once, exit after first cycle
  if (options.once) {
    return;
  }

  if (!options.json) {
    logger.newline();
    logger.success('Watching for file changes... (Ctrl+C to stop)');
  }

  // Find files to watch
  const files = await glob(input, { absolute: true });

  // Use chokidar for reliable cross-platform file watching
  const chokidar = await import('chokidar');
  const watcher = chokidar.watch(files, {
    persistent: true,
    ignoreInitial: true,
  });

  watcher.on('change', async (file) => {
    if (!options.json) {
      cycleSeparator(file);
    }

    await compileAndRun(filePath, params, options);
  });

  // Handle process termination
  const cleanup = () => {
    if (!options.json) {
      logger.newline();
      logger.info('Stopping dev mode...');
    }
    watcher.close();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  if (process.platform !== 'win32') process.on('SIGTERM', cleanup);

  // Keep process alive
  await new Promise(() => {
    // Never resolves - keeps process running
  });
}
