/**
 * Tests for init command
 * Pure function tests + real-fs scaffolding + CLI wiring
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  validateProjectName,
  toWorkflowName,
  isNonInteractive,
  generateProjectFiles,
  scaffoldProject,
  runNpmInstall,
  runGitInit,
  initCommand,
  resolveInitConfig,
} from '../../src/cli/commands/init';
import type { TModuleFormat } from '../../src/ast/types';

const INIT_TEMP_DIR = path.join(os.tmpdir(), `flow-weaver-init-${process.pid}`);

beforeAll(() => fs.mkdirSync(INIT_TEMP_DIR, { recursive: true }));
afterAll(() => fs.rmSync(INIT_TEMP_DIR, { recursive: true, force: true }));

/** Create a temp subdirectory, optionally with files */
function makeFixture(name: string, files: Record<string, string> = {}): string {
  const dir = path.join(INIT_TEMP_DIR, name);
  fs.mkdirSync(dir, { recursive: true });
  for (const [file, content] of Object.entries(files)) {
    const filePath = path.join(dir, file);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  }
  return dir;
}

/** Cache for generateProjectFiles — pure function, same inputs produce same output */
const _projectFilesCache = new Map<string, Record<string, string>>();
function cachedGenerateProjectFiles(name: string, template: string, format?: string): Record<string, string> {
  const key = `${name}:${template}:${format ?? ''}`;
  if (!_projectFilesCache.has(key)) {
    _projectFilesCache.set(key, generateProjectFiles(name, template, format as TModuleFormat));
  }
  return _projectFilesCache.get(key)!;
}

// ── validateProjectName ──────────────────────────────────────────────────────

describe('validateProjectName', () => {
  it('should accept a valid name', () => {
    expect(validateProjectName('my-project')).toBe(true);
  });

  it('should accept alphanumeric with dots and underscores', () => {
    expect(validateProjectName('my_project.v2')).toBe(true);
  });

  it('should accept names starting with a digit', () => {
    expect(validateProjectName('3d-viewer')).toBe(true);
  });

  it('should reject empty string', () => {
    expect(validateProjectName('')).toContain('empty');
  });

  it('should reject names starting with a hyphen', () => {
    const result = validateProjectName('-bad');
    expect(result).not.toBe(true);
  });

  it('should reject names with spaces', () => {
    const result = validateProjectName('bad name');
    expect(result).not.toBe(true);
  });

  it('should reject names longer than 214 characters', () => {
    const result = validateProjectName('a'.repeat(215));
    expect(result).toContain('214');
  });
});

// ── toWorkflowName ───────────────────────────────────────────────────────────

describe('toWorkflowName', () => {
  it('should convert hyphenated name to camelCase + Workflow', () => {
    expect(toWorkflowName('my-app')).toBe('myAppWorkflow');
  });

  it('should convert underscored name', () => {
    expect(toWorkflowName('data_processor')).toBe('dataProcessorWorkflow');
  });

  it('should convert dotted name', () => {
    expect(toWorkflowName('api.v2')).toBe('apiV2Workflow');
  });

  it('should handle single word', () => {
    expect(toWorkflowName('project')).toBe('projectWorkflow');
  });

  it('should strip leading non-identifier characters', () => {
    expect(toWorkflowName('123abc')).toBe('abcWorkflow');
  });

  it('should fallback for fully numeric name', () => {
    expect(toWorkflowName('123')).toBe('myProjectWorkflow');
  });
});

// ── isNonInteractive ─────────────────────────────────────────────────────────

describe('isNonInteractive', () => {
  it('should return a boolean', () => {
    expect(typeof isNonInteractive()).toBe('boolean');
  });
});

// ── generateProjectFiles ─────────────────────────────────────────────────────

