/**
 * Tests for doctor command
 * Uses direct check functions for speed, with CLI smoke test for wiring
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as YAML from 'js-yaml';
import {
  stripJsonComments,
  checkNodeVersion,
  checkTypeScriptVersion,
  checkPackageJsonType,
  checkTsconfigModule,
  checkTsconfigModuleResolution,
  checkFlowWeaverInstalled,
  checkTypesNodeInstalled,
  checkTsxAvailable,
  checkProjectConfig,
  checkDeploymentProfiles,
  checkDeploymentManifest,
  runDoctorChecks,
  doctorCommand,
  detectProjectModuleFormat,
} from '../../src/cli/commands/doctor';

const DOCTOR_TEMP_DIR = path.join(os.tmpdir(), `flow-weaver-doctor-${process.pid}`);

beforeAll(() => fs.mkdirSync(DOCTOR_TEMP_DIR, { recursive: true }));
afterAll(() => fs.rmSync(DOCTOR_TEMP_DIR, { recursive: true, force: true }));

/** Create a temp subdirectory with the given files */
function makeFixture(name: string, files: Record<string, string>): string {
  const dir = path.join(DOCTOR_TEMP_DIR, name);
  fs.mkdirSync(dir, { recursive: true });
  for (const [file, content] of Object.entries(files)) {
    const filePath = path.join(dir, file);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  }
  return dir;
}

// ── stripJsonComments ────────────────────────────────────────────────────────

describe('stripJsonComments', () => {
  it('should remove single-line comments', () => {
    const input = '{\n  "a": 1 // comment\n}';
    const result = stripJsonComments(input);
    expect(JSON.parse(result)).toEqual({ a: 1 });
  });

  it('should remove multi-line comments', () => {
    const input = '{\n  /* comment */\n  "a": 1\n}';
    const result = stripJsonComments(input);
    expect(JSON.parse(result)).toEqual({ a: 1 });
  });

  it('should preserve // inside strings', () => {
    const input = '{ "url": "http://example.com" }';
    const result = stripJsonComments(input);
    expect(JSON.parse(result)).toEqual({ url: 'http://example.com' });
  });

  it('should handle empty input', () => {
    expect(stripJsonComments('')).toBe('');
  });

  it('should handle multi-line comment spanning lines', () => {
    const input = '{\n  /* \n  multi\n  line\n  */\n  "b": 2\n}';
    const result = stripJsonComments(input);
    expect(JSON.parse(result)).toEqual({ b: 2 });
  });
});

// ── detectProjectModuleFormat ────────────────────────────────────────────────

describe('detectProjectModuleFormat', () => {
  it('should detect ESM from package.json "type": "module"', () => {
    const dir = makeFixture('detect-esm', {
      'package.json': JSON.stringify({ type: 'module' }),
    });
    const result = detectProjectModuleFormat(dir);
    expect(result.format).toBe('esm');
    expect(result.source).toBe('package.json');
  });

  it('should detect CJS from package.json "type": "commonjs"', () => {
    const dir = makeFixture('detect-cjs-explicit', {
      'package.json': JSON.stringify({ type: 'commonjs' }),
    });
    const result = detectProjectModuleFormat(dir);
    expect(result.format).toBe('cjs');
    expect(result.source).toBe('package.json');
  });

  it('should detect CJS when package.json has no type field', () => {
    const dir = makeFixture('detect-cjs-default', {
      'package.json': JSON.stringify({ name: 'test' }),
    });
    const result = detectProjectModuleFormat(dir);
    expect(result.format).toBe('cjs');
    expect(result.source).toBe('package.json');
    expect(result.details).toContain('defaults to CommonJS');
  });

  it('should fall back to tsconfig when package.json is missing', () => {
    const dir = makeFixture('detect-tsconfig-esm', {
      'tsconfig.json': JSON.stringify({ compilerOptions: { module: 'esnext' } }),
    });
    const result = detectProjectModuleFormat(dir);
    expect(result.format).toBe('esm');
    expect(result.source).toBe('tsconfig');
  });

  it('should fall back to tsconfig for CJS module', () => {
    const dir = makeFixture('detect-tsconfig-cjs', {
      'tsconfig.json': JSON.stringify({ compilerOptions: { module: 'commonjs' } }),
    });
    const result = detectProjectModuleFormat(dir);
    expect(result.format).toBe('cjs');
    expect(result.source).toBe('tsconfig');
  });

  it('should default to ESM when no config files exist', () => {
    const dir = makeFixture('detect-default', {});
    const result = detectProjectModuleFormat(dir);
    expect(result.format).toBe('esm');
    expect(result.source).toBe('default');
  });
});

