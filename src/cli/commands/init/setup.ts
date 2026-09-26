/**
 * The steps init runs once the files are written. None of them stops init:
 * each reports how it went instead. npm install (behind a spinner unless the
 * output is JSON), git init, compiling the scaffolded workflow so `npm start`
 * works at once, and configuring the AI editors it detects over MCP, with a
 * line per configured or failed editor.
 */
import * as fs from 'fs';
import { execSync } from 'child_process';
import { logger } from '../../utils/logger.js';
import { compileCommand } from '../compile.js';
import { runMcpSetupFromInit } from '../mcp-setup.js';
import type { McpSetupFromInitResult } from '../mcp-setup.js';
import type { TModuleFormat } from '../../../ast/types.js';
import { getErrorMessage } from '../../../utils/error-utils.js';
import type { StepResult } from './types.js';

export function runNpmInstall(targetDir: string): { success: boolean; error?: string } {
  try {
    execSync('npm install', { cwd: targetDir, stdio: 'pipe', timeout: 120_000 });
    return { success: true };
  } catch (err) {
    const message = getErrorMessage(err);
    return { success: false, error: message };
  }
}

export function runGitInit(targetDir: string): { success: boolean; error?: string } {
  try {
    execSync('git init', { cwd: targetDir, stdio: 'pipe', timeout: 10_000 });
    return { success: true };
  } catch (err) {
    const message = getErrorMessage(err);
    return { success: false, error: message };
  }
}

/** npm install, behind a spinner when showProgress is set. */
export function installDependencies(targetDir: string, showProgress: boolean): StepResult {
  const spinner = showProgress ? logger.spinner('Installing dependencies...') : null;
  const installResult = runNpmInstall(targetDir);
  if (spinner) {
    if (installResult.success) spinner.stop('Dependencies installed');
    else spinner.fail(`npm install failed: ${installResult.error}`);
  }
  return installResult;
}

/** Compiles the scaffolded workflow in place; undefined when the file is not there. */
export async function compileWorkflow(workflowPath: string, format: TModuleFormat): Promise<StepResult | undefined> {
  if (!fs.existsSync(workflowPath)) return undefined;
  try {
    await compileCommand(workflowPath, { format });
    return { success: true };
  } catch (err) {
    const message = getErrorMessage(err);
    return { success: false, error: message };
  }
}

/**
 * Detects and configures AI editors, printing a line per configured or
 * failed editor. Undefined when setup itself failed.
 */
export async function setUpEditors(): Promise<McpSetupFromInitResult | undefined> {
  let mcpResult: McpSetupFromInitResult | undefined;
  const spinner = logger.spinner('Detecting AI editors...');
  try {
    mcpResult = await runMcpSetupFromInit();
    const mcpConfigured = mcpResult.configured;
    spinner.stop();

    // Per-tool status lines
    for (const t of mcpResult.detected) {
      if (!t.detected) continue;
      const wasConfigured = mcpConfigured.includes(t.displayName);
      if (wasConfigured) {
        logger.success(`${t.displayName} configured`);
      }
    }
    if (mcpResult.failed.length > 0) {
      for (const name of mcpResult.failed) {
        logger.warn(`${name} failed to configure`);
      }
    }
    if (mcpResult.detected.every((t) => !t.detected)) {
      logger.log(`  ${logger.dim('No AI editors detected')}`);
    }
  } catch {
    spinner.fail('MCP setup failed');
  }
  return mcpResult;
}
