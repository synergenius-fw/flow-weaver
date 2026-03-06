/**
 * Registers MCP tools contributed by installed marketplace packs.
 *
 * Scans for packs with mcpEntrypoint in their manifest. For each,
 * imports the entrypoint and calls its registerMcpTools(mcp) function.
 */

import * as path from 'path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { listInstalledPackages } from '../marketplace/registry.js';

export async function registerPackMcpTools(mcp: McpServer): Promise<void> {
  const projectDir = process.cwd();
  let packages;
  try {
    packages = await listInstalledPackages(projectDir);
  } catch {
    return;
  }

  for (const pkg of packages) {
    const manifest = pkg.manifest;
    if (!manifest.mcpEntrypoint || !manifest.mcpTools?.length) continue;

    const entrypointPath = path.join(pkg.path, manifest.mcpEntrypoint);

    try {
      const mod = await import(entrypointPath);
      if (typeof mod.registerMcpTools === 'function') {
        await mod.registerMcpTools(mcp);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // Log to stderr so it doesn't interfere with MCP JSON-RPC on stdout
      process.stderr.write(`[mcp] Failed to load pack tools from ${pkg.name}: ${msg}\n`);
    }
  }
}
