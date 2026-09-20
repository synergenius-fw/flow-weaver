/**
 * Node positions left the grammar. A file written before that still parses:
 * `[position: x y]` on a @node line and a standalone `@position` line are
 * ignored, each with one warning saying so, and nothing about them survives
 * into the AST or a regenerated annotation block.
 */
import { describe, it, expect } from 'vitest';
import { parser } from '../../src/parser';
import { generateInPlace } from '../../src/api/generate-in-place';
import { getAllGrammars, serializedToEBNF } from '../../src/chevrotain-parser';

const LEGACY = `
/** @flowWeaver nodeType @expression */
function double(value: number): { value: number } { return { value: value * 2 }; }
/** @flowWeaver nodeType @expression */
function report(value: number): { text: string } { return { text: String(value) }; }
/**
 * @flowWeaver workflow
 * @param value - Input
 * @returns text - Output
 * @node a double [position: 180 0] [color: "blue"]
 * @node b report [label: "Report", position: 360 0]
 * @position Start -450 0
 * @position Exit 450 0
 * @path Start -> a -> b -> Exit
 */
export function legacy(execute: boolean, params: { value: number }): { onSuccess: boolean; onFailure: boolean; text: string } {
  throw new Error('not compiled');
}
`;

describe('positions are no longer part of the grammar', () => {
  const result = parser.parseFromString(LEGACY);
  const wf = result.workflows[0];

  it('still parses a file that carries them, keeping every other attribute', () => {
    expect(result.errors).toEqual([]);
    expect(wf.instances.map((i) => i.id)).toEqual(['a', 'b']);
    expect(wf.instances[0].config?.color).toBe('blue');
    expect(wf.instances[1].config?.label).toBe('Report');
    expect(wf.connections.some((c) => c.from.node === 'a' && c.to.node === 'b')).toBe(true);
  });

  it('keeps nothing of them in the AST', () => {
    for (const inst of wf.instances) {
      expect(inst.config).not.toHaveProperty('x');
      expect(inst.config).not.toHaveProperty('y');
    }
    expect(wf.ui).toBeUndefined();
  });

  it('says so once per line', () => {
    const notices = result.warnings.filter((w) => w.includes('no longer part of the grammar'));
    // Two [position:] attributes and two @position lines.
    expect(notices).toHaveLength(4);
    expect(notices.map((n) => n.slice(0, n.indexOf(': node positions')))).toEqual(['@node a [position:]', '@node b [position:]', '@position Start -450 0', '@position Exit 450 0']);
    expect(notices[0]).toContain('fw compile');
  });

  it('does not write them back', () => {
    // Compiling in place regenerates the block from the AST: the legacy
    // lines are gone from the file afterwards, which is the migration.
    const { code } = generateInPlace(LEGACY, wf);
    expect(code).not.toMatch(/position/i);
    expect(code).toContain('@node a double [color: "blue"]');
    expect(code).toContain('@node b report [label: "Report"]');
  });

  it('is gone from the published grammar', () => {
    const grammars = getAllGrammars();
    expect(grammars).not.toHaveProperty('position');
    const ebnf = Object.values(grammars).flatMap((g) => serializedToEBNF(g)).join('\n');
    expect(ebnf).not.toMatch(/position/i);
  });
});
