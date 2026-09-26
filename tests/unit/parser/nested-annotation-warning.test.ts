/**
 * Only functions at the top level of a file are read as node types and
 * workflows. One annotated @flowWeaver inside another function was skipped
 * without a word, so the author saw an unknown node type and no reason.
 * The parser now says where it is and what to do.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parseWorkflow } from '../../../src/api/parse.js';

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-nested-')); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const WORKFLOW = `
/**
 * @flowWeaver nodeType
 */
function top(execute: boolean): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}

/**
 * @flowWeaver workflow
 * @node t top
 * @connect t.onSuccess -> Exit.onSuccess
 */
export function wf(execute: boolean): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  throw new Error('not compiled');
}
`;

async function warningsFor(extra: string): Promise<string[]> {
  const file = path.join(dir, 'wf.ts');
  fs.writeFileSync(file, WORKFLOW + extra);
  return (await parseWorkflow(file, { workflowName: 'wf' })).warnings;
}

describe('an annotated function that is not at the top level', () => {
  it('is reported for a nested function declaration, with its name and line', async () => {
    const warnings = await warningsFor(`
function outer() {
  /**
   * @flowWeaver nodeType
   */
  function inner(execute: boolean): { onSuccess: boolean } { return { onSuccess: true }; }
  return inner;
}
`);
    const nested = warnings.filter((w) => w.includes('inner'));
    expect(nested).toHaveLength(1);
    expect(nested[0]).toMatch(/inner.*line \d+.*top level/);
  });

  it('is reported for a nested arrow function', async () => {
    const warnings = await warningsFor(`
export function factory() {
  /** @flowWeaver nodeType */
  const helper = (execute: boolean) => ({ onSuccess: true });
  return helper;
}
`);
    expect(warnings.some((w) => w.includes('helper') && w.includes('top level'))).toBe(true);
  });

  it('says nothing for top-level functions or for nested ones with no annotation', async () => {
    const warnings = await warningsFor(`
function outer() {
  /** Just a helper. */
  function inner() { return 1; }
  return inner;
}
`);
    expect(warnings.filter((w) => w.includes('top level'))).toEqual([]);
  });
});
