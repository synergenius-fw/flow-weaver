import fs from 'node:fs';
import path from 'node:path';

describe('CLI reference synchronization', () => {
  it('documents exactly the top-level commands registered by the live CLI', () => {
    const root = process.cwd();
    const source = fs.readFileSync(path.join(root, 'src/cli/index.ts'), 'utf8');
    const docs = fs.readFileSync(path.join(root, 'docs/reference/cli-reference.md'), 'utf8');
    const live = [...source.matchAll(
      /program\s*\.\s*command\(\s*(['"])(.*?)\1\s*\)\s*\.description\(\s*(['"])(.*?)\3\s*\)/gs,
    )].map((match) => match[2].trim().split(/\s+/)[0]);
    const section = docs.match(
      /<!-- AUTO:START cli_quick_reference -->([\s\S]*?)<!-- AUTO:END cli_quick_reference -->/,
    )?.[1] ?? '';
    const documented = [...section.matchAll(/^\| `([^`]+)` \|/gm)].map((match) => match[1]);

    expect(documented).toEqual(live);
    expect(documented).toContain('mcp-setup');
    expect(documented).not.toContain('ui');
    expect(documented).not.toContain('listen');
  });
});
