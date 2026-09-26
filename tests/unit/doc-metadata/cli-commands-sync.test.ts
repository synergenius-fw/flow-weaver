/**
 * The CLI command mirror in doc-metadata feeds `fw docs` and `fw context`, and
 * is written by hand. This keeps it honest: every top-level command it
 * documents must exist in the live CLI, and the long flags it lists must be
 * exactly the ones the command registers.
 *
 * "Live" is the real Commander program from src/cli/program.ts. Its command
 * handlers load lazily, so building it runs none of them.
 */
import { describe, it, expect } from 'vitest';
import { buildProgram } from '../../../src/cli/program';
import { CLI_COMMANDS } from '../../../src/doc-metadata/extractors/cli-commands';

/** The long flags (`--name`) of every option each top-level command registers. */
function liveFlags(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const command of buildProgram().commands) {
    out.set(command.name(), new Set(command.options.flatMap((option) => (option.long ? [option.long] : []))));
  }
  return out;
}

describe('CLI command mirror', () => {
  const live = liveFlags();

  it('reads the live CLI', () => {
    expect(live.size).toBeGreaterThan(15);
    expect(live.get('compile')).toContain('--dry-run');
  });

  // Entries with a space are subcommands (`create node`) or list pages
  // (`Node Templates`); only top-level commands are compared.
  for (const doc of CLI_COMMANDS) {
    if (doc.name.includes(' ') || !live.has(doc.name)) continue;
    it(`lists exactly the flags fw ${doc.name} registers`, () => {
      const documented = new Set<string>();
      for (const opt of doc.options ?? []) {
        for (const [flag] of opt.flags.matchAll(/--[A-Za-z][A-Za-z-]*/g)) documented.add(flag);
      }
      expect([...documented].sort()).toEqual([...live.get(doc.name)!].sort());
    });
  }

  it('documents no top-level command the CLI does not have', () => {
    const unknown = CLI_COMMANDS.map((c) => c.name).filter((n) => !n.includes(' ') && !live.has(n));
    expect(unknown).toEqual([]);
  });
});
