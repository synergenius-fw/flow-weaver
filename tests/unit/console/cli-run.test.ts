/**
 * The console runs `fw` commands as an argument list handed to this install
 * of the CLI -- never a shell string. What is checked here is the gate in
 * front of the spawn, and that the spawn reaches a real CLI.
 */
import os from 'node:os';
import { describe, it, expect } from 'vitest';
import { planFwCommand, resolveCliEntry, spawnFw, NOT_FROM_CONSOLE } from '../../../src/console/cli-run';

describe('planFwCommand', () => {
  it('drops a leading fw and keeps the rest verbatim', () => {
    expect(planFwCommand(['fw', 'validate', 'a b.ts', '--json'])).toEqual({ ok: true, args: ['validate', 'a b.ts', '--json'] });
    expect(planFwCommand(['flow-weaver', 'doctor'])).toEqual({ ok: true, args: ['doctor'] });
    expect(planFwCommand(['doctor'])).toEqual({ ok: true, args: ['doctor'] });
  });

  it('refuses an empty command', () => {
    expect(planFwCommand([])).toMatchObject({ ok: false });
    expect(planFwCommand(['fw'])).toMatchObject({ ok: false });
  });

  it('refuses the commands that do not belong in a page', () => {
    for (const c of NOT_FROM_CONSOLE) {
      const plan = planFwCommand(['fw', c]);
      expect(plan.ok, c).toBe(false);
      if (!plan.ok) expect(plan.error).toContain(c);
    }
  });

  it('lets a bare flag through', () => {
    expect(planFwCommand(['--version'])).toEqual({ ok: true, args: ['--version'] });
  });
});

describe('resolveCliEntry', () => {
  it('runs the CLI with the same node binary, through tsx from source', () => {
    const entry = resolveCliEntry();
    expect(entry.exec).toBe(process.execPath);
    expect(entry.prefix[entry.prefix.length - 1]).toMatch(/[\\/]cli[\\/](flow-weaver\.mjs|index\.ts)$/);
  });

  it('says so when there is no CLI beside it', () => {
    expect(() => resolveCliEntry(os.tmpdir())).toThrow(/cannot find/);
  });
});

describe('spawnFw', () => {
  it('reaches a real CLI and prints its version without colour codes', async () => {
    const child = spawnFw(['--version'], process.cwd());
    let out = '';
    child.stdout!.on('data', (d) => { out += d; });
    const code = await new Promise<number | null>((resolve) => child.on('close', resolve));
    expect(code).toBe(0);
    expect(out).toMatch(/\d+\.\d+\.\d+/);
    expect(out).not.toMatch(/\[/);
  }, 30000);
});
