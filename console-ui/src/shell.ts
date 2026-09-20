/**
 * Split a command line the way a person typing it expects: on spaces,
 * except inside quotes, with a backslash escaping the next character
 * outside single quotes. No expansion of anything -- the result is handed
 * to the CLI as an argument list, never to a shell.
 */
export function splitArgs(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let has = false;
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote) { quote = null; continue; }
      if (c === '\\' && quote === '"' && i + 1 < line.length) { cur += line[++i]; continue; }
      cur += c;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; has = true; continue; }
    if (c === '\\' && i + 1 < line.length) { cur += line[++i]; has = true; continue; }
    if (/\s/.test(c)) { if (has) { out.push(cur); cur = ''; has = false; } continue; }
    cur += c; has = true;
  }
  if (has) out.push(cur);
  return out;
}

/** Quote an argument so {@link splitArgs} gives it back unchanged. */
export function quoteArg(arg: string): string {
  return /[\s"'\\]/.test(arg) || arg === '' ? `"${arg.replace(/(["\\])/g, '\\$1')}"` : arg;
}
