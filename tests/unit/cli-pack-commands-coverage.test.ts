/**
 * Coverage tests for src/cli/pack-commands.ts
 * Targets uncovered lines: 33-40 (checkPackEngineVersion warning),
 * 100-108 (lazy handler error path)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';

// Mock the marketplace registry and generated-version modules
vi.mock('../../src/marketplace/registry.js', () => ({
  listInstalledPackages: vi.fn(),
}));

vi.mock('../../src/generated-version.js', () => ({
  VERSION: '0.10.0',
}));

describe('registerPackCommands', () => {
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prints engine version warning when pack requires newer version (lines 33-40)', async () => {
    const { listInstalledPackages } = await import('../../src/marketplace/registry.js');
    const { registerPackCommands } = await import('../../src/cli/pack-commands');

    (listInstalledPackages as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        name: '@synergenius/flow-weaver-pack-example',
        version: '1.0.0',
        path: '/fake/node_modules/@synergenius/flow-weaver-pack-example',
        manifest: {
          manifestVersion: 2,
          name: '@synergenius/flow-weaver-pack-example',
          version: '1.0.0',
          engineVersion: '>=99.0.0',
          nodeTypes: [],
          workflows: [],
          patterns: [],
          cliEntrypoint: 'dist/cli.js',
          cliCommands: [
            { name: 'run', description: 'Run something' },
          ],
        },
      },
    ]);

    const program = new Command();
    await registerPackCommands(program);

    // Should have printed the engine version warning (lines 37-42)
    expect(consoleWarnSpy).toHaveBeenCalled();
    const warnCalls = consoleWarnSpy.mock.calls.map(c => c[0]);
    expect(warnCalls.some((m: string) => m.includes('requires flow-weaver >=99.0.0'))).toBe(true);
  });

  it('does not warn when pack engine version is satisfied', async () => {
    const { listInstalledPackages } = await import('../../src/marketplace/registry.js');
    const { registerPackCommands } = await import('../../src/cli/pack-commands');

    (listInstalledPackages as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        name: '@synergenius/flow-weaver-pack-ok',
        version: '1.0.0',
        path: '/fake/node_modules/@synergenius/flow-weaver-pack-ok',
        manifest: {
          manifestVersion: 2,
          name: '@synergenius/flow-weaver-pack-ok',
          version: '1.0.0',
          engineVersion: '>=0.1.0',
          nodeTypes: [],
          workflows: [],
          patterns: [],
          cliEntrypoint: 'dist/cli.js',
          cliCommands: [
            { name: 'status', description: 'Show status' },
          ],
        },
      },
    ]);

    const program = new Command();
    await registerPackCommands(program);

    // No warning should have been printed
    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });

  it('silently returns when listInstalledPackages throws', async () => {
    const { listInstalledPackages } = await import('../../src/marketplace/registry.js');
    const { registerPackCommands } = await import('../../src/cli/pack-commands');

    (listInstalledPackages as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('no node_modules'));

    const program = new Command();
    // Should not throw
    await registerPackCommands(program);
  });

  it('skips packages without cliEntrypoint or cliCommands', async () => {
    const { listInstalledPackages } = await import('../../src/marketplace/registry.js');
    const { registerPackCommands } = await import('../../src/cli/pack-commands');

    (listInstalledPackages as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        name: '@synergenius/flow-weaver-pack-nocli',
        version: '1.0.0',
        path: '/fake/path',
        manifest: {
          manifestVersion: 2,
          name: '@synergenius/flow-weaver-pack-nocli',
          version: '1.0.0',
          nodeTypes: [],
          workflows: [],
          patterns: [],
          // No cliEntrypoint, no cliCommands
        },
      },
    ]);

    const program = new Command();
    await registerPackCommands(program);
    // No subcommands should have been added
    expect(program.commands.length).toBe(0);
  });

  it('registers commands with options and usage', async () => {
    const { listInstalledPackages } = await import('../../src/marketplace/registry.js');
    const { registerPackCommands } = await import('../../src/cli/pack-commands');

    (listInstalledPackages as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        name: '@synergenius/flow-weaver-pack-full',
        version: '1.0.0',
        path: '/fake/node_modules/@synergenius/flow-weaver-pack-full',
        manifest: {
          manifestVersion: 2,
          name: '@synergenius/flow-weaver-pack-full',
          version: '1.0.0',
          nodeTypes: [],
          workflows: [],
          patterns: [],
          cliEntrypoint: 'dist/cli.js',
          cliCommands: [
            {
              name: 'deploy',
              description: 'Deploy workflow',
              usage: '<file>',
              options: [
                { flags: '-e, --env <env>', description: 'Environment', default: 'dev' },
                { flags: '-f, --force', description: 'Force deploy' },
              ],
            },
          ],
        },
      },
    ]);

    const program = new Command();
    await registerPackCommands(program);

    // Should have registered the 'full' namespace with 'deploy' subcommand
    const group = program.commands.find(c => c.name() === 'full');
    expect(group).toBeDefined();
    const deploy = group!.commands.find(c => c.name() === 'deploy');
    expect(deploy).toBeDefined();
  });

  it('handles error in lazy action handler (lines 100-108)', async () => {
    const { listInstalledPackages } = await import('../../src/marketplace/registry.js');
    const { registerPackCommands } = await import('../../src/cli/pack-commands');

    (listInstalledPackages as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        name: 'flow-weaver-pack-broken',
        version: '1.0.0',
        path: '/nonexistent/path',
        manifest: {
          manifestVersion: 2,
          name: 'flow-weaver-pack-broken',
          version: '1.0.0',
          nodeTypes: [],
          workflows: [],
          patterns: [],
          cliEntrypoint: 'dist/cli.js',
          cliCommands: [
            { name: 'run', description: 'Run something' },
          ],
        },
      },
    ]);

    const program = new Command();
    program.exitOverride(); // Prevent Commander from calling process.exit
    await registerPackCommands(program);

    // Find the registered command and invoke its action directly
    const group = program.commands.find(c => c.name() === 'broken');
    expect(group).toBeDefined();
    const runCmd = group!.commands.find(c => c.name() === 'run');
    expect(runCmd).toBeDefined();

    // Mock process.exit to prevent test from exiting
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as never);

    try {
      // Invoke the action handler directly. It will try to import the entrypoint
      // which doesn't exist, triggering the catch block (lines 105-108).
      // Commander wraps the action args, so we simulate by calling parseAsync.
      await group!.parseAsync(['run'], { from: 'user' });
    } catch {
      // Expected: process.exit(1) or commander exit
    }

    // Verify the error was logged
    expect(consoleErrorSpy).toHaveBeenCalled();
    const errorCalls = consoleErrorSpy.mock.calls.map(c => c[0]);
    expect(errorCalls.some((m: string) => typeof m === 'string' && m.includes('Error running broken run'))).toBe(true);

    exitSpy.mockRestore();
  });
});