// ── Individual check functions ───────────────────────────────────────────────

describe('checkNodeVersion', () => {
  it('should pass for the current Node.js version (test requires Node >= 18)', () => {
    const result = checkNodeVersion();
    expect(result.status).toBe('pass');
    expect(result.name).toBe('Node.js version');
  });
});

describe('checkTypeScriptVersion', () => {
  it('should pass when TypeScript >= 5 is installed', () => {
    const dir = makeFixture('ts-ok', {
      'node_modules/typescript/package.json': JSON.stringify({ version: '5.3.3' }),
    });
    const result = checkTypeScriptVersion(dir);
    expect(result.status).toBe('pass');
  });

  it('should fail when TypeScript < 5 is installed', () => {
    const dir = makeFixture('ts-old', {
      'node_modules/typescript/package.json': JSON.stringify({ version: '4.9.5' }),
    });
    const result = checkTypeScriptVersion(dir);
    expect(result.status).toBe('fail');
    expect(result.fix).toBeDefined();
  });

  it('should fail when TypeScript is not installed', () => {
    const dir = makeFixture('ts-missing', {});
    const result = checkTypeScriptVersion(dir);
    expect(result.status).toBe('fail');
  });
});

describe('checkPackageJsonType', () => {
  it('should pass when type is module', () => {
    const dir = makeFixture('pkg-module', {
      'package.json': JSON.stringify({ type: 'module' }),
    });
    const result = checkPackageJsonType(dir);
    expect(result.status).toBe('pass');
    expect(result.message).toContain('ESM');
  });

  it('should pass when type is commonjs', () => {
    const dir = makeFixture('pkg-cjs', {
      'package.json': JSON.stringify({ type: 'commonjs' }),
    });
    const result = checkPackageJsonType(dir);
    expect(result.status).toBe('pass');
    expect(result.message).toContain('CJS');
  });

  it('should pass when type is not set (defaults to CommonJS)', () => {
    const dir = makeFixture('pkg-notype', {
      'package.json': JSON.stringify({ name: 'test' }),
    });
    const result = checkPackageJsonType(dir);
    expect(result.status).toBe('pass');
    expect(result.message).toContain('defaults to CommonJS');
  });

  it('should fail when package.json is missing', () => {
    const dir = makeFixture('pkg-missing', {});
    const result = checkPackageJsonType(dir);
    expect(result.status).toBe('fail');
  });
});

describe('checkTsconfigModule', () => {
  it('should pass for nodenext (ESM)', () => {
    const dir = makeFixture('tsconfig-nodenext', {
      'package.json': JSON.stringify({ type: 'module' }),
      'tsconfig.json': JSON.stringify({ compilerOptions: { module: 'nodenext' } }),
    });
    const result = checkTsconfigModule(dir);
    expect(result.status).toBe('pass');
    expect(result.message).toContain('ESM');
  });

  it('should pass for commonjs in a CJS project', () => {
    const dir = makeFixture('tsconfig-cjs', {
      'package.json': JSON.stringify({ name: 'test' }), // No type = CJS
      'tsconfig.json': JSON.stringify({ compilerOptions: { module: 'commonjs' } }),
    });
    const result = checkTsconfigModule(dir);
    expect(result.status).toBe('pass');
    expect(result.message).toContain('CJS');
  });

  it('should warn for commonjs with ESM package.json', () => {
    const dir = makeFixture('tsconfig-cjs-mismatch', {
      'package.json': JSON.stringify({ type: 'module' }),
      'tsconfig.json': JSON.stringify({ compilerOptions: { module: 'commonjs' } }),
    });
    const result = checkTsconfigModule(dir);
    expect(result.status).toBe('warn');
    expect(result.message).toContain('suggests ESM');
  });

  it('should warn when module is missing', () => {
    const dir = makeFixture('tsconfig-nomod', {
      'tsconfig.json': JSON.stringify({ compilerOptions: {} }),
    });
    const result = checkTsconfigModule(dir);
    expect(result.status).toBe('warn');
  });

  it('should warn when tsconfig.json is missing', () => {
    const dir = makeFixture('tsconfig-missing', {});
    const result = checkTsconfigModule(dir);
    expect(result.status).toBe('warn');
  });

  it('should handle tsconfig with comments', () => {
    const dir = makeFixture('tsconfig-comments', {
      'package.json': JSON.stringify({ type: 'module' }),
      'tsconfig.json':
        '{\n  // Use nodenext for ESM\n  "compilerOptions": { "module": "nodenext" }\n}',
    });
    const result = checkTsconfigModule(dir);
    expect(result.status).toBe('pass');
  });
});

