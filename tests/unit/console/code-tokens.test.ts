/**
 * The Code view's colouring: keywords, strings, numbers, types and function
 * names in code; tags, declared names and backticked code in doc comments.
 */
import { describe, it, expect } from 'vitest';
import { tokenizeLines, tokenizeJson } from '../../../console-ui/src/tokens';

const kinds = (line: string) => tokenizeLines(line)[0].filter((t) => t.t).map((t) => `${t.t}:${t.c}`);

describe('tokenizeLines', () => {
  it('lights keywords, literals, types and function names in code', () => {
    expect(kinds('export function forEachInvoice(execute: boolean, invoices: Invoice[]): Rated[] {')).toEqual([
      'k:export', 'k:function', 'f:forEachInvoice', 'y:boolean', 'y:Invoice', 'y:Rated',
    ]);
    expect(kinds('const pass = line(true, invoice, rates);')).toEqual(['k:const', 'f:line', 'n:true']);
    expect(kinds('results.push(pass.rated); return { onSuccess: false, n: 0x1f, x: 1.5e3 };')).toEqual([
      'f:push', 'k:return', 'n:false', 'n:0x1f', 'n:1.5e3',
    ]);
    expect(kinds("const s = 'it\\'s' + `t ${x}` + \"q\"; // note")).toEqual(["k:const", "s:'it\\'s'", 's:`t ${x}`', 's:"q"', 'c:// note']);
  });

  it('does not mistake the tail of an identifier for a keyword, number or type', () => {
    expect(kinds('myfunction1 = doIf2 + n1 + xString')).toEqual([]);
    expect(kinds('Record<string, number>')).toEqual(['y:Record', 'y:string', 'y:number']);
    expect(kinds('@Component() class A {}')).toEqual(['d:@Component', 'k:class', 'y:A']);
  });

  it('lights the tag, the declared name and backticked code inside a doc comment, across lines', () => {
    const lines = tokenizeLines([
      '/**',
      ' * Run the rating once per invoice; it owns the `line` scope.',
      ' * @flowWeaver nodeType',
      ' * @label For Each Invoice',
      ' * @input invoices - Invoices to rate',
      ' * @node parse parseFigmaLink',
      ' */',
      'const after = 1;',
    ].join('\n'));
    const k = (i: number) => lines[i].filter((t) => t.t).map((t) => `${t.t}:${t.c}`);
    expect(k(1)).toEqual([' * Run the rating once per invoice; it owns the ', '`line`', ' scope.'].map((c, i) => `${i === 1 ? 'i' : 'c'}:${c}`));
    expect(k(2)).toEqual(['c: * ', 't:@flowWeaver', 'c: nodeType']);
    // A label is prose: nothing after the tag is a name.
    expect(k(3)).toEqual(['c: * ', 't:@label', 'c: For Each Invoice']);
    expect(k(4)).toEqual(['c: * ', 't:@input', 'c: ', 'i:invoices', 'c: - Invoices to rate']);
    expect(k(5)).toEqual(['c: * ', 't:@node', 'c: ', 'i:parse', 'c: parseFigmaLink']);
    expect(k(7)).toEqual(['k:const', 'n:1']);
  });
});

describe('tokenizeJson', () => {
  const jkinds = (s: string) => tokenizeJson(s).filter((t) => t.t).map((t) => `${t.t}:${t.c}`);

  it('tells a key from a string and colours each scalar kind', () => {
    expect(jkinds('{ "goal": "ship it", "count": 42, "ok": true, "note": null }')).toEqual([
      'key:"goal"', 'str:"ship it"', 'key:"count"', 'num:42', 'key:"ok"', 'bool:true', 'key:"note"', 'null:null',
    ]);
  });

  it('treats a key as a key even with space before the colon', () => {
    expect(jkinds('{ "a" : 1 }')).toEqual(['key:"a"', 'num:1']);
  });

  it('handles negative and exponent numbers', () => {
    expect(jkinds('[-3, 1.5e3, -2.0]')).toEqual(['num:-3', 'num:1.5e3', 'num:-2.0']);
  });

  it('never throws and keeps every character on incomplete input', () => {
    for (const s of ['{ "a":', '"unterminated', '{ "x": tru', '', '[1,2,']) {
      const toks = tokenizeJson(s);
      expect(toks.map((t) => t.c).join('')).toBe(s);
    }
  });

  it('colours a value being typed before it is valid', () => {
    expect(jkinds('{ "x": tru')).toEqual(['key:"x"']); // "tru" is not yet a literal
    expect(jkinds('{ "x": "hi')).toEqual(['key:"x"', 'str:"hi']); // unterminated string still a string
  });
});
