/* eslint-disable no-console */
/**
 * Doctor command - validates project environment and configuration for flow-weaver compatibility
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import * as YAML from 'js-yaml';
import { logger } from '../utils/logger.js';
import type { TModuleFormat } from '../../ast/types.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface DoctorOptions {
  json?: boolean;
}

/**
 * Result of detecting the project's module format
 */
export interface ModuleFormatDetection {
  format: TModuleFormat;
  source: 'package.json' | 'tsconfig' | 'default';
  details?: string;
}

export type CheckStatus = 'pass' | 'warn' | 'fail';

export interface CheckResult {
  name: string;
  status: CheckStatus;
  message: string;
  fix?: string;
  details?: string;
}

export interface DoctorReport {
  ok: boolean;
  checks: CheckResult[];
  summary: { pass: number; warn: number; fail: number };
  moduleFormat: ModuleFormatDetection;
}

// ── Utility ──────────────────────────────────────────────────────────────────

/**
 * Strips single-line (//) and multi-line comments from JSON-like text,
 * preserving string contents that may contain // or slash-star sequences.
 */
export function stripJsonComments(text: string): string {
  let result = '';
  let i = 0;
  while (i < text.length) {
    // String literal — copy verbatim
    if (text[i] === '"') {
      const start = i;
      i++; // skip opening quote
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\\') i++; // skip escaped char
        i++;
      }
      i++; // skip closing quote
      result += text.slice(start, i);
      continue;
    }
    // Single-line comment
    if (text[i] === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }
    // Multi-line comment
    if (text[i] === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2; // skip closing */
      continue;
    }
    result += text[i];
    i++;
  }
  return result;
}

// ── Module Format Detection ──────────────────────────────────────────────────

/**
 * Detect the project's module format from package.json and tsconfig.json
 */
export function detectProjectModuleFormat(cwd: string): ModuleFormatDetection {
  // First check package.json "type" field
  const pkgPath = path.join(cwd, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.type === 'module') {
        return { format: 'esm', source: 'package.json', details: '"type": "module"' };
      }
      // "commonjs" or no type field means CJS
      if (pkg.type === 'commonjs' || !pkg.type) {
        return {
          format: 'cjs',
          source: 'package.json',
          details: pkg.type ? '"type": "commonjs"' : 'no "type" field (defaults to CommonJS)',
        };
      }
    } catch {
      // Fall through to tsconfig check
    }
  }

  // Check tsconfig.json "module" setting
  const tsconfigPath = path.join(cwd, 'tsconfig.json');
  if (fs.existsSync(tsconfigPath)) {
    try {
      const raw = fs.readFileSync(tsconfigPath, 'utf8');
      const parsed = JSON.parse(stripJsonComments(raw));
      const compilerOptions = (parsed.compilerOptions ?? {}) as Record<string, unknown>;
      const mod =
        typeof compilerOptions.module === 'string'
          ? compilerOptions.module.toLowerCase()
          : undefined;

      if (mod === 'commonjs') {
        return { format: 'cjs', source: 'tsconfig', details: '"module": "commonjs"' };
      }
      if (mod && ['es2015', 'es2020', 'es2022', 'esnext', 'nodenext', 'node16'].includes(mod)) {
        return {
          format: 'esm',
          source: 'tsconfig',
          details: `"module": "${compilerOptions.module}"`,
        };
      }
    } catch {
      // Fall through to default
    }
  }

  // Default to ESM for new projects
  return { format: 'esm', source: 'default', details: 'defaulting to ESM' };
}

// ── Check functions ──────────────────────────────────────────────────────────

export function checkNodeVersion(): CheckResult {
  const major = parseInt(process.version.slice(1), 10);
  if (major >= 18) {
    return {
      name: 'Node.js version',
      status: 'pass',
      message: `Node.js ${process.version} (>= 18 required)`,
    };
  }
  return {
    name: 'Node.js version',
    status: 'fail',
    message: `Node.js ${process.version} is below the minimum (18)`,
    fix: 'Install Node.js 18 or later: https://nodejs.org',
  };
}

