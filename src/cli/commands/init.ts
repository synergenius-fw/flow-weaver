/* eslint-disable no-console */
/**
 * Init command — scaffolds a new flow-weaver project interactively.
 * Supports persona-aware onboarding for nocode, low-code, vibe-coder, and expert users.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync, spawn } from 'child_process';
import input from '@inquirer/input';
import select, { Separator } from '@inquirer/select';
import confirm from '@inquirer/confirm';
import { ExitPromptError } from '@inquirer/core';
import { getWorkflowTemplate, getAllWorkflowTemplates } from '../templates/index.js';
import { loadPackTemplates } from '../templates/pack-loader.js';
import { logger } from '../utils/logger.js';
import { compileCommand } from './compile.js';
import { runMcpSetupFromInit, CLI_TOOL_BINARY, detectCliTools } from './mcp-setup.js';
import type { ToolId } from './mcp-setup.js';
import type { TModuleFormat } from '../../ast/types.js';
import type { PersonaId } from './init-personas.js';
import {
  PERSONA_CHOICES,
  PERSONA_CONFIRMATIONS,
  USE_CASE_CHOICES,
  selectTemplateForPersona,
  getTemplateSubChoices,
  printNextSteps,
  generateReadme,
  generateExampleWorkflow,
  generateAgentPrompt,
  generateEditorPrompt,
  generateSetupPromptFile,
  printCopyablePrompt,
  AGENT_LAUNCH_DEFAULTS,
} from './init-personas.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface InitOptions {
  name?: string;
  template?: string;
  format?: TModuleFormat;
  yes?: boolean;
  install?: boolean;
  git?: boolean;
  force?: boolean;
  json?: boolean;
  preset?: string;
  useCase?: string;
  mcp?: boolean;
  agent?: boolean;
}

export interface InitConfig {
  projectName: string;
  targetDir: string;
  template: string;
  format: TModuleFormat;
  install: boolean;
  git: boolean;
  force: boolean;
  persona: PersonaId;
  useCase?: string;
  /** Free-text description when user picked "Something else" */
  useCaseDescription?: string;
  mcp: boolean;
  installWeaver: boolean;
}

export interface InitReport {
  projectDir: string;
  filesCreated: string[];
  filesSkipped: string[];
  template: string;
  format: TModuleFormat;
  persona: PersonaId;
  installResult?: { success: boolean; error?: string };
  gitResult?: { success: boolean; error?: string };
  mcpConfigured?: string[];
  agentLaunched?: boolean;
}

// ── Utilities ────────────────────────────────────────────────────────────────

const PROJECT_NAME_RE = /^[a-zA-Z0-9][-a-zA-Z0-9_.]*$/;

export function validateProjectName(name: string): string | true {
  if (!name) return 'Project name cannot be empty';
  if (name.length > 214) return 'Project name must be at most 214 characters';
  if (!PROJECT_NAME_RE.test(name)) {
    return 'Project name must start with a letter or digit and contain only letters, digits, hyphens, dots, and underscores';
  }
  return true;
}

export function toWorkflowName(projectName: string): string {
  const camel = projectName
    .replace(/[-_.]+(.)?/g, (_, c: string | undefined) => (c ? c.toUpperCase() : ''))
    .replace(/^[^a-zA-Z_$]+/, '')
    .replace(/^./, (c) => c.toLowerCase());
  return (camel || 'myProject') + 'Workflow';
}

export function isNonInteractive(): boolean {
  return !process.stdin.isTTY;
}

// Dynamic: includes core templates plus any registered by extensions/packs
function getValidTemplates(): string[] {
  return getAllWorkflowTemplates().map((t) => t.id);
}
const VALID_PERSONAS: PersonaId[] = ['nocode', 'vibecoder', 'lowcode', 'expert'];
// Dynamic: includes core use cases plus any registered by extensions/packs
function getValidUseCases(): string[] {
  return USE_CASE_CHOICES.map((c) => c.value);
}

