/**
 * The slop linter's own pins, both directions: the habits it must catch, and
 * the syntax it must leave alone. A gate that flags honest writing teaches
 * everyone to reach for the exemption comment, so the false-negative side
 * matters as much as the false-positive side.
 *
 * Driven through the CLI, because the script does its work at module scope
 * and exports nothing to call.
 *
 * slop-allow: file. The fixtures below are slop on purpose: every string in
 * the "flags" table is a pattern the linter must catch, so it reads this
 * file as a wall of findings. This is the one file that earns a whole-file
 * exemption, and it earns it by being the linter's own test.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let scratch: string | undefined;
afterEach(() => {
  if (scratch !== undefined) rmSync(scratch, { recursive: true, force: true });
  scratch = undefined;
});

/** Run the linter over one file holding `source` (a `.ts` unless `ext` says otherwise). */
function lint(source: string, ext = 'ts'): string {
  scratch = mkdtempSync(join(tmpdir(), 'fw-slop-'));
  const file = join(scratch, `sample.${ext}`);
  writeFileSync(file, source, 'utf8');
  return execFileSync('npx', ['tsx', 'scripts/lint-slop.mjs', file], { encoding: 'utf8' });
}

describe('the slop linter', () => {
  it.each([
    ['a middle dot between labels in a comment', '// steps 3 \u00b7 gates 1\n'],
    ['a bullet as a separator', '// answers 200 \u2022 422 \u2022 500\n'],
    ['a middle dot in a string', 'const s = "up \u00b7 since noon";\n'],
    ['an em dash splicing clauses in a comment', '// the split survives \u2014 the file moves\n'],
    ['a prose semicolon', '// the store commits; the anchor does not\n'],
    ['an emoji in a string', 'const s = "done \u{1F389}";\n'],
    ['a filler word in a comment', '// we leverage the cache here\n'],
    ['in order to', '// call it in order to warm the cache\n'],
    ['a middle dot in JSX text', 'const x = <span>up \u00b7 since noon</span>;\n', 'tsx'],
    ['a middle dot in Markdown prose', 'The server is up \u00b7 since noon.\n', 'md'],
    ['an emoji in Markdown', '# \u{1F680} Getting started\n', 'md'],
    ['a prose colon-clause that only looks like CSS', 'const s = `note: ${a}; the caller reads it now`;\n'],
    ['an em dash between two interpolations', 'const s = `${name} — ${desc}`;\n'],
  ])('flags %s', (_label, source, ext) => {
    expect(lint(source, ext as string | undefined)).not.toContain('slop: clean');
  });

  it.each([
    ['a code semicolon', 'const a = [];\nconst b = 0;\n'],
    ['a CSS block in a string', 'const css = ".x { color: red; font: bold; }";\n'],
    ['a media type', 'const h = "text/csv; charset=utf-8";\n'],
    ['a content-disposition header', 'const h = `attachment; filename="${name}"`;\n'],
    ['an inline CSS style run', 'const s = `left: ${x}px; top: ${y}px`;\n'],
    ['a CSS run with a custom property', 'const s = `--d: ${depth}; top: ${top}px; height: ${h}px`;\n'],
    ['a lone dash placeholder in a table cell', 'Name | Value\n---|---\nfoo | \u2014\n', 'md'],
    ['a codepoint escape rather than the character', 'const dot = "\\u00b7";\n'],
    ['a status tick the CLI prints', 'console.log("\u2713 done");\n'],
    ['a hyphen in prose', '// a well-formed answer\n'],
    ['a fenced code block in Markdown', '```\nconst a = b \u00b7 c;\n```\n', 'md'],
    ['inline code in Markdown prose', 'Use the `a \u00b7 b` operator carefully.\n', 'md'],
    ['a recorded value with its reason', '// slop-allow: recorded (verbatim office title)\nconst title = "Servi\u00e7o \u00b7 Central";\n'],
  ])('leaves %s alone', (_label, source, ext) => {
    expect(lint(source, ext as string | undefined)).toContain('slop: clean');
  });

  it('names the rule and the reason for each finding', () => {
    const out = lint('// up \u00b7 since noon\n');
    expect(out).toContain('middle-dot');
    expect(out).toMatch(/say the relationship/);
  });

  it('the codebase passes the strict rules it gates on', () => {
    // The same command `npm run lint:slop` runs; a new middle dot or a new
    // emoji in a reader-facing surface fails here as it would in CI.
    const run = (args: string[]) => {
      try {
        execFileSync('npx', ['tsx', 'scripts/lint-slop.mjs', ...args], { encoding: 'utf8' });
        return true;
      } catch {
        return false;
      }
    };
    expect(run(['--strict', '--only=middle-dot'])).toBe(true);
    expect(run(['--strict', '--only=emoji', 'console-ui/src', 'docs/reference', 'README.md', 'CHANGELOG.md'])).toBe(true);
  }, 60000);
});
