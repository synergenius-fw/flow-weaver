/**
 * Strict integer parser for CLI options.
 * Unlike parseInt, rejects partial matches ("12abc") and non-numeric values.
 * Throws a clear error instead of silently returning NaN.
 */
export function parseIntStrict(value: string): number {
  const trimmed = value.trim();
  if (trimmed === '') {
    throw new Error(`"${value}" is not a valid number`);
  }
  const n = Number(trimmed);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new Error(`"${value}" is not a valid number`);
  }
  return n;
}