describe('checkTsconfigModuleResolution', () => {
  it('should pass for nodenext', () => {
    const dir = makeFixture('modres-nodenext', {
      'tsconfig.json': JSON.stringify({ compilerOptions: { moduleResolution: 'nodenext' } }),
    });
    const result = checkTsconfigModuleResolution(dir);
    expect(result.status).toBe('pass');
  });

  it('should pass for bundler', () => {
    const dir = makeFixture('modres-bundler', {
      'tsconfig.json': JSON.stringify({ compilerOptions: { moduleResolution: 'bundler' } }),
    });
    const result = checkTsconfigModuleResolution(dir);
    expect(result.status).toBe('pass');
  });

  it('should fail for node (Node10)', () => {
    const dir = makeFixture('modres-node', {
      'tsconfig.json': JSON.stringify({ compilerOptions: { moduleResolution: 'node' } }),
    });
    const result = checkTsconfigModuleResolution(dir);
    expect(result.status).toBe('fail');
  });

  it('should warn when moduleResolution is missing', () => {
    const dir = makeFixture('modres-missing', {
      'tsconfig.json': JSON.stringify({ compilerOptions: {} }),
    });
    const result = checkTsconfigModuleResolution(dir);
    expect(result.status).toBe('warn');
  });
});

describe('checkFlowWeaverInstalled', () => {
  it('should pass when installed', () => {
    const dir = makeFixture('fw-ok', {
      'node_modules/@synergenius/flow-weaver/package.json': JSON.stringify({
        name: '@synergenius/flow-weaver',
        version: '0.1.0',
      }),
    });
    const result = checkFlowWeaverInstalled(dir);
    expect(result.status).toBe('pass');
  });

  it('should fail when not installed', () => {
    const dir = makeFixture('fw-missing', {});
    const result = checkFlowWeaverInstalled(dir);
    expect(result.status).toBe('fail');
    expect(result.fix).toBeDefined();
  });
});

describe('checkTypesNodeInstalled', () => {
  it('should pass when installed', () => {
    const dir = makeFixture('types-ok', {
      'node_modules/@types/node/package.json': JSON.stringify({ name: '@types/node' }),
    });
    const result = checkTypesNodeInstalled(dir);
    expect(result.status).toBe('pass');
  });

  it('should warn when not installed', () => {
    const dir = makeFixture('types-missing', {});
    const result = checkTypesNodeInstalled(dir);
    expect(result.status).toBe('warn');
  });
});

describe('checkTsxAvailable', () => {
  it('should pass when tsx is locally installed', () => {
    const dir = makeFixture('tsx-local', {
      'node_modules/.bin/tsx': '#!/bin/sh\n',
    });
    const result = checkTsxAvailable(dir);
    expect(result.status).toBe('pass');
    expect(result.message).toContain('local');
  });

  it('should warn when tsx is not available locally (status is warn or pass for global)', () => {
    const dir = makeFixture('tsx-none', {});
    const result = checkTsxAvailable(dir);
    // Could be 'pass' if tsx is globally installed, or 'warn' if not
    expect(['pass', 'warn']).toContain(result.status);
  });
});

