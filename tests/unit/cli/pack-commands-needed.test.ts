/**
 * Which invocations register the pack-contributed commands (src/cli/pack-commands-needed.ts).
 * Registering them scans node_modules, so it is skipped when no pack command can be reached.
 */

import { describe, it, expect } from 'vitest';
import { buildProgram } from '../../../src/cli/program.js';
import { packCommandsNeeded } from '../../../src/cli/pack-commands-needed.js';

const program = buildProgram();
const needed = (...args: string[]) => packCommandsNeeded(program, args);

describe('packCommandsNeeded', () => {
  it('skips the scan for a built-in command, whatever its options', () => {
    expect(needed('compile', 'x.ts')).toBe(false);
    expect(needed('compile', '--help')).toBe(false);
    expect(needed('market', 'list')).toBe(false);
    expect(needed('--no-color', 'validate', 'x.ts')).toBe(false);
  });

  it('skips the scan for --version before any command', () => {
    expect(needed('--version')).toBe(false);
    expect(needed('-v')).toBe(false);
    expect(needed('--no-color', '-v')).toBe(false);
  });

  it('scans when help can list pack commands', () => {
    expect(needed('--help')).toBe(true);
    expect(needed('-h')).toBe(true);
    expect(needed('help')).toBe(true);
    expect(needed('help', 'compile')).toBe(true);
  });

  it('scans for a command that is not built in: a pack namespace or a typo', () => {
    expect(needed('weaver', 'run')).toBe(true);
    expect(needed('weaver', '--version')).toBe(true);
    expect(needed('compil')).toBe(true);
    expect(needed('--', 'compile')).toBe(true);
  });
});
