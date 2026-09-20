/**
 * The command line's completion comes from the CLI reference, which a
 * docs-sync test keeps true to the real commands. This checks the reading
 * of it: names, usage, flags, examples -- and that nothing is invented.
 */
import { describe, it, expect } from 'vitest';
import { parseCliReference, cliCatalog } from '../../../src/console/cli-catalog';

const SAMPLE = `
# CLI Reference

## Quick Reference

### not a command

\`\`\`bash
fw nope
\`\`\`

## Core Commands

### compile

Compile workflow files to TypeScript. Inserts generated code into marker sections.

\`\`\`bash
fw compile <input> [options]
\`\`\`

| Flag | Description | Default |
|------|-------------|---------|
| \`-o, --output <path>\` | Output file or directory | in-place |
| \`--dry-run\` | Preview without writing | \`false\` |

**Examples:**
\`\`\`bash
fw compile my-workflow.ts
fw compile '**/*.ts' -o .output
\`\`\`

> See also: [Compilation](compilation).

---

### create workflow

Create a workflow from a template.

\`\`\`bash
fw create workflow <template> <file> [options]
\`\`\`

## Global Flag

### --version

\`\`\`bash
fw --version
\`\`\`
`;

describe('parseCliReference', () => {
  const cmds = parseCliReference(SAMPLE);

  it('reads a command with its usage, flags and examples', () => {
    const compile = cmds.find((c) => c.name === 'compile')!;
    expect(compile).toMatchObject({
      group: 'Core Commands',
      words: ['compile'],
      usage: 'fw compile <input> [options]',
      description: 'Compile workflow files to TypeScript. Inserts generated code into marker sections.',
    });
    expect(compile.flags).toEqual([
      { flag: '-o, --output <path>', description: 'Output file or directory', default: 'in-place' },
      { flag: '--dry-run', description: 'Preview without writing', default: 'false' },
    ]);
    expect(compile.examples).toEqual(['fw compile my-workflow.ts', "fw compile '**/*.ts' -o .output"]);
  });

  it('takes the selecting words from the usage line, not the heading', () => {
    // `create workflow` is two words before the first placeholder.
    expect(cmds.find((c) => c.name === 'create workflow')?.words).toEqual(['create', 'workflow']);
  });

  it('ignores the quick reference and the global flag sections', () => {
    expect(cmds.map((c) => c.name)).toEqual(['compile', 'create workflow']);
  });
});

describe('cliCatalog', () => {
  it('finds the real commands, including console itself', () => {
    const names = cliCatalog().map((c) => c.name);
    expect(names).toContain('compile');
    expect(names).toContain('validate');
    expect(names).toContain('console');
    expect(names).toContain('run');
    // Every command has a usage line beginning with fw.
    expect(cliCatalog().every((c) => c.usage.startsWith('fw '))).toBe(true);
  });
});
