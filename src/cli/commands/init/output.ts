/**
 * What init prints for people (not --json) once the project is set up.
 *
 * Decides the status lines (created, skipped files, npm install, git init,
 * compile) and how the next steps name the project directory: not at all
 * when it is the current directory, relative when nearby, absolute when it
 * is two or more levels up.
 */
import * as path from 'path';
import { logger } from '../../utils/logger.js';
import type { InitConfig, StepResult } from './types.js';

interface SetupOutcome {
  filesSkipped: string[];
  installResult?: StepResult;
  gitResult?: StepResult;
  compileResult?: StepResult;
}

export function printStatusLines(config: InitConfig, outcome: SetupOutcome): void {
  const { filesSkipped, installResult, gitResult, compileResult } = outcome;
  logger.newline();
  logger.success(`Created ${logger.highlight(config.projectName)} ${logger.dim(`(${config.template}, ${config.format.toUpperCase()})`)}`);

  if (filesSkipped.length > 0) {
    logger.warn(`Skipped ${filesSkipped.length} existing file(s)`);
  }

  if (installResult) {
    if (installResult.success) {
      logger.success('Dependencies installed');
    } else {
      logger.warn(`npm install failed: ${installResult.error}`);
    }
  }

  if (gitResult) {
    if (gitResult.success) {
      logger.success('Git initialized');
    } else {
      logger.warn(`git init failed: ${gitResult.error}`);
    }
  }

  if (compileResult) {
    if (compileResult.success) {
      logger.success('Workflow compiled');
    } else {
      logger.warn(`Compile failed: ${compileResult.error}`);
    }
  }
}

/** The project directory as the next steps show it, or null when it is the current directory. */
export function displayDirFor(targetDir: string): string | null {
  const relDir = path.relative(process.cwd(), targetDir);
  return !relDir || relDir === '.' ? null : relDir.startsWith('../../') ? targetDir : relDir;
}