// ── Config resolution (prompts) ──────────────────────────────────────────────

export async function resolveInitConfig(
  dirArg: string | undefined,
  options: InitOptions
): Promise<InitConfig> {
  const skipPrompts = options.yes || isNonInteractive();
  const force = options.force ?? false;
  const hasExplicitTemplate = !!options.template;

  // 1. Project name (unchanged)
  let projectName: string;
  if (options.name) {
    projectName = options.name;
  } else if (dirArg) {
    projectName = path.basename(dirArg);
  } else if (skipPrompts) {
    projectName = 'my-project';
  } else {
    projectName = await input({
      message: 'Project name:',
      default: 'my-project',
      validate: (v) => validateProjectName(v),
    });
  }

  const valid = validateProjectName(projectName);
  if (valid !== true) {
    throw new Error(valid);
  }

  const targetDir = path.resolve(dirArg ?? projectName);

  // 2. Persona
  let persona: PersonaId;
  if (options.preset) {
    if (!VALID_PERSONAS.includes(options.preset as PersonaId)) {
      throw new Error(`Unknown preset "${options.preset}". Available: ${VALID_PERSONAS.join(', ')}`);
    }
    persona = options.preset as PersonaId;
  } else if (skipPrompts || hasExplicitTemplate) {
    persona = 'expert';
  } else {
    persona = await select<PersonaId>({
      message: 'How do you plan to build?',
      choices: PERSONA_CHOICES,
      default: 'vibecoder',
    });
  }

  // Print persona confirmation (interactive only)
  if (!skipPrompts) {
    const confirmation = PERSONA_CONFIRMATIONS[persona];
    if (confirmation) {
      logger.log(`  ${logger.dim(confirmation)}`);
      logger.newline();
    }
  }

  // 3. Template selection (persona-dependent)
  let template: string;
  let useCase: string | undefined;

  if (hasExplicitTemplate) {
    // Direct --template flag bypasses everything
    template = options.template!;
    if (!getValidTemplates().includes(template)) {
      throw new Error(`Unknown template "${template}". Available: ${getValidTemplates().join(', ')}`);
    }
  } else if (persona === 'expert') {
    // Expert: show today's flat template list
    if (skipPrompts) {
      template = 'sequential';
    } else {
      template = await select<string>({
        message: 'Workflow template:',
        choices: [
          new Separator('── Data Processing ──'),
          { value: 'sequential', name: 'sequential', description: 'Linear pipeline' },
          { value: 'foreach', name: 'foreach', description: 'Batch iteration' },
          { value: 'aggregator', name: 'aggregator', description: 'Collect and aggregate results' },
          new Separator('── Automation ──'),
          { value: 'conditional', name: 'conditional', description: 'Route by condition' },
          new Separator('── AI ──'),
          { value: 'ai-agent', name: 'ai-agent', description: 'LLM agent with tool calling' },
          { value: 'ai-react', name: 'ai-react', description: 'ReAct pattern' },
          { value: 'ai-rag', name: 'ai-rag', description: 'Retrieval-Augmented Generation' },
          { value: 'ai-chat', name: 'ai-chat', description: 'Conversational AI' },
          new Separator('── Integration ──'),
          { value: 'webhook', name: 'webhook', description: 'HTTP webhook handler' },
          new Separator('── Utility ──'),
          { value: 'error-handler', name: 'error-handler', description: 'Error handling and recovery' },
        ],
        default: 'sequential',
      });
    }
  } else {
    // Non-expert: use-case categories
    if (options.useCase) {
      if (!getValidUseCases().includes(options.useCase)) {
        throw new Error(`Unknown use case "${options.useCase}". Available: ${getValidUseCases().join(', ')}`);
      }
      useCase = options.useCase;
    } else if (skipPrompts) {
      useCase = 'data';
    } else {
      useCase = await select<string>({
        message: 'What are you building?',
        choices: USE_CASE_CHOICES,
        default: 'data',
      });
    }

    const selection = selectTemplateForPersona(persona, useCase);

    if (selection.choices && !skipPrompts) {
      // Lowcode with multiple choices: show sub-select
      template = await select<string>({
        message: 'Pick a template:',
        choices: getTemplateSubChoices(selection.choices),
        default: selection.template,
      });
    } else {
      template = selection.template;
    }
  }

  // 3b. "Something else" follow-up: ask what they're building
  let useCaseDescription: string | undefined;
  if (useCase === 'minimal' && !skipPrompts && persona !== 'expert') {
    useCaseDescription = await input({
      message: 'Briefly describe what you want to build:',
    });
    if (useCaseDescription) {
      useCaseDescription = useCaseDescription.trim();
    }
    if (!useCaseDescription) useCaseDescription = undefined;
  }

  // 3c. Weaver AI assistant opt-in
  let installWeaver: boolean;
  if (skipPrompts) {
    installWeaver = false;
  } else {
    installWeaver = await confirm({
      message: 'Install Weaver AI assistant? (Recommended)\n  Weaver helps you create, modify, and manage workflows with AI.',
      default: true,
    });
  }

  // 4. MCP setup (nocode, vibecoder, lowcode: prompt; expert: skip unless --mcp)
  let mcp: boolean;
  if (options.mcp !== undefined) {
    mcp = options.mcp;
  } else if (skipPrompts) {
    mcp = false;
  } else if (persona === 'nocode' || persona === 'vibecoder' || persona === 'lowcode') {
    mcp = await confirm({
      message: 'Set up AI editor integration? (Claude Code, Cursor, VS Code, etc.)',
      default: true,
    });
  } else {
    mcp = false;
  }

  // 5. Install deps (expert: prompt, others: auto-yes)
  let installDeps: boolean;
  if (options.install !== undefined) {
    installDeps = options.install;
  } else if (skipPrompts || persona !== 'expert') {
    installDeps = true;
  } else {
    installDeps = await confirm({ message: 'Install dependencies (npm install)?', default: true });
  }

  // 6. Git init (expert: prompt, others: auto-yes)
  let gitInit: boolean;
  if (options.git !== undefined) {
    gitInit = options.git;
  } else if (skipPrompts || persona !== 'expert') {
    gitInit = true;
  } else {
    gitInit = await confirm({ message: 'Initialize a git repository?', default: true });
  }

  // 7. Module format (expert only)
  let format: TModuleFormat;
  if (options.format) {
    format = options.format;
    if (format !== 'esm' && format !== 'cjs') {
      throw new Error(`Invalid format "${format}". Use "esm" or "cjs".`);
    }
  } else if (skipPrompts || persona !== 'expert') {
    format = 'esm';
  } else {
    format = await select<TModuleFormat>({
      message: 'Module format:',
      choices: [
        { value: 'esm', name: 'ESM (Recommended)', description: 'ECMAScript modules (import/export)' },
        { value: 'cjs', name: 'CommonJS', description: 'CommonJS modules (require/module.exports)' },
      ],
      default: 'esm',
    });
  }

  return {
    projectName,
    targetDir,
    template,
    format,
    install: installDeps,
    git: gitInit,
    force,
    persona,
    useCase,
    useCaseDescription,
    mcp,
    installWeaver,
  };
}

