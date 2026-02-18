/**
 * MCP Marketplace Tools — fw_market_search, fw_market_install, fw_market_list
 *
 * Allows Claude Code to discover, install, and inspect marketplace packages
 * during vibe coding sessions.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import * as path from 'path';
import { execSync } from 'child_process';
import {
  searchPackages,
  listInstalledPackages,
  getInstalledPackageManifest,
} from '../marketplace/index.js';
import { makeToolResult, makeErrorResult } from './response-utils.js';

export function registerMarketplaceTools(mcp: McpServer): void {
  // ── fw_market_search ─────────────────────────────────────────────────────

  mcp.tool(
    'fw_market_search',
    'Search npm for Flow Weaver marketplace packages (node types, workflows, patterns). Returns package name, version, and description.',
    {
      query: z.string().optional().describe('Search query text (optional — omit to browse all)'),
      limit: z
        .number()
        .optional()
        .describe('Maximum number of results (default: 20)'),
      registryUrl: z
        .string()
        .optional()
        .describe('Custom registry search URL for private registries (default: public npm)'),
    },
    async (args: { query?: string; limit?: number; registryUrl?: string }) => {
      try {
        const results = await searchPackages({
          query: args.query,
          limit: args.limit,
          registryUrl: args.registryUrl,
        });

        return makeToolResult({
          count: results.length,
          packages: results.map((pkg) => ({
            name: pkg.name,
            version: pkg.version,
            description: pkg.description,
            official: pkg.official,
            publisher: pkg.publisher,
          })),
          hint: results.length > 0
            ? 'Use fw_market_install to install a package'
            : 'No packages found — try a different query or browse all with no query',
        });
      } catch (err) {
        return makeErrorResult(
          'SEARCH_FAILED',
          err instanceof Error ? err.message : String(err)
        );
      }
    }
  );

  // ── fw_market_install ────────────────────────────────────────────────────

  mcp.tool(
    'fw_market_install',
    'Install a Flow Weaver marketplace package via npm. After installation, the package\'s node types, workflows, and patterns become available for use.',
    {
      package: z.string().describe('Package name or specifier (e.g., "flowweaver-pack-openai" or "flowweaver-pack-openai@1.0.0")'),
    },
    async (args: { package: string }) => {
      try {
        // Run npm install
        execSync(`npm install ${args.package}`, {
          cwd: process.cwd(),
          stdio: 'pipe',
        });

        // Try to read the manifest
        const packageName = resolvePackageName(args.package);
        const manifest = getInstalledPackageManifest(process.cwd(), packageName);

        if (manifest) {
          return makeToolResult({
            installed: packageName,
            version: manifest.version,
            nodeTypes: manifest.nodeTypes.map((nt) => ({
              name: nt.name,
              description: nt.description,
              inputs: Object.keys(nt.inputs),
              outputs: Object.keys(nt.outputs),
            })),
            workflows: manifest.workflows.map((wf) => ({
              name: wf.name,
              description: wf.description,
            })),
            patterns: manifest.patterns.map((p) => ({
              name: p.name,
              description: p.description,
            })),
          });
        }

        return makeToolResult({
          installed: packageName,
          note: 'Package installed but no flowweaver.manifest.json found',
        });
      } catch (err) {
        return makeErrorResult(
          'INSTALL_FAILED',
          err instanceof Error ? err.message : String(err)
        );
      }
    }
  );

  // ── fw_market_list ───────────────────────────────────────────────────────

  mcp.tool(
    'fw_market_list',
    'List installed Flow Weaver marketplace packages in the current project. Shows available node types, workflows, and patterns from each package.',
    {},
    async () => {
      try {
        const packages = await listInstalledPackages(process.cwd());

        return makeToolResult({
          count: packages.length,
          packages: packages.map((pkg) => ({
            name: pkg.name,
            version: pkg.version,
            path: pkg.path,
            nodeTypes: pkg.manifest.nodeTypes.map((nt) => ({
              name: nt.name,
              description: nt.description,
            })),
            workflows: pkg.manifest.workflows.map((wf) => ({
              name: wf.name,
              description: wf.description,
            })),
            patterns: pkg.manifest.patterns.map((p) => ({
              name: p.name,
              description: p.description,
            })),
          })),
          hint: packages.length === 0
            ? 'No marketplace packages installed. Use fw_market_search to find packages.'
            : undefined,
        });
      } catch (err) {
        return makeErrorResult(
          'LIST_FAILED',
          err instanceof Error ? err.message : String(err)
        );
      }
    }
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function resolvePackageName(spec: string): string {
  if (spec.startsWith('@')) {
    const atIndex = spec.indexOf('@', 1);
    return atIndex > 0 ? spec.slice(0, atIndex) : spec;
  }
  const atIndex = spec.indexOf('@');
  return atIndex > 0 ? spec.slice(0, atIndex) : spec;
}
