/**
 * The little of git the console needs: which commits touched a file, what
 * the file looked like at one of them, and where HEAD is. Shelling out to
 * the `git` on the machine, never a library: the project's own git, with
 * its own config, is the one whose answer counts.
 */
import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface Commit { sha: string; short: string; author: string; at: number; subject: string }
export interface FileHistory {
  /** False when the file is not in a git repository, or git is not installed. */
  repo: boolean;
  head?: string;
  /** The file differs from HEAD in the working tree. */
  dirty: boolean;
  /** Newest first, following renames. */
  commits: Commit[];
}

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
      if (err) reject(err); else resolve(String(stdout));
    });
  });
}

/** The repository root a file belongs to, or undefined. */
export async function repoRoot(file: string): Promise<string | undefined> {
  try { return (await git(path.dirname(file), ['rev-parse', '--show-toplevel'])).trim() || undefined; }
  catch { return undefined; }
}

/**
 * A path as git names it inside the repository: forward slashes, relative
 * to the root. Both ends are resolved through symlinks first -- git reports
 * the root resolved, and a file under `/var` on macOS is really under
 * `/private/var`.
 */
function gitPath(root: string, file: string): string {
  const real = (p: string) => { try { return fs.realpathSync(p); } catch { return p; } };
  return path.relative(real(root), real(file)).split(path.sep).join('/');
}

export async function fileHistory(file: string, limit = 60): Promise<FileHistory> {
  const root = await repoRoot(file);
  if (!root) return { repo: false, dirty: false, commits: [] };
  const rel = gitPath(root, file);
  const [head, status, log] = await Promise.all([
    git(root, ['rev-parse', '--short', 'HEAD']).then((s) => s.trim()).catch(() => undefined),
    git(root, ['status', '--porcelain', '--', rel]).catch(() => ''),
    git(root, ['log', '--follow', `-n${limit}`, '--format=%H%x1f%h%x1f%an%x1f%at%x1f%s', '--', rel]).catch(() => ''),
  ]);
  const commits = log.split('\n').filter(Boolean).map((line) => {
    const [sha, short, author, at, subject] = line.split('\x1f');
    return { sha, short, author, at: Number(at) * 1000, subject };
  });
  return { repo: true, head, dirty: status.trim().length > 0, commits };
}

/** The file's text at a ref, or undefined when it did not exist there. */
export async function fileAt(file: string, ref: string): Promise<string | undefined> {
  const root = await repoRoot(file);
  if (!root) return undefined;
  try { return await git(root, ['show', `${ref}:${gitPath(root, file)}`]); }
  catch { return undefined; }
}

/** The short sha HEAD points at, and whether the file has uncommitted changes -- what a run is stamped with. */
export async function stamp(file: string): Promise<{ commit?: string; dirty?: boolean } | undefined> {
  const root = await repoRoot(file);
  if (!root) return undefined;
  const rel = gitPath(root, file);
  const [commit, status] = await Promise.all([
    git(root, ['rev-parse', '--short', 'HEAD']).then((s) => s.trim()).catch(() => undefined),
    git(root, ['status', '--porcelain', '--', rel]).catch(() => ''),
  ]);
  return commit ? { commit, dirty: status.trim().length > 0 } : undefined;
}
