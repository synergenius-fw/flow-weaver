/**
 * Registers CLI commands contributed by installed marketplace packs.
 *
 * Scans for packs with cliCommands in their manifest. For each pack,
 * registers a Commander subcommand group under the pack namespace
 * (e.g., @synergenius/flow-weaver-pack-weaver -> "weaver").
 *
 * Command handlers are lazy: the pack's cliEntrypoint is only imported
 * when the user actually invokes a pack command.
 */

import * as path from 'path';
import { pathToFileURL } from 'node:url';
import type { Command } from 'commander';
import { listInstalledPackages } from '../marketplace/registry.js';
import type { TInstalledPackage } from '../marketplace/types.js';
import { VERSION } from '../generated-version.js';

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
  const current = VERSION;

  if (compareVersions(current, minVersion) < 0) {
    console.warn(
      `\x1b[33mWarning: ${pkg.name} requires flow-weaver >=${minVersion} but ${current} is installed.\x1b[0m`,
    );
    console.warn(
      `\x1b[33mRun: npm install @synergenius/flow-weaver@latest\x1b[0m`,
    );
  }
}

/**
 * Derive a short namespace from a pack's npm name.
 * @synergenius/flow-weaver-pack-weaver -> weaver
 * flow-weaver-pack-gitlab-ci -> gitlab-ci
 */
function deriveNamespace(packageName: string): string {
  const base = packageName.replace(/^@[^/]+\//, '');
  return base.replace(/^flow-weaver-pack-/, '');
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

    checkPackEngineVersion(pkg);

    const namespace = deriveNamespace(pkg.name);
    const entrypointPath = path.join(pkg.path, manifest.cliEntrypoint);

    const group = program
      .command(namespace)
      .description(`Commands from ${pkg.name}`);

    // Override Commander's auto-generated help with the pack's grouped help.
    // Intercept both bare `weaver` (action) and `weaver --help` (helpCommand).
    const showPackHelp = async () => {
      try {
        const bridge = await import(pathToFileURL(entrypointPath).href);
        if (typeof bridge.printHelp === 'function') {
          bridge.printHelp();
          return;
        }
      } catch { /* fall through */ }
      group.outputHelp();
    };
    group.action(showPackHelp);
    group.command('help').description('Show help').action(showPackHelp);
    group.helpOption(false); // disable --help so it doesn't trigger Commander's default
    group.option('-h, --help', 'Show help');
    group.hook('preAction', async (thisCmd) => {
      if (thisCmd.opts().help) {
        await showPackHelp();
        process.exit(0);
      }
    });

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
          const bridge = await import(pathToFileURL(entrypointPath).href);
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
