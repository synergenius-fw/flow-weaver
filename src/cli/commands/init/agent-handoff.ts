/**
 * Handing the new project to an AI agent once init is done.
 *
 * offerAgentHandoff decides whether to offer anything: not with --no-agent,
 * --yes or without a terminal, and only when a CLI agent is on the PATH or
 * editor setup found one. handleAgentHandoff then offers to launch the CLI
 * agent (Claude Code before Codex) with a setup prompt, and otherwise offers
 * a setup prompt for the editor: printed, saved as PROJECT_SETUP.md (and
 * added to .gitignore), both, or skipped.
 */
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import select from '@inquirer/select';
import confirm from '@inquirer/confirm';
import { ExitPromptError } from '@inquirer/core';
import { logger } from '../../utils/logger.js';
import { isNonInteractive } from '../../utils/interactive.js';
import { CLI_TOOL_BINARY, detectCliTools } from '../mcp-setup.js';
import type { McpSetupFromInitResult, ToolId } from '../mcp-setup.js';
import type { PersonaId } from '../init-personas.js';
import {
  generateAgentPrompt,
  generateEditorPrompt,
  generateSetupPromptFile,
  printCopyablePrompt,
  AGENT_LAUNCH_DEFAULTS,
} from '../init-personas.js';
import type { InitConfig, InitOptions } from './types.js';

interface AgentHandoffOptions {
  projectName: string;
  persona: PersonaId;
  template: string;
  targetDir: string;
  cliTools: ToolId[];
  guiTools: ToolId[];
  filesCreated: string[];
  useCaseDescription?: string;
}

/**
 * Offers the handoff when it applies. Decoupled from MCP: even if MCP
 * wasn't run, it checks for CLI tools on the PATH. Returns true when init
 * should print nothing more: an agent was launched and takes over, or the
 * user pressed Ctrl+C at a handoff prompt. Any other failure only skips the
 * handoff.
 */
export async function offerAgentHandoff(
  config: InitConfig,
  options: InitOptions,
  filesCreated: string[],
  mcpResult: McpSetupFromInitResult | undefined
): Promise<boolean> {
  let cliTools: ToolId[] = mcpResult ? mcpResult.cliTools : [];
  const guiTools: ToolId[] = mcpResult ? mcpResult.guiTools : [];

  const skipAgent = options.agent === false || options.yes || isNonInteractive();
  if (skipAgent) return false;

  // If MCP didn't run or found no CLI tools, do a quick binary check
  if (cliTools.length === 0) {
    try {
      cliTools = await detectCliTools();
    } catch {
      // Non-fatal
    }
  }

  const hasTools = cliTools.length > 0 || guiTools.length > 0;
  if (!hasTools) return false;

  try {
    return await handleAgentHandoff({
      projectName: config.projectName,
      persona: config.persona,
      template: config.template,
      targetDir: config.targetDir,
      cliTools,
      guiTools,
      filesCreated,
      useCaseDescription: config.useCaseDescription,
    });
  } catch (err) {
    if (err instanceof ExitPromptError) return true;
    // Non-fatal: just skip agent handoff
    return false;
  }
}

/**
 * After init + MCP setup, offer to launch a CLI agent or generate a prompt for GUI editors.
 * Returns true if a CLI agent was spawned (init should exit and let the agent take over).
 */
export async function handleAgentHandoff(opts: AgentHandoffOptions): Promise<boolean> {
  // Step 1: If CLI agent available, offer to launch it
  if (opts.cliTools.length > 0 && (await offerCliAgentLaunch(opts))) {
    return true;
  }

  // Step 2: If GUI editors configured (or user declined CLI), offer prompt options
  if (opts.guiTools.length > 0 || opts.cliTools.length > 0) {
    await offerEditorPrompt(opts);
  }

  return false;
}

/** Asks to launch the first CLI agent (claude before codex) and spawns it. True when it was spawned. */
async function offerCliAgentLaunch(opts: AgentHandoffOptions): Promise<boolean> {
  const { projectName, persona, template, targetDir, cliTools, useCaseDescription } = opts;
  const toolId = cliTools[0]; // Prefer first (claude > codex)
  const binary = CLI_TOOL_BINARY[toolId];
  const displayName = toolId === 'claude' ? 'Claude Code' : 'Codex';

  const launchDefault = AGENT_LAUNCH_DEFAULTS[persona];
  const shouldLaunch = await confirm({
    message: `Launch ${displayName} to set up your project?`,
    default: launchDefault,
  });

  if (!shouldLaunch || !binary) return false;

  const prompt = generateAgentPrompt(projectName, persona, template, useCaseDescription);
  logger.newline();
  logger.log(`  ${logger.dim(`Starting ${displayName}...`)}`);
  logger.newline();

  const child = spawn(binary, [prompt], {
    cwd: targetDir,
    stdio: 'inherit',
    env: { ...process.env },
  });
  child.on('error', (err) => {
    logger.error(`Failed to start ${displayName}: ${err.message}`);
  });

  return true;
}

/** Offers the editor setup prompt: printed, saved as PROJECT_SETUP.md, both, or skipped. */
async function offerEditorPrompt(opts: AgentHandoffOptions): Promise<void> {
  const { projectName, persona, template, useCaseDescription } = opts;
  const promptAction = await select<'terminal' | 'file' | 'both' | 'skip'>({
    message: 'Generate a setup prompt for your editor?',
    choices: [
      { value: 'terminal', name: 'Print to terminal', description: 'Copy and paste into your editor' },
      { value: 'file', name: 'Save as file', description: 'Write PROJECT_SETUP.md to your project' },
      { value: 'both', name: 'Both' },
      { value: 'skip', name: 'Skip' },
    ],
    default: 'terminal',
  });

  if (promptAction === 'skip') return;

  const editorPrompt = generateEditorPrompt(projectName, persona, template, useCaseDescription);

  if (promptAction === 'terminal' || promptAction === 'both') {
    printCopyablePrompt(editorPrompt);
  }

  if (promptAction === 'file' || promptAction === 'both') {
    writeSetupPromptFile(opts);
  }
}

/** Writes PROJECT_SETUP.md and adds it to an existing .gitignore. */
function writeSetupPromptFile(opts: AgentHandoffOptions): void {
  const { projectName, persona, template, targetDir, filesCreated, useCaseDescription } = opts;
  const setupContent = generateSetupPromptFile(projectName, persona, template, filesCreated, useCaseDescription);
  const setupPath = path.join(targetDir, 'PROJECT_SETUP.md');
  fs.writeFileSync(setupPath, setupContent, 'utf8');

  // Add to .gitignore
  const gitignorePath = path.join(targetDir, '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    const existing = fs.readFileSync(gitignorePath, 'utf8');
    if (!existing.includes('PROJECT_SETUP.md')) {
      fs.appendFileSync(gitignorePath, 'PROJECT_SETUP.md\n', 'utf8');
    }
  }

  logger.newline();
  logger.success(`Wrote ${logger.highlight('PROJECT_SETUP.md')} ${logger.dim('(delete after first setup)')}`);
}
