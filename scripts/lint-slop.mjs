#!/usr/bin/env node
/**
 * The slop linter: it flags machine-prose habits in what people read, and
 * says what to write instead. It rewrites nothing, on purpose. These are
 * habits, not stray characters, and a substitution produces another
 * flavour of the same habit. The fix is the sentence.
 *
 * What it reads: string literals, template literals, JSX text and comments
 * in TypeScript and JavaScript (by walking the AST, so code punctuation is
 * never mistaken for prose), and the prose of Markdown files outside fenced
 * and inline code.
 *
 * THE RULES, and what to write instead:
 *
 *   middle-dot     An interpunct or bullet joining anything to anything.
 *                  Say the relationship: a comma for a list, a colon for a
 *                  count, parentheses for an aside, a full stop between
 *                  thoughts. A glyph that can join anything explains nothing.
 *   long-dash      An em or en dash splicing clauses. Break the thought: a
 *                  full stop, a comma, a colon, or parentheses. A dash that
 *                  stands alone in a table cell is a placeholder and passes.
 *   prose-semicolon  A semicolon joining two clauses in a sentence. Full
 *                  stop, new sentence. A code semicolon is token-adjacent
 *                  and never matches; CSS blocks and media types pass.
 *   filler         Words that carry no information and mark text nobody
 *                  read back: "delve", "seamless", "leverage", "robust",
 *                  "in order to", "it is worth noting" and their kin. Cut
 *                  the word, or say the concrete thing it stood in for.
 *   emoji          A pictograph decorating prose or a label. The CLI's own
 *                  status marks (a tick, a cross, a dot) are not emoji and
 *                  pass.
 *
 * Exemptions, and the reason has to be written down to earn one:
 *   slop-allow: recorded   within 400 characters before the site, in a
 *                          comment (or an HTML comment in Markdown), for a
 *                          value whose wording is part of a record or a
 *                          verbatim quotation.
 *   slop-allow: file       anywhere in the file, for a file whose fixtures
 *                          are deliberately slop (this rule's own test).
 *
 * A `\uXXXX` escape never matches. Writing the codepoint out is a visible,
 * deliberate act; the literal character is what slips in unnoticed.
 *
 * Usage: node scripts/lint-slop.mjs [--strict] [--only=rule,rule] [paths...]
 *   Default paths: src console-ui/src scripts docs/reference README.md CHANGELOG.md
 *   --strict makes any finding fail the run (exit 1). Without it the report
 *   is advisory, which is what a sweep in progress needs.
 *   --only limits the rules, so one rule can be made strict while another
 *   is still being swept: --strict --only=middle-dot,filler,emoji
 *
 * Adapted from stitch-pack-accounting-pt/scripts/lint-slop.mjs, which reads
 * TypeScript only and knows the first three rules. The Markdown reader, the
 * filler and emoji rules, the per-rule summary and --only are this repo's.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import ts from 'typescript';

const EM_DASH = String.fromCodePoint(0x2014);
const EN_DASH = String.fromCodePoint(0x2013);
const MIDDLE_DOT = String.fromCodePoint(0xb7);
const BULLET = String.fromCodePoint(0x2022);

const LEADING_SPACE_SEMICOLON = /\s+;/u;
const CLAUSE_JOIN = /[^\s;];\s+[a-z]/u;
const CSS_BLOCK = /\{[^{}]*[a-z-]+\s*:\s*[^{}]+\}/u;
// An inline style run: `property: value; property: value`, as a React/Preact
// `style={...}` template literal holds. The `;` there separates CSS
// declarations, not clauses, and prose never writes `word: value; word:`.
// Each side is a CSS property (lowercase and hyphens, or a `${}` custom
// property, which the scanner replaces with U+0001) then a colon and a value.
// `` stands for an interpolated `${...}` in a checked template literal.
const CSS_DECLARATION_RUN = /(?:[a-z-]+|)\s*:\s*[^;]+;\s*(?:[a-z-]+|)\s*:/u;
// A header value carrying parameters after a semicolon, by RFC 9110: a
// media type (`text/csv; charset=utf-8`) or a disposition
// (`attachment; filename="x"`). Syntax, the way a CSS declaration is, not a
// clause join.
const MEDIA_TYPE = /^[a-z]+(?:\/[\w.+-]+)?\s*;\s*[\w-]+=/u;
const CODE_STATEMENT = /\b(?:const|let|var)\s+[\w{[][^;\n]*=[^;\n]*;/u;
// Pictographs and symbols people paste as decoration. Dingbats such as the
// tick and cross the CLI prints (U+2713, U+2717) are outside these ranges.
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}]|\u{1F1E6}[\u{1F1E6}-\u{1F1FF}]/u;

/**
 * Filler: each entry is a pattern and the reason it is flagged. Word
 * boundaries throughout, case-insensitive. Kept short on purpose: a list
 * that flags honest writing teaches everyone to reach for the exemption.
 */
