/**
 * The topics in reading order, with what each has to do with the project.
 */
import { describe, it, expect } from 'vitest';
import { guideOutline } from '../../../src/docs/guide';
import { listTopics } from '../../../src/docs/index';

describe('guideOutline', () => {
  const outline = guideOutline();
  const slugs = outline.flatMap((g) => g.topics.map((t) => t.slug));

  it('starts with orientation and places every real topic', () => {
    expect(slugs[0]).toBe('orientation');
    const all = listTopics().map((t) => t.slug).sort();
    expect([...slugs].sort()).toEqual(all);
  });

  it('places each topic once', () => {
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('knows which project facets a topic is about', () => {
    const gates = outline.flatMap((g) => g.topics).find((t) => t.slug === 'durable-gates');
    expect(gates?.related?.uses).toContain('gate:');
    const codes = outline.flatMap((g) => g.topics).find((t) => t.slug === 'error-codes');
    expect(codes?.related?.codes).toBe(true);
  });

  it('puts an unknown topic under More, and a pack topic under Packs', () => {
    const topics = [
      { slug: 'orientation', name: 'Orientation', description: '', keywords: [] },
      { slug: 'brand-new', name: 'Brand New', description: '', keywords: [] },
      { slug: 'acme-pack', name: 'Acme', description: '', keywords: [] },
    ];
    const groups = guideOutline(topics, new Set(['acme-pack']));
    expect(groups.map((g) => g.title)).toEqual(['Getting started', 'More', 'Packs']);
    expect(groups[1].topics[0].slug).toBe('brand-new');
    expect(groups[2].topics[0].slug).toBe('acme-pack');
  });
});