// ── Pure file generation ─────────────────────────────────────────────────────

export function generateProjectFiles(
  projectName: string,
  template: string,
  format: TModuleFormat = 'esm',
  persona: PersonaId = 'expert',
  installWeaver: boolean = false
): Record<string, string> {
  const workflowName = toWorkflowName(projectName);
  const workflowFile = `${projectName}-workflow.ts`;

  const tmpl = getWorkflowTemplate(template);
  if (!tmpl) {
    throw new Error(`Unknown template "${template}"`);
  }

  const workflowCode = tmpl.generate({ workflowName });

  // Package.json
  const scripts: Record<string, string> = {
    dev: `npx fw compile src/${workflowFile} -o src && npx tsx src/main.ts`,
    start: 'npx tsx src/main.ts',
    compile: `npx fw compile src/${workflowFile} -o src`,
    validate: `npx fw validate src/${workflowFile}`,
    doctor: 'npx fw doctor',
  };

  // Add diagram script for non-expert personas
  if (persona !== 'expert') {
    scripts.diagram = `npx fw diagram src/${workflowFile} --format ascii-compact`;
  }

  const packageJsonContent: Record<string, unknown> = {
    name: projectName,
    version: '1.0.0',
    scripts,
    dependencies: {
      '@synergenius/flow-weaver': 'latest',
      ...(installWeaver ? { '@synergenius/flow-weaver-pack-weaver': 'latest' } : {}),
    },
    devDependencies: {
      typescript: '^5.3.0',
      '@types/node': '^20.11.0',
      tsx: '^4.21.0',
    },
  };

  if (format === 'esm') {
    packageJsonContent.type = 'module';
  }

  const packageJson = JSON.stringify(packageJsonContent, null, 2);

  // tsconfig.json
  const tsconfigContent = {
    compilerOptions: {
      target: 'ES2020',
      module: format === 'esm' ? 'ES2020' : 'CommonJS',
      moduleResolution: format === 'esm' ? 'bundler' : 'node',
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      outDir: 'dist',
      rootDir: 'src',
      types: ['node'],
    },
    include: ['src'],
  };

  const tsconfigJson = JSON.stringify(tsconfigContent, null, 2);

  // main.ts
  const workflowJsFile = workflowFile.replace(/\.ts$/, '.js');
  let mainTs: string;
  if (format === 'esm') {
    mainTs = [
      '/**',
      ` * ${projectName} — workflow runner`,
      ' *',
      ' * Usage:',
      ' *   npm run dev      compile workflow + run this file',
      ' *   npm start        run without recompiling',
      ' *   npm run compile  compile only',
      ' */',
      '',
      `import { ${workflowName} } from './${workflowJsFile}';`,
      '',
      'try {',
      `  const result = ${workflowName}(true, { data: { message: 'hello world' } });`,
      '  console.log(result);',
      '} catch (e) {',
      "  if (e instanceof Error && e.message.startsWith('Compile with:')) {",
      "    console.error('Workflow not compiled yet. Run: npm run dev');",
      '    process.exit(1);',
      '  }',
      '  throw e;',
      '}',
      '',
    ].join('\n');
  } else {
    mainTs = [
      '/**',
      ` * ${projectName} — workflow runner`,
      ' *',
      ' * Usage:',
      ' *   npm run dev      compile workflow + run this file',
      ' *   npm start        run without recompiling',
      ' *   npm run compile  compile only',
      ' */',
      '',
      `const { ${workflowName} } = require('./${workflowJsFile}');`,
      '',
      'try {',
      `  const result = ${workflowName}(true, { data: { message: 'hello world' } });`,
      '  console.log(result);',
      '} catch (e) {',
      "  if (e instanceof Error && e.message.startsWith('Compile with:')) {",
      "    console.error('Workflow not compiled yet. Run: npm run dev');",
      '    process.exit(1);',
      '  }',
      '  throw e;',
      '}',
      '',
    ].join('\n');
  }

  const gitignore = `node_modules/\ndist/\n.tsbuildinfo\n`;
  const configYaml = `defaultFileType: ts\n`;

  const files: Record<string, string> = {
    'package.json': packageJson,
    'tsconfig.json': tsconfigJson,
    [`src/${workflowFile}`]: workflowCode,
    'src/main.ts': mainTs,
    '.gitignore': gitignore,
    '.flowweaver/config.yaml': configYaml,
  };

  // Add README for all personas
  files['README.md'] = generateReadme(projectName, persona, template);

  // Add example workflow for lowcode persona
  if (persona === 'lowcode') {
    files['examples/example-workflow.ts'] = generateExampleWorkflow(projectName);
  }

  // Add Weaver config if opted in
  if (installWeaver) {
    files['.weaver.json'] = JSON.stringify({ provider: 'auto', approval: 'auto' }, null, 2) + '\n';
  }

  return files;
}

