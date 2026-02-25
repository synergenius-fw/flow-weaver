import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TMarketplaceManifest } from '../../../src/marketplace/types.js';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

const mockGlob = vi.fn();
vi.mock('glob', () => ({
  glob: (...args: unknown[]) => mockGlob(...args),
}));

import * as fs from 'fs';
import {
  searchPackages,
  listInstalledPackages,
  getInstalledPackageManifest,
} from '../../../src/marketplace/registry.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeManifest(overrides?: Partial<TMarketplaceManifest>): TMarketplaceManifest {
  return {
    manifestVersion: 1,
    name: 'flowweaver-pack-test',
    version: '1.0.0',
    nodeTypes: [],
    workflows: [],
    patterns: [],
    ...overrides,
  };
}

function makeNpmSearchResponse(
  packages: Array<{
    name: string;
    version: string;
    description?: string;
    keywords?: string[];
    publisher?: string;
  }>
) {
  return {
    objects: packages.map((pkg) => ({
      package: {
        name: pkg.name,
        version: pkg.version,
        description: pkg.description,
        keywords: pkg.keywords,
        publisher: pkg.publisher ? { username: pkg.publisher } : undefined,
      },
    })),
    total: packages.length,
  };
}

// ─── Test setup ──────────────────────────────────────────────────────────────

const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.fetch = originalFetch;
});

// ─── searchPackages ──────────────────────────────────────────────────────────

describe('searchPackages', () => {
  it('fetches from npm search endpoint with marketplace keyword', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeNpmSearchResponse([])),
    });
    globalThis.fetch = mockFetch;

    await searchPackages();

    expect(mockFetch).toHaveBeenCalledOnce();
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('registry.npmjs.org');
    expect(calledUrl).toContain('keywords%3Aflowweaver-marketplace-pack');
  });

  it('appends query text to search', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeNpmSearchResponse([])),
    });
    globalThis.fetch = mockFetch;

    await searchPackages({ query: 'openai' });

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('openai');
  });

  it('respects custom limit', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeNpmSearchResponse([])),
    });
    globalThis.fetch = mockFetch;

    await searchPackages({ limit: 5 });

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('size=5');
  });

  it('uses custom registry URL', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeNpmSearchResponse([])),
    });
    globalThis.fetch = mockFetch;

    await searchPackages({ registryUrl: 'https://my-registry.example.com/-/v1/search' });

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('my-registry.example.com');
  });

  it('filters results to match flowweaver-pack-* naming', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeNpmSearchResponse([
        { name: 'flowweaver-pack-openai', version: '1.0.0' },
        { name: 'flowweaver-utils', version: '2.0.0' },
        { name: '@org/flowweaver-pack-stripe', version: '0.5.0' },
        { name: 'unrelated-package', version: '3.0.0' },
      ])),
    });
    globalThis.fetch = mockFetch;

    const results = await searchPackages();

    expect(results).toHaveLength(2);
    expect(results.map((r) => r.name)).toEqual([
      'flowweaver-pack-openai',
      '@org/flowweaver-pack-stripe',
    ]);
  });

  it('maps response fields correctly', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeNpmSearchResponse([
        {
          name: 'flowweaver-pack-openai',
          version: '2.1.0',
          description: 'OpenAI integration',
          keywords: ['flowweaver-marketplace-pack', 'ai'],
          publisher: 'jdoe',
        },
      ])),
    });
    globalThis.fetch = mockFetch;

    const results = await searchPackages();

    expect(results[0]).toEqual({
      name: 'flowweaver-pack-openai',
      version: '2.1.0',
      description: 'OpenAI integration',
      keywords: ['flowweaver-marketplace-pack', 'ai'],
      publisher: 'jdoe',
      official: false,
    });
  });

  it('marks @synergenius packages as official', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeNpmSearchResponse([
        { name: '@synergenius/flowweaver-pack-core', version: '1.0.0' },
      ])),
    });
    globalThis.fetch = mockFetch;

    const results = await searchPackages();

    expect(results[0].official).toBe(true);
  });

  it('marks non-synergenius packages as not official', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeNpmSearchResponse([
        { name: 'flowweaver-pack-community', version: '1.0.0' },
      ])),
    });
    globalThis.fetch = mockFetch;

    const results = await searchPackages();

    expect(results[0].official).toBe(false);
  });

  it('throws on non-ok HTTP responses', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
    });
    globalThis.fetch = mockFetch;

    await expect(searchPackages()).rejects.toThrow('npm search failed: 503 Service Unavailable');
  });

  it('handles empty results', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ objects: [], total: 0 }),
    });
    globalThis.fetch = mockFetch;

    const results = await searchPackages();

    expect(results).toEqual([]);
  });

  it('handles missing publisher gracefully', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeNpmSearchResponse([
        { name: 'flowweaver-pack-anon', version: '1.0.0' },
      ])),
    });
    globalThis.fetch = mockFetch;

    const results = await searchPackages();

    expect(results[0].publisher).toBeUndefined();
  });
});

