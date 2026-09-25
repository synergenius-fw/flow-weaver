/**
 * The CLI command mirror in doc-metadata feeds `fw docs` and `fw context`, and
 * is written by hand. This keeps it honest: every top-level command it
 * documents must exist in the live CLI, and the long flags it lists must be
 * exactly the ones the command registers.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { CLI_COMMANDS } from '../../../src/doc-metadata/extractors/cli-commands';

const source = fs.readFileSync(path.join(process.cwd(), 'src/cli/index.ts'), 'utf8');

/** The long flags (`--name`) of every option a top-level command registers. */
function liveFlags(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  // Each top-level command is a `program\n  .command('name ...')` chain up to
  // its `.action(`; subcommand groups (market, create, modify) are registered
  // on their own Command objects and are not compared here.
  const blocks = source.matchAll(/^program\s*\.command\(\s*'([^' ]+)[^']*'\s*\)([\s\S]*?)\.action\(/gm);
  for (const [, name, body] of blocks) {
    const flags = new Set<string>();
    for (const [, spec] of body.matchAll(/(?:\.option|\.requiredOption|new Option)\(\s*'([^']+)'/g)) {
      for (const [flag] of spec.matchAll(/--[a-z][a-z-]*/g)) flags.add(flag);
    }
    out.set(name, flags);
  }
  return out;
}

describe('CLI command mirror', () => {
  const live = liveFlags();

  it('reads the live CLI', () => {
    expect(live.size).toBeGreaterThan(15);
    expect(live.get('compile')).toContain('--dry-run');
  });

  for (const doc of CLI_COMMANDS) {
    const top = doc.name.split(/\s+/)[0];
    if (!live.has(top) || doc.name.includes(' ')) continue;
    it(`lists exactly the flags fw ${doc.name} registers`, () => {
      const documented = new Set<string>();
      for (const opt of doc.options ?? []) {
        for (const [flag] of opt.flags.matchAll(/--[a-z][a-z-]*/g)) documented.add(flag);
      }
      expect([...documented].sort()).toEqual([...live.get(top)!].sort());
    });
  }

  it('documents no top-level command the CLI does not have', () => {
    // Entries with a space are subcommands (`create node`) or list pages
    // (`Node Templates`), registered elsewhere.
    const unknown = CLI_COMMANDS.filter((c) => !c.name.includes(' ')).map((c) => c.name).filter((n) => !live.has(n) && !['market', 'create', 'modify'].includes(n));
    expect(unknown).toEqual([]);
  });
});
