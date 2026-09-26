/**
 * When a rejected annotation line gets a fallback warning: only when the
 * grammar rejected it without saying why, so each bad line is reported once.
 */

/**
 * Run a line parser so each bad line is reported once. When the parser already
 * said why it rejected the line, that warning stands alone; `fallback` is used
 * only when the line was rejected without one (a line the lexer cannot read).
 */
export function parseLineOnce<T>(
  parse: (line: string, warnings: string[]) => T | null,
  line: string,
  warnings: string[],
  fallback: string
): T | null {
  const before = warnings.length;
  const result = parse(line, warnings);
  if (result === null && warnings.length === before) warnings.push(fallback);
  return result;
}
