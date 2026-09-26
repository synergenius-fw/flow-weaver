/**
 * Running an `fw` command for the console.
 *
 * The console is a local tool driving a local CLI, and the person at it
 * could open a terminal and type the same thing. What this must not become
 * is a shell: the command is an argument list handed to this very install
 * of the CLI, never a string handed to `sh`, so quoting means what the
 * person meant on Windows and elsewhere alike.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Commands that do not belong in a page: they run until stopped, or start
 * the very thing that is already running.
 */
export const NOT_FROM_CONSOLE = new Set([
  'console', 'mcp-server', 'mcp-setup', 'dev', 'watch', 'serve',
]);

export type Plan = { ok: true; args: string[] } | { ok: false; error: string };

/** Check an argument list before anything is spawned. A leading `fw` is accepted and dropped. */
export function planFwCommand(argv: readonly string[]): Plan {
  const args = argv[0] === 'fw' || argv[0] === 'flow-weaver' ? argv.slice(1) : [...argv];
  if (!args.length) return { ok: false, error: 'nothing to run' };
  if (args.some((a) => typeof a !== 'string')) return { ok: false, error: 'arguments must be strings' };
  const command = args[0];
  if (NOT_FROM_CONSOLE.has(command)) {
    return { ok: false, error: `\`fw ${command}\` runs outside the console: it is long-lived. Use a terminal.` };
  }
  return { ok: true, args };
}

/**
 * How to start this install's CLI: the built entry beside this module in a
 * package, or the TypeScript entry through `tsx` in a source checkout.
 */
export function resolveCliEntry(here = path.dirname(fileURLToPath(import.meta.url))): { exec: string; prefix: string[] } {
  const built = path.join(here, '..', 'cli', 'flow-weaver.mjs');
  if (fs.existsSync(built)) return { exec: process.execPath, prefix: [built] };
  const source = path.join(here, '..', 'cli', 'index.ts');
  if (fs.existsSync(source)) return { exec: process.execPath, prefix: ['--import', 'tsx', source] };
  throw new Error('cannot find the fw CLI beside the console');
}

/** Start `fw <args>` in the project, output uncoloured. The caller streams stdout/stderr and may kill it. */
export function spawnFw(args: string[], cwd: string): ChildProcess {
  const { exec, prefix } = resolveCliEntry();
  // The loader flags this process was started with are its own, not the
  // child's.
  const { NODE_OPTIONS: _flags, ...env } = process.env;
  return spawn(exec, [...prefix, ...args], {
    cwd,
    env: { ...env, FORCE_COLOR: '0', NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
}
