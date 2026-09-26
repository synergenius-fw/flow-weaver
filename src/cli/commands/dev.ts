/**
 * Dev command - watch, compile, and run workflow on changes
 */

import * as path from 'path';
import * as fs from 'fs';
import { randomUUID } from 'node:crypto';
import { glob } from 'glob';
import { compileCommand, type CompileOptions } from './compile.js';
import { executeWorkflow } from '../../mcp/workflow-executor.js';
import type { FwMockConfig } from '../../built-in-nodes/mock-types.js';
import { logger } from '../utils/logger.js';
import { readJsonObjectOption } from '../utils/json-option.js';
import { getErrorMessage } from '../../utils/error-utils.js';

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
  /** Specific workflow to run when the file has several */
  workflow?: string;
  /** No trace events */
  production?: boolean;
  /** Run once, then exit */
  once?: boolean;
  /** Print the result as JSON */
  json?: boolean;
  /** Input parameters as JSON string */
  params?: string;
  /** Path to JSON file containing input parameters */
  paramsFile?: string;
  /** Module format for generated code */
  format?: 'esm' | 'cjs' | 'auto';
  /** Omit redundant @param/@returns annotations */
  clean?: boolean;
  /** Mock config for built-in nodes as JSON string */
  mocks?: string;
  /** Path to JSON file with mock config */
  mocksFile?: string;
}

/** Params from --params or --params-file. */
function parseParams(options: DevOptions): Record<string, unknown> {
  return readJsonObjectOption(options.params, options.paramsFile, 'params') ?? {};
}

/** Mock config from --mocks or --mocks-file. */
function parseMocks(options: DevOptions): FwMockConfig | undefined {
  return readJsonObjectOption(options.mocks, options.mocksFile, 'mocks');
}

/**
 * Run a single compile + execute cycle.
 * Returns true if both compile and run succeeded.
 */
async function compileAndRun(
  filePath: string,
  params: Record<string, unknown>,
  mocks: FwMockConfig | undefined,
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
    // compileCommand has already printed each error, with its fix.
    logger.error(`Compile failed: ${getErrorMessage(error)}`);
    return false;
  }

  // Step 2: Run
  try {
    const result = await executeWorkflow({
      runId: randomUUID(),
      filePath,
      params,
      workflowName: options.workflow,
      production: options.production ?? false,
      includeTrace: !options.production,
      mocks,
    });

    if (result.kind === 'yielded') {
      throw new Error(
        'fw dev is not a durable coordinator and cannot persist a yielded continuation',
      );
    }

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

  const params = parseParams(options);
  const mocks = parseMocks(options);

  if (!options.json) {
    logger.section('Dev Mode');
    logger.info(`File: ${path.basename(filePath)}`);
    if (Object.keys(params).length > 0) {
      logger.info(`Params: ${JSON.stringify(params)}`);
    }
    if (mocks) {
      logger.info(`Mocks: ${JSON.stringify(mocks)}`);
    }
    logger.newline();
  }

  // Initial compile + run
  await compileAndRun(filePath, params, mocks, options);

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

  watcher.on('change', (file) => {
    if (!options.json) {
      cycleSeparator(file);
    }

    // compileAndRun reports compile and run failures itself; what reaches
    // this catch is a failure in that reporting. Say so and keep watching.
    compileAndRun(filePath, params, mocks, options).catch((error: unknown) => {
      logger.error(`Dev cycle failed: ${getErrorMessage(error)}`);
    });
  });

  // Handle process termination
  const cleanup = () => {
    if (!options.json) {
      logger.newline();
      logger.info('Stopping dev mode...');
    }
    // The process exits on the next line, which releases the watcher
    // whether or not close() has finished, so there is nothing to wait for.
    void watcher.close();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  if (process.platform !== 'win32') process.on('SIGTERM', cleanup);

  // Keep process alive
  await new Promise(() => {
    // Never resolves - keeps process running
  });
}
