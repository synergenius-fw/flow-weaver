/**
 * Tests for the doctor command's report output.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { captureConsole, type ConsoleCapture } from '../../helpers/console-capture';

const TEMP_DIR = path.join(os.tmpdir(), `fw-doctor-cov-${process.pid}`);

beforeEach(() => {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
});

afterEach(() => {
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
});

function writeFixture(relativePath: string, content: string): string {
  const fullPath = path.join(TEMP_DIR, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
  return fullPath;
}

describe('doctorCommand: non-JSON output', () => {
  let originalCwd: () => string;
  let out: ConsoleCapture;

  beforeEach(() => {
    originalCwd = process.cwd;
    out = captureConsole();
  });

  afterEach(() => {
    out.restore();
    process.cwd = originalCwd;
  });

  it('prints formatted report with fixes for non-passing checks', async () => {
    const { doctorCommand } = await import('../../../src/cli/commands/doctor');

    // Set up a project dir that will produce some warnings/fails
    const projectDir = path.join(TEMP_DIR, 'doctor-project');
    fs.mkdirSync(projectDir, { recursive: true });
    // No package.json, no tsconfig -> will produce fail/warn checks
    writeFixture('doctor-project/package.json', JSON.stringify({ name: 'test', type: 'module' }));

    process.cwd = () => projectDir;

    // Failures make the command throw, after printing the report.
    await expect(doctorCommand({ json: false })).rejects.toThrow('Doctor found issues that need to be fixed');

    const text = out.text();
    expect(text).toMatch(/TypeScript version\s+.*✗ fail/);
    // Each non-passing check is followed by its fix.
    expect(text).toContain('TypeScript version: npm install -D typescript');
    expect(text).toContain('@synergenius/flow-weaver installed: npm install @synergenius/flow-weaver');
    expect(text).toMatch(/\d+ passed, \d+ warnings, 2 failed/);
    expect(out.of('error')).toContain('Fix the issues above to continue.');
  });

  it('prints success message when all checks pass', async () => {
    const { doctorCommand } = await import('../../../src/cli/commands/doctor');

    // Create a project directory with enough config to pass most checks
    const projectDir = path.join(TEMP_DIR, 'doctor-pass');
    fs.mkdirSync(projectDir, { recursive: true });
    writeFixture('doctor-pass/package.json', JSON.stringify({
      name: 'test-pass',
      type: 'module',
    }));
    writeFixture('doctor-pass/tsconfig.json', JSON.stringify({
      compilerOptions: { module: 'nodenext', moduleResolution: 'nodenext' },
    }));
    // Create node_modules stubs
    writeFixture('doctor-pass/node_modules/typescript/package.json', JSON.stringify({ version: '5.4.0' }));
    writeFixture('doctor-pass/node_modules/@synergenius/flow-weaver/package.json', JSON.stringify({ version: '0.21.0' }));
    writeFixture('doctor-pass/node_modules/@types/node/package.json', JSON.stringify({ version: '20.0.0' }));
    writeFixture('doctor-pass/node_modules/.bin/tsx', '#!/bin/sh\n');
    writeFixture('doctor-pass/.flowweaver/config.yaml', 'defaultFileType: ts\n');

    process.cwd = () => projectDir;
    // No failures; a warning (e.g. a newer library version) does not fail it.
    await expect(doctorCommand({})).resolves.toBeUndefined();

    expect(out.text()).toContain('Environment is ready for flow-weaver!');
    expect(out.text()).not.toContain('failed');
    expect(out.of('error')).toBe('');
  });

  it('prints JSON report when --json is used', async () => {
    const { doctorCommand } = await import('../../../src/cli/commands/doctor');

    const projectDir = path.join(TEMP_DIR, 'doctor-json');
    fs.mkdirSync(projectDir, { recursive: true });
    writeFixture('doctor-json/package.json', JSON.stringify({ name: 'test', type: 'module' }));

    process.cwd = () => projectDir;

    await expect(doctorCommand({ json: true })).rejects.toThrow('Doctor found issues');

    // The report is printed as JSON, and only as JSON.
    const report = JSON.parse(out.text());
    expect(report.ok).toBe(false);
    expect(report.summary.fail).toBe(2);
    expect(report.checks).toContainEqual(expect.objectContaining({ name: 'TypeScript version', status: 'fail' }));
  });
});
