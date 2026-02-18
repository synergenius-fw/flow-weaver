/**
 * Watch command - watches workflow files and recompiles on changes
 */

import * as path from 'path';
import { glob } from 'glob';
import { compileCommand, type CompileOptions } from './compile.js';
import { logger } from '../utils/logger.js';
import { getErrorMessage } from '../../utils/error-utils.js';

function timestamp(): string {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  return `[${h}:${m}:${s}]`;
}

export interface WatchOptions extends CompileOptions {
  onRecompile?: (filePath: string, success: boolean, errors?: string[]) => void;
}

export async function watchCommand(input: string, options: WatchOptions = {}): Promise<void> {
  logger.section('Watch Mode');
  logger.info(`Watching for changes: ${input}`);
  logger.info('Press Ctrl+C to stop');
  logger.newline();

  // Initial compilation
  logger.info('Initial compilation...');
  await compileCommand(input, options);
  logger.newline();
  logger.success('Watching for file changes...');

  // Find files to watch
  const files = await glob(input, { absolute: true });

  // Use chokidar for reliable cross-platform file watching
  const chokidar = await import('chokidar');
  const watcher = chokidar.watch(files, {
    persistent: true,
    ignoreInitial: true,
  });

  watcher.on('change', async (file) => {
    logger.newline();
    logger.info(`${timestamp()} File changed: ${path.basename(file)}`);
    logger.info(`${timestamp()} Recompiling...`);
    logger.newline();

    try {
      await compileCommand(file, options);
      logger.newline();
      logger.success(`${timestamp()} Recompilation complete`);
      options.onRecompile?.(file, true);
    } catch (error) {
      const errorMsg = getErrorMessage(error);
      logger.error(`${timestamp()} Recompilation failed: ${errorMsg}`);
      options.onRecompile?.(file, false, [errorMsg]);
    }
  });

  if (options.verbose) {
    for (const file of files) {
      logger.debug(`Watching: ${file}`);
    }
  }

  // Handle process termination
  const cleanup = () => {
    logger.newline();
    logger.info('Stopping watch mode...');
    watcher.close();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  // Keep process alive
  await new Promise(() => {
    // Never resolves - keeps process running
  });
}
