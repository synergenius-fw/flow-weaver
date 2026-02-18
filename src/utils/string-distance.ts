/**
 * Levenshtein distance and fuzzy matching utilities
 */

/**
 * Compute the Levenshtein edit distance between two strings.
 */
export function levenshteinDistance(a: string, b: string): number {
  const la = a.length;
  const lb = b.length;

  if (la === 0) return lb;
  if (lb === 0) return la;

  // Use single-row optimization
  let prev = Array.from({ length: lb + 1 }, (_, i) => i);
  let curr = new Array<number>(lb + 1);

  for (let i = 1; i <= la; i++) {
    curr[0] = i;
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1, // insertion
        prev[j] + 1, // deletion
        prev[j - 1] + cost // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[lb];
}

/**
 * Compute an adaptive max edit distance based on target string length.
 * Short strings get a tighter threshold to avoid nonsensical suggestions.
 */
function adaptiveMaxDistance(target: string): number {
  const len = target.length;
  if (len <= 3) return 1;
  if (len <= 6) return 2;
  return 3;
}

/**
 * Find the closest matches from a list of candidates.
 * Returns candidates within maxDistance, sorted by distance (ascending).
 * When maxDistance is not provided, uses a length-proportional default.
 */
export function findClosestMatches(
  target: string,
  candidates: string[],
  maxDistance?: number
): string[] {
  const effectiveMax = maxDistance ?? adaptiveMaxDistance(target);
  const scored = candidates
    .filter((c) => c !== target)
    .map((c) => ({ name: c, distance: levenshteinDistance(target, c) }))
    .filter((s) => s.distance <= effectiveMax)
    .sort((a, b) => a.distance - b.distance);

  return scored.map((s) => s.name);
}
