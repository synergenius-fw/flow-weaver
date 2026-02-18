/**
 * Registry integration — npm search API + local package scanning.
 *
 * Uses the npm registry search endpoint filtered by the
 * `flowweaver-marketplace-pack` keyword for discovery, and scans
 * `node_modules/` for locally installed packages.
 */

import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import type {
  TMarketplaceManifest,
  TMarketplacePackageInfo,
  TInstalledPackage,
} from './types.js';

const MARKETPLACE_KEYWORD = 'flowweaver-marketplace-pack';
const NPM_SEARCH_URL = 'https://registry.npmjs.org/-/v1/search';
const PACK_NAME_RE = /^(@[^/]+\/)?flowweaver-pack-.+$/;

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
 * Search the npm registry for marketplace packages.
 */
export async function searchPackages(options: SearchOptions = {}): Promise<TMarketplacePackageInfo[]> {
  const { query, limit = 20, registryUrl } = options;

  // Build search query: always filter by marketplace keyword
  const textParts = [
    `keywords:${MARKETPLACE_KEYWORD}`,
    ...(query ? [query] : []),
  ];

  const url = new URL(registryUrl ?? NPM_SEARCH_URL);
  url.searchParams.set('text', textParts.join(' '));
  url.searchParams.set('size', String(limit));

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`npm search failed: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as NpmSearchResult;

  return data.objects
    .filter((obj) => PACK_NAME_RE.test(obj.package.name))
    .map((obj) => ({
      name: obj.package.name,
      version: obj.package.version,
      description: obj.package.description,
      keywords: obj.package.keywords,
      publisher: obj.package.publisher?.username,
      official: obj.package.name.startsWith('@synergenius/'),
    }));
}

// ── Local scanning ───────────────────────────────────────────────────────────

/**
 * Scan node_modules for installed marketplace packages by looking for
 * `flowweaver.manifest.json` files in matching package directories.
 */
export async function listInstalledPackages(
  projectDir: string
): Promise<TInstalledPackage[]> {
  const nodeModules = path.join(projectDir, 'node_modules');
  if (!fs.existsSync(nodeModules)) return [];

  // Look for flowweaver-pack-* and @*/flowweaver-pack-* directories
  const patterns = [
    path.join(nodeModules, 'flowweaver-pack-*', 'flowweaver.manifest.json'),
    path.join(nodeModules, '@*', 'flowweaver-pack-*', 'flowweaver.manifest.json'),
  ];

  const results: TInstalledPackage[] = [];

  for (const pattern of patterns) {
    const manifestPaths = await glob(pattern.replace(/\\/g, '/'), { absolute: true });

    for (const manifestPath of manifestPaths) {
      try {
        const pkgDir = path.dirname(manifestPath);
        const manifest: TMarketplaceManifest = JSON.parse(
          fs.readFileSync(manifestPath, 'utf-8')
        );

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
