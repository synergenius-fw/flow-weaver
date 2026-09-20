/**
 * Finding the workflows in a project directory.
 *
 * The console re-lists on every file change, so this runs constantly: it
 * skips directories that cannot hold project sources, reads a file only
 * when the annotation is actually in its text, and caches by mtime. Each of
 * those is a chance to miss a workflow or to show a stale one.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { scanWorkflows, scanWorkflowNames, checkWorkflows } from '../../../src/console/scan';

let dir: string;

const write = (rel: string, body: string) => {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
  return full;
};

/** A minimal workflow whose ports and node all line up. */
const workflow = (name: string) => `
/**
 * @flowWeaver nodeType
 * @expression
 * @input value - A value
 * @output result - The value
 */
export function passThrough(value: string): { result: string } {
  return { result: value };
}

/**
 * @flowWeaver workflow
 * @param value - A value
 * @returns result - The value
 * @node step passThrough
 * @path Start -> step -> Exit
 */
export function ${name}(
  execute: boolean,
  params: { value: string },
): { onSuccess: boolean; onFailure: boolean; result: string } {
  throw new Error('generated body was not installed');
}
`;

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-scan-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('scanWorkflows', () => {
  it('finds a workflow and reports what the rail shows', async () => {
    write('flow.ts', workflow('myFlow'));
    const found = await scanWorkflows(dir);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ name: 'myFlow', rel: 'flow.ts', errors: 0, warnings: 0 });
    expect(found[0].steps).toBe(1);
  });

  it('looks in subdirectories', async () => {
    write('nested/deep/flow.ts', workflow('deepFlow'));
    const found = await scanWorkflows(dir);
    expect(found.map((w) => w.name)).toEqual(['deepFlow']);
    expect(found[0].rel).toBe(path.join('nested', 'deep', 'flow.ts'));
  });

  it('ignores directories that cannot hold project sources', async () => {
    // A dependency's own use cases are not this project's workflows, and
    // walking node_modules on every file change would be the slow path.
    for (const d of ['node_modules', 'dist', '.git']) write(`${d}/flow.ts`, workflow('hidden'));
    write('real.ts', workflow('realFlow'));
    const found = await scanWorkflows(dir);
    expect(found.map((w) => w.name)).toEqual(['realFlow']);
  });

  it('ignores files that are not workflows', async () => {
    write('notes.md', '@flowWeaver workflow');
    write('types.d.ts', workflow('declared'));
    write('helper.ts', 'export const x = 1;\n');
    expect(await scanWorkflows(dir)).toEqual([]);
  });

  it('lists a file that does not parse, so it is not silently missing', async () => {
    // A file mid-edit is the state an author is in most often; dropping it
    // from the rail would make the console look like it lost the workflow.
    write('broken.ts', workflow('brokenFlow').replace('@path Start -> step -> Exit', '@path Start -> nowhere -> Exit'));
    const found = await scanWorkflows(dir);
    expect(found).toHaveLength(1);
    expect(found[0].name).toBe('brokenFlow');
    expect(found[0].errors).toBeGreaterThan(0);
  });

  it('lists every workflow in a file, not just the first', async () => {
    // A file is a module: `@flowWeaver workflow` may appear on as many
    // exported functions as it needs, and they share the node types beside
    // them. Listing only the first would hide the rest from the rail.
    write('pair.ts', `
/**
 * @flowWeaver nodeType
 * @expression
 * @input value - A value
 * @output result - The value
 */
export function passThrough(value: string): { result: string } {
  return { result: value };
}

/**
 * @flowWeaver workflow
 * @param value - A value
 * @returns result - The value
 * @node step passThrough
 * @path Start -> step -> Exit
 */
export function first(
  execute: boolean,
  params: { value: string },
): { onSuccess: boolean; onFailure: boolean; result: string } {
  throw new Error('generated body was not installed');
}

/**
 * @flowWeaver workflow
 * @param value - A value
 * @returns result - The value
 * @node step passThrough
 * @path Start -> step -> Exit
 */
export function second(
  execute: boolean,
  params: { value: string },
): { onSuccess: boolean; onFailure: boolean; result: string } {
  throw new Error('generated body was not installed');
}
`);
    const found = await scanWorkflows(dir);
    expect(found.map((w) => w.name).sort()).toEqual(['first', 'second']);
    // Both point at the same file, and each is validated on its own.
    expect(new Set(found.map((w) => w.rel))).toEqual(new Set(['pair.ts']));
    expect(found.every((w) => w.errors === 0 && w.steps === 1)).toBe(true);
  });

  it('ignores a workflow written inside a string literal', async () => {
    // Test files build workflow sources as strings. Matching the annotation
    // anywhere in the text listed each of them as a nameless, erroring row:
    // 215 of them, from this repo's own tests directory.
    write('builder.test.ts', [
      "const source = `",
      '/**',
      ' * @flowWeaver workflow',
      ' * @param a - A',
      ' */',
      'export function inner(execute: boolean, params: { a: string }) {}',
      '`;',
      'export default source;',
    ].join('\n'));
    expect(await scanWorkflows(dir)).toEqual([]);
  });

  it('sorts by path so the rail does not reorder between scans', async () => {
    write('b.ts', workflow('bFlow'));
    write('a.ts', workflow('aFlow'));
    write('nested/c.ts', workflow('cFlow'));
    const found = await scanWorkflows(dir);
    expect(found.map((w) => w.rel)).toEqual(['a.ts', 'b.ts', path.join('nested', 'c.ts')]);
  });

  it('sees an edit rather than serving the cached result', async () => {
    const file = write('flow.ts', workflow('first'));
    expect((await scanWorkflows(dir)).map((w) => w.name)).toEqual(['first']);

    // Same path, new content: the cache is keyed by mtime and size, so a
    // rewrite within the same clock tick must still be picked up.
    fs.writeFileSync(file, workflow('second'));
    const now = new Date();
    fs.utimesSync(file, now, new Date(now.getTime() + 1000));
    expect((await scanWorkflows(dir)).map((w) => w.name)).toEqual(['second']);
  });

  it('lists names without parsing, then fills the verdicts in', async () => {
    // Parsing every workflow took thirty seconds on this repo's own tests
    // directory, so the rail is filled from a syntax-only pass and the
    // verdicts arrive after.
    write('flow.ts', workflow('myFlow'));

    const listed = scanWorkflowNames(dir);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ name: 'myFlow', checked: false, steps: 0 });

    const reported: string[] = [];
    const full = await checkWorkflows(dir, (w) => reported.push(w.name));
    expect(reported).toEqual(['myFlow']);
    expect(full[0]).toMatchObject({ name: 'myFlow', checked: true, steps: 1, errors: 0 });

    // Checked once, the names pass hands back the verdict it already has.
    expect(scanWorkflowNames(dir)[0]).toMatchObject({ checked: true, steps: 1 });
  });

  it('re-checks a workflow after its file changes', async () => {
    const file = write('flow.ts', workflow('myFlow'));
    await checkWorkflows(dir);
    expect(scanWorkflowNames(dir)[0]).toMatchObject({ checked: true, errors: 0 });

    fs.writeFileSync(file, workflow('myFlow').replace('@path Start -> step -> Exit', '@path Start -> nowhere -> Exit'));
    const now = new Date();
    fs.utimesSync(file, now, new Date(now.getTime() + 1000));

    expect(scanWorkflowNames(dir)[0].checked).toBe(false);
    const full = await checkWorkflows(dir);
    expect(full[0].errors).toBeGreaterThan(0);
  });

  it('returns nothing for an empty project instead of throwing', async () => {
    expect(await scanWorkflows(dir)).toEqual([]);
  });
});
