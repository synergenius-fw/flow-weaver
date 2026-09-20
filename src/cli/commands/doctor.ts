/* eslint-disable no-console */
/**
 * Doctor command - validates project environment and configuration for flow-weaver compatibility
 */

import { listServices, type ServiceRecord } from '../../service-registry.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import * as YAML from 'js-yaml';
import { logger } from '../utils/logger.js';
import type { TModuleFormat } from '../../ast/types.js';
import { VERSION } from '../../generated-version.js';

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

/** The Flow Weaver that is actually answering: its version and where it runs from. */
export interface ServerInstallInfo {
  version: string;
  installPath: string;
}

export interface DoctorReport {
  ok: boolean;
  checks: CheckResult[];
  summary: { pass: number; warn: number; fail: number };
  moduleFormat: ModuleFormatDetection;
  server: ServerInstallInfo;
  /** The fw processes alive on this machine, as they announced themselves. */
  services: ServiceRecord[];
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
    // String literal, copied verbatim
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

  // Check the tsconfig.json "module" setting, following `extends`.
  const { parsed } = readTsconfig(cwd);
  if (parsed) {
    const compilerOptions = (parsed.compilerOptions ?? {}) as Record<string, unknown>;
    const mod =
      typeof compilerOptions.module === 'string' ? compilerOptions.module.toLowerCase() : undefined;

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
  }

  // Default to ESM for new projects
  return { format: 'esm', source: 'default', details: 'defaulting to ESM' };
}

// ── Running install ──────────────────────────────────────────────────────────

const PACKAGE_NAME = '@synergenius/flow-weaver';

function realpathOr(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

/** Is `dir` the root of a Flow Weaver checkout or install (its own package.json)? */
function isFlowWeaverPackageRoot(dir: string): boolean {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    return pkg.name === PACKAGE_NAME;
  } catch {
    return false;
  }
}

/**
 * Where this very module runs from, resolved to the package root.
 *
 * The MCP server is started with an absolute path to one install and keeps
 * serving that install whatever directory the tools are pointed at. Reporting
 * the path makes that visible: in a git worktree, a rebuild of `dist/` in the
 * worktree changes nothing the server does, and the only symptom is that a
 * fix "did not work". `import.meta.url` is the ESM case (the `dist/*.mjs`
 * bundle, tsx, vitest); `__dirname` covers a CJS bundle.
 */
