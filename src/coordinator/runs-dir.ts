/**
 * Where a run store lives on disk.
 *
 * Decides the project a workflow file belongs to and, from it, the
 * directory the default file store keeps runs in, so every process driving
 * the same file shares one store.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * The project a workflow file belongs to: the nearest ancestor directory with
 * a `package.json` or an existing `.fw/` folder, or — when neither is found —
 * the file's own directory. `anchor` may be a file or a directory.
 *
 * This is what makes a run store follow the file rather than the process: two
 * processes launched from different working directories (a console, and an MCP
 * server a tool spawned elsewhere) resolve the SAME project for the SAME file,
 * so they share one store. The walk is case- and separator-tolerant because
 * `path` is already platform-native; the containment the store relies on is the
 * resolved root, not the raw string.
 */
export function resolveProjectRoot(anchor: string): string {
  let current: string;
  try {
    current = fs.statSync(anchor).isDirectory() ? path.resolve(anchor) : path.dirname(path.resolve(anchor));
  } catch {
    // The path need not exist yet (a not-yet-written file): treat it as a file.
    current = path.dirname(path.resolve(anchor));
  }
  const root = path.parse(current).root;
  // Walk up to the nearest project marker.
  for (let dir = current; ; dir = path.dirname(dir)) {
    if (
      fs.existsSync(path.join(dir, 'package.json')) ||
      fs.existsSync(path.join(dir, '.fw'))
    ) {
      return dir;
    }
    if (dir === root || path.dirname(dir) === dir) break;
  }
  // No marker found: the file's own directory is the project.
  return current;
}

/**
 * Where a run store lives. Precedence:
 *   1. `FW_RUNS_DIR` — an explicit override for operators pointing every
 *      process at one store.
 *   2. `<projectRoot>/.fw/runs` — when an anchor (a workflow file or its
 *      directory) is given, so the store follows the file across processes.
 *   3. `~/.fw/runs` — the legacy global fallback when there is no anchor.
 *
 * Passing no anchor keeps the old global behaviour, so existing callers and
 * runs are unaffected; nothing migrates.
 */
export function defaultRunsDir(anchor?: string): string {
  if (process.env.FW_RUNS_DIR) return process.env.FW_RUNS_DIR;
  if (anchor) return path.join(resolveProjectRoot(anchor), '.fw', 'runs');
  return path.join(os.homedir(), '.fw', 'runs');
}
