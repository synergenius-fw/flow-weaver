/**
 * The files a new project starts with, and writing them to disk.
 *
 * generateProjectFiles decides the contents, without touching the disk:
 * package.json (npm scripts, dependencies, the module type), tsconfig.json,
 * the workflow from the chosen template, a src/main.ts runner, .gitignore,
 * the .flowweaver config, the persona's README and, for low-code, an example
 * workflow. assertNoExistingProject refuses a directory that already holds a
 * package.json unless forced, and scaffoldProject writes the files, keeping
 * any that exist unless forced.
 */
import * as fs from 'fs';
import * as path from 'path';
import { getWorkflowTemplate } from '../../templates/index.js';
import type { TModuleFormat } from '../../../ast/types.js';
import type { PersonaId } from '../init-personas.js';
import { generateReadme, generateExampleWorkflow } from '../init-personas.js';
import { toWorkflowName, workflowFileName } from './naming.js';

const GITIGNORE = `node_modules/\ndist/\n.tsbuildinfo\n`;
const CONFIG_YAML = `defaultFileType: ts\n`;

export function generateProjectFiles(
  projectName: string,
  template: string,
  format: TModuleFormat = 'esm',
  persona: PersonaId = 'expert',
): Record<string, string> {
  const workflowName = toWorkflowName(projectName);
  const workflowFile = workflowFileName(projectName);

  const tmpl = getWorkflowTemplate(template);
  if (!tmpl) {
    throw new Error(`Unknown template "${template}"`);
  }

  const workflowCode = tmpl.generate({ workflowName });

  const files: Record<string, string> = {
    'package.json': buildPackageJson(projectName, workflowFile, format, persona),
    'tsconfig.json': buildTsconfig(format),
    [`src/${workflowFile}`]: workflowCode,
    'src/main.ts': buildMainTs(projectName, workflowName, workflowFile, format),
    '.gitignore': GITIGNORE,
    '.flowweaver/config.yaml': CONFIG_YAML,
  };

  // Add README for all personas
  files['README.md'] = generateReadme(projectName, persona, template);

  // Add example workflow for lowcode persona
  if (persona === 'lowcode') {
    files['examples/example-workflow.ts'] = generateExampleWorkflow(projectName);
  }

  return files;
}

/** npm scripts around the workflow (plus `diagram` for non-experts), deps, and `type: module` for ESM. */
function buildPackageJson(
  projectName: string,
  workflowFile: string,
  format: TModuleFormat,
  persona: PersonaId,
): string {
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
    },
    devDependencies: {
      typescript: '^5.3.0',
      '@types/node': '^22.0.0',
      tsx: '^4.21.0',
    },
  };

  if (format === 'esm') {
    packageJsonContent.type = 'module';
  }

  return JSON.stringify(packageJsonContent, null, 2);
}

/** Strict TypeScript from src to dist, with module settings matching the format. */
function buildTsconfig(format: TModuleFormat): string {
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

  return JSON.stringify(tsconfigContent, null, 2);
}

/**
 * main.ts. The compiled workflow imports nothing from the package, and it
 * exports the helper that builds the runtime it takes as its third
 * argument, so the runner needs nothing from the package either.
 */
function buildMainTs(
  projectName: string,
  workflowName: string,
  workflowFile: string,
  format: TModuleFormat,
): string {
  const workflowJsFile = workflowFile.replace(/\.ts$/, '.js');
  const imports = format === 'esm'
    ? [`import { ${workflowName}, createWorkflowRuntime } from './${workflowJsFile}';`]
    : [`const { ${workflowName}, createWorkflowRuntime } = require('./${workflowJsFile}');`];
  return [
    '/**',
    ` * ${projectName}: workflow runner`,
    ' *',
    ' * Usage:',
    ' *   npm run dev      compile workflow + run this file',
    ' *   npm start        run without recompiling',
    ' *   npm run compile  compile only',
    ' */',
    '',
    ...imports,
    '',
    'async function main() {',
    '  // The runtime names the run and carries the services the generated code',
    '  // reads (mocks, a debugger, an abort signal). See: fw docs library',
    `  const runtime = createWorkflowRuntime({ runId: \`run-\${Date.now()}\`, workflowId: '${workflowName}' });`,
    `  const result = await ${workflowName}(true, { data: { message: 'hello world' } }, runtime);`,
    '  console.log(JSON.stringify(result, null, 2));',
    '}',
    '',
    'main().catch((e) => {',
    "  if (e instanceof Error && /generated body was not installed|Compile with:/.test(e.message)) {",
    "    console.error('Workflow not compiled yet. Run: npm run dev');",
    '    process.exit(1);',
    '  }',
    '  console.error(e);',
    '  process.exit(1);',
    '});',
    '',
  ].join('\n');
}

/** Refuses a target directory that already holds a package.json, unless forced. */
export function assertNoExistingProject(targetDir: string, force: boolean): void {
  const pkgPath = path.join(targetDir, 'package.json');
  if (fs.existsSync(pkgPath) && !force) {
    throw new Error(
      `${targetDir} already contains a package.json. Use --force to overwrite.`
    );
  }
}

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
