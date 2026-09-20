/**
 * Registry integration: npm search API plus local package scanning.
 *
 * A pack is a package carrying a `flowweaver.manifest.json` (installed) or
 * the marketplace keyword (on a registry). `flow-weaver-pack-*` is the
 * naming convention, not the test.
 *
 * Uses the npm registry search endpoint filtered by the
 * `flow-weaver-marketplace-pack` keyword for discovery, and scans
 * `node_modules/` for locally installed packages.
 */

import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import type {
  TMarketplaceManifest,
  TMarketplacePackageInfo,
  TInstalledPackage,
  TManifestTagHandler,
  TManifestValidationRuleSet,
  TManifestDocTopic,
  TManifestInitContribution,
} from './types.js';

import { resolveRegistries, PUBLIC_REGISTRY, type Registry } from './npmrc.js';

const MARKETPLACE_KEYWORD = 'flow-weaver-marketplace-pack';
const NPM_SEARCH_URL = 'https://registry.npmjs.org/-/v1/search';
const PACK_NAME_RE = /^(@[^/]+\/)?flow-weaver-pack-.+$/;

/**
 * Whether a registry result is a pack. The keyword is what `market pack`
 * requires and what identifies a pack whatever it is called. The name
 * pattern is kept for packs published before the keyword was required.
 */
export function isPackResult(pkg: { name: string; keywords?: string[] }): boolean {
  return (pkg.keywords ?? []).includes(MARKETPLACE_KEYWORD) || PACK_NAME_RE.test(pkg.name);
}

// ── npm search ───────────────────────────────────────────────────────────────

export interface SearchOptions {
  /** Search query text */
  query?: string;
  /** Maximum number of results (default: 20) */
  limit?: number;
  /** Custom registry search URL (default: public npm registry). Supports private registries like Verdaccio, GitHub Packages, etc. */
  registryUrl?: string;
}

interface NpmSearchResult {
  objects: Array<{
    package: {
      name: string;
      version: string;
      description?: string;
      keywords?: string[];
      publisher?: { username: string };
    };
    score?: { detail?: { popularity?: number } };
    downloads?: { weekly?: number };
  }>;
  total: number;
}

/**
 * One registry's search endpoint, asked and read.
 *
 * The public registry understands `keywords:<kw>` in the text. A private
 * one (Verdaccio, GitHub Packages) matches plain text against names and
 * descriptions, so it is asked for the query itself -- or `flow-weaver`
 * when there is none, since Verdaccio matches that and not the longer
 * hyphenated prefix -- and the name pattern does the filtering either way.
 */
