/* eslint-disable no-console */
/**
 * Init command — scaffolds a new flow-weaver project interactively.
 * Supports persona-aware onboarding for nocode, low-code, vibe-coder, and expert users.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import input from '@inquirer/input';
import select, { Separator } from '@inquirer/select';
import confirm from '@inquirer/confirm';
import { ExitPromptError } from '@inquirer/core';
import { getWorkflowTemplate, workflowTemplates } from '../templates/index.js';
import { logger } from '../utils/logger.js';
import { compileCommand } from './compile.js';
import { runMcpSetupFromInit } from './mcp-setup.js';
import type { TModuleFormat } from '../../ast/types.js';
import type { PersonaId, UseCaseId } from './init-personas.js';
import {
  PERSONA_CHOICES,
  USE_CASE_CHOICES,
  USE_CASE_TEMPLATES,
  selectTemplateForPersona,
  getTemplateSubChoices,
  printNextSteps,
  generateReadme,
  generateExampleWorkflow,
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
  useCase?: UseCaseId;
  mcp: boolean;
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

const VALID_TEMPLATES = workflowTemplates.map((t) => t.id);
const VALID_PERSONAS: PersonaId[] = ['nocode', 'vibecoder', 'lowcode', 'expert'];
const VALID_USE_CASES: UseCaseId[] = ['data', 'ai', 'api', 'automation', 'cicd', 'minimal'];

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

  // 3. Template selection (persona-dependent)
  let template: string;
  let useCase: UseCaseId | undefined;

  if (hasExplicitTemplate) {
    // Direct --template flag bypasses everything
    template = options.template!;
    if (!VALID_TEMPLATES.includes(template)) {
      throw new Error(`Unknown template "${template}". Available: ${VALID_TEMPLATES.join(', ')}`);
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
          new Separator('── Durable ──'),
          { value: 'ai-agent-durable', name: 'ai-agent-durable', description: 'Durable agent with approval gate' },
          { value: 'ai-pipeline-durable', name: 'ai-pipeline-durable', description: 'Durable data pipeline' },
          new Separator('── Integration ──'),
          { value: 'webhook', name: 'webhook', description: 'HTTP webhook handler' },
          new Separator('── Utility ──'),
          { value: 'error-handler', name: 'error-handler', description: 'Error handling and recovery' },
          new Separator('── CI/CD ──'),
          { value: 'cicd-test-deploy', name: 'cicd-test-deploy', description: 'Test and deploy pipeline' },
          { value: 'cicd-docker', name: 'cicd-docker', description: 'Docker build and push' },
          { value: 'cicd-multi-env', name: 'cicd-multi-env', description: 'Multi-environment deploy' },
          { value: 'cicd-matrix', name: 'cicd-matrix', description: 'Matrix build strategy' },
        ],
        default: 'sequential',
      });
    }
  } else {
    // Non-expert: use-case categories
    if (options.useCase) {
      if (!VALID_USE_CASES.includes(options.useCase as UseCaseId)) {
        throw new Error(`Unknown use case "${options.useCase}". Available: ${VALID_USE_CASES.join(', ')}`);
      }
      useCase = options.useCase as UseCaseId;
    } else if (skipPrompts) {
      useCase = 'data';
    } else {
      useCase = await select<UseCaseId>({
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

  // 4. MCP setup (nocode + vibecoder only)
  let mcp: boolean;
  if (options.mcp !== undefined) {
    mcp = options.mcp;
  } else if (skipPrompts) {
    mcp = false;
  } else if (persona === 'nocode' || persona === 'vibecoder') {
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
    mcp,
  };
}

// ── Pure file generation ─────────────────────────────────────────────────────

export function generateProjectFiles(
  projectName: string,
  template: string,
  format: TModuleFormat = 'esm',
  persona: PersonaId = 'expert'
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
    dev: `npx flow-weaver compile src/${workflowFile} -o src && npx tsx src/main.ts`,
    start: 'npx tsx src/main.ts',
    compile: `npx flow-weaver compile src/${workflowFile} -o src`,
    validate: `npx flow-weaver validate src/${workflowFile}`,
    doctor: 'npx flow-weaver doctor',
  };

  // Add diagram script for non-expert personas
  if (persona !== 'expert') {
    scripts.diagram = `npx flow-weaver diagram src/${workflowFile} --format ascii-compact`;
  }

  const packageJsonContent: Record<string, unknown> = {
    name: projectName,
    version: '1.0.0',
    scripts,
    dependencies: {
      '@synergenius/flow-weaver': 'latest',
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

// ── CLI entrypoint ───────────────────────────────────────────────────────────

export async function initCommand(dirArg: string | undefined, options: InitOptions): Promise<void> {
  try {
    const config = await resolveInitConfig(dirArg, options);

    // Validate target directory
    const pkgPath = path.join(config.targetDir, 'package.json');
    if (fs.existsSync(pkgPath) && !config.force) {
      throw new Error(
        `${config.targetDir} already contains a package.json. Use --force to overwrite.`
      );
    }

    // Generate and scaffold
    const files = generateProjectFiles(config.projectName, config.template, config.format, config.persona);
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
    if (config.mcp && !options.json) {
      const spinner = logger.spinner('Configuring AI editors...');
      try {
        const result = await runMcpSetupFromInit();
        mcpConfigured = result.configured;
        if (result.configured.length > 0) {
          spinner.stop(`${result.configured.join(', ')} configured`);
        } else if (result.failed.length > 0) {
          spinner.fail('MCP setup failed');
        } else {
          spinner.stop('No AI editors detected');
        }
      } catch {
        spinner.fail('MCP setup failed');
      }
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

    // Read the workflow code for preview
    const workflowCode = files[`src/${workflowFile}`] ?? null;

    // Persona-specific rich output
    const relDir = path.relative(process.cwd(), config.targetDir);
    const displayDir =
      !relDir || relDir === '.' ? null : relDir.startsWith('../../') ? config.targetDir : relDir;

    printNextSteps({
      projectName: config.projectName,
      persona: config.persona,
      template: config.template,
      displayDir,
      installSkipped: !config.install,
      workflowCode,
      workflowFile,
      mcpConfigured,
    });
  } catch (err) {
    // Clean exit on Ctrl+C during prompts
    if (err instanceof ExitPromptError) {
      return;
    }
    throw err;
  }
}
