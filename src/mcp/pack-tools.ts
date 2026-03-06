/**
 * Registers MCP tools contributed by installed marketplace packs.
 *
 * Scans for packs with mcpEntrypoint in their manifest. For each,
 * imports the entrypoint and calls its registerMcpTools(mcp) function.
 */

import * as path from 'path';
import { createRequire } from 'node:module';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { listInstalledPackages } from '../marketplace/registry.js';
import type { TInstalledPackage } from '../marketplace/types.js';

function getEngineVersion(): string {
  try {
    const req = createRequire(import.meta.url);
    const pkg = req('../../package.json');
    return pkg.version as string;
  } catch {
    return '0.0.0';
  }
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function checkPackEngineVersion(pkg: TInstalledPackage): void {
  const required = pkg.manifest.engineVersion;
  if (!required) return;

  const minVersion = required.replace(/^>=?\s*/, '');
  const current = getEngineVersion();
  if (current === '0.0.0') return;

  if (compareVersions(current, minVersion) < 0) {
    process.stderr.write(
      `\x1b[33mWarning: ${pkg.name} requires flow-weaver >=${minVersion} but ${current} is installed.\x1b[0m\n`,
    );
    process.stderr.write(
      `\x1b[33mRun: npm install @synergenius/flow-weaver@latest\x1b[0m\n`,
    );
  }
}

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

    checkPackEngineVersion(pkg);

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
