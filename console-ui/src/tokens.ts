/**
 * Syntax colouring for the Code view: a small line-at-a-time tokenizer for
 * TypeScript with Flow Weaver annotations, pure so it is tested on its own.
 */
/**
 * Token kinds: c comment, t annotation tag, i the name an annotation
 * declares, k keyword, s string, n number or literal constant, y type,
 * f function, d decorator or directive.
 */
export type Tok = { c: string; t?: 'c' | 't' | 'i' | 'k' | 's' | 'n' | 'y' | 'f' | 'd' };
const KW = /\b(export|default|function|async|await|return|const|let|var|if|else|switch|case|break|continue|while|do|try|catch|finally|throw|new|delete|void|for|of|in|typeof|instanceof|keyof|satisfies|import|from|as|interface|type|enum|class|extends|implements|declare|namespace|abstract|static|readonly|public|private|protected|yield|this|super)\b/y;
const LIT = /\b(true|false|null|undefined|NaN|Infinity)\b/y;
const NUM = /\b(?:0x[\da-fA-F_]+|0b[01_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:e[+-]?\d+)?n?)\b/y;
const STR = /'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/y;
const TYPE = /\b(?:[A-Z][\w$]*|string|number|boolean|unknown|any|never|object|symbol|bigint)\b/y;
const IDENT = /[A-Za-z_$][\w$]*/y;
const TAG = /@[a-zA-Z]+/y;
const CODE = /`[^`\n]*`/y;
/** Annotations whose first word names something: it is lit up as the name, the rest is the description. */
const NAMED = new Set(['input', 'output', 'node', 'connect', 'path', 'param', 'returns', 'scope', 'fwImport', 'workflow', 'nodeType', 'gate', 'expr', 'property', 'typedef', 'type', 'template', 'extends', 'durableGate']);

/**
 * Tokenize one line at a time, carrying block-comment state across lines, so
 * every line's markup is balanced and a multi-line JSDoc cannot break the
 * line grid. Inside a doc comment the annotations are the content, so their
 * tags, the names they declare and their backticked code are lit; outside it
 * keywords, strings, numbers, types and function names are.
 */
export function tokenizeLines(src: string): Tok[][] {
  const out: Tok[][] = [];
  let inBlock = false;
  for (const line of src.split('\n')) {
    const toks: Tok[] = [];
    let i = 0, plain = '';
    const flush = () => { if (plain) { toks.push({ c: plain }); plain = ''; } };
    const prevWord = (at: number) => /[\w$]/.test(line[at - 1] ?? '');
    while (i < line.length) {
      if (inBlock) {
        const end = line.indexOf('*/', i);
        const seg = end < 0 ? line.slice(i) : line.slice(i, end + 2);
        flush();
        let j = 0; let acc = '';
        let nameNext = false;
        const put = (c: string, t: Tok['t']) => { if (acc) { toks.push({ c: acc, t: 'c' }); acc = ''; } toks.push({ c, t }); };
        while (j < seg.length) {
          let m: RegExpExecArray | null;
          TAG.lastIndex = j;
          if ((m = TAG.exec(seg))) { put(m[0], 't'); j += m[0].length; nameNext = NAMED.has(m[0].slice(1)); continue; }
          CODE.lastIndex = j;
          if ((m = CODE.exec(seg))) { put(m[0], 'i'); j += m[0].length; continue; }
          if (nameNext && !/\s/.test(seg[j])) {
            // The word after the tag: `@input invoices`, `@node parse parseFigmaLink`.
            const w = /[^\s]+/y; w.lastIndex = j; m = w.exec(seg)!;
            put(m[0], 'i'); j += m[0].length; nameNext = false; continue;
          }
          acc += seg[j]; j++;
        }
        if (acc) toks.push({ c: acc, t: 'c' });
        i += seg.length;
        if (end >= 0) inBlock = false;
        continue;
      }
      if (line.startsWith('/*', i)) { inBlock = true; continue; }
      if (line.startsWith('//', i)) { flush(); toks.push({ c: line.slice(i), t: 'c' }); break; }
      let m: RegExpExecArray | null;
      STR.lastIndex = i; if ((m = STR.exec(line))) { flush(); toks.push({ c: m[0], t: 's' }); i += m[0].length; continue; }
      if (line[i] === '@') {
        IDENT.lastIndex = i + 1;
        if ((m = IDENT.exec(line))) { flush(); toks.push({ c: '@' + m[0], t: 'd' }); i += 1 + m[0].length; continue; }
      }
      if (!prevWord(i)) {
        NUM.lastIndex = i; if ((m = NUM.exec(line))) { flush(); toks.push({ c: m[0], t: 'n' }); i += m[0].length; continue; }
        LIT.lastIndex = i; if ((m = LIT.exec(line))) { flush(); toks.push({ c: m[0], t: 'n' }); i += m[0].length; continue; }
        KW.lastIndex = i; if ((m = KW.exec(line))) { flush(); toks.push({ c: m[0], t: 'k' }); i += m[0].length; continue; }
        TYPE.lastIndex = i; if ((m = TYPE.exec(line)) && !/[\w$]/.test(line[i + m[0].length] ?? '')) { flush(); toks.push({ c: m[0], t: 'y' }); i += m[0].length; continue; }
        IDENT.lastIndex = i;
        if ((m = IDENT.exec(line))) {
          // A name followed by `(` is a function: declared, called or a method.
          const after = line.slice(i + m[0].length).match(/^\s*(\(|<[^>]*>\s*\()/);
          flush(); toks.push(after ? { c: m[0], t: 'f' } : { c: m[0] }); i += m[0].length; continue;
        }
      }
      plain += line[i]; i++;
    }
    flush();
    out.push(toks);
  }
  return out;
}

/**
 * Colouring for editable JSON text.
 *
 * The Code tokenizer is for TypeScript; a value being typed into a field is
 * JSON, and it is often mid-edit — a half-typed string, a trailing comma, not
 * yet valid. So this scans the raw text token by token, tolerating anything,
 * and tags each piece with the same `j-*` classes the read-only Json view
 * uses: a key (a string immediately before a colon) is told apart from a
 * plain string, and numbers, booleans and null each get their own colour.
 * Whitespace and punctuation pass through unclassed. It never throws and never
 * drops a character, so the highlighted mirror always matches the textarea.
 */
export type JsonTok = { c: string; t?: 'str' | 'key' | 'num' | 'bool' | 'null' };

export function tokenizeJson(src: string): JsonTok[] {
  const out: JsonTok[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const ch = src[i];
    // A string, possibly unterminated (still being typed).
    if (ch === '"') {
      let j = i + 1;
      while (j < n && src[j] !== '"') {
        if (src[j] === '\\') j++;
        j++;
      }
      j = Math.min(j + 1, n); // include closing quote if present
      const text = src.slice(i, j);
      // A string that the next non-space character follows with a colon is a key.
      let k = j;
      while (k < n && (src[k] === ' ' || src[k] === '\t')) k++;
      out.push({ c: text, t: src[k] === ':' ? 'key' : 'str' });
      i = j;
      continue;
    }
    // A number.
    if (ch === '-' || (ch >= '0' && ch <= '9')) {
      const m = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(src.slice(i));
      if (m) { out.push({ c: m[0], t: 'num' }); i += m[0].length; continue; }
    }
    // A keyword literal.
    if (ch === 't' || ch === 'f' || ch === 'n') {
      const rest = src.slice(i);
      const kw = rest.startsWith('true') ? 'true' : rest.startsWith('false') ? 'false' : rest.startsWith('null') ? 'null' : '';
      if (kw) { out.push({ c: kw, t: kw === 'null' ? 'null' : 'bool' }); i += kw.length; continue; }
    }
    // Anything else — whitespace, braces, commas, colons — passes through.
    out.push({ c: ch });
    i++;
  }
  return out;
}
