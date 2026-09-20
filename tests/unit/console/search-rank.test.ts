/**
 * The console's search ranking: the thing named for the query comes
 * before the thing that mentions it.
 */
import { describe, it, expect } from 'vitest';
import { score, rank } from '../../../console-ui/src/search';

describe('score', () => {
  it('is zero unless every term appears', () => {
    expect(score('gate', { title: 'Durable Gates' })).toBeGreaterThan(0);
    expect(score('gate token', { title: 'Durable Gates' })).toBe(0);
    expect(score('gate token', { title: 'Durable Gates', detail: 'the bundle token' })).toBeGreaterThan(0);
    expect(score('', { title: 'anything' })).toBe(0);
  });

  it('ranks an exact title over a prefix over a word start over a substring over the detail', () => {
    const q = 'gate';
    const exact = score(q, { title: 'gate' });
    const prefix = score(q, { title: 'gates and effects' });
    const wordStart = score(q, { title: 'Durable Gates' });
    const inside = score(q, { title: 'delegate' });
    const detail = score(q, { title: 'Orientation', detail: 'a gate pauses the run' });
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(wordStart);
    expect(wordStart).toBeGreaterThan(inside);
    expect(inside).toBeGreaterThan(detail);
  });

  it('prefers the shorter of two titles that match the same way', () => {
    expect(score('run', { title: 'run' })).toBeGreaterThan(score('run', { title: 'run a workflow from the command line' }));
  });

  it('rewards a multi-word query matching the title whole', () => {
    expect(score('durable gates', { title: 'Durable Gates' })).toBeGreaterThan(score('durable gates', { title: 'Gates, durable and otherwise' }));
  });

  it('is case-insensitive', () => {
    expect(score('GATE', { title: 'durable gates' })).toBe(score('gate', { title: 'Durable Gates' }));
  });
});

describe('rank', () => {
  const items = [
    { title: 'Durable Gates', detail: 'Running' },
    { title: 'Gate kinds', detail: 'Durable Gates' },
    { title: 'Orientation', detail: 'a gate pauses the run' },
    { title: 'Marketplace', detail: 'packs' },
    { title: 'delegate', detail: '' },
  ];

  it('returns matches best first and drops the rest', () => {
    expect(rank('gate', items).map((x) => x.title)).toEqual(['Gate kinds', 'Durable Gates', 'delegate', 'Orientation']);
  });

  it('honours the limit', () => {
    expect(rank('gate', items, 2)).toHaveLength(2);
  });

  it('breaks a tie by title', () => {
    const tied = rank('x', [{ title: 'x b' }, { title: 'x a' }]);
    expect(tied.map((t) => t.title)).toEqual(['x a', 'x b']);
  });
});