// ─── listInstalledPackages ───────────────────────────────────────────────────

describe('listInstalledPackages', () => {
  it('returns empty array when node_modules does not exist', async () => {
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);

    const results = await listInstalledPackages('/project');

    expect(results).toEqual([]);
    expect(mockGlob).not.toHaveBeenCalled();
  });

  it('scans both unscoped and scoped package patterns', async () => {
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    mockGlob.mockResolvedValue([]);

    await listInstalledPackages('/project');

    // Called once per pattern (unscoped and scoped)
    expect(mockGlob).toHaveBeenCalledTimes(2);
    const patterns = mockGlob.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(patterns.some((p: string) => p.includes('flowweaver-pack-*') && !p.includes('@*'))).toBe(true);
    expect(patterns.some((p: string) => p.includes('@*') && p.includes('flowweaver-pack-*'))).toBe(true);
  });

  it('returns installed packages with manifest and version from package.json', async () => {
    const existsSyncMock = fs.existsSync as ReturnType<typeof vi.fn>;
    const readFileSyncMock = fs.readFileSync as ReturnType<typeof vi.fn>;

    existsSyncMock.mockReturnValue(true);

    const manifest = makeManifest({ name: 'flowweaver-pack-openai', version: '1.0.0' });
    const manifestPath = '/project/node_modules/flowweaver-pack-openai/flowweaver.manifest.json';

    mockGlob
      .mockResolvedValueOnce([manifestPath])
      .mockResolvedValueOnce([]);

    readFileSyncMock.mockImplementation((p: string) => {
      if (p === manifestPath) return JSON.stringify(manifest);
      if (p.endsWith('package.json')) return JSON.stringify({ version: '1.2.3' });
      throw new Error(`ENOENT: ${p}`);
    });

    const results = await listInstalledPackages('/project');

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      name: 'flowweaver-pack-openai',
      version: '1.2.3', // from package.json, not manifest
      manifest,
      path: '/project/node_modules/flowweaver-pack-openai',
    });
  });

  it('falls back to manifest version when package.json is missing', async () => {
    const existsSyncMock = fs.existsSync as ReturnType<typeof vi.fn>;
    const readFileSyncMock = fs.readFileSync as ReturnType<typeof vi.fn>;

    const manifest = makeManifest({ name: 'flowweaver-pack-slim', version: '0.5.0' });
    const manifestPath = '/project/node_modules/flowweaver-pack-slim/flowweaver.manifest.json';

    existsSyncMock.mockImplementation((p: string) => {
      if (p.endsWith('node_modules')) return true;
      if (p.endsWith('package.json')) return false;
      return true;
    });

    mockGlob
      .mockResolvedValueOnce([manifestPath])
      .mockResolvedValueOnce([]);

    readFileSyncMock.mockImplementation((p: string) => {
      if (p === manifestPath) return JSON.stringify(manifest);
      throw new Error(`ENOENT: ${p}`);
    });

    const results = await listInstalledPackages('/project');

    expect(results).toHaveLength(1);
    expect(results[0].version).toBe('0.5.0');
  });

  it('collects packages from both unscoped and scoped directories', async () => {
    const existsSyncMock = fs.existsSync as ReturnType<typeof vi.fn>;
    const readFileSyncMock = fs.readFileSync as ReturnType<typeof vi.fn>;

    existsSyncMock.mockReturnValue(true);

    const m1 = makeManifest({ name: 'flowweaver-pack-a', version: '1.0.0' });
    const m2 = makeManifest({ name: '@org/flowweaver-pack-b', version: '2.0.0' });

    const mp1 = '/project/node_modules/flowweaver-pack-a/flowweaver.manifest.json';
    const mp2 = '/project/node_modules/@org/flowweaver-pack-b/flowweaver.manifest.json';

    mockGlob
      .mockResolvedValueOnce([mp1])
      .mockResolvedValueOnce([mp2]);

    readFileSyncMock.mockImplementation((p: string) => {
      if (p === mp1) return JSON.stringify(m1);
      if (p === mp2) return JSON.stringify(m2);
      if (p.endsWith('package.json')) return JSON.stringify({ version: '9.9.9' });
      throw new Error(`ENOENT: ${p}`);
    });

    const results = await listInstalledPackages('/project');

    expect(results).toHaveLength(2);
    expect(results.map((r) => r.name)).toEqual(['flowweaver-pack-a', '@org/flowweaver-pack-b']);
  });

  it('skips malformed manifest files without throwing', async () => {
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (fs.readFileSync as ReturnType<typeof vi.fn>).mockImplementation(() => '{ broken json !!!');

    const manifestPath = '/project/node_modules/flowweaver-pack-bad/flowweaver.manifest.json';
    mockGlob
      .mockResolvedValueOnce([manifestPath])
      .mockResolvedValueOnce([]);

    const results = await listInstalledPackages('/project');

    expect(results).toEqual([]);
  });
});

