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

  // Initial compilation. A file that does not compile yet is the usual reason
  // to watch it, so a failure here is reported and watching goes on.
  logger.info('Initial compilation...');
  try {
    await compileCommand(input, options);
  } catch (error) {
    const errorMsg = getErrorMessage(error);
    logger.error(`${timestamp()} Initial compilation failed: ${errorMsg}`);
    options.onRecompile?.(input, false, [errorMsg]);
  }
  logger.newline();
  logger.success('Watching for file changes...');

  // Find files to watch. Nothing matching is a mistake in the argument, not
  // a file that will compile later.
  const files = await glob(input, { absolute: true });
  if (files.length === 0) {
    throw new Error(`No files match ${input}; nothing to watch`);
  }

  // Use chokidar for reliable cross-platform file watching
  const chokidar = await import('chokidar');
  const watcher = chokidar.watch(files, {
    persistent: true,
    ignoreInitial: true,
  });

  const recompile = async (file: string): Promise<void> => {
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
  };
  watcher.on('change', (file) => {
    // What escapes recompile() is a throwing onRecompile callback; report it
    // and keep watching.
    recompile(file).catch((error: unknown) => {
      logger.error(`${timestamp()} Handling the change to ${path.basename(file)} failed: ${getErrorMessage(error)}`);
    });
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