export function serverInstallInfo(): ServerInstallInfo {
  let here: string;
  try {
    here = path.dirname(fileURLToPath(import.meta.url));
  } catch {
    here = __dirname;
  }
  let dir = here;
  for (let depth = 0; depth < 8; depth++) {
    if (isFlowWeaverPackageRoot(dir)) {
      return { version: VERSION, installPath: realpathOr(dir) };
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return { version: VERSION, installPath: realpathOr(here) };
}

/**
 * Says which install is answering, and warns when the directory under check
 * is a *different* Flow Weaver checkout -- the worktree case, where edits and
 * rebuilds in the checked directory do not reach the running server.
 */
export function checkServerInstall(cwd: string): CheckResult {
  const { version, installPath } = serverInstallInfo();
  const checked = realpathOr(path.resolve(cwd));

  if (isFlowWeaverPackageRoot(checked) && checked !== installPath) {
    return {
      name: 'Running install',
      status: 'warn',
      message: `This is a Flow Weaver checkout, but the running server is ${PACKAGE_NAME} ${version} from ${installPath}`,
      fix: `Edits and rebuilds here do not reach the running server. Restart the MCP server from ${path.join(checked, 'dist', 'cli', 'flow-weaver.mjs')}, or rebuild the install it runs from.`,
    };
  }

  return {
    name: 'Running install',
    status: 'pass',
    message: `${PACKAGE_NAME} ${version} running from ${installPath}`,
  };
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

/**
 * Read a tsconfig at an exact path and merge in whatever it `extends`, so a
 * project that keeps its real settings in a base config (`extends:
 * "./tsconfig.base.json"`, or a package like `@tsconfig/node20`) is judged on
 * the settings it actually compiles with, not on the thin file that only adds
 * `extends`. Child options win over the base; `extends` can be a string or, in
 * TS 5.0+, an array applied left to right. Depth is capped so a cycle cannot
 * loop. A base that cannot be found (an unresolved package, say) is skipped
 * rather than failing the whole read.
 */
function readTsconfigAt(
  tsconfigPath: string,
  compilerOptions: Record<string, unknown>,
  depth: number,
): void {
  if (depth > 10 || !fs.existsSync(tsconfigPath)) return;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(stripJsonComments(fs.readFileSync(tsconfigPath, 'utf8')));
  } catch {
    return;
  }
  const base = parsed.extends;
  const bases = typeof base === 'string' ? [base] : Array.isArray(base) ? base : [];
  for (const b of bases) {
    if (typeof b !== 'string') continue;
    readTsconfigAt(resolveExtends(b, path.dirname(tsconfigPath)), compilerOptions, depth + 1);
  }
  const own = (parsed.compilerOptions ?? {}) as Record<string, unknown>;
  Object.assign(compilerOptions, own);
}

/** Turn an `extends` value into a file path: a relative one against the base dir, else a package's tsconfig. */
function resolveExtends(ref: string, fromDir: string): string {
  if (ref.startsWith('.') || ref.startsWith('/')) {
    return ref.endsWith('.json') ? path.resolve(fromDir, ref) : path.resolve(fromDir, `${ref}.json`);
  }
  // A package reference: "@scope/name" or "@scope/name/tsconfig.json".
  const withExt = ref.endsWith('.json') ? ref : `${ref}/tsconfig.json`;
  return path.join(fromDir, 'node_modules', withExt);
}

function readTsconfig(cwd: string): { parsed: Record<string, unknown> | null; error?: string } {
  const tsconfigPath = path.join(cwd, 'tsconfig.json');
  if (!fs.existsSync(tsconfigPath)) {
    return { parsed: null, error: 'No tsconfig.json found' };
  }
  try {
    // The file must parse on its own; a base it cannot reach is tolerated.
    JSON.parse(stripJsonComments(fs.readFileSync(tsconfigPath, 'utf8')));
  } catch {
    return { parsed: null, error: 'Could not parse tsconfig.json' };
  }
  const compilerOptions: Record<string, unknown> = {};
  readTsconfigAt(tsconfigPath, compilerOptions, 0);
  return { parsed: { compilerOptions } };
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
      message: '"moduleResolution" is "node" (Node10), which cannot resolve ESM exports',
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
  // Running inside the Flow Weaver checkout itself: the package is the repo,
  // not a dependency, so there is nothing to install and nothing to warn about.
  if (isFlowWeaverPackageRoot(realpathOr(path.resolve(cwd)))) {
    return {
      name: '@synergenius/flow-weaver installed',
      status: 'pass',
      message: 'This is the Flow Weaver source checkout (not a dependency)',
    };
  }
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
// Target validation is skipped — valid targets are discovered dynamically
// from installed packs at export time.

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
      message: `Invalid defaultFileType "${config.defaultFileType}", must be one of: ${VALID_FILE_TYPES.join(', ')}`,
      fix: `Set defaultFileType to one of: ${VALID_FILE_TYPES.join(', ')}`,
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
    // Target names are validated at export time via the target registry.
    // We only check that the value is a non-empty string here.
    if (config.target && typeof config.target !== 'string') {
      invalid.push(`${profile} (target must be a string)`);
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

/**
 * Which fw processes are running, from the records they keep. Never a
 * failure: an MCP server answering from another install is reported as a
 * warning, since edits here do not reach it.
 */
export function checkRunningServices(services: ServiceRecord[] = listServices()): CheckResult {
  if (!services.length) return { name: 'Running services', status: 'pass', message: 'none' };
  const here = serverInstallInfo().installPath;
  const lines = services.map((s) => {
    const ago = Math.max(0, Math.round((Date.now() - Date.parse(s.lastActivityAt)) / 1000));
    const where = s.url ?? s.transport ?? '';
    const client = s.client ? ` for ${s.client}` : '';
    const last = s.activity ? `, last ${s.activity} ${ago}s ago` : '';
    return `${s.kind} (pid ${s.pid}${where ? `, ${where}` : ''}${client}) from ${s.install}${last}`;
  });
  const elsewhere = services.filter((s) => s.kind === 'mcp-server' && realpathOr(s.install) !== realpathOr(here));
  return {
    name: 'Running services',
    status: elsewhere.length ? 'warn' : 'pass',
    message: lines.join('; '),
    ...(elsewhere.length ? { fix: `An MCP server runs from ${elsewhere[0].install}, not from here. Restart it from this install if this is the one you are changing.` } : {}),
  };
}

export function runDoctorChecks(cwd: string): DoctorReport {
  const moduleFormat = detectProjectModuleFormat(cwd);
  const server = serverInstallInfo();
  const services = listServices();

  const checks: CheckResult[] = [
    checkServerInstall(cwd),
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
    checkRunningServices(services),
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
    server,
    services,
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

    const statusIcon = (s: CheckStatus) =>
      s === 'pass' ? logger.highlight('pass') : s === 'warn' ? 'warn' : '✗ fail';

    const rows: [string, string, string][] = report.checks.map((check) => [
      check.name,
      check.message,
      statusIcon(check.status),
    ]);
    logger.table(rows);

    // Show fixes for non-passing checks
    const fixable = report.checks.filter((c) => c.status !== 'pass' && c.fix);
    if (fixable.length > 0) {
      logger.newline();
      for (const check of fixable) {
        logger.log(`  ${logger.dim(check.name + ':')} ${check.fix}`);
      }
    }

    logger.newline();
    logger.log(`  Running: ${PACKAGE_NAME} ${report.server.version} ${logger.dim(`(${report.server.installPath})`)}`);
    logger.log(`  Module format: ${report.moduleFormat.format.toUpperCase()} ${logger.dim(`(${report.moduleFormat.details})`)}`);

    const parts: string[] = [];
    if (report.summary.pass > 0) parts.push(`${report.summary.pass} passed`);
    if (report.summary.warn > 0) parts.push(`${report.summary.warn} warnings`);
    if (report.summary.fail > 0) parts.push(`${report.summary.fail} failed`);
    logger.log(`  ${parts.join(', ')}`);

    if (report.ok) {
      logger.newline();
      logger.success('Environment is ready for flow-weaver!');
    } else {
      logger.newline();
      logger.error('Fix the issues above to continue.');
    }
  }

  if (!report.ok) {
    throw new Error('Doctor found issues that need to be fixed');
  }
}