// ─── getInstalledPackageManifest ─────────────────────────────────────────────

describe('getInstalledPackageManifest', () => {
  it('returns the manifest when it exists', () => {
    const manifest = makeManifest({ name: 'flowweaver-pack-test' });

    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify(manifest));

    const result = getInstalledPackageManifest('/project', 'flowweaver-pack-test');

    expect(result).toEqual(manifest);
  });

  it('reads from the correct path', () => {
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify(makeManifest()));

    getInstalledPackageManifest('/project', 'flowweaver-pack-test');

    expect(fs.readFileSync).toHaveBeenCalledWith(
      expect.stringContaining('node_modules/flowweaver-pack-test/flowweaver.manifest.json'),
      'utf-8',
    );
  });

  it('handles scoped packages', () => {
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify(makeManifest()));

    getInstalledPackageManifest('/project', '@org/flowweaver-pack-x');

    expect(fs.readFileSync).toHaveBeenCalledWith(
      expect.stringContaining('node_modules/@org/flowweaver-pack-x/flowweaver.manifest.json'),
      'utf-8',
    );
  });

  it('returns null when the manifest file does not exist', () => {
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);

    const result = getInstalledPackageManifest('/project', 'flowweaver-pack-missing');

    expect(result).toBeNull();
    expect(fs.readFileSync).not.toHaveBeenCalled();
  });

  it('returns null when the manifest is malformed JSON', () => {
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue('not valid json');

    const result = getInstalledPackageManifest('/project', 'flowweaver-pack-broken');

    expect(result).toBeNull();
  });

  it('returns null when readFileSync throws', () => {
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (fs.readFileSync as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('EACCES: permission denied');
    });

    const result = getInstalledPackageManifest('/project', 'flowweaver-pack-noperm');

    expect(result).toBeNull();
  });
});
