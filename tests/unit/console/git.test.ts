/**
 * The little of git the console uses, against a throwaway repository.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { fileHistory, fileAt, stamp, repoRoot } from '../../../src/console/git';

let dir: string;
let file: string;
const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@x' } }).toString();

const hasGit = (() => { try { execFileSync('git', ['--version'], { stdio: 'pipe' }); return true; } catch { return false; } })();

beforeAll(() => {
  if (!hasGit) return;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-git-'));
  git('init', '-q', '-b', 'main');
  fs.mkdirSync(path.join(dir, 'flows'));
  file = path.join(dir, 'flows', 'wf.ts');
  fs.writeFileSync(file, 'export const v = 1;\n');
  git('add', '.'); git('commit', '-q', '-m', 'first');
  fs.writeFileSync(file, 'export const v = 2;\n');
  git('commit', '-q', '-am', 'second');
});
afterAll(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

describe.skipIf(!hasGit)('git helpers', () => {
  it('finds the repository and lists the commits that touched the file, newest first', async () => {
    expect(await repoRoot(file)).toBe(fs.realpathSync(dir));
    const h = await fileHistory(file);
    expect(h.repo).toBe(true);
    expect(h.dirty).toBe(false);
    expect(h.commits.map((c) => c.subject)).toEqual(['second', 'first']);
    expect(h.head).toBe(h.commits[0].short);
    expect(h.commits[0].at).toBeGreaterThan(0);
  });

  it('reads the file as it was at a commit, and knows when it did not exist', async () => {
    const h = await fileHistory(file);
    expect(await fileAt(file, h.commits[1].sha)).toBe('export const v = 1;\n');
    expect(await fileAt(file, 'HEAD')).toBe('export const v = 2;\n');
    expect(await fileAt(path.join(dir, 'flows', 'nope.ts'), 'HEAD')).toBeUndefined();
  });

  it('stamps a run with the commit and whether the file has uncommitted changes', async () => {
    expect(await stamp(file)).toEqual({ commit: (await fileHistory(file)).head, dirty: false });
    fs.writeFileSync(file, 'export const v = 3;\n');
    expect((await stamp(file))?.dirty).toBe(true);
    expect((await fileHistory(file)).dirty).toBe(true);
  });

  it('says a file outside any repository has no history', async () => {
    const loose = path.join(os.tmpdir(), `fw-loose-${Date.now()}.ts`);
    fs.writeFileSync(loose, '');
    try {
      const h = await fileHistory(loose);
      // A temp dir may itself sit inside a repository on some machines; only the shape is asserted then.
      if (!h.repo) { expect(h.commits).toEqual([]); expect(await stamp(loose)).toBeUndefined(); }
    } finally { fs.rmSync(loose, { force: true }); }
  });
});
