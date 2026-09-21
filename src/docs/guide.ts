/**
 * The reference topics arranged as a guide.
 *
 * `listTopics()` is alphabetical, which is right for a lookup and wrong for
 * a person reading their way in: `advanced-annotations` should not come
 * before `orientation`. This is the order a reader wants, in groups, with
 * what each topic has to do with the project that is open -- so a page
 * about gates can point at the gated workflows sitting in the rail.
 */
import { listTopics, type DocTopic } from './index.js';

/**
 * What in the open project a topic is about, as facets of the workflow
 * listing. `uses` entries match a workflow's `uses` exactly, or by prefix
 * when they end in `:` (`gate:` matches `gate:approval`).
 */
export interface Related {
  /** Workflows with validation issues, grouped by code. */
  codes?: boolean;
  uses?: string[];
}

export interface GuideEntry {
  slug: string;
  name: string;
  description: string;
  related?: Related;
}

export interface GuideGroup {
  title: string;
  topics: GuideEntry[];
}

const GROUPS: Array<{ title: string; topics: Array<[slug: string, related?: Related]> }> = [
  { title: 'Getting started', topics: [['orientation'], ['tutorial'], ['console']] },
  {
    title: 'Authoring',
    topics: [
      ['concepts'],
      ['jsdoc-grammar'],
      ['advanced-annotations', { uses: ['pull', 'expr', 'scope'] }],
      ['export-interface', { uses: ['scope'] }],
      ['built-in-nodes', { uses: ['builtin:'] }],
      ['node-conversion'],
      ['visual-reference'],
      ['scaffold'],
    ],
  },
  {
    title: 'Running',
    topics: [
      ['library'],
      ['durable-gates', { uses: ['gate:', 'effect', 'pure'] }],
      ['debugging', { codes: true }],
      ['cancellation'],
      ['compilation'],
      ['deployment'],
    ],
  },
  { title: 'Tooling', topics: [['cli-reference'], ['mcp-tools'], ['iterative-development'], ['marketplace']] },
  { title: 'Reference', topics: [['error-codes', { codes: true }]] },
];

/** Every topic, in reading order. A topic the manifest does not know goes under "More", a pack's under "Packs". */
export function guideOutline(topics: DocTopic[] = listTopics(), packSlugs: Set<string> = new Set()): GuideGroup[] {
  const byslug = new Map(topics.map((t) => [t.slug, t]));
  const placed = new Set<string>();
  const groups: GuideGroup[] = [];
  for (const g of GROUPS) {
    const entries: GuideEntry[] = [];
    for (const [slug, related] of g.topics) {
      const t = byslug.get(slug);
      if (!t) continue;
      placed.add(slug);
      entries.push({ slug, name: t.name || slug, description: t.description, ...(related ? { related } : {}) });
    }
    if (entries.length) groups.push({ title: g.title, topics: entries });
  }
  const rest = topics.filter((t) => !placed.has(t.slug));
  const more = rest.filter((t) => !packSlugs.has(t.slug)).map((t) => ({ slug: t.slug, name: t.name || t.slug, description: t.description }));
  const packs = rest.filter((t) => packSlugs.has(t.slug)).map((t) => ({ slug: t.slug, name: t.name || t.slug, description: t.description }));
  if (more.length) groups.push({ title: 'More', topics: more });
  if (packs.length) groups.push({ title: 'Packs', topics: packs });
  return groups;
}
