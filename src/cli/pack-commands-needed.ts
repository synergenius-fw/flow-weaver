/**
 * Whether an invocation needs the pack-contributed commands registered.
 *
 * Finding them scans the project's node_modules, which costs more than the
 * rest of a simple command's start. A built-in command, or `--version` before
 * any command, never reaches a pack command, so the scan is skipped. Anything
 * else (`fw --help`, `fw help`, an unknown or pack command) still registers
 * them, so help lists them and an unknown command can be matched to one.
 */

import type { Command } from 'commander';

/** Program options that end the invocation before any command runs. */
const VERSION_FLAGS = new Set(['-v', '--version']);

export function packCommandsNeeded(program: Command, args: readonly string[]): boolean {
  for (const arg of args) {
    if (VERSION_FLAGS.has(arg)) return false;
    if (arg === '--') return true;
    // The program's own options take no value, so the first operand is the command.
    if (arg.startsWith('-')) continue;
    return !program.commands.some((c) => c.name() === arg || c.aliases().includes(arg));
  }
  return true;
}