describe('generateProjectFiles', () => {
  it('should generate all expected files for sequential template', () => {
    const files = cachedGenerateProjectFiles('my-project', 'sequential');
    const paths = Object.keys(files);
    expect(paths).toContain('package.json');
    expect(paths).toContain('tsconfig.json');
    expect(paths).toContain('src/my-project-workflow.ts');
    expect(paths).toContain('src/main.ts');
    expect(paths).toContain('.gitignore');
  });

  it('should produce valid package.json', () => {
    const files = cachedGenerateProjectFiles('test-app', 'sequential');
    const pkg = JSON.parse(files['package.json']);
    expect(pkg.name).toBe('test-app');
    expect(pkg.version).toBe('1.0.0');
    expect(pkg.type).toBe('module');
    expect(pkg.dependencies).toHaveProperty('@synergenius/flow-weaver');
    expect(pkg.devDependencies).toHaveProperty('typescript');
    expect(pkg.devDependencies).toHaveProperty('@types/node');
    expect(pkg.devDependencies).toHaveProperty('tsx');
    expect(pkg.scripts).toHaveProperty('dev');
    expect(pkg.scripts).toHaveProperty('start');
    expect(pkg.scripts).toHaveProperty('compile');
    expect(pkg.scripts).toHaveProperty('validate');
    expect(pkg.scripts).toHaveProperty('doctor');
    expect(pkg.scripts.dev).toContain('compile');
    expect(pkg.scripts.dev).toContain('tsx src/main.ts');
    expect(pkg.scripts.compile).toContain('src/test-app-workflow.ts');
    expect(pkg.scripts.compile).not.toContain('**');
    expect(pkg.scripts.validate).toContain('src/test-app-workflow.ts');
    expect(pkg.scripts.validate).not.toContain('**');
  });

  it('should produce valid tsconfig.json', () => {
    const files = cachedGenerateProjectFiles('test-app', 'sequential');
    const tsconfig = JSON.parse(files['tsconfig.json']);
    expect(tsconfig.compilerOptions.target).toBe('ES2020');
    expect(tsconfig.compilerOptions.module).toBe('ES2020');
    expect(tsconfig.compilerOptions.moduleResolution).toBe('bundler');
    expect(tsconfig.compilerOptions.strict).toBe(true);
    expect(tsconfig.compilerOptions.esModuleInterop).toBe(true);
    expect(tsconfig.compilerOptions.skipLibCheck).toBe(true);
    expect(tsconfig.compilerOptions.outDir).toBe('dist');
    expect(tsconfig.compilerOptions.rootDir).toBe('src');
    expect(tsconfig.compilerOptions.types).toContain('node');
  });

  it('should generate workflow with @flowWeaver annotations', () => {
    const files = cachedGenerateProjectFiles('test-app', 'sequential');
    const workflow = files['src/test-app-workflow.ts'];
    expect(workflow).toContain('@flowWeaver');
    expect(workflow).toContain('testAppWorkflow');
  });

  it('should generate main.ts that imports the workflow', () => {
    const files = cachedGenerateProjectFiles('test-app', 'sequential');
    const main = files['src/main.ts'];
    expect(main).toContain('testAppWorkflow');
    expect(main).toContain("from './test-app-workflow.js'");
    expect(main).toContain('workflow runner');
    expect(main).toContain('npm run dev');
    expect(main).toContain("{ message: 'hello world' }");
    // blank line between JSDoc closing and import
    expect(main).toContain('*/\n\nimport');
    // friendly error when running before compiling
    expect(main).toContain('Workflow not compiled yet');
    expect(main).toContain('npm run dev');
  });

  it('should generate .gitignore with expected entries', () => {
    const files = cachedGenerateProjectFiles('test-app', 'sequential');
    const gitignore = files['.gitignore'];
    expect(gitignore).toContain('node_modules/');
    expect(gitignore).toContain('dist/');
    expect(gitignore).toContain('.tsbuildinfo');
  });

  it('should throw for unknown template', () => {
    expect(() => generateProjectFiles('test', 'nonexistent')).toThrow('Unknown template');
  });

  it('should adapt workflow filename to project name', () => {
    const files = cachedGenerateProjectFiles('data-pipeline', 'sequential');
    expect(Object.keys(files)).toContain('src/data-pipeline-workflow.ts');
  });

  it('should adapt main.ts import to project name', () => {
    const files = cachedGenerateProjectFiles('data-pipeline', 'sequential');
    const main = files['src/main.ts'];
    expect(main).toContain("from './data-pipeline-workflow.js'");
    expect(main).toContain('dataPipelineWorkflow');
  });
});

// ── Template integration ─────────────────────────────────────────────────────

