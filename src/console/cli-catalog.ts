/**
 * The CLI's commands, read from the CLI reference.
 *
 * The console offers a command line with completion. The natural source
 * would be the commander program itself, but `src/cli/index.ts` parses
 * `process.argv` on import and cannot be loaded for its metadata. The
 * reference topic is the next best thing, and a better one than it looks:
 * a docs-sync test fails the build when it drifts from the real commands,
 * so what is read here is what `fw --help` would say.
 */
import { readTopic } from '../docs/index.js';

export interface CliFlag {
  flag: string;
  description: string;
  default: string;
}

export interface CliCommand {
  /** As the heading names it: `compile`, `create workflow`, `pattern list`. */
  name: string;
  /** The words after `fw` that select it, from the usage line. */
  words: string[];
  group: string;
  description: string;
  usage: string;
  flags: CliFlag[];
  examples: string[];
}

const SKIP_GROUPS = new Set(['Quick Reference', 'Global Flag', 'Related Topics']);

const cell = (s: string): string => s.trim().replace(/^`|`$/g, '');

/** Parse the reference's markdown into commands. Exposed for tests. Use {@link cliCatalog} otherwise. */
export function parseCliReference(markdown: string): CliCommand[] {
  const out: CliCommand[] = [];
  let group = '';
  let cur: CliCommand | undefined;
  let fence: 'usage' | 'examples' | 'other' | null = null;
  let examplesNext = false;
  let inFlags = false;
  let described = false;

  for (const raw of markdown.split('\n')) {
    const line = raw.trimEnd();
    const h2 = line.match(/^## (.+)$/);
    if (h2) { group = h2[1].trim(); cur = undefined; fence = null; continue; }
    const h3 = line.match(/^### (.+)$/);
    if (h3) {
      if (SKIP_GROUPS.has(group)) { cur = undefined; continue; }
      cur = { name: h3[1].trim(), words: [], group, description: '', usage: '', flags: [], examples: [] };
      out.push(cur);
      fence = null; examplesNext = false; inFlags = false; described = false;
      continue;
    }
    if (!cur) continue;

    if (line.startsWith('```')) {
      if (fence) { fence = null; continue; }
      fence = examplesNext ? 'examples' : !cur.usage ? 'usage' : 'other';
      examplesNext = false;
      continue;
    }
    if (fence === 'usage') {
      if (!cur.usage && /^fw\b/.test(line)) {
        cur.usage = line;
        cur.words = line.split(/\s+/).slice(1).filter((w) => !/^[<[-]/.test(w));
      }
      continue;
    }
    if (fence === 'examples') { if (line.trim() && !line.startsWith('#')) cur.examples.push(line.trim()); continue; }
    if (fence) continue;

    if (/^\*\*Examples:?\*\*/.test(line)) { examplesNext = true; continue; }
    if (/^\|\s*Flag\s*\|/i.test(line)) { inFlags = true; continue; }
    if (inFlags) {
      if (!line.startsWith('|')) { inFlags = false; }
      else {
        const cells = line.split('|').slice(1, -1);
        if (cells.length >= 2 && !/^[\s-:]+$/.test(cells[0])) {
          cur.flags.push({ flag: cell(cells[0]), description: cells[1].trim(), default: cell(cells[2] ?? '') });
        }
        continue;
      }
    }
    // The first paragraph under the heading describes the command.
    if (!described && line.trim() && !line.startsWith('|') && !line.startsWith('>') && !line.startsWith('---')) {
      cur.description = line.trim();
      described = true;
    }
  }
  return out.filter((c) => c.usage);
}

let cached: CliCommand[] | undefined;

/** The commands, parsed once per process. */
export function cliCatalog(): CliCommand[] {
  if (!cached) cached = parseCliReference(readTopic('cli-reference')?.content ?? '');
  return cached;
}
