import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Every relative link in docs/reference/*.md must point at a file that
 * exists, so the links work on GitHub and on npm, not only in the console
 * (whose Markdown renderer also accepts `slug.md#anchor`).
 */
const docsDir = path.join(process.cwd(), 'docs', 'reference');

/** Markdown links outside fenced code blocks, as [text](target). */
function relativeLinks(markdown: string): string[] {
  const prose = markdown.replace(/```[\s\S]*?```/g, '');
  const targets: string[] = [];
  for (const match of prose.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = match[1];
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue; // http:, https:, mailto:
    if (target.startsWith('#')) continue; // an anchor on the same page
    targets.push(target);
  }
  return targets;
}

describe('reference docs links', () => {
  const files = fs.readdirSync(docsDir).filter((f) => f.endsWith('.md')).sort();

  it('finds the reference topics', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s links only to files that exist', (file) => {
    const markdown = fs.readFileSync(path.join(docsDir, file), 'utf8');
    const broken: string[] = [];
    for (const target of relativeLinks(markdown)) {
      const [filePart] = target.split('#');
      const resolved = path.resolve(docsDir, filePart);
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) broken.push(target);
    }
    expect(broken, `broken links in ${file}`).toEqual([]);
  });
});