describe('template integration', () => {
  it('should generate different workflow content for different templates', () => {
    const seqFiles = cachedGenerateProjectFiles('test', 'sequential');
    const condFiles = cachedGenerateProjectFiles('test', 'conditional');
    const seqWorkflow = seqFiles['src/test-workflow.ts'];
    const condWorkflow = condFiles['src/test-workflow.ts'];
    expect(seqWorkflow).not.toBe(condWorkflow);
  });

  it('should produce same package.json structure regardless of template', () => {
    const seqPkg = JSON.parse(cachedGenerateProjectFiles('test', 'sequential')['package.json']);
    const condPkg = JSON.parse(cachedGenerateProjectFiles('test', 'conditional')['package.json']);
    expect(Object.keys(seqPkg)).toEqual(Object.keys(condPkg));
    expect(seqPkg.dependencies).toEqual(condPkg.dependencies);
    expect(seqPkg.devDependencies).toEqual(condPkg.devDependencies);
  });

  it('should produce same tsconfig regardless of template', () => {
    const seqTsconfig = cachedGenerateProjectFiles('test', 'sequential')['tsconfig.json'];
    const condTsconfig = cachedGenerateProjectFiles('test', 'conditional')['tsconfig.json'];
    expect(seqTsconfig).toBe(condTsconfig);
  });

  it.each([
    'sequential',
    'foreach',
    'conditional',
    'ai-agent',
    'ai-react',
    'ai-rag',
    'ai-chat',
    'aggregator',
    'webhook',
    'error-handler',
    'ai-agent-durable',
    'ai-pipeline-durable',
  ])('should generate workflow files for template "%s"', (template) => {
    const files = cachedGenerateProjectFiles('test', template);
    const workflow = files['src/test-workflow.ts'];
    expect(workflow).toBeTruthy();
    expect(workflow).toContain('@flowWeaver');
  });
});

// ── scaffoldProject (real fs) ────────────────────────────────────────────────

describe('scaffoldProject', () => {
  it('should create all files in an empty directory', () => {
    const dir = makeFixture('scaffold-empty');
    const files = generateProjectFiles('test', 'sequential');
    const result = scaffoldProject(dir, files, { force: false });

    expect(result.filesCreated).toHaveLength(Object.keys(files).length);
    expect(result.filesSkipped).toHaveLength(0);

    for (const relativePath of result.filesCreated) {
      expect(fs.existsSync(path.join(dir, relativePath))).toBe(true);
    }
  });

  it('should skip existing files without --force', () => {
    const dir = makeFixture('scaffold-existing', {
      'package.json': '{"existing": true}',
    });
    const files = generateProjectFiles('test', 'sequential');
    const result = scaffoldProject(dir, files, { force: false });

    expect(result.filesSkipped).toContain('package.json');
    // Existing file should NOT be overwritten
    const content = fs.readFileSync(path.join(dir, 'package.json'), 'utf8');
    expect(content).toContain('"existing"');
  });

  it('should overwrite existing files with --force', () => {
    const dir = makeFixture('scaffold-force', {
      'package.json': '{"existing": true}',
    });
    const files = generateProjectFiles('test', 'sequential');
    const result = scaffoldProject(dir, files, { force: true });

    expect(result.filesSkipped).toHaveLength(0);
    expect(result.filesCreated).toContain('package.json');
    const content = fs.readFileSync(path.join(dir, 'package.json'), 'utf8');
    expect(content).toContain('"test"');
  });

  it('should create intermediate directories', () => {
    const dir = makeFixture('scaffold-nested');
    const files = { 'deep/nested/file.txt': 'hello' };
    const result = scaffoldProject(dir, files, { force: false });

    expect(result.filesCreated).toContain('deep/nested/file.txt');
    expect(fs.readFileSync(path.join(dir, 'deep/nested/file.txt'), 'utf8')).toBe('hello');
  });

  it('should report filesCreated and filesSkipped correctly', () => {
    const dir = makeFixture('scaffold-mixed', {
      'tsconfig.json': '{}',
    });
    const files = generateProjectFiles('test', 'sequential');
    const result = scaffoldProject(dir, files, { force: false });

    expect(result.filesSkipped).toContain('tsconfig.json');
    expect(result.filesCreated).not.toContain('tsconfig.json');
    expect(result.filesCreated.length + result.filesSkipped.length).toBe(Object.keys(files).length);
  });
});

// ── resolveInitConfig (non-interactive) ──────────────────────────────────────

