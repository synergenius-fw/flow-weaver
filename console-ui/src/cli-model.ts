/**
 * The command line as a structure.
 *
 * The catalogue gives each command its usage line and its flags as text
 * from the CLI reference. Read here into arguments and options, a command
 * can be shown as a form, a typed line can be taken apart into that form,
 * and the form put back together as a line -- so a person moves between
 * typing and filling in without either losing what the other had.
 */
import { splitArgs, quoteArg } from './shell';

export interface CommandLike {
  name: string;
  words: string[];
  usage: string;
  description: string;
  flags: Array<{ flag: string; description: string; default: string }>;
  examples: string[];
}

export interface Arg {
  name: string;
  required: boolean;
  variadic: boolean;
}

export interface Flag {
  /** The long form, `--output`. The only form the builder writes. */
  long: string;
  short: string | null;
  /** The value's placeholder, `<path>`, or null for a boolean flag. */
  value: string | null;
  variadic: boolean;
  /** `--no-watch` negates `--watch`: on means the flag is passed as written. */
  negation: boolean;
  description: string;
  default: string;
}

/** The positional arguments a usage line declares: `fw compile <input> [options]` → `input`, required. */
export function parseUsage(usage: string): Arg[] {
  const out: Arg[] = [];
  for (const m of usage.matchAll(/<([^>]+)>|\[([^\]]+)\]/g)) {
    const raw = m[1] ?? m[2];
    const required = m[1] !== undefined;
    if (!required && /^options$/i.test(raw)) continue;
    const variadic = raw.endsWith('...');
    out.push({ name: variadic ? raw.slice(0, -3) : raw, required, variadic });
  }
  return out;
}

/** `-o, --output <path>` → long `--output`, short `-o`, value `<path>`. */
export function parseFlag(spec: { flag: string; description: string; default: string }): Flag | null {
  const parts = spec.flag.split(',').map((s) => s.trim());
  let long: string | null = null;
  let short: string | null = null;
  let value: string | null = null;
  for (const p of parts) {
    const m = p.match(/^(--?[\w-]+)(?:\s+(<[^>]+>|\[[^\]]+\]))?$/);
    if (!m) continue;
    if (m[1].startsWith('--')) long = m[1]; else short = m[1];
    if (m[2]) value = m[2];
  }
  if (!long && !short) return null;
  return {
    long: long ?? short!,
    short: long ? short : null,
    value,
    variadic: !!value && value.includes('...'),
    negation: !!long?.startsWith('--no-'),
    description: spec.description,
    default: spec.default,
  };
}

export interface Filled {
  command: CommandLike;
  args: string[];
  /** Long flag → value, or `true` for a boolean flag that is on. */
  flags: Record<string, string | true>;
  /** Tokens the model could not place, kept so nothing typed is lost. */
  rest: string[];
}

/** The command a line names, by the longest run of leading words that matches. */
export function commandFor(words: string[], commands: CommandLike[]): CommandLike | undefined {
  const w = words[0] === 'fw' || words[0] === 'flow-weaver' ? words.slice(1) : words;
  let best: CommandLike | undefined;
  for (const c of commands) {
    if (c.words.length && c.words.every((x, i) => w[i] === x) && (!best || c.words.length > best.words.length)) best = c;
  }
  return best;
}

/** Take a typed line apart against the catalogue. Unknown tokens are kept in `rest`. */
export function parseLine(line: string, commands: CommandLike[]): Filled | null {
  const tokens = splitArgs(line);
  const command = commandFor(tokens, commands);
  if (!command) return null;
  const start = (tokens[0] === 'fw' || tokens[0] === 'flow-weaver' ? 1 : 0) + command.words.length;
  const flags = command.flags.map(parseFlag).filter((f): f is Flag => !!f);
  const byName = new Map<string, Flag>();
  for (const f of flags) { byName.set(f.long, f); if (f.short) byName.set(f.short, f); }
  const args: string[] = [];
  const set: Record<string, string | true> = {};
  const rest: string[] = [];
  for (let i = start; i < tokens.length; i++) {
    const t = tokens[i];
    const eq = t.startsWith('--') ? t.indexOf('=') : -1;
    const key = eq > 0 ? t.slice(0, eq) : t;
    const f = byName.get(key);
    if (f) {
      if (!f.value) set[f.long] = true;
      else if (eq > 0) set[f.long] = t.slice(eq + 1);
      else if (i + 1 < tokens.length) set[f.long] = tokens[++i];
      else set[f.long] = '';
    } else if (t.startsWith('-') && t !== '-') {
      rest.push(t);
    } else {
      args.push(t);
    }
  }
  return { command, args, flags: set, rest };
}

/** Put a filled form back into a line. Empty values and off flags are left out. Placeholders are kept as typed. */
export function composeLine(filled: Filled): string {
  const parts: string[] = [...filled.command.words];
  const declared = parseUsage(filled.command.usage);
  filled.args.forEach((a, i) => {
    const arg = declared[Math.min(i, declared.length - 1)];
    if (a === '' && arg && !arg.required) return;
    parts.push(a === '' ? (arg ? `<${arg.name}>` : '') : /^<[^>]+>$/.test(a) ? a : quoteArg(a));
  });
  for (const [k, v] of Object.entries(filled.flags)) {
    if (v === true) parts.push(k);
    else if (v !== '') parts.push(k, /^<[^>]+>$/.test(v) ? v : quoteArg(v));
  }
  parts.push(...filled.rest);
  return parts.filter(Boolean).join(' ');
}

/** Whether a line still has a `<placeholder>` to fill in. */
export const hasPlaceholder = (line: string): boolean => /<[^>]+>/.test(line);
