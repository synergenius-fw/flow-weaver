/**
 * `@icon` takes any Material Symbols name, because that is the font the
 * console draws with. The validator and the console must agree: an icon
 * that renders is never reported as invalid.
 */
import { describe, it, expect } from 'vitest';
import { MATERIAL_SYMBOLS, isMaterialSymbol, toSymbolName } from '../../../src/diagram/material-symbols';
import { VALID_NODE_ICONS } from '../../../src/diagram/theme';
import { parser } from '../../../src/parser';
import { validateWorkflow } from '../../../src/api/validate';

describe('Material Symbols names', () => {
  it('is the whole font, in snake_case', () => {
    expect(MATERIAL_SYMBOLS.size).toBeGreaterThan(4000);
    for (const n of ['flag', 'swap_horiz', 'smart_toy', 'home', 'conversion_path', 'analytics']) expect(MATERIAL_SYMBOLS.has(n)).toBe(true);
    for (const n of MATERIAL_SYMBOLS) expect(n).toMatch(/^[a-z0-9_]+$/);
  });

  it('accepts camelCase as the console does', () => {
    expect(toSymbolName('swapHoriz')).toBe('swap_horiz');
    expect(toSymbolName('smartToy')).toBe('smart_toy');
    expect(toSymbolName('flag')).toBe('flag');
    expect(isMaterialSymbol('swapHoriz')).toBe(true);
    expect(isMaterialSymbol('swap_horiz')).toBe(true);
    expect(isMaterialSymbol('xyzBadIcon')).toBe(false);
  });

  it('covers every icon the SVG renderer has a path for', () => {
    // Names in the path table that are Flow Weaver's own (not in the font) are allowed, but they are few.
    const missing = VALID_NODE_ICONS.filter((n) => !isMaterialSymbol(n));
    expect(missing.length).toBeLessThan(VALID_NODE_ICONS.length / 4);
  });

  const source = (icon: string) => `
/**
 * @flowWeaver nodeType
 * @expression
 * @icon ${icon}
 * @input v - Value
 * @output v - Value
 */
function mark(v: number): { v: number } { return { v }; }
/**
 * @flowWeaver workflow
 * @param v - Value
 * @returns v - Value
 * @node m mark
 * @path Start -> m -> Exit
 */
export function wf(execute: boolean, params: { v: number }): { onSuccess: boolean; onFailure: boolean; v: number } { throw new Error('x'); }
`;
  const iconWarnings = async (icon: string) => {
    const parsed = parser.parseFromString(source(icon));
    expect(parsed.errors).toEqual([]);
    return (await validateWorkflow(parsed.workflows[0])).warnings.filter((w) => w.code === 'INVALID_ICON');
  };

  it('validates an icon that renders in the console even when the SVG has no path for it', async () => {
    expect(VALID_NODE_ICONS).not.toContain('flag_circle');
    expect(await iconWarnings('flag_circle')).toEqual([]);
    expect(await iconWarnings('swapHoriz')).toEqual([]);
  });

  it('still flags a misspelling, with the nearest real name', async () => {
    const [w] = await iconWarnings('flagg');
    expect(w.message).toContain('Did you mean "flag"?');
    expect(w.message).toContain('Material Symbols');
  });
});