describe('resolveInitConfig (non-interactive)', () => {
  it('should resolve with --yes using defaults', async () => {
    const config = await resolveInitConfig(undefined, { yes: true });
    expect(config.projectName).toBe('my-project');
    expect(config.template).toBe('sequential');
    expect(config.install).toBe(true);
    expect(config.git).toBe(true);
  });

  it('should use directory arg as project name', async () => {
    const config = await resolveInitConfig('my-app', { yes: true });
    expect(config.projectName).toBe('my-app');
    expect(config.targetDir).toBe(path.resolve('my-app'));
  });

  it('should prefer --name over directory arg', async () => {
    const config = await resolveInitConfig('some-dir', { yes: true, name: 'custom-name' });
    expect(config.projectName).toBe('custom-name');
    expect(config.targetDir).toBe(path.resolve('some-dir'));
  });

  it('should use --template when provided', async () => {
    const config = await resolveInitConfig(undefined, { yes: true, template: 'sequential' });
    expect(config.template).toBe('sequential');
  });

  it('should throw for unknown template', async () => {
    await expect(
      resolveInitConfig(undefined, { yes: true, template: 'does-not-exist' })
    ).rejects.toThrow('Unknown template');
  });

  it('should respect --no-install', async () => {
    const config = await resolveInitConfig(undefined, { yes: true, install: false });
    expect(config.install).toBe(false);
  });

  it('should respect --no-git', async () => {
    const config = await resolveInitConfig(undefined, { yes: true, git: false });
    expect(config.git).toBe(false);
  });

  it('should set force from options', async () => {
    const config = await resolveInitConfig(undefined, { yes: true, force: true });
    expect(config.force).toBe(true);
  });

  it('should default force to false', async () => {
    const config = await resolveInitConfig(undefined, { yes: true });
    expect(config.force).toBe(false);
  });
});

// ── initCommand --json wiring ────────────────────────────────────────────────

describe('initCommand --json', () => {
  it('should output valid JSON report', async () => {
    const dir = makeFixture('init-json');
    const logs: string[] = [];
    const originalLog = console.log;
    const originalCwd = process.cwd;

    console.log = (...args: unknown[]) => logs.push(args.map(String).join(' '));
    process.cwd = () => dir;

    try {
      await initCommand(dir, {
        yes: true,
        json: true,
        install: false,
        git: false,
      });
    } finally {
      console.log = originalLog;
      process.cwd = originalCwd;
    }

    expect(logs.length).toBeGreaterThan(0);
    const report = JSON.parse(logs.join(''));
    expect(report).toHaveProperty('projectDir');
    expect(report).toHaveProperty('filesCreated');
    expect(report).toHaveProperty('filesSkipped');
    expect(report).toHaveProperty('template');
    expect(Array.isArray(report.filesCreated)).toBe(true);
    expect(report.template).toBe('sequential');
    expect(report.filesCreated.length).toBeGreaterThan(0);
  });

  it('should report skipped files in JSON', async () => {
    const dir = makeFixture('init-json-skip', {
      'tsconfig.json': '{"existing": true}',
    });
    const logs: string[] = [];
    const originalLog = console.log;
    const originalCwd = process.cwd;

    console.log = (...args: unknown[]) => logs.push(args.map(String).join(' '));
    process.cwd = () => dir;

    try {
      await initCommand(dir, {
        name: 'test-skip',
        yes: true,
        json: true,
        install: false,
        git: false,
      });
    } finally {
      console.log = originalLog;
      process.cwd = originalCwd;
    }

    const report = JSON.parse(logs.join(''));
    expect(report.filesSkipped).toContain('tsconfig.json');
  });

  it('should error when package.json exists without --force', async () => {
    const dir = makeFixture('init-no-force', {
      'package.json': '{}',
    });

    await expect(
      initCommand(dir, {
        name: 'test',
        yes: true,
        install: false,
        git: false,
      })
    ).rejects.toThrow('--force');
  });

  it('should succeed with --force when package.json exists', async () => {
    const dir = makeFixture('init-with-force', {
      'package.json': '{"existing": true}',
    });
    const logs: string[] = [];
    const originalLog = console.log;
    const originalCwd = process.cwd;

    console.log = (...args: unknown[]) => logs.push(args.map(String).join(' '));
    process.cwd = () => dir;

    try {
      await initCommand(dir, {
        name: 'test',
        yes: true,
        json: true,
        install: false,
        git: false,
        force: true,
      });
    } finally {
      console.log = originalLog;
      process.cwd = originalCwd;
    }

    const report = JSON.parse(logs.join(''));
    expect(report.filesCreated).toContain('package.json');
    expect(report.filesSkipped).toHaveLength(0);
  });
});