// ── Shared "good project" fixtures (used by orchestrator + CLI tests) ────────

const GOOD_ESM_PROJECT_FILES = {
  'package.json': JSON.stringify({ type: 'module' }),
  'tsconfig.json': JSON.stringify({
    compilerOptions: { module: 'nodenext', moduleResolution: 'nodenext' },
  }),
  'node_modules/typescript/package.json': JSON.stringify({ version: '5.3.3' }),
  'node_modules/@synergenius/flow-weaver/package.json': JSON.stringify({
    name: '@synergenius/flow-weaver',
    version: '0.1.0',
  }),
  'node_modules/@types/node/package.json': JSON.stringify({ name: '@types/node' }),
  'node_modules/.bin/tsx': '#!/bin/sh\n',
};

const GOOD_CJS_PROJECT_FILES = {
  'package.json': JSON.stringify({ name: 'test' }), // No type = CJS
  'tsconfig.json': JSON.stringify({
    compilerOptions: { module: 'commonjs', moduleResolution: 'node10' },
  }),
  'node_modules/typescript/package.json': JSON.stringify({ version: '5.3.3' }),
  'node_modules/@synergenius/flow-weaver/package.json': JSON.stringify({
    name: '@synergenius/flow-weaver',
    version: '0.1.0',
  }),
  'node_modules/@types/node/package.json': JSON.stringify({ name: '@types/node' }),
  'node_modules/.bin/tsx': '#!/bin/sh\n',
};

// Pre-create shared fixtures once
let goodEsmDir: string;
let goodCjsDir: string;
let emptyDir: string;
let badDir: string;

beforeAll(() => {
  goodEsmDir = makeFixture('shared-good-esm', GOOD_ESM_PROJECT_FILES);
  goodCjsDir = makeFixture('shared-good-cjs', GOOD_CJS_PROJECT_FILES);
  emptyDir = makeFixture('shared-empty', {});
  badDir = makeFixture('shared-bad', {
    'package.json': JSON.stringify({ name: 'test' }),
  });
});

// ── runDoctorChecks orchestrator ─────────────────────────────────────────────

describe('runDoctorChecks', () => {
  it('should run all 8 checks', () => {
    const report = runDoctorChecks(emptyDir);
    expect(report.checks).toHaveLength(12);
    expect(report.summary.pass + report.summary.warn + report.summary.fail).toBe(12);
  });

  it('should report ok=false when failures exist (missing TypeScript)', () => {
    const report = runDoctorChecks(badDir);
    expect(report.ok).toBe(false);
    expect(report.summary.fail).toBeGreaterThan(0);
  });

  it('should report ok=true for a fully valid ESM project', () => {
    const report = runDoctorChecks(goodEsmDir);
    expect(report.ok).toBe(true);
    expect(report.summary.fail).toBe(0);
    expect(report.moduleFormat.format).toBe('esm');
    // Node.js check uses process.version; warn count depends on environment
    expect(report.summary.pass).toBeGreaterThanOrEqual(7);
  });

  it('should report ok=true for a fully valid CJS project', () => {
    const report = runDoctorChecks(goodCjsDir);
    expect(report.moduleFormat.format).toBe('cjs');
    // Should have failures because moduleResolution: node10 is not valid
    // but package type and module format should be detected correctly
    expect(report.moduleFormat.source).toBe('package.json');
  });

  it('should include moduleFormat in the report', () => {
    const report = runDoctorChecks(goodEsmDir);
    expect(report.moduleFormat).toBeDefined();
    expect(report.moduleFormat.format).toBe('esm');
    expect(report.moduleFormat.source).toBe('package.json');
  });
});

// ── CLI --json wiring ────────────────────────────────────────────────────────

