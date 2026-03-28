/**
 * Integration tests for scripts/postinstall.cjs.
 *
 * Runs the actual CJS script as a child process to verify:
 * - Cross-platform compatibility (no bash-isms, pure Node)
 * - CI detection silences output
 * - Context detection produces correct messages
 * - Never exits with non-zero code (never fails the install)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const SCRIPT = path.resolve(__dirname, '../../scripts/postinstall.cjs');

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-postinstall-cjs-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const BASE_ENV: Record<string, string> = {
  CI: '',
  CONTINUOUS_INTEGRATION: '',
  BUILD_NUMBER: '',
  GITHUB_ACTIONS: '',
  GITLAB_CI: '',
  CIRCLECI: '',
  JENKINS_URL: '',
  CODEBUILD_BUILD_ID: '',
};

function runPostinstall(initCwd: string, extraEnv: Record<string, string> = {}): { status: number; stdout: string; stderr: string } {
  const { spawnSync } = require('child_process');
  const proc = spawnSync(process.execPath, [SCRIPT], {
    env: { ...process.env, INIT_CWD: initCwd, ...BASE_ENV, ...extraEnv },
    timeout: 5000,
  });
  return {
    status: proc.status ?? 0,
    stdout: proc.stdout?.toString() ?? '',
    stderr: proc.stderr?.toString() ?? '',
  };
}

describe('postinstall.cjs integration', () => {
  it('exits 0 and is silent in CI', () => {
    const result = runPostinstall(tmpDir, { CI: 'true' });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe('');
  });

  it('shows global install message when no package.json', () => {
    const result = runPostinstall(tmpDir);
    expect(result.status).toBe(0);
    expect(result.stderr).toContain('fw init');
    expect(result.stderr).toContain('fw create workflow');
    expect(result.stdout).toBe('');
  });

  it('shows TypeScript hint when tsconfig exists with .ts files', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, 'tsconfig.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, 'utils.ts'), 'export const x = 1;');

    const result = runPostinstall(tmpDir);
    expect(result.stderr).toContain('@flowWeaver nodeType');
    expect(result.stderr).toContain('fw compile');
    expect(result.stdout).toBe('');
  });

  it('shows updated message for existing flow-weaver projects', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, 'tsconfig.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, 'workflow.ts'), '/** @flowWeaver workflow */\nexport function wf() {}');

    const result = runPostinstall(tmpDir);
    expect(result.stderr).toContain('updated');
    expect(result.stderr).toContain('fw doctor');
  });

  it('shows fw init for non-TypeScript projects', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');

    const result = runPostinstall(tmpDir);
    expect(result.stderr).toContain('fw init');
    expect(result.stderr).not.toContain('@flowWeaver');
  });

  it('never exits with non-zero code', () => {
    // Point to a non-existent directory — should not crash
    const result = runPostinstall('/nonexistent/path/that/does/not/exist');
    expect(result.status).toBe(0);
  });
});