export function checkTypeScriptVersion(cwd: string): CheckResult {
  const tsPath = path.join(cwd, 'node_modules', 'typescript', 'package.json');
  if (!fs.existsSync(tsPath)) {
    return {
      name: 'TypeScript version',
      status: 'fail',
      message: 'TypeScript is not installed locally',
      fix: 'npm install -D typescript',
    };
  }
  try {
    const tsPkg = JSON.parse(fs.readFileSync(tsPath, 'utf8'));
    const major = parseInt(tsPkg.version.split('.')[0], 10);
    if (major >= 5) {
      return {
        name: 'TypeScript version',
        status: 'pass',
        message: `TypeScript ${tsPkg.version} (>= 5.0 required)`,
      };
    }
    return {
      name: 'TypeScript version',
      status: 'fail',
      message: `TypeScript ${tsPkg.version} is below the minimum (5.0)`,
      fix: 'npm install -D typescript@latest',
    };
  } catch {
    return {
      name: 'TypeScript version',
      status: 'fail',
      message: 'Could not read TypeScript version',
      fix: 'npm install -D typescript@latest',
    };
  }
}

export function checkPackageJsonType(cwd: string): CheckResult {
  const pkgPath = path.join(cwd, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    return {
      name: 'package.json "type"',
      status: 'fail',
      message: 'No package.json found',
      fix: 'Run npm init -y',
    };
  }
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    if (pkg.type === 'module') {
      return {
        name: 'package.json "type"',
        status: 'pass',
        message: '"type": "module" is set (ESM project)',
      };
    }
    if (pkg.type === 'commonjs') {
      return {
        name: 'package.json "type"',
        status: 'pass',
        message: '"type": "commonjs" is set (CJS project)',
      };
    }
    // No type field - defaults to CommonJS
    return {
      name: 'package.json "type"',
      status: 'pass',
      message: 'No "type" field (defaults to CommonJS)',
      details: 'Add "type": "module" if you prefer ESM',
    };
  } catch {
    return {
      name: 'package.json "type"',
      status: 'fail',
      message: 'Could not parse package.json',
      fix: 'Fix JSON syntax in package.json',
    };
  }
}

function readTsconfig(cwd: string): { parsed: Record<string, unknown> | null; error?: string } {
  const tsconfigPath = path.join(cwd, 'tsconfig.json');
  if (!fs.existsSync(tsconfigPath)) {
    return { parsed: null, error: 'No tsconfig.json found' };
  }
  try {
    const raw = fs.readFileSync(tsconfigPath, 'utf8');
    const parsed = JSON.parse(stripJsonComments(raw));
    return { parsed };
  } catch {
    return { parsed: null, error: 'Could not parse tsconfig.json' };
  }
}

export function checkTsconfigModule(cwd: string): CheckResult {
  const { parsed, error } = readTsconfig(cwd);
  if (!parsed) {
    return {
      name: 'tsconfig "module"',
      status: 'warn',
      message: error ?? 'No tsconfig.json found',
      fix: 'Create a tsconfig.json with appropriate "module" setting',
    };
  }
  const compilerOptions = (parsed.compilerOptions ?? {}) as Record<string, unknown>;
  const mod =
    typeof compilerOptions.module === 'string' ? compilerOptions.module.toLowerCase() : undefined;

  if (!mod) {
    return {
      name: 'tsconfig "module"',
      status: 'warn',
      message: '"module" is not set in compilerOptions',
      fix: 'Set "module" in tsconfig.json compilerOptions (e.g., "nodenext" for ESM, "commonjs" for CJS)',
    };
  }

  // Detect project format to validate consistency
  const detection = detectProjectModuleFormat(cwd);

  // CommonJS module setting
  if (mod === 'commonjs') {
    if (detection.format === 'cjs') {
      return {
        name: 'tsconfig "module"',
        status: 'pass',
        message: '"module": "commonjs" (CJS project)',
      };
    }
    return {
      name: 'tsconfig "module"',
      status: 'warn',
      message: '"module" is "commonjs" but package.json suggests ESM',
      fix: 'Align tsconfig.json "module" with package.json "type"',
    };
  }

  // ESM module settings
  const esmModules = ['es2015', 'es2020', 'es2022', 'esnext', 'nodenext', 'node16'];
  if (esmModules.includes(mod)) {
    if (detection.format === 'esm') {
      return {
        name: 'tsconfig "module"',
        status: 'pass',
        message: `"module": "${compilerOptions.module}" (ESM project)`,
      };
    }
    return {
      name: 'tsconfig "module"',
      status: 'warn',
      message: `"module" is "${compilerOptions.module}" but package.json suggests CJS`,
      fix: 'Align tsconfig.json "module" with package.json "type"',
    };
  }

  return {
    name: 'tsconfig "module"',
    status: 'pass',
    message: `"module": "${compilerOptions.module}"`,
  };
}

