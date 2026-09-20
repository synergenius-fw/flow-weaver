/**
 * Ranking for the console's search: a query against a list of things with
 * a title and a detail line, so that "gate" puts *Durable Gates* above a
 * page that mentions gates once, and a workflow called `release` above a
 * command whose description has the word in it.
 */

export interface Searchable {
  title: string;
  detail?: string;
}

const norm = (s: string): string => s.toLowerCase();
const words = (q: string): string[] => norm(q).split(/\s+/).filter(Boolean);

/**
 * How well a title (and its detail) answers a query. 0 means no match:
 * every term has to appear somewhere. Otherwise, in descending order: the
 * title is the query, starts with it, has a word starting with it, contains
 * it; a term found only in the detail counts for less. A short title that
 * matches beats a long one that also does.
 */
export function score(query: string, item: Searchable): number {
  const terms = words(query);
  if (!terms.length) return 0;
  const title = norm(item.title);
  const detail = norm(item.detail ?? '');
  const whole = norm(query.trim());
  let total = 0;
  for (const t of terms) {
    const inTitle = title.includes(t);
    const inDetail = detail.includes(t);
    if (!inTitle && !inDetail) return 0;
    if (title === t) total += 100;
    else if (title.startsWith(t)) total += 80;
    else if (inTitle && new RegExp(`(^|[^a-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(title)) total += 60;
    else if (inTitle) total += 40;
    else total += 20;
  }
  if (terms.length > 1 && title === whole) total += 40;
  else if (terms.length > 1 && title.startsWith(whole)) total += 20;
  // Between two titles that match the same way, the shorter one is the closer answer.
  return total / terms.length - Math.min(10, title.length / 8);
}

/** The items that match, best first, at most `limit`. */
export function rank<T extends Searchable>(query: string, items: T[], limit = 8): Array<T & { score: number }> {
  return items
    .map((item) => ({ ...item, score: score(query, item) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, limit);
}