const FILLER = [
  [/\bdelve(?:s|d)?\b/iu, 'nobody delves; say what is looked at'],
  [/\bseamless(?:ly)?\b/iu, 'say what does not happen, or cut it'],
  [/\bleverag(?:e|es|ed|ing)\b/iu, '"use"'],
  [/\brobust(?:ly|ness)?\b/iu, 'say what it survives, or cut it'],
  [/\butiliz(?:e|es|ed|ing|ation)\b/iu, '"use"'],
  [/\bin order to\b/iu, '"to"'],
  [/\bit(?:'s| is) worth noting\b/iu, 'just note it'],
  [/\bcutting[- ]edge\b/iu, 'say what is new'],
  [/\bgame[- ]chang(?:er|ing)\b/iu, 'say what changes'],
  [/\bstreamlin(?:e|es|ed|ing)\b/iu, 'say what step goes away'],
  [/\bempower(?:s|ed|ing)?\b/iu, 'say what someone can now do'],
  [/\bunlock(?:s|ed|ing)?\s+(?:the\s+)?(?:power|potential|value)\b/iu, 'say the concrete gain'],
  [/\btapestry\b/iu, 'no'],
  [/\bnavigat(?:e|es|ing)\s+the\s+(?:complexities|landscape|world)\b/iu, 'say the actual difficulty'],
  [/\bin today'?s\s+(?:fast[- ]paced|digital|modern|ever[- ]changing)\b/iu, 'cut the opener'],
  [/\ba testament to\b/iu, '"shows"'],
  [/\bplays? a (?:crucial|vital|key|pivotal) role\b/iu, 'say what it does'],
  [/\bcomprehensive\b/iu, 'say what it covers'],
  [/\bfurthermore\b|\bmoreover\b/iu, 'start the sentence; the link is already there'],
  [/\bdeep[- ]dive\b|\bdive (?:deep )?into\b/iu, '"look at"'],
  [/\blook no further\b/iu, 'no'],
  [/\bwhether you'?re\b/iu, 'name the reader once, or not at all'],
  [/\bnot (?:just|only) [^.!?\n]{1,40}\b(?:but|it'?s) (?:also )?\b/iu, 'say the one thing it is'],
  [/\bensure(?:s|d)? that\b/iu, '"make sure", or say what happens otherwise'],
];

/** @typedef {{ file: string, line: number, rule: string, sample: string, why: string }} Finding */

/** @type {(text: string) => string | null} */
function dashIn(text) {
  const without = text.replaceAll(EM_DASH, '').replaceAll(EN_DASH, '');
  if (without.trim() === '') return null;
  if (text.includes(EM_DASH)) return 'em dash';
  if (text.includes(EN_DASH)) return 'en dash';
  return null;
}

/** @type {(text: string) => boolean} */
function hasProseSemicolon(text) {
  if (CSS_BLOCK.test(text)) return false;
  if (CSS_DECLARATION_RUN.test(text)) return false;
  if (MEDIA_TYPE.test(text)) return false;
  if (CODE_STATEMENT.test(text)) return false;
  return LEADING_SPACE_SEMICOLON.test(text) || CLAUSE_JOIN.test(text);
}

/** @type {(text: string) => string | null} */
function dotIn(text) {
  if (text.includes(MIDDLE_DOT)) return 'middle dot';
  if (text.includes(BULLET)) return 'bullet';
  return null;
}

/**
 * Every finding in one prose segment. `code` marks a segment that is code
 * rather than prose (a string literal may hold a CSS class or a path), where
 * only the character rules apply and the filler words are left alone.
 * @type {(segment: string, opts: { prose: boolean }) => Array<{ rule: string, why: string, sample: string }>}
 */
function findingsIn(segment, opts) {
  const out = [];
  const sample = segment.trim().replace(/\s+/g, ' ').slice(0, 72);
  const dash = dashIn(segment);
  if (dash !== null) out.push({ rule: 'long-dash', why: `${dash}: break the thought with a full stop, a comma, a colon or parentheses`, sample });
  if (hasProseSemicolon(segment)) out.push({ rule: 'prose-semicolon', why: 'full stop, new sentence', sample });
  const dot = dotIn(segment);
  if (dot !== null) out.push({ rule: 'middle-dot', why: `${dot}: say the relationship (comma, colon, parentheses, full stop)`, sample });
  if (EMOJI.test(segment)) out.push({ rule: 'emoji', why: 'decoration; the words have to carry it', sample });
  if (opts.prose) {
    for (const [pattern, why] of FILLER) {
      const match = pattern.exec(segment);
      if (match) out.push({ rule: 'filler', why: `"${match[0]}": ${why}`, sample });
    }
  }
  return out;
}

/** @type {(text: string, pos: number) => boolean} */
function exempt(text, pos) {
  if (/slop-allow:\s*file/u.test(text)) return true;
  return /slop-allow:\s*recorded/u.test(text.slice(Math.max(0, pos - 400), pos));
}

/** @type {(file: string, content: string, findings: Finding[]) => void} */
function scanTypeScript(file, content, findings) {
  const kind = file.endsWith('.tsx') || file.endsWith('.jsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, kind);
  const text = source.getFullText();
  const report = (pos, segment, prose) => {
    if (exempt(text, pos)) return;
    const { line } = source.getLineAndCharacterOfPosition(pos);
    for (const f of findingsIn(segment, { prose })) findings.push({ file, line: line + 1, ...f });
  };
  const walk = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      report(node.getStart(source), text.slice(node.getStart(source) + 1, node.getEnd() - 1), true);
    } else if (ts.isTemplateExpression(node)) {
      // A template with `${...}`. Check the whole literal at once, each
      // expression replaced by a neutral token (U+0001), so a CSS
      // declaration run or a code statement split across `${...}` reads as
      // one thing rather than as fragments that each look like a bare
      // `; word`. Built from RAW source, not the cooked text, so a `\uXXXX`
      // escape stays an escape and never matches (writing the codepoint out
      // is a deliberate act).
      const raw = (n) => {
        const start = n.getStart(source);
        const end = n.getEnd();
        // Head is `...${`, middles are `}...${`, the tail is `}...\``.
        const openTrim = ts.isTemplateHead(n) ? 1 : 1; // skip the leading ` or }
        const closeTrim = ts.isTemplateTail(n) ? 1 : 2; // trailing ` or ${
        return text.slice(start + openTrim, end - closeTrim);
      };
      const cooked = raw(node.head) + node.templateSpans.map((s) => `${raw(s.literal)}`).join('');
      report(node.getStart(source), cooked, true);
    } else if (ts.isJsxText(node)) {
      report(node.getStart(source), text.slice(node.getStart(source), node.getEnd()), true);
    }
    ts.forEachChild(node, walk);
  };
  walk(source);

  const seen = new Set();
  const comments = (ranges) => {
    for (const range of ranges ?? []) {
      if (seen.has(range.pos)) continue;
      seen.add(range.pos);
      report(range.pos, text.slice(range.pos, range.end), true);
    }
  };
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.JSX, text);
  scanner.setOnError(() => undefined);
  let position = 0;
  let token = scanner.scan();
  while (token !== ts.SyntaxKind.EndOfFileToken) {
    comments(ts.getLeadingCommentRanges(text, position));
    position = scanner.getTokenEnd();
    token = scanner.scan();
  }
  comments(ts.getLeadingCommentRanges(text, position));
}

/**
 * Markdown: the prose outside fenced code blocks, with inline code, links'
 * targets and HTML comments removed, one line at a time so a finding names
 * its line. A table row is read cell by cell, so a lone dash placeholder
 * passes and a spliced sentence in a cell does not.
 * @type {(file: string, content: string, findings: Finding[]) => void}
 */
function scanMarkdown(file, content, findings) {
  if (/slop-allow:\s*file/u.test(content)) return;
  const lines = content.split('\n');
  let fenced = false;
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const pos = offset;
    offset += raw.length + 1;
    if (/^\s*(```|~~~)/.test(raw)) { fenced = !fenced; continue; }
    if (fenced) continue;
    if (/^---\s*$/.test(raw) && i === 0) { fenced = true; continue; }   // front matter opens
    if (exempt(content, pos)) continue;
    const prose = raw
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/`[^`]*`/g, ' ')
      .replace(/\]\([^)]*\)/g, ']')
      .replace(/^\s*[-*+]\s+/, '')            // list marker
      .replace(/^\s*\|?\s*[-:]+\s*(\|\s*[-:]+\s*)*\|?\s*$/, '');   // table rule row
    if (!prose.trim()) continue;
    const cells = prose.includes('|') ? prose.split('|') : [prose];
    for (const cell of cells) {
      for (const f of findingsIn(cell, { prose: true })) findings.push({ file, line: i + 1, ...f });
    }
  }
}

/** @type {(root: string, out: string[]) => void} */
// Generated files carry a `Do not edit` header and are rebuilt from source.
// Anything ending `.generated.ts` is one; these two do not follow that name.
const GENERATED = new Set(['generated-version.ts', 'generated-registry.ts']);

/** @type {(name: string) => boolean} */
function isGenerated(name) {
  return name.endsWith('.generated.ts') || GENERATED.has(name);
}

function collect(root, out) {
  if (!existsSync(root)) return;
  if (statSync(root).isFile()) { out.push(root); return; }
  for (const name of readdirSync(root)) {
    const full = join(root, name);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
      collect(full, out);
    } else if (/\.(ts|tsx|mts|mjs|js|jsx|md)$/u.test(name) && !name.endsWith('.d.ts') && !isGenerated(name)) {
      out.push(full);
    }
  }
}

const args = process.argv.slice(2);
const strict = args.includes('--strict');
const only = args.find((a) => a.startsWith('--only='))?.slice('--only='.length).split(',').filter(Boolean);
const roots = args.filter((a) => !a.startsWith('--'));
const targets = roots.length > 0 ? roots : ['src', 'console-ui/src', 'scripts', 'docs/reference', 'README.md', 'CHANGELOG.md'];

/** @type {Finding[]} */
const findings = [];
/** @type {string[]} */
const files = [];
for (const target of targets) collect(target, files);
for (const file of files) {
  const rel = relative(process.cwd(), file);
  const content = readFileSync(file, 'utf8');
  if (extname(file) === '.md') scanMarkdown(rel, content, findings);
  else scanTypeScript(rel, content, findings);
}

const kept = only ? findings.filter((f) => only.includes(f.rule)) : findings;
if (kept.length === 0) {
  process.stdout.write(`slop: clean (${files.length} files${only ? `, rules ${only.join(', ')}` : ''})\n`);
  process.exit(0);
}
for (const f of kept) process.stdout.write(`${f.file}:${f.line}  ${f.rule}  ${f.sample}\n    ${f.why}\n`);
const byRule = new Map();
for (const f of kept) byRule.set(f.rule, (byRule.get(f.rule) ?? 0) + 1);
const summary = [...byRule.entries()].sort((a, b) => b[1] - a[1]).map(([rule, n]) => `${rule} ${n}`).join(', ');
process.stdout.write(`\nslop: ${kept.length} finding(s) in ${new Set(kept.map((f) => f.file)).size} file(s): ${summary}.\n` +
  'Rewrite the sentence; do not swap the glyph.\n');
process.exit(strict ? 1 : 0);