export function checkTsconfigModuleResolution(cwd: string): CheckResult {
  const { parsed, error } = readTsconfig(cwd);
  if (!parsed) {
    return {
      name: 'tsconfig "moduleResolution"',
      status: 'warn',
      message: error ?? 'No tsconfig.json found',
      fix: 'Create a tsconfig.json with "moduleResolution": "nodenext" or "bundler"',
    };
  }
  const compilerOptions = (parsed.compilerOptions ?? {}) as Record<string, unknown>;
  const res =
    typeof compilerOptions.moduleResolution === 'string'
      ? compilerOptions.moduleResolution.toLowerCase()
      : undefined;

  if (!res) {
    return {
      name: 'tsconfig "moduleResolution"',
      status: 'warn',
      message: '"moduleResolution" is not set in compilerOptions',
      fix: 'Set "moduleResolution": "nodenext" in tsconfig.json compilerOptions',
    };
  }
  // "node" is the legacy Node10 resolution — cannot resolve ESM exports maps
  if (res === 'node') {
    return {
      name: 'tsconfig "moduleResolution"',
      status: 'fail',
      message: '"moduleResolution" is "node" (Node10) — cannot resolve ESM exports',
      fix: 'Set "moduleResolution": "nodenext" or "bundler" in tsconfig.json',
    };
  }
  return {
    name: 'tsconfig "moduleResolution"',
    status: 'pass',
    message: `"moduleResolution": "${compilerOptions.moduleResolution}"`,
  };
}

export function checkFlowWeaverInstalled(cwd: string): CheckResult {
  const pkgPath = path.join(cwd, 'node_modules', '@synergenius', 'flow-weaver', 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      return {
        name: '@synergenius/flow-weaver installed',
        status: 'pass',
        message: `@synergenius/flow-weaver ${pkg.version} is installed`,
      };
    } catch {
      // exists but unreadable — still pass
      return {
        name: '@synergenius/flow-weaver installed',
        status: 'pass',
        message: '@synergenius/flow-weaver is installed',
      };
    }
  }
  return {
    name: '@synergenius/flow-weaver installed',
    status: 'fail',
    message: '@synergenius/flow-weaver is not installed',
    fix: 'npm install @synergenius/flow-weaver',
  };
}