// ── npm/git install (mocked execSync) ────────────────────────────────────────

vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process');
  return { ...actual };
});

describe('runNpmInstall', () => {
  it('should report failure for a non-existent directory', () => {
    const result = runNpmInstall(path.join(INIT_TEMP_DIR, 'nonexistent-npm'));
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

describe('runGitInit', () => {
  it('should succeed in an empty directory', () => {
    const dir = makeFixture('git-init-ok');
    const result = runGitInit(dir);
    expect(result.success).toBe(true);
  });

  it('should report failure for a non-existent directory', () => {
    const result = runGitInit(path.join(INIT_TEMP_DIR, 'nonexistent-git'));
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

// ── initCommand human output ─────────────────────────────────────────────────

// ── Module format option ─────────────────────────────────────────────────────

describe('generateProjectFiles with format option', () => {
  it('should generate ESM package.json by default', () => {
    const files = cachedGenerateProjectFiles('test-app', 'sequential');
    const pkg = JSON.parse(files['package.json']);
    expect(pkg.type).toBe('module');
  });

  it('should generate ESM package.json with format: esm', () => {
    const files = cachedGenerateProjectFiles('test-app', 'sequential', 'esm');
    const pkg = JSON.parse(files['package.json']);
    expect(pkg.type).toBe('module');
  });

  it('should generate CJS package.json without "type" field', () => {
    const files = cachedGenerateProjectFiles('test-app', 'sequential', 'cjs');
    const pkg = JSON.parse(files['package.json']);
    expect(pkg.type).toBeUndefined();
  });

  it('should generate ESM tsconfig.json by default', () => {
    const files = cachedGenerateProjectFiles('test-app', 'sequential');
    const tsconfig = JSON.parse(files['tsconfig.json']);
    expect(tsconfig.compilerOptions.module).toBe('ES2020');
  });

  it('should generate ESM tsconfig.json with format: esm', () => {
    const files = cachedGenerateProjectFiles('test-app', 'sequential', 'esm');
    const tsconfig = JSON.parse(files['tsconfig.json']);
    expect(tsconfig.compilerOptions.module).toBe('ES2020');
  });

  it('should generate CJS tsconfig.json with "CommonJS" module', () => {
    const files = cachedGenerateProjectFiles('test-app', 'sequential', 'cjs');
    const tsconfig = JSON.parse(files['tsconfig.json']);
    expect(tsconfig.compilerOptions.module).toBe('CommonJS');
  });

  it('should generate ESM main.ts with import syntax by default', () => {
    const files = cachedGenerateProjectFiles('test-app', 'sequential');
    const main = files['src/main.ts'];
    expect(main).toContain('import { testAppWorkflow }');
    expect(main).toContain("from './test-app-workflow.js'");
    expect(main).not.toContain('require(');
  });

  it('should generate CJS main.ts with require syntax', () => {
    const files = cachedGenerateProjectFiles('test-app', 'sequential', 'cjs');
    const main = files['src/main.ts'];
    expect(main).toContain('const { testAppWorkflow }');
    expect(main).toContain("= require('./test-app-workflow.js')");
    expect(main).not.toContain('import {');
  });
});

describe('resolveInitConfig format option', () => {
  it('should default to esm format', async () => {
    const config = await resolveInitConfig(undefined, { yes: true });
    expect(config.format).toBe('esm');
  });

  it('should accept --format esm', async () => {
    const config = await resolveInitConfig(undefined, { yes: true, format: 'esm' });
    expect(config.format).toBe('esm');
  });

  it('should accept --format cjs', async () => {
    const config = await resolveInitConfig(undefined, { yes: true, format: 'cjs' });
    expect(config.format).toBe('cjs');
  });
});

describe('initCommand with format option', () => {
  it('should create ESM project by default', async () => {
    const dir = makeFixture('init-esm-default');
    const logs: string[] = [];
    const originalLog = console.log;
    const originalCwd = process.cwd;

    console.log = (...args: unknown[]) => logs.push(args.map(String).join(' '));
    process.cwd = () => dir;

    try {
      await initCommand(dir, {
        yes: true,
        json: true,
        install: false,
        git: false,
      });
    } finally {
      console.log = originalLog;
      process.cwd = originalCwd;
    }

    const pkgContent = fs.readFileSync(path.join(dir, 'package.json'), 'utf8');
    const pkg = JSON.parse(pkgContent);
    expect(pkg.type).toBe('module');

    const tsconfigContent = fs.readFileSync(path.join(dir, 'tsconfig.json'), 'utf8');
    const tsconfig = JSON.parse(tsconfigContent);
    expect(tsconfig.compilerOptions.module).toBe('ES2020');
  });

  it('should create CJS project with --format cjs', async () => {
    const dir = makeFixture('init-cjs-format');
    const logs: string[] = [];
    const originalLog = console.log;
    const originalCwd = process.cwd;

    console.log = (...args: unknown[]) => logs.push(args.map(String).join(' '));
    process.cwd = () => dir;

    try {
      await initCommand(dir, {
        yes: true,
        json: true,
        install: false,
        git: false,
        format: 'cjs',
      });
    } finally {
      console.log = originalLog;
      process.cwd = originalCwd;
    }

    // Check package.json has no "type" field (CJS is default)
    const pkgContent = fs.readFileSync(path.join(dir, 'package.json'), 'utf8');
    const pkg = JSON.parse(pkgContent);
    expect(pkg.type).toBeUndefined();

    // Check tsconfig.json has CommonJS module
    const tsconfigContent = fs.readFileSync(path.join(dir, 'tsconfig.json'), 'utf8');
    const tsconfig = JSON.parse(tsconfigContent);
    expect(tsconfig.compilerOptions.module).toBe('CommonJS');

    // Check main.ts uses require syntax
    const mainContent = fs.readFileSync(path.join(dir, 'src', 'main.ts'), 'utf8');
    expect(mainContent).toContain('require(');
    expect(mainContent).not.toContain('import {');
  });

  it('should include format in JSON report', async () => {
    const dir = makeFixture('init-cjs-report');
    const logs: string[] = [];
    const originalLog = console.log;
    const originalCwd = process.cwd;

    console.log = (...args: unknown[]) => logs.push(args.map(String).join(' '));
    process.cwd = () => dir;

    try {
      await initCommand(dir, {
        yes: true,
        json: true,
        install: false,
        git: false,
        format: 'cjs',
      });
    } finally {
      console.log = originalLog;
      process.cwd = originalCwd;
    }

    const report = JSON.parse(logs.join(''));
    expect(report.format).toBe('cjs');
  });
});

// ── initCommand human output ─────────────────────────────────────────────────

describe('initCommand human output', () => {
  it('should produce human-readable output without --json', async () => {
    const dir = makeFixture('init-human');
    const logs: string[] = [];
    const errors: string[] = [];
    const originalLog = console.log;
    const originalError = console.error;
    const originalWarn = console.warn;
    const originalCwd = process.cwd;

    console.log = (...args: unknown[]) => logs.push(args.map(String).join(' '));
    console.error = (...args: unknown[]) => errors.push(args.map(String).join(' '));
    console.warn = (...args: unknown[]) => logs.push(args.map(String).join(' '));
    process.cwd = () => dir;

    try {
      await initCommand(dir, {
        yes: true,
        install: false,
        git: false,
      });
    } finally {
      console.log = originalLog;
      console.error = originalError;
      console.warn = originalWarn;
      process.cwd = originalCwd;
    }

    const output = logs.join('\n');
    expect(output).toContain('Created');
    expect(output).toContain('Next steps');
  });

  it('should show install and dev in next steps when --no-install', async () => {
    const dir = makeFixture('init-no-install');
    const logs: string[] = [];
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalCwd = process.cwd;

    console.log = (...args: unknown[]) => logs.push(args.map(String).join(' '));
    console.warn = (...args: unknown[]) => logs.push(args.map(String).join(' '));
    process.cwd = () => dir;

    try {
      await initCommand(dir, {
        yes: true,
        install: false,
        git: false,
      });
    } finally {
      console.log = originalLog;
      console.warn = originalWarn;
      process.cwd = originalCwd;
    }

    const output = logs.join('\n');
    expect(output).toContain('npm install');
    // After auto-compile, shows 'npm start'; if compile fails/skipped, shows 'npm run dev'
    expect(output).toMatch(/npm (run dev|start)/);
  });
});
