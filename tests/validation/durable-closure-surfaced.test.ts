/**
 * validateWorkflow must surface durable-closure violations, not just the
 * coordinator at bundle-digest time. A gated workflow that puts a boundary in
 * two branch regions used to pass `fw_validate` and then fail at run time with
 * an opaque coordinator error; it should be an author-time error instead.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseWorkflow } from '../../src/api/parse';
import { validateWorkflow } from '../../src/api/validate';

let dir: string;
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'fw-durable-')); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

const GOOD = `
/** @flowWeaver nodeType @expression @input x - in @output state - o */
export function frame(x: number): { state: { s: string } } { return { state: { s: 'a' } }; }

/** @flowWeaver nodeType @durableGate agent @input p - prompt @output r - reply */
export async function gate(execute: boolean, p: string): Promise<{ onSuccess: boolean; onFailure: boolean; r: object }> { throw new Error('g'); }

/** @flowWeaver nodeType @expression @input r - reply @output out - o */
export function done(r: object): { out: string } { return { out: JSON.stringify(r) }; }

/**
 * @flowWeaver workflow
 * @param x - in
 * @returns out - o
 * @node frame frame
 * @node g gate [expr: p="\`go \${frame.state.s}\`"]
 * @node done done
 * @path Start -> frame -> g -> done -> Exit
 * @connect g.r -> done.r
 */
export async function good(execute: boolean, params: { x: number }): Promise<{ onSuccess: boolean; onFailure: boolean; out: string }> { throw new Error('ni'); }
`;

// Two gates, and the second reads data from `frame` -- reaching around the
// first gate -- so it lands in two branch regions.
const BAD = `
/** @flowWeaver nodeType @expression @input x - in @output state - o */
export function frame(x: number): { state: { s: string } } { return { state: { s: 'a' } }; }

/** @flowWeaver nodeType @durableGate agent @input p - prompt @output r - reply */
export async function gateA(execute: boolean, p: string): Promise<{ onSuccess: boolean; onFailure: boolean; r: object }> { throw new Error('g'); }

/** @flowWeaver nodeType @durableGate approval @input summary - s @output ok - decision */
export async function gateB(execute: boolean, summary: string): Promise<{ onSuccess: boolean; onFailure: boolean; ok: boolean }> { throw new Error('g'); }

/** @flowWeaver nodeType @expression @input ok - d @output out - o */
export function done(ok: boolean): { out: string } { return { out: String(ok) }; }

/**
 * @flowWeaver workflow
 * @param x - in
 * @returns out - o
 * @node frame frame
 * @node a gateA [expr: p="'go'"]
 * @node b gateB [expr: summary="\`\${frame.state.s} \${JSON.stringify(a.r)}\`"]
 * @node done done
 * @path Start -> frame -> a -> b -> done -> Exit
 * @connect b.ok -> done.ok
 */
export async function bad(execute: boolean, params: { x: number }): Promise<{ onSuccess: boolean; onFailure: boolean; out: string }> { throw new Error('ni'); }
`;

async function validate(source: string) {
  const file = join(dir, `wf-${Math.random().toString(36).slice(2)}.ts`);
  writeFileSync(file, source);
  const parsed = await parseWorkflow(file, { projectDir: dir });
  const wf = parsed as { workflows?: unknown[]; workflow?: unknown; ast?: unknown };
  const ast = (wf.workflows?.[0] ?? wf.workflow ?? wf.ast) as never;
  return validateWorkflow(ast);
}

describe('durable-closure violations surface in validateWorkflow', () => {
  it('flags a gate that lands in two branch regions', async () => {
    const result = await validate(BAD);
    const durable = result.errors.filter((e) => e.code === 'DURABLE_CLOSURE_INVALID');
    expect(durable).toHaveLength(1);
    expect(durable[0].message).toContain('branch');
    expect(result.valid).toBe(false);
  });

  it('leaves a valid gated workflow valid', async () => {
    const result = await validate(GOOD);
    expect(result.errors.filter((e) => e.code === 'DURABLE_CLOSURE_INVALID')).toHaveLength(0);
  });
});