export function checkFlowWeaverVersion(cwd: string): CheckResult {
  const libraryPath = path.join(cwd, 'node_modules', '@synergenius', 'flow-weaver');
  const pkgPath = path.join(libraryPath, 'package.json');

  if (!fs.existsSync(pkgPath)) {
    // Not installed — covered by checkFlowWeaverInstalled
    return {
      name: 'Library version',
      status: 'pass',
      message: 'Skipped (library not installed)',
    };
  }

  // Check if this is a local file:/link:/workspace: dependency or symlink
  try {
    const projectPkgPath = path.join(cwd, 'package.json');
    if (fs.existsSync(projectPkgPath)) {
      const projectPkg = JSON.parse(fs.readFileSync(projectPkgPath, 'utf8'));
      const depSpec =
        projectPkg.dependencies?.['@synergenius/flow-weaver'] ??
        projectPkg.devDependencies?.['@synergenius/flow-weaver'];
      if (
        typeof depSpec === 'string' &&
        (depSpec.startsWith('file:') ||
          depSpec.startsWith('link:') ||
          depSpec.startsWith('workspace:'))
      ) {
        return {
          name: 'Library version',
          status: 'pass',
          message: 'Local dependency (version check skipped)',
        };
      }
    }
    if (fs.lstatSync(libraryPath).isSymbolicLink()) {
      return {
        name: 'Library version',
        status: 'pass',
        message: 'Linked dependency (version check skipped)',
      };
    }
  } catch {
    // Continue with registry check
  }

  // Check against npm registry
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const currentVersion = pkg.version;
    const latestVersion = execSync('npm view @synergenius/flow-weaver version', {
      timeout: 5000,
      stdio: 'pipe',
    })
      .toString()
      .trim();

    if (currentVersion === latestVersion) {
      return {
        name: 'Library version',
        status: 'pass',
        message: `@synergenius/flow-weaver ${currentVersion} is up to date`,
      };
    }
    return {
      name: 'Library version',
      status: 'warn',
      message: `Library update available: ${currentVersion} → ${latestVersion}`,
      fix: 'npm update @synergenius/flow-weaver',
    };
  } catch {
    return {
      name: 'Library version',
      status: 'pass',
      message: 'Could not check for updates (registry unreachable)',
    };
  }
}

export function checkTypesNodeInstalled(cwd: string): CheckResult {
  const pkgPath = path.join(cwd, 'node_modules', '@types', 'node', 'package.json');
  if (fs.existsSync(pkgPath)) {
    return {
      name: '@types/node installed',
      status: 'pass',
      message: '@types/node is installed',
    };
  }
  return {
    name: '@types/node installed',
    status: 'warn',
    message: '@types/node is not installed (recommended)',
    fix: 'npm install -D @types/node',
  };
}

export function checkTsxAvailable(cwd: string): CheckResult {
  // Check local install first
  const localBin = path.join(cwd, 'node_modules', '.bin', 'tsx');
  if (fs.existsSync(localBin)) {
    return {
      name: 'tsx available',
      status: 'pass',
      message: 'tsx is available (local)',
    };
  }
  // Check global
  try {
    execSync('tsx --version', { stdio: 'pipe', timeout: 5000 });
    return {
      name: 'tsx available',
      status: 'pass',
      message: 'tsx is available (global)',
    };
  } catch {
    return {
      name: 'tsx available',
      status: 'warn',
      message: 'tsx is not installed (recommended for running .ts files)',
      fix: 'npm install -D tsx',
    };
  }
}

// ── Config health checks ─────────────────────────────────────────────────────

const VALID_FILE_TYPES = ['ts', 'tsx', 'js', 'jsx'];
const VALID_TARGETS = ['lambda', 'vercel', 'cloudflare'];

function readYaml(filePath: string): { data: unknown; error?: string } {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return { data: YAML.load(content) };
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : String(e) };
  }
}