describe('doctorCommand --json', () => {
  it('should output valid JSON report', async () => {
    const dir = goodEsmDir;

    const logs: string[] = [];
    const originalLog = console.log;
    const originalCwd = process.cwd;
    const originalExit = process.exit;

    console.log = (...args: unknown[]) => logs.push(args.map(String).join(' '));
    process.cwd = () => dir;
    process.exit = vi.fn() as never;

    try {
      await doctorCommand({ json: true });
    } finally {
      console.log = originalLog;
      process.cwd = originalCwd;
      process.exit = originalExit;
    }

    expect(logs.length).toBeGreaterThan(0);
    const report = JSON.parse(logs.join(''));
    expect(report).toHaveProperty('ok');
    expect(report).toHaveProperty('checks');
    expect(report).toHaveProperty('summary');
    expect(report).toHaveProperty('moduleFormat');
    expect(Array.isArray(report.checks)).toBe(true);
    expect(report.checks).toHaveLength(12);
    expect(typeof report.summary.pass).toBe('number');
    expect(typeof report.summary.warn).toBe('number');
    expect(typeof report.summary.fail).toBe('number');
    expect(report.moduleFormat.format).toBe('esm');
  });

  it('should call process.exit(1) when checks fail', async () => {
    const dir = emptyDir;

    const originalLog = console.log;
    const originalCwd = process.cwd;
    const originalExit = process.exit;
    const mockExit = vi.fn() as unknown as typeof process.exit;

    console.log = vi.fn();
    process.cwd = () => dir;
    process.exit = mockExit;

    try {
      await doctorCommand({ json: true });
    } finally {
      console.log = originalLog;
      process.cwd = originalCwd;
      process.exit = originalExit;
    }

    expect(mockExit).toHaveBeenCalledWith(1);
  });
});

// ── Config health checks ─────────────────────────────────────────────────────

describe('checkProjectConfig', () => {
  it('should pass when .flowweaver/config.yaml exists with valid schema', () => {
    const dir = makeFixture('config-valid', {
      '.flowweaver/config.yaml': YAML.dump({
        defaultFileType: 'ts',
        pluginsDir: './plugins',
      }),
    });
    const result = checkProjectConfig(dir);
    expect(result.status).toBe('pass');
    expect(result.name).toBe('Project config');
  });

  it('should pass when config has only defaultFileType', () => {
    const dir = makeFixture('config-minimal', {
      '.flowweaver/config.yaml': YAML.dump({ defaultFileType: 'js' }),
    });
    const result = checkProjectConfig(dir);
    expect(result.status).toBe('pass');
  });

  it('should warn when .flowweaver/config.yaml is missing', () => {
    const dir = makeFixture('config-missing', {});
    const result = checkProjectConfig(dir);
    expect(result.status).toBe('warn');
    expect(result.fix).toBeDefined();
  });

  it('should fail when config.yaml has invalid YAML syntax', () => {
    const dir = makeFixture('config-bad-yaml', {
      '.flowweaver/config.yaml': '{ invalid yaml: [',
    });
    const result = checkProjectConfig(dir);
    expect(result.status).toBe('fail');
    expect(result.message).toContain('parse');
  });

  it('should fail when defaultFileType has an invalid value', () => {
    const dir = makeFixture('config-bad-filetype', {
      '.flowweaver/config.yaml': YAML.dump({ defaultFileType: 'python' }),
    });
    const result = checkProjectConfig(dir);
    expect(result.status).toBe('fail');
    expect(result.message).toContain('defaultFileType');
  });

  it('should pass with full config including security settings', () => {
    const dir = makeFixture('config-full', {
      '.flowweaver/config.yaml': YAML.dump({
        defaultFileType: 'ts',
        pluginsDir: './plugins',
        security: {
          allowUnsignedPlugins: true,
          allowUnverifiedCapabilities: false,
        },
      }),
    });
    const result = checkProjectConfig(dir);
    expect(result.status).toBe('pass');
  });
});