async function searchOne(searchUrl: string, query: string | undefined, limit: number, publicSyntax: boolean, authorization?: string): Promise<TMarketplacePackageInfo[]> {
  const url = new URL(searchUrl);
  const text = publicSyntax
    ? [`keywords:${MARKETPLACE_KEYWORD}`, ...(query ? [query] : [])].join(' ')
    : (query || 'flow-weaver');
  url.searchParams.set('text', text);
  url.searchParams.set('size', String(limit));

  const response = await fetch(url.toString(), authorization ? { headers: { Authorization: authorization } } : undefined);
  if (!response.ok) {
    throw new Error(`npm search failed: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as NpmSearchResult;

  return (data.objects ?? [])
    .filter((obj) => isPackResult(obj.package))
    .map((obj) => ({
      name: obj.package.name,
      version: obj.package.version,
      description: obj.package.description,
      keywords: obj.package.keywords,
      publisher: obj.package.publisher?.username,
      official: obj.package.name.startsWith('@synergenius/'),
    }));
}

/**
 * Search one registry for marketplace packages: the public one, or the
 * search URL given. For every registry a project's npm would use, see
 * {@link searchAllRegistries}.
 */
export async function searchPackages(options: SearchOptions = {}): Promise<TMarketplacePackageInfo[]> {
  const { query, limit = 20, registryUrl } = options;
  const searchUrl = registryUrl ?? NPM_SEARCH_URL;
  const isPublic = searchUrl.startsWith(PUBLIC_REGISTRY);
  // Credentials for a named registry, when .npmrc has them; a config that
  // cannot be read only means the registry is asked without them.
  let authorization: string | undefined;
  if (registryUrl) {
    try { authorization = resolveRegistries(process.cwd()).find((r) => searchUrl.startsWith(r.url))?.authorization; } catch { authorization = undefined; }
  }
  return searchOne(searchUrl, query, limit, isPublic, authorization);
}

export interface RegistrySearched {
  url: string;
  scopes: string[];
  /** Whether `.npmrc` had credentials for it. */
  authenticated: boolean;
  ok: boolean;
  error?: string;
  count: number;
}

export interface MultiRegistrySearch {
  /** Merged, a package once, the first registry that had it winning. */
  results: Array<TMarketplacePackageInfo & { registry: string }>;
  searched: RegistrySearched[];
}

/**
 * Search every registry the project's npm would talk to -- the default and
 * each scoped one from `.npmrc`, with its credentials -- and say which were
 * asked and which answered. One registry failing does not fail the search;
 * it is reported beside the results.
 */
export async function searchAllRegistries(options: { query?: string; limit?: number; projectDir?: string; registries?: Registry[] } = {}): Promise<MultiRegistrySearch> {
  const { query, limit = 20 } = options;
  const registries = options.registries ?? resolveRegistries(options.projectDir ?? process.cwd());
  const results: MultiRegistrySearch['results'] = [];
  const seen = new Set<string>();
  const searched: RegistrySearched[] = [];
  await Promise.all(registries.map(async (r) => {
    const entry: RegistrySearched = { url: r.url, scopes: r.scopes, authenticated: !!r.authorization, ok: false, count: 0 };
    try {
      const found = await searchOne(`${r.url}-/v1/search`, query, limit, r.url === PUBLIC_REGISTRY, r.authorization);
      entry.ok = true;
      entry.count = found.length;
      for (const pkg of found) {
        if (seen.has(pkg.name)) continue;
        seen.add(pkg.name);
        results.push({ ...pkg, registry: new URL(r.url).host });
      }
    } catch (err) {
      entry.error = err instanceof Error ? err.message : String(err);
    }
    searched.push(entry);
  }));
  // Registries in the order they were configured, whatever order they answered in.
  searched.sort((a, b) => registries.findIndex((r) => r.url === a.url) - registries.findIndex((r) => r.url === b.url));
  return { results, searched };
}

// ── Local scanning ───────────────────────────────────────────────────────────

/**
 * The packs installed in a project: every package under `node_modules`,
 * scoped or not, that carries a `flowweaver.manifest.json`.
 *
 * The manifest is the identity. A name like `flow-weaver-pack-*` is the
 * convention and helps a pack be found on a registry, but a package an
 * organisation had to call something else is no less a pack once it is
 * installed, and everything that loads packs -- the parser's tag handlers
 * and rule sets, export targets, docs, CLI and MCP extensions -- goes
 * through here.
 */
export async function listInstalledPackages(
  projectDir: string
): Promise<TInstalledPackage[]> {
  const nodeModules = path.join(projectDir, 'node_modules');
  if (!fs.existsSync(nodeModules)) return [];

  const patterns = [
    path.join(nodeModules, '*', 'flowweaver.manifest.json'),
    path.join(nodeModules, '@*', '*', 'flowweaver.manifest.json'),
  ];

  const results: TInstalledPackage[] = [];
  // The manifest's name is the pack's identity: the same pack reachable
  // under two directories (a link, a nested install) is one pack.
  const seen = new Set<string>();

  for (const pattern of patterns) {
    const manifestPaths = await glob(pattern.replace(/\\/g, '/'), { absolute: true });

    for (const manifestPath of manifestPaths) {
      try {
        const pkgDir = path.dirname(manifestPath);
        const manifest: TMarketplaceManifest = JSON.parse(
          fs.readFileSync(manifestPath, 'utf-8')
        );
        if (seen.has(manifest.name)) continue;
        seen.add(manifest.name);

        // Also read package.json for accurate version
        const pkgJsonPath = path.join(pkgDir, 'package.json');
        let version = manifest.version;
        if (fs.existsSync(pkgJsonPath)) {
          const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
          version = pkg.version ?? manifest.version;
        }

        results.push({
          name: manifest.name,
          version,
          manifest,
          path: pkgDir,
        });
      } catch {
        // Skip malformed manifests
      }
    }
  }

  return results;
}

/**
 * Read the manifest for a specific installed package.
 */
export function getInstalledPackageManifest(
  projectDir: string,
  packageName: string
): TMarketplaceManifest | null {
  const packageDir = path.join(projectDir, 'node_modules', packageName);
  const manifestPath = path.join(packageDir, 'flowweaver.manifest.json');

  if (!fs.existsSync(manifestPath)) return null;

  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  } catch {
    return null;
  }
}

// ── Extension point discovery (manifest v2) ──────────────────────────────────

export type TDiscoveredTagHandler = TManifestTagHandler & {
  /** Absolute path to the handler module */
  absoluteFile: string;
  /** Package name this handler belongs to */
  packageName: string;
};

export type TDiscoveredValidationRuleSet = TManifestValidationRuleSet & {
  /** Absolute path to the rule set module */
  absoluteFile: string;
  /** Package name this rule set belongs to */
  packageName: string;
};

export type TDiscoveredDocTopic = TManifestDocTopic & {
  /** Absolute path to the markdown file */
  absoluteFile: string;
  /** Package name this doc belongs to */
  packageName: string;
};

export type TDiscoveredInitContribution = TManifestInitContribution & {
  /** Package name this contribution belongs to */
  packageName: string;
};

/** A device handler entry point discovered from an installed pack manifest. */
export type TDiscoveredDeviceHandler = {
  /** npm package name */
  packageName: string;
  /** Absolute path to the installed package */
  packagePath: string;
  /** Absolute path to the device handler entrypoint module */
  entrypoint: string;
};

/**
 * Discover all tag handlers from installed pack manifests.
 */
export async function discoverTagHandlers(
  projectDir: string,
): Promise<TDiscoveredTagHandler[]> {
  const packages = await listInstalledPackages(projectDir);
  const handlers: TDiscoveredTagHandler[] = [];

  for (const pkg of packages) {
    const manifest = pkg.manifest;
    if (!manifest.tagHandlers) continue;

    for (const handler of manifest.tagHandlers) {
      handlers.push({
        ...handler,
        absoluteFile: path.join(pkg.path, handler.file),
        packageName: pkg.name,
      });
    }
  }

  return handlers;
}

/**
 * Discover all validation rule sets from installed pack manifests.
 */
export async function discoverValidationRuleSets(
  projectDir: string,
): Promise<TDiscoveredValidationRuleSet[]> {
  const packages = await listInstalledPackages(projectDir);
  const ruleSets: TDiscoveredValidationRuleSet[] = [];

  for (const pkg of packages) {
    const manifest = pkg.manifest;
    if (!manifest.validationRuleSets) continue;

    for (const ruleSet of manifest.validationRuleSets) {
      ruleSets.push({
        ...ruleSet,
        absoluteFile: path.join(pkg.path, ruleSet.file),
        packageName: pkg.name,
      });
    }
  }

  return ruleSets;
}

/**
 * Discover all doc topics from installed pack manifests.
 */
export async function discoverDocTopics(
  projectDir: string,
): Promise<TDiscoveredDocTopic[]> {
  const packages = await listInstalledPackages(projectDir);
  const topics: TDiscoveredDocTopic[] = [];

  for (const pkg of packages) {
    const manifest = pkg.manifest;
    if (!manifest.docs) continue;

    for (const doc of manifest.docs) {
      topics.push({
        ...doc,
        absoluteFile: path.join(pkg.path, doc.file),
        packageName: pkg.name,
      });
    }
  }

  return topics;
}

/**
 * Discover all init contributions from installed pack manifests.
 */
export async function discoverInitContributions(
  projectDir: string,
): Promise<TDiscoveredInitContribution[]> {
  const packages = await listInstalledPackages(projectDir);
  const contributions: TDiscoveredInitContribution[] = [];

  for (const pkg of packages) {
    const manifest = pkg.manifest;
    if (!manifest.initContributions) continue;

    contributions.push({
      ...manifest.initContributions,
      packageName: pkg.name,
    });
  }

  return contributions;
}