export function checkProjectConfig(cwd: string): CheckResult {
  const configPath = path.join(cwd, '.flowweaver', 'config.yaml');

  if (!fs.existsSync(configPath)) {
    return {
      name: 'Project config',
      status: 'warn',
      message: '.flowweaver/config.yaml not found',
      fix: 'Create .flowweaver/config.yaml with at least: defaultFileType: ts',
    };
  }

  const { data, error } = readYaml(configPath);
  if (error || data == null) {
    return {
      name: 'Project config',
      status: 'fail',
      message: `Could not parse .flowweaver/config.yaml: ${error}`,
      fix: 'Fix YAML syntax in .flowweaver/config.yaml',
    };
  }

  const config = data as Record<string, unknown>;

  if (config.defaultFileType && !VALID_FILE_TYPES.includes(config.defaultFileType as string)) {
    return {
      name: 'Project config',
      status: 'fail',
      message: `Invalid defaultFileType "${config.defaultFileType}" — must be one of: ${VALID_FILE_TYPES.join(', ')}`,
      fix: `Set defaultFileType to one of: ${VALID_FILE_TYPES.join(', ')}`,
    };
  }

  if (config.pluginsDir && typeof config.pluginsDir !== 'string') {
    return {
      name: 'Project config',
      status: 'fail',
      message: 'pluginsDir must be a string',
      fix: 'Set pluginsDir to a valid directory path',
    };
  }

  return {
    name: 'Project config',
    status: 'pass',
    message: `.flowweaver/config.yaml is valid`,
    details: `defaultFileType: ${config.defaultFileType ?? 'not set'}`,
  };
}

export function checkDeploymentManifest(cwd: string): CheckResult {
  const deployDir = path.join(cwd, '.flowweaver', 'deployment');

  if (!fs.existsSync(deployDir)) {
    return {
      name: 'Deployment manifest',
      status: 'pass',
      message: 'No deployment directory (deployment profiles are optional)',
    };
  }

  const manifestPath = path.join(deployDir, 'manifest.yaml');
  if (!fs.existsSync(manifestPath)) {
    return {
      name: 'Deployment manifest',
      status: 'fail',
      message: '.flowweaver/deployment/ exists but manifest.yaml is missing',
      fix: 'Create manifest.yaml with activeProfile and profiles list',
    };
  }

  const { data, error } = readYaml(manifestPath);
  if (error || data == null) {
    return {
      name: 'Deployment manifest',
      status: 'fail',
      message: `Could not parse manifest.yaml: ${error}`,
      fix: 'Fix YAML syntax in .flowweaver/deployment/manifest.yaml',
    };
  }

  const manifest = data as Record<string, unknown>;

  if (typeof manifest.activeProfile !== 'string') {
    return {
      name: 'Deployment manifest',
      status: 'fail',
      message: 'manifest.yaml is missing required field: activeProfile',
      fix: 'Add activeProfile: default to manifest.yaml',
    };
  }

  if (!Array.isArray(manifest.profiles)) {
    return {
      name: 'Deployment manifest',
      status: 'fail',
      message: 'manifest.yaml is missing required field: profiles (must be an array)',
      fix: 'Add profiles: [default] to manifest.yaml',
    };
  }

  if (!manifest.profiles.includes(manifest.activeProfile)) {
    return {
      name: 'Deployment manifest',
      status: 'warn',
      message: `Active profile "${manifest.activeProfile}" is not in the profiles list`,
      fix: `Add "${manifest.activeProfile}" to the profiles array or change activeProfile`,
    };
  }

  return {
    name: 'Deployment manifest',
    status: 'pass',
    message: `Deployment manifest valid (${manifest.profiles.length} profile${manifest.profiles.length === 1 ? '' : 's'})`,
  };
}

