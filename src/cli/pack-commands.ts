/**
 * Registers CLI commands contributed by installed marketplace packs.
 *
 * Scans for packs with cliCommands in their manifest. For each pack,
 * registers a Commander subcommand group under the pack namespace
 * (e.g., @synergenius/flowweaver-pack-weaver -> "weaver").
 *
 * Command handlers are lazy: the pack's cliEntrypoint is only imported
 * when the user actually invokes a pack command.
 */

import * as path from 'path';
import type { Command } from 'commander';
import { listInstalledPackages } from '../marketplace/registry.js';

/**
 * Derive a short namespace from a pack's npm name.
 * @synergenius/flowweaver-pack-weaver -> weaver
 * flowweaver-pack-gitlab-ci -> gitlab-ci
 */
function deriveNamespace(packageName: string): string {
  const base = packageName.replace(/^@[^/]+\//, '');
  return base.replace(/^flowweaver-pack-/, '');
}

export async function registerPackCommands(program: Command): Promise<void> {
  const projectDir = process.cwd();
  let packages;
  try {
    packages = await listInstalledPackages(projectDir);
  } catch {
    return;
  }

  for (const pkg of packages) {
    const manifest = pkg.manifest;
    if (!manifest.cliEntrypoint || !manifest.cliCommands?.length) continue;

    const namespace = deriveNamespace(pkg.name);
    const entrypointPath = path.join(pkg.path, manifest.cliEntrypoint);

    const group = program
      .command(namespace)
      .description(`Commands from ${pkg.name}`);

    for (const cmd of manifest.cliCommands) {
      const sub = group
        .command(cmd.name)
        .description(cmd.description);

      if (cmd.usage) {
        sub.argument(cmd.usage);
      }

      if (cmd.options) {
        for (const opt of cmd.options) {
          if (opt.default !== undefined) {
            sub.option(opt.flags, opt.description, String(opt.default));
          } else {
            sub.option(opt.flags, opt.description);
          }
        }
      }

      // Lazy handler: only import the pack's bridge when invoked
      sub.allowUnknownOption(true);
      sub.action(async (...actionArgs: unknown[]) => {
        try {
          const bridge = await import(entrypointPath);
          // Collect raw args from the sub command
          const rawArgs = sub.args ?? [];
          await bridge.handleCommand(cmd.name, rawArgs);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`Error running ${namespace} ${cmd.name}: ${msg}`);
          process.exit(1);
        }
      });
    }
  }
}
