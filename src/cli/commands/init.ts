/* eslint-disable no-console */
/**
 * Init command — scaffolds a new flow-weaver project interactively
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
import type { TModuleFormat } from '../../ast/types.js';

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
}

export interface InitConfig {
  projectName: string;
  targetDir: string;
  template: string;
  format: TModuleFormat;
  install: boolean;
  git: boolean;
  force: boolean;
}

export interface InitReport {
  projectDir: string;
  filesCreated: string[];
  filesSkipped: string[];
  template: string;
  format: TModuleFormat;
  installResult?: { success: boolean; error?: string };
  gitResult?: { success: boolean; error?: string };
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

// ── Config resolution (prompts) ──────────────────────────────────────────────

export async function resolveInitConfig(
  dirArg: string | undefined,
  options: InitOptions
): Promise<InitConfig> {
  const skipPrompts = options.yes || isNonInteractive();
  const force = options.force ?? false;

  // 1. Project name
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

  // Target directory
  const targetDir = path.resolve(dirArg ?? projectName);

  // 2. Template
  let template: string;
  if (options.template) {
    template = options.template;
    if (!VALID_TEMPLATES.includes(template)) {
      throw new Error(`Unknown template "${template}". Available: ${VALID_TEMPLATES.join(', ')}`);
    }
  } else if (skipPrompts) {
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
        {
          value: 'error-handler',
          name: 'error-handler',
          description: 'Error handling and recovery',
        },
      ],
      default: 'sequential',
    });
  }

  // 3. Install deps?
  let installDeps: boolean;
  if (options.install !== undefined) {
    installDeps = options.install;
  } else if (skipPrompts) {
    installDeps = true;
  } else {
    installDeps = await confirm({ message: 'Install dependencies (npm install)?', default: true });
  }

  // 4. Git init?
  let gitInit: boolean;
  if (options.git !== undefined) {
    gitInit = options.git;
  } else if (skipPrompts) {
    gitInit = true;
  } else {
    gitInit = await confirm({ message: 'Initialize a git repository?', default: true });
  }

  // 5. Module format
  let format: TModuleFormat;
  if (options.format) {
    format = options.format;
    if (format !== 'esm' && format !== 'cjs') {
      throw new Error(`Invalid format "${format}". Use "esm" or "cjs".`);
    }
  } else if (skipPrompts) {
    format = 'esm';
  } else {
    format = await select<TModuleFormat>({
      message: 'Module format:',
      choices: [
        {
          value: 'esm',
          name: 'ESM (Recommended)',
          description: 'ECMAScript modules (import/export)',
        },
        {
          value: 'cjs',
          name: 'CommonJS',
          description: 'CommonJS modules (require/module.exports)',
        },
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
  };
}

// ── Pure file generation ─────────────────────────────────────────────────────

export function generateProjectFiles(
  projectName: string,
  template: string,
  format: TModuleFormat = 'esm'
): Record<string, string> {
  const workflowName = toWorkflowName(projectName);
  const workflowFile = `${projectName}-workflow.ts`;

  const tmpl = getWorkflowTemplate(template);
  if (!tmpl) {
    throw new Error(`Unknown template "${template}"`);
  }

  const workflowCode = tmpl.generate({ workflowName });

  // Package.json differs based on module format
  const packageJsonContent: Record<string, unknown> = {
    name: projectName,
    version: '1.0.0',
    scripts: {
      dev: `npx flow-weaver compile src/${workflowFile} -o src && npx tsx src/main.ts`,
      start: 'npx tsx src/main.ts',
      compile: `npx flow-weaver compile src/${workflowFile} -o src`,
      validate: `npx flow-weaver validate src/${workflowFile}`,
      doctor: 'npx flow-weaver doctor',
    },
    dependencies: {
      '@synergenius/flow-weaver': 'latest',
    },
    devDependencies: {
      typescript: '^5.3.0',
      '@types/node': '^20.11.0',
      tsx: '^4.21.0',
    },
  };

  // ESM projects need "type": "module"
  if (format === 'esm') {
    packageJsonContent.type = 'module';
  }
  // CJS projects can optionally have "type": "commonjs" but it's the default

  const packageJson = JSON.stringify(packageJsonContent, null, 2);

  // tsconfig.json differs based on module format
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

  // main.ts import syntax differs based on module format
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
    // CommonJS format
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

  return {
    'package.json': packageJson,
    'tsconfig.json': tsconfigJson,
    [`src/${workflowFile}`]: workflowCode,
    'src/main.ts': mainTs,
    '.gitignore': gitignore,
    '.flowweaver/config.yaml': configYaml,
  };
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
    const files = generateProjectFiles(config.projectName, config.template, config.format);
    const { filesCreated, filesSkipped } = scaffoldProject(config.targetDir, files, {
      force: config.force,
    });

    // Post-scaffold actions
    let installResult: { success: boolean; error?: string } | undefined;
    if (config.install) {
      if (!options.json) {
        logger.info('Installing dependencies...');
      }
      installResult = runNpmInstall(config.targetDir);
    }

    let gitResult: { success: boolean; error?: string } | undefined;
    if (config.git) {
      if (!options.json) {
        logger.info('Initializing git repository...');
      }
      gitResult = runGitInit(config.targetDir);
    }

    // Auto-compile the workflow so `npm start` works immediately
    const workflowFile = `${config.projectName}-workflow.ts`;
    const workflowPath = path.join(config.targetDir, 'src', workflowFile);
    // Auto-compile the workflow so `npm start` works immediately.
    // Skip in JSON mode since compileCommand writes to logger.
    let compileResult: { success: boolean; error?: string } | undefined;
    if (!options.json && fs.existsSync(workflowPath)) {
      try {
        logger.info('Compiling workflow...');
        await compileCommand(workflowPath, { format: config.format });
        compileResult = { success: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        compileResult = { success: false, error: message };
      }
    }

    // Build report
    const report: InitReport = {
      projectDir: config.targetDir,
      filesCreated,
      filesSkipped,
      template: config.template,
      format: config.format,
      installResult,
      gitResult,
    };

    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    // Human output
    logger.section('Project created');

    for (const file of filesCreated) {
      logger.success(`Created ${file}`);
    }
    for (const file of filesSkipped) {
      logger.warn(`Skipped ${file} (already exists)`);
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
        logger.success('Git repository initialized');
      } else {
        logger.warn(`git init failed: ${gitResult.error}`);
      }
    }

    if (compileResult) {
      if (compileResult.success) {
        logger.success('Workflow compiled (npm start works immediately)');
      } else {
        logger.warn(`Workflow compile failed: ${compileResult.error}`);
      }
    }

    logger.newline();
    logger.section('Next steps');

    const relDir = path.relative(process.cwd(), config.targetDir);
    const displayDir =
      !relDir || relDir === '.' ? null : relDir.startsWith('../../') ? config.targetDir : relDir;
    if (displayDir) {
      logger.log(`  cd ${displayDir}`);
    }
    if (!config.install) {
      logger.log('  npm install');
    }
    logger.log(compileResult?.success ? '  npm start' : '  npm run dev');
    logger.newline();
  } catch (err) {
    // Clean exit on Ctrl+C during prompts
    if (err instanceof ExitPromptError) {
      return;
    }
    throw err;
  }
}