export function checkDeploymentProfiles(cwd: string): CheckResult {
  const deployDir = path.join(cwd, '.flowweaver', 'deployment');

  if (!fs.existsSync(deployDir)) {
    return {
      name: 'Deployment profiles',
      status: 'pass',
      message: 'No deployment directory (profiles are optional)',
    };
  }

  const manifestPath = path.join(deployDir, 'manifest.yaml');
  if (!fs.existsSync(manifestPath)) {
    return {
      name: 'Deployment profiles',
      status: 'pass',
      message: 'No manifest to validate against',
    };
  }

  const { data: manifestData } = readYaml(manifestPath);
  if (!manifestData || !Array.isArray((manifestData as Record<string, unknown>).profiles)) {
    return {
      name: 'Deployment profiles',
      status: 'pass',
      message: 'Manifest invalid (checked separately)',
    };
  }

  const profiles = (manifestData as Record<string, unknown>).profiles as string[];
  const missing: string[] = [];
  const invalid: string[] = [];

  for (const profile of profiles) {
    const profilePath = path.join(deployDir, `${profile}.yaml`);

    if (!fs.existsSync(profilePath)) {
      missing.push(profile);
      continue;
    }

    const { data, error } = readYaml(profilePath);
    if (error || data == null) {
      invalid.push(`${profile} (parse error)`);
      continue;
    }

    const config = data as Record<string, unknown>;
    if (config.target && !VALID_TARGETS.includes(config.target as string)) {
      invalid.push(
        `${profile} (invalid target "${config.target}" — must be: ${VALID_TARGETS.join(', ')})`
      );
    }
  }

  if (invalid.length > 0) {
    return {
      name: 'Deployment profiles',
      status: 'fail',
      message: `Invalid profiles: ${invalid.join(', ')}`,
      fix: 'Fix the listed profile files in .flowweaver/deployment/',
    };
  }

  if (missing.length > 0) {
    return {
      name: 'Deployment profiles',
      status: 'warn',
      message: `Missing profile files: ${missing.join(', ')}`,
      fix: `Create the missing .yaml files in .flowweaver/deployment/`,
    };
  }

  return {
    name: 'Deployment profiles',
    status: 'pass',
    message: `All ${profiles.length} deployment profiles are valid`,
  };
}

// ── Orchestrator ─────────────────────────────────────────────────────────────

export function runDoctorChecks(cwd: string): DoctorReport {
  const moduleFormat = detectProjectModuleFormat(cwd);

  const checks: CheckResult[] = [
    checkNodeVersion(),
    checkTypeScriptVersion(cwd),
    checkPackageJsonType(cwd),
    checkTsconfigModule(cwd),
    checkTsconfigModuleResolution(cwd),
    checkFlowWeaverInstalled(cwd),
    checkFlowWeaverVersion(cwd),
    checkTypesNodeInstalled(cwd),
    checkTsxAvailable(cwd),
    checkProjectConfig(cwd),
    checkDeploymentManifest(cwd),
    checkDeploymentProfiles(cwd),
  ];

  const summary = { pass: 0, warn: 0, fail: 0 };
  for (const check of checks) {
    summary[check.status]++;
  }

  return {
    ok: summary.fail === 0,
    checks,
    summary,
    moduleFormat,
  };
}

// ── CLI entrypoint ───────────────────────────────────────────────────────────

export async function doctorCommand(options: DoctorOptions = {}): Promise<void> {
  const cwd = process.cwd();
  const report = runDoctorChecks(cwd);

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    logger.section('Flow Weaver Doctor');
    logger.info(`Checking project at ${cwd}`);
    logger.newline();

    for (const check of report.checks) {
      switch (check.status) {
        case 'pass':
          logger.success(check.message);
          break;
        case 'warn':
          logger.warn(check.message);
          if (check.fix) {
            logger.log(`    Fix: ${check.fix}`);
          }
          break;
        case 'fail':
          logger.error(check.message);
          if (check.fix) {
            logger.log(`    Fix: ${check.fix}`);
          }
          break;
      }
    }

    logger.newline();
    logger.section('Module Format');
    logger.info(
      `  Detected: ${report.moduleFormat.format.toUpperCase()} (${report.moduleFormat.details})`
    );

    logger.newline();
    logger.section('Summary');
    const parts: string[] = [];
    if (report.summary.pass > 0) parts.push(`${report.summary.pass} passed`);
    if (report.summary.warn > 0) parts.push(`${report.summary.warn} warning(s)`);
    if (report.summary.fail > 0) parts.push(`${report.summary.fail} failed`);
    logger.log(`  ${parts.join(', ')}`);

    if (report.ok) {
      logger.newline();
      logger.success('Environment is ready for flow-weaver!');
    } else {
      logger.newline();
      logger.error('Some checks failed. Please fix the issues above.');
    }
  }

  if (!report.ok) {
    process.exit(1);
  }
}
