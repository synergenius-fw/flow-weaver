/**
 * Simple invocations (`--version`, help, the welcome, `templates`) must not
 * load the heavy dependencies: the TypeScript compiler, ts-morph, the
 * chevrotain grammar, esbuild, the MCP SDK or zod. Loading them took `fw
 * --version` from about 0.15 s to 0.8 s and more. Built-in commands must also
 * skip the node_modules scan for pack commands (it pulls in glob).
 *
 * The check is which modules the ESM loader resolved, recorded by a loader
 * hook (tests/fixtures/cli-startup/record-loads.mjs), not wall-clock time,
 * which flakes on shared runners.
 *
 * The source entry is always checked. The built bundle is checked too when
 * dist/ exists: a single-file bundle hoists every static import of an
 * external (typescript, ts-morph, esbuild) to its top, so it would load them
 * all even though the source imports them lazily.
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const CLI_ENTRY = path.join(PROJECT_ROOT, 'src/cli/index.ts');
const BUILT_CLI = path.join(PROJECT_ROOT, 'dist/cli/flow-weaver.mjs');
const RECORDER = path.join(PROJECT_ROOT, 'tests/fixtures/cli-startup/record-loads.mjs');

const HEAVY = ['typescript', 'ts-morph', 'chevrotain', '@chevrotain', 'esbuild', '@modelcontextprotocol', 'zod'];

const env: NodeJS.ProcessEnv = {
  ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('VITEST'))),
  NO_COLOR: '1',
};
delete env.FORCE_COLOR;

/** Run the CLI and return the packages under node_modules it loaded, and its result. */
function loadsOf(prefix: string[], args: string[]): { packages: string[]; status: number | null; stdout: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-startup-'));
  const log = path.join(dir, 'loads.txt');
  try {
    const r = spawnSync(process.execPath, [...prefix, ...args], {
      cwd: PROJECT_ROOT,
      env: { ...env, FW_TEST_LOAD_LOG: log },
      encoding: 'utf8',
      timeout: 60_000,
    });
    const lines = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
    const packages = new Set<string>();
    for (const line of lines) {
      const [parent, url] = line.split(' -> ');
      // tsx's own loading is not the CLI's.
      if (parent.includes('/node_modules/tsx/')) continue;
      const m = /\/node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(url);
      if (m) packages.add(m[1]);
    }
    return { packages: [...packages].sort(), status: r.status, stdout: r.stdout };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const heavyIn = (packages: string[]) => packages.filter((p) => HEAVY.includes(p) || HEAVY.includes(p.split('/')[0]));

const SOURCE = ['--import', 'tsx', '--import', RECORDER, CLI_ENTRY];
const BUILT = ['--import', RECORDER, BUILT_CLI];

describe('CLI startup loads', { timeout: 90_000 }, () => {
  it('sees the heavy modules a real command loads (the recorder works)', () => {
    const r = loadsOf(SOURCE, ['validate', '/nonexistent.ts']);
    expect(r.status).toBe(1);
    expect(heavyIn(r.packages)).toEqual(expect.arrayContaining(['chevrotain', 'typescript']));
  });

  it.each([
    [['--version']],
    [['compile', '--help']],
    [[]],
  ])('fw %j loads nothing heavy and does not scan for packs', (args) => {
    const r = loadsOf(SOURCE, args);
    expect(r.status).toBe(0);
    expect(r.packages).toContain('commander');
    expect(heavyIn(r.packages)).toEqual([]);
    expect(r.packages).not.toContain('glob');
  });

  it.each([
    [['--help']],
    [['templates']],
  ])('fw %j loads nothing heavy', (args) => {
    const r = loadsOf(SOURCE, args);
    expect(r.status).toBe(0);
    expect(heavyIn(r.packages)).toEqual([]);
  });

  it('still scans for pack commands for fw --help, which lists them', () => {
    expect(loadsOf(SOURCE, ['--help']).packages).toContain('glob');
  });

  describe.skipIf(!fs.existsSync(BUILT_CLI))('built bundle', () => {
    it.each([
      [['--version']],
      [['--help']],
      [['compile', '--help']],
    ])('fw %j does not load typescript, ts-morph or esbuild', (args) => {
      const r = loadsOf(BUILT, args);
      expect(r.status).toBe(0);
      expect(r.stdout).not.toBe('');
      expect(r.packages.filter((p) => ['typescript', 'ts-morph', 'esbuild'].includes(p))).toEqual([]);
    });
  });
});