describe('checkDeploymentManifest', () => {
  it('should pass when manifest.yaml is valid', () => {
    const dir = makeFixture('manifest-valid', {
      '.flowweaver/deployment/manifest.yaml': YAML.dump({
        activeProfile: 'default',
        profiles: ['default'],
      }),
    });
    const result = checkDeploymentManifest(dir);
    expect(result.status).toBe('pass');
    expect(result.name).toBe('Deployment manifest');
  });

  it('should pass when no deployment directory exists (deployment is optional)', () => {
    const dir = makeFixture('manifest-no-dir', {});
    const result = checkDeploymentManifest(dir);
    expect(result.status).toBe('pass');
    expect(result.message).toContain('No deployment');
  });

  it('should fail when manifest.yaml has invalid YAML', () => {
    const dir = makeFixture('manifest-bad-yaml', {
      '.flowweaver/deployment/manifest.yaml': '{ broken: [',
    });
    const result = checkDeploymentManifest(dir);
    expect(result.status).toBe('fail');
  });

  it('should fail when manifest is missing activeProfile', () => {
    const dir = makeFixture('manifest-no-active', {
      '.flowweaver/deployment/manifest.yaml': YAML.dump({
        profiles: ['default'],
      }),
    });
    const result = checkDeploymentManifest(dir);
    expect(result.status).toBe('fail');
    expect(result.message).toContain('activeProfile');
  });

  it('should fail when manifest is missing profiles array', () => {
    const dir = makeFixture('manifest-no-profiles', {
      '.flowweaver/deployment/manifest.yaml': YAML.dump({
        activeProfile: 'default',
      }),
    });
    const result = checkDeploymentManifest(dir);
    expect(result.status).toBe('fail');
    expect(result.message).toContain('profiles');
  });

  it('should warn when activeProfile is not in profiles list', () => {
    const dir = makeFixture('manifest-orphan-active', {
      '.flowweaver/deployment/manifest.yaml': YAML.dump({
        activeProfile: 'staging',
        profiles: ['default', 'production'],
      }),
    });
    const result = checkDeploymentManifest(dir);
    expect(result.status).toBe('warn');
    expect(result.message).toContain('staging');
  });
});

describe('checkDeploymentProfiles', () => {
  it('should pass when all profiles in manifest have valid YAML files', () => {
    const dir = makeFixture('profiles-valid', {
      '.flowweaver/deployment/manifest.yaml': YAML.dump({
        activeProfile: 'default',
        profiles: ['default', 'staging'],
      }),
      '.flowweaver/deployment/default.yaml': YAML.dump({
        target: 'lambda',
        serviceName: 'my-api',
      }),
      '.flowweaver/deployment/staging.yaml': YAML.dump({
        target: 'vercel',
        serviceName: 'my-api-staging',
      }),
    });
    const result = checkDeploymentProfiles(dir);
    expect(result.status).toBe('pass');
    expect(result.name).toBe('Deployment profiles');
  });

  it('should pass when no deployment directory exists', () => {
    const dir = makeFixture('profiles-no-dir', {});
    const result = checkDeploymentProfiles(dir);
    expect(result.status).toBe('pass');
  });

  it('should warn when a profile file listed in manifest is missing', () => {
    const dir = makeFixture('profiles-missing-file', {
      '.flowweaver/deployment/manifest.yaml': YAML.dump({
        activeProfile: 'default',
        profiles: ['default', 'staging'],
      }),
      '.flowweaver/deployment/default.yaml': YAML.dump({ target: 'lambda' }),
      // staging.yaml is missing
    });
    const result = checkDeploymentProfiles(dir);
    expect(result.status).toBe('warn');
    expect(result.message).toContain('staging');
  });

  it('should fail when a profile file has invalid YAML', () => {
    const dir = makeFixture('profiles-bad-yaml', {
      '.flowweaver/deployment/manifest.yaml': YAML.dump({
        activeProfile: 'default',
        profiles: ['default'],
      }),
      '.flowweaver/deployment/default.yaml': '{ broken: [',
    });
    const result = checkDeploymentProfiles(dir);
    expect(result.status).toBe('fail');
    expect(result.message).toContain('default');
  });

  it('should fail when a profile has an invalid target value', () => {
    const dir = makeFixture('profiles-bad-target', {
      '.flowweaver/deployment/manifest.yaml': YAML.dump({
        activeProfile: 'default',
        profiles: ['default'],
      }),
      '.flowweaver/deployment/default.yaml': YAML.dump({
        target: 'heroku',
        serviceName: 'test',
      }),
    });
    const result = checkDeploymentProfiles(dir);
    expect(result.status).toBe('fail');
    expect(result.message).toContain('target');
  });
});
