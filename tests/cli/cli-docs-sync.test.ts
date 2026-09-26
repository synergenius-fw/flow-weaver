import fs from 'node:fs';
import path from 'node:path';
import { buildProgram } from '../../src/cli/program';

describe('CLI reference synchronization', () => {
  it('documents exactly the top-level commands registered by the live CLI', () => {
    const root = process.cwd();
    const docs = fs.readFileSync(path.join(root, 'docs/reference/cli-reference.md'), 'utf8');
    const live = buildProgram().commands.map((command) => command.name());
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
