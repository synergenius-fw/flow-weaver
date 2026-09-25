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
import type {
  TManifestCliArgument,
  TPackCliCommandContext,
  TPackCliOptionValue,
} from '../marketplace/types.js';
import { VERSION } from '../generated-version.js';
import { logger } from './utils/logger.js';

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
    logger.warn(`${pkg.name} requires flow-weaver >=${minVersion} but ${current} is installed. Run: npm install @synergenius/flow-weaver@latest`);
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

    // A namespace that is already a command (a built-in, or another pack's)
    // cannot be added; commander throws. That pack loses its commands, the
    // rest of the CLI must still work.
    if (program.commands.some((c) => c.name() === namespace || c.aliases().includes(namespace))) {
      logger.warn(`${pkg.name}: its command namespace "${namespace}" is already taken, so its commands are not available`);
      continue;
    }
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

      const commandArguments = cmd.arguments ?? legacyArguments(cmd.usage);
      for (const argument of commandArguments) {
        sub.argument(argument.syntax, argument.description, argument.default);
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
      sub.action(async (..._actionArgs: unknown[]) => {
        try {
          const bridge = await import(pathToFileURL(entrypointPath).href);
          const context: TPackCliCommandContext = Object.freeze({
            args: Object.freeze([...(sub.args ?? [])]),
            options: freezeOptions(sub.opts()),
            cwd: process.cwd(),
          });
          if (typeof bridge.handleCommandV2 === 'function') {
            await bridge.handleCommandV2(cmd.name, context);
          } else if (typeof bridge.handleCommand === 'function') {
            // Backward compatibility for v1 packs. New packs use the parsed
            // context so they never reach into process.argv.
            await bridge.handleCommand(cmd.name, context.args);
          } else {
            throw new TypeError('pack CLI entrypoint exports neither handleCommandV2 nor handleCommand');
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`Error running ${namespace} ${cmd.name}: ${msg}`);
          process.exit(1);
        }
      });
    }
  }
}

function legacyArguments(usage: string | undefined): TManifestCliArgument[] {
  if (usage === undefined || usage.trim() === '') return [];
  return usage.trim().split(/\s+/u).map((syntax) => ({ syntax }));
}

function freezeOptions(input: Record<string, unknown>): Readonly<Record<string, TPackCliOptionValue>> {
  const output: Record<string, TPackCliOptionValue> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      output[key] = value;
      continue;
    }
    if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) {
      output[key] = Object.freeze([...value]) as readonly string[];
      continue;
    }
    if (value !== undefined) {
      throw new TypeError(`pack CLI option ${key} produced a non-serializable value`);
    }
  }
  return Object.freeze(output);
}
