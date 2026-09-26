/**
 * The real CLI entry (src/cli/index.ts), run as a process: what a user sees on
 * stdout and stderr and the exit code. The program's parsing is covered by
 * program.test.ts; these cover what only the entry does (the no-args welcome,
 * parsing process.argv, printing an error once and exiting with its code).
 *
 * Runs `node --import tsx` directly, not npx: on Linux a grandchild of npx can
 * outlive it and hold stdout open.
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const CLI_ENTRY = path.join(PROJECT_ROOT, 'src/cli/index.ts');

// Strip VITEST* so the entry's test guard does not skip parsing, and pin
// colour off so the output is plain text.
const env: NodeJS.ProcessEnv = {
  ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('VITEST'))),
  NO_COLOR: '1',
};
delete env.FORCE_COLOR;

function fw(...args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, ['--import', 'tsx', CLI_ENTRY, ...args], {
    cwd: PROJECT_ROOT,
    env,
    encoding: 'utf8',
    timeout: 60_000,
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

describe('fw entry', { timeout: 90_000 }, () => {
  it('prints the welcome and exits 0 with no arguments', () => {
    const r = fw();
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
    expect(r.stdout).toContain('flow-weaver v0.0.0-dev');
    expect(r.stdout).toContain('Usage: fw <command> [options]');
    expect(r.stdout).toContain('Run fw --help for all commands.');
  });

  it('prints the version banner and exits 0 for --version', () => {
    const r = fw('--version');
    expect(r).toEqual({ status: 0, stdout: '  flow-weaver v0.0.0-dev\n', stderr: '' });
  });

  it('prints an unknown command once on stderr and exits 1', () => {
    const r = fw('compil');
    expect(r).toEqual({ status: 1, stdout: '', stderr: "✗ unknown command 'compil'\n(Did you mean compile?)\n" });
  });

  it('prints a failing command\'s error once on stderr and exits 1', () => {
    const r = fw('validate', '/nonexistent.ts');
    expect(r).toEqual({ status: 1, stdout: '', stderr: '✗ No files found matching pattern: /nonexistent.ts\n' });
  });

  it('prints an error thrown out of parsing once and exits 1', () => {
    const r = fw('create', 'node', 'n', 'f.ts', '--line', 'abc');
    expect(r).toEqual({ status: 1, stdout: '', stderr: '✗ "abc" is not a valid number\n' });
  });
});
