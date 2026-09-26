/**
 * Init command: scaffolds a new flow-weaver project interactively.
 * Supports persona-aware onboarding for nocode, low-code, vibe-coder, and expert users.
 *
 * initCommand decides the order of the steps. Each lives in ./init/:
 *
 * - config: flags, defaults and prompts into an InitConfig
 * - naming: accepted project names and the workflow names derived from them
 * - files: the files a project starts with, and writing them
 * - setup: npm install, git init, compiling the workflow, editor (MCP) setup
 * - output: the human status lines and how the project directory is shown
 * - agent-handoff: launching a CLI agent or writing an editor setup prompt
 *
 * The persona texts (choices, READMEs, prompts, next steps) are in
 * ./init-personas.ts.
 */

import * as path from 'path';
import { ExitPromptError } from '@inquirer/core';
import { loadPackTemplates } from '../templates/pack-loader.js';
import { isNonInteractive } from '../utils/interactive.js';
import { printNextSteps } from './init-personas.js';
import { resolveInitConfig } from './init/config.js';
import { workflowFileName } from './init/naming.js';
import { assertNoExistingProject, generateProjectFiles, scaffoldProject } from './init/files.js';
import { compileWorkflow, installDependencies, runGitInit, setUpEditors } from './init/setup.js';
import { displayDirFor, printStatusLines } from './init/output.js';
import { offerAgentHandoff } from './init/agent-handoff.js';
import type { InitOptions, InitReport } from './init/types.js';

export type { InitOptions, InitConfig, InitReport } from './init/types.js';
export { validateProjectName, toWorkflowName } from './init/naming.js';
export { resolveInitConfig, generateProjectFiles, scaffoldProject, runGitInit };
export { runNpmInstall } from './init/setup.js';
export { handleAgentHandoff } from './init/agent-handoff.js';

// Shared with mcp-setup, which init itself imports; re-exported for callers.
export { isNonInteractive };

// ── CLI entrypoint ───────────────────────────────────────────────────────────

export async function initCommand(dirArg: string | undefined, options: InitOptions): Promise<void> {
  try {
    // Load templates contributed by installed marketplace packs
    await loadPackTemplates(process.cwd());

    const config = await resolveInitConfig(dirArg, options);
    assertNoExistingProject(config.targetDir, config.force);

    // Generate and scaffold
    const files = generateProjectFiles(config.projectName, config.template, config.format, config.persona);
    const { filesCreated, filesSkipped } = scaffoldProject(config.targetDir, files, {
      force: config.force,
    });

    // Post-scaffold actions
    const installResult = config.install ? installDependencies(config.targetDir, !options.json) : undefined;
    const gitResult = config.git ? runGitInit(config.targetDir) : undefined;

    // Auto-compile the workflow so `npm start` works immediately
    const workflowFile = workflowFileName(config.projectName);
    const compileResult = options.json
      ? undefined
      : await compileWorkflow(path.join(config.targetDir, 'src', workflowFile), config.format);

    const mcpResult = config.mcp && !options.json ? await setUpEditors() : undefined;
    const mcpConfigured = mcpResult?.configured;

    if (options.json) {
      const report: InitReport = {
        projectDir: config.targetDir,
        filesCreated,
        filesSkipped,
        template: config.template,
        format: config.format,
        persona: config.persona,
        installResult,
        gitResult,
        mcpConfigured,
        agentLaunched: false,
      };
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    printStatusLines(config, { filesSkipped, installResult, gitResult, compileResult });

    const workflowCode = files[`src/${workflowFile}`] ?? null;
    const displayDir = displayDirFor(config.targetDir);

    // If an agent was spawned it takes over, and Ctrl+C at a handoff prompt
    // ends init: either way nothing more is printed.
    if (await offerAgentHandoff(config, options, filesCreated, mcpResult)) {
      return;
    }

    printNextSteps({
      projectName: config.projectName,
      persona: config.persona,
      template: config.template,
      displayDir,
      installSkipped: !config.install,
      workflowCode,
      workflowFile,
      mcpConfigured,
      agentLaunched: false,
      compiled: compileResult?.success,
    });
  } catch (err) {
    // Clean exit on Ctrl+C during prompts
    if (err instanceof ExitPromptError) {
      return;
    }
    throw err;
  }
}
