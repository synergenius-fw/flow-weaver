/**
 * The engine and execution context are copied into compiled workflows as
 * text, cut up by line-based patterns. A Windows checkout has CRLF line
 * endings, which none of those patterns expect: the development regions of
 * the execution context were not found and every compile failed. The text
 * is read with LF endings whatever the checkout has.
 */
import { describe, it, expect } from 'vitest';
import { inlineEngineSource } from '../../../scripts/inline-engine-text.js';

const LF = [
  "import { a } from './a.js';",
  "import type { B } from './b.js';",
  '/** The module. */',
  'export class Ctx {',
  '  // inline: development only',
  '  debug(): void {}',
  '  // inline: end',
  '}',
  '',
].join('\n');

describe('inlineEngineSource', () => {
  it('gives the same text for a CRLF checkout as for an LF one', () => {
    const lf = inlineEngineSource([{ name: 'ctx.ts', text: LF }]);
    const crlf = inlineEngineSource([{ name: 'ctx.ts', text: LF.replace(/\n/g, '\r\n') }]);
    expect(crlf).toBe(lf);
    expect(crlf).not.toContain('\r');
  });

  it('strips imports, export modifiers and the file comment', () => {
    const out = inlineEngineSource([{ name: 'ctx.ts', text: LF.replace(/\n/g, '\r\n') }]);
    expect(out).not.toMatch(/^import/m);
    expect(out).toContain('class Ctx {');
    expect(out).not.toContain('export class');
    expect(out).not.toContain('The module.');
    expect(out).toContain('  // inline: development only\n  debug(): void {}\n  // inline: end\n');
  });
});
