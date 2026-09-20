/**
 * A search asks every registry the project's npm would, with that
 * registry's credentials, and reports each one rather than failing on
 * the first that does not answer.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { searchAllRegistries } from '../../../src/marketplace/registry';
import type { Registry } from '../../../src/marketplace/npmrc';

const pkg = (name: string, description = '') => ({ package: { name, version: '1.0.0', description } });

const registries: Registry[] = [
  { url: 'https://registry.npmjs.org/', scopes: [], isDefault: true },
  { url: 'https://npm.example.com/', scopes: ['@acme'], isDefault: false, authorization: 'Bearer secret' },
];

afterEach(() => { vi.unstubAllGlobals(); });

describe('searchAllRegistries', () => {
  it('asks each registry its own way, with its credentials, and merges', async () => {
    const calls: Array<{ url: string; auth?: string }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
      calls.push({ url: input, auth: (init?.headers as Record<string, string> | undefined)?.Authorization });
      const objects = input.startsWith('https://registry.npmjs.org/')
        ? [pkg('flow-weaver-pack-openai', 'public'), pkg('not-a-pack')]
        : [pkg('@acme/flow-weaver-pack-audio', 'private'), pkg('flow-weaver-pack-openai', 'mirror')];
      return { ok: true, json: async () => ({ objects, total: objects.length }) } as Response;
    }));

    const { results, searched } = await searchAllRegistries({ query: 'x', registries });

    const pub = new URL(calls.find((c) => c.url.startsWith('https://registry.npmjs.org/'))!.url);
    const priv = new URL(calls.find((c) => c.url.startsWith('https://npm.example.com/'))!.url);
    // The public registry understands the keyword qualifier. A private one gets plain text.
    expect(pub.pathname).toBe('/-/v1/search');
    expect(pub.searchParams.get('text')).toBe('keywords:flow-weaver-marketplace-pack x');
    expect(priv.searchParams.get('text')).toBe('x');
    expect(calls.find((c) => c.url.startsWith('https://npm.example.com/'))!.auth).toBe('Bearer secret');
    expect(calls.find((c) => c.url.startsWith('https://registry.npmjs.org/'))!.auth).toBeUndefined();

    // Merged: a name once, the first registry keeping it. Only packs kept.
    expect(results.map((r) => [r.name, r.registry]).sort()).toEqual([
      ['@acme/flow-weaver-pack-audio', 'npm.example.com'],
      ['flow-weaver-pack-openai', 'registry.npmjs.org'],
    ]);
    expect(searched).toEqual([
      { url: 'https://registry.npmjs.org/', scopes: [], authenticated: false, ok: true, count: 1 },
      { url: 'https://npm.example.com/', scopes: ['@acme'], authenticated: true, ok: true, count: 2 },
    ]);
  });

  it('asks a private registry for flow-weaver when there is no query', async () => {
    const seen: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string) => { seen.push(input); return { ok: true, json: async () => ({ objects: [] }) } as Response; }));
    await searchAllRegistries({ registries: [registries[1]] });
    expect(new URL(seen[0]).searchParams.get('text')).toBe('flow-weaver');
  });

  it('reports a registry that fails and keeps the others', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string) => (
      input.startsWith('https://npm.example.com/')
        ? { ok: false, status: 401, statusText: 'Unauthorized' } as Response
        : { ok: true, json: async () => ({ objects: [pkg('flow-weaver-pack-openai')] }) } as Response
    )));
    const { results, searched } = await searchAllRegistries({ registries });
    expect(results.map((r) => r.name)).toEqual(['flow-weaver-pack-openai']);
    expect(searched[1]).toMatchObject({ ok: false, error: 'npm search failed: 401 Unauthorized' });
  });
});