// ── Filesystem writer ────────────────────────────────────────────────────────

export function scaffoldProject(
  targetDir: string,
  files: Record<string, string>,
  options: { force: boolean }
): { filesCreated: string[]; filesSkipped: string[] } {
  const filesCreated: string[] = [];
  const filesSkipped: string[] = [];

  for (const [relativePath, content] of Object.entries(files)) {
    const absPath = path.join(targetDir, relativePath);
    const dir = path.dirname(absPath);
    fs.mkdirSync(dir, { recursive: true });

    if (fs.existsSync(absPath) && !options.force) {
      filesSkipped.push(relativePath);
      continue;
    }

    fs.writeFileSync(absPath, content, 'utf8');
    filesCreated.push(relativePath);
  }

  return { filesCreated, filesSkipped };
}

// ── Post-scaffold actions ────────────────────────────────────────────────────

export function runNpmInstall(targetDir: string): { success: boolean; error?: string } {
  try {
    execSync('npm install', { cwd: targetDir, stdio: 'pipe', timeout: 120_000 });
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

export function runGitInit(targetDir: string): { success: boolean; error?: string } {
  try {
    execSync('git init', { cwd: targetDir, stdio: 'pipe', timeout: 10_000 });
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

// ── Agent handoff ─────────────────────────────────────────────────────────────

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
 * After init + MCP setup, offer to launch a CLI agent or generate a prompt for GUI editors.
 * Returns true if a CLI agent was spawned (init should exit and let the agent take over).
 */
export async function handleAgentHandoff(opts: AgentHandoffOptions): Promise<boolean> {
  const { projectName, persona, template, targetDir, cliTools, guiTools, filesCreated, useCaseDescription } = opts;

  // Step 1: If CLI agent available, offer to launch it
  if (cliTools.length > 0) {
    const toolId = cliTools[0]; // Prefer first (claude > codex)
    const binary = CLI_TOOL_BINARY[toolId];
    const displayName = toolId === 'claude' ? 'Claude Code' : 'Codex';

    const launchDefault = AGENT_LAUNCH_DEFAULTS[persona];
    const shouldLaunch = await confirm({
      message: `Launch ${displayName} to set up your project?`,
      default: launchDefault,
    });

    if (shouldLaunch && binary) {
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
  }

  // Step 2: If GUI editors configured (or user declined CLI), offer prompt options
  if (guiTools.length > 0 || cliTools.length > 0) {
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

    if (promptAction === 'skip') return false;

    const editorPrompt = generateEditorPrompt(projectName, persona, template, useCaseDescription);

    if (promptAction === 'terminal' || promptAction === 'both') {
      printCopyablePrompt(editorPrompt);
    }

    if (promptAction === 'file' || promptAction === 'both') {
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
  }

  return false;
}

// ── CLI entrypoint ───────────────────────────────────────────────────────────

export async function initCommand(dirArg: string | undefined, options: InitOptions): Promise<void> {
  try {
    // Load templates contributed by installed marketplace packs
    await loadPackTemplates(process.cwd());

    const config = await resolveInitConfig(dirArg, options);

    // Validate target directory
    const pkgPath = path.join(config.targetDir, 'package.json');
    if (fs.existsSync(pkgPath) && !config.force) {
      throw new Error(
        `${config.targetDir} already contains a package.json. Use --force to overwrite.`
      );
    }

    // Generate and scaffold
    const files = generateProjectFiles(config.projectName, config.template, config.format, config.persona, config.installWeaver);
    const { filesCreated, filesSkipped } = scaffoldProject(config.targetDir, files, {
      force: config.force,
    });

    // Post-scaffold actions
    let installResult: { success: boolean; error?: string } | undefined;
    if (config.install) {
      const spinner = !options.json ? logger.spinner('Installing dependencies...') : null;
      installResult = runNpmInstall(config.targetDir);
      if (spinner) {
        if (installResult.success) spinner.stop('Dependencies installed');
        else spinner.fail(`npm install failed: ${installResult.error}`);
      }
    }

    let gitResult: { success: boolean; error?: string } | undefined;
    if (config.git) {
      gitResult = runGitInit(config.targetDir);
    }

    // Auto-compile the workflow so `npm start` works immediately
    const workflowFile = `${config.projectName}-workflow.ts`;
    const workflowPath = path.join(config.targetDir, 'src', workflowFile);
    let compileResult: { success: boolean; error?: string } | undefined;
    if (!options.json && fs.existsSync(workflowPath)) {
      try {
        await compileCommand(workflowPath, { format: config.format });
        compileResult = { success: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        compileResult = { success: false, error: message };
      }
    }

    // MCP setup
    let mcpConfigured: string[] | undefined;
    let mcpResult: Awaited<ReturnType<typeof runMcpSetupFromInit>> | undefined;
    if (config.mcp && !options.json) {
      const spinner = logger.spinner('Detecting AI editors...');
      try {
        mcpResult = await runMcpSetupFromInit();
        mcpConfigured = mcpResult.configured;
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
    }

    // Agent handoff
    let agentLaunched = false;
    let mcpCliTools: ToolId[] = [];
    let mcpGuiTools: ToolId[] = [];
    if (mcpResult) {
      mcpCliTools = mcpResult.cliTools;
      mcpGuiTools = mcpResult.guiTools;
    }

    // Build report
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

    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    // Human output — status lines
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

    if (config.installWeaver) {
      logger.success('Weaver AI assistant installed');
      logger.newline();
      logger.log('  Weaver installed. Try:');
      logger.log('    flow-weaver weaver assistant      # AI assistant');
      logger.log('    flow-weaver weaver bot "..."      # create workflows with AI');
      logger.log('    flow-weaver weaver examples       # see what\'s possible');
      logger.newline();
    }

    // Read the workflow code for preview
    const workflowCode = files[`src/${workflowFile}`] ?? null;

    // Persona-specific rich output
    const relDir = path.relative(process.cwd(), config.targetDir);
    const displayDir =
      !relDir || relDir === '.' ? null : relDir.startsWith('../../') ? config.targetDir : relDir;

    // Agent handoff: offer to launch CLI agent or generate prompt for GUI editors.
    // Decoupled from MCP: even if MCP wasn't run, check for available CLI tools.
    const skipAgent = options.agent === false || options.yes || isNonInteractive();
    if (!skipAgent) {
      // If MCP didn't run or found no CLI tools, do a quick binary check
      if (mcpCliTools.length === 0) {
        try {
          mcpCliTools = await detectCliTools();
        } catch {
          // Non-fatal
        }
      }

      const hasTools = mcpCliTools.length > 0 || mcpGuiTools.length > 0;
      if (hasTools) {
        try {
          agentLaunched = await handleAgentHandoff({
            projectName: config.projectName,
            persona: config.persona,
            template: config.template,
            targetDir: config.targetDir,
            cliTools: mcpCliTools,
            guiTools: mcpGuiTools,
            filesCreated,
            useCaseDescription: config.useCaseDescription,
          });
          report.agentLaunched = agentLaunched;
        } catch (err) {
          if (err instanceof ExitPromptError) return;
          // Non-fatal: just skip agent handoff
        }
      }
    }

    // If an agent was spawned, it takes over. Print minimal output.
    if (agentLaunched) {
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
      agentLaunched,
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
