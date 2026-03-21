import * as path from 'path';
import { Command } from 'commander';
import { registerPackCommands } from '../../src/cli/pack-commands.js';

// Mock listInstalledPackages to return controlled data
vi.mock('../../src/marketplace/registry.js', () => ({
  listInstalledPackages: vi.fn(),
}));

import { listInstalledPackages } from '../../src/marketplace/registry.js';

const mockList = vi.mocked(listInstalledPackages);

describe('registerPackCommands', () => {
  let program: Command;

  beforeEach(() => {
    program = new Command();
    program.name('flow-weaver');
    mockList.mockReset();
  });

  it('does nothing when no packs installed', async () => {
    mockList.mockResolvedValue([]);
    await registerPackCommands(program);
    expect(program.commands).toHaveLength(0);
  });

  it('does nothing when packs have no cliCommands', async () => {
    mockList.mockResolvedValue([{
      name: '@synergenius/flow-weaver-pack-test',
      version: '1.0.0',
      manifest: {
        manifestVersion: 2,
        name: '@synergenius/flow-weaver-pack-test',
        version: '1.0.0',
        nodeTypes: [],
        workflows: [],
        patterns: [],
      },
      path: '/mock/path',
    }]);
    await registerPackCommands(program);
    expect(program.commands).toHaveLength(0);
  });

  it('registers subcommand group from pack namespace', async () => {
    mockList.mockResolvedValue([{
      name: '@synergenius/flow-weaver-pack-weaver',
      version: '0.4.0',
      manifest: {
        manifestVersion: 2,
        name: '@synergenius/flow-weaver-pack-weaver',
        version: '0.4.0',
        nodeTypes: [],
        workflows: [],
        patterns: [],
        cliEntrypoint: 'dist/cli-bridge.js',
        cliCommands: [
          { name: 'run', description: 'Run a workflow' },
          { name: 'history', description: 'List runs' },
        ],
      },
      path: '/mock/weaver-pack',
    }]);

    await registerPackCommands(program);

    // Should have a "weaver" subcommand group
    const weaverCmd = program.commands.find(c => c.name() === 'weaver');
    expect(weaverCmd).toBeDefined();
    // +1 for the auto-registered 'help' subcommand
    const packCmds = weaverCmd!.commands.filter(c => c.name() !== 'help');
    expect(packCmds).toHaveLength(2);
    expect(packCmds[0]!.name()).toBe('run');
    expect(packCmds[1]!.name()).toBe('history');
  });

  it('derives namespace correctly from scoped package', async () => {
    mockList.mockResolvedValue([{
      name: '@myorg/flow-weaver-pack-gitlab-ci',
      version: '1.0.0',
      manifest: {
        manifestVersion: 2,
        name: '@myorg/flow-weaver-pack-gitlab-ci',
        version: '1.0.0',
        nodeTypes: [],
        workflows: [],
        patterns: [],
        cliEntrypoint: 'dist/bridge.js',
        cliCommands: [{ name: 'deploy', description: 'Deploy' }],
      },
      path: '/mock/gitlab-pack',
    }]);

    await registerPackCommands(program);

    const cmd = program.commands.find(c => c.name() === 'gitlab-ci');
    expect(cmd).toBeDefined();
  });

  it('derives namespace correctly from unscoped package', async () => {
    mockList.mockResolvedValue([{
      name: 'flow-weaver-pack-docker',
      version: '1.0.0',
      manifest: {
        manifestVersion: 2,
        name: 'flow-weaver-pack-docker',
        version: '1.0.0',
        nodeTypes: [],
        workflows: [],
        patterns: [],
        cliEntrypoint: 'dist/bridge.js',
        cliCommands: [{ name: 'build', description: 'Build image' }],
      },
      path: '/mock/docker-pack',
    }]);

    await registerPackCommands(program);

    const cmd = program.commands.find(c => c.name() === 'docker');
    expect(cmd).toBeDefined();
  });

  it('handles listInstalledPackages failure gracefully', async () => {
    mockList.mockRejectedValue(new Error('no node_modules'));
    await registerPackCommands(program);
    expect(program.commands).toHaveLength(0);
  });

  it('registers commands with usage and options', async () => {
    mockList.mockResolvedValue([{
      name: '@synergenius/flow-weaver-pack-test',
      version: '1.0.0',
      manifest: {
        manifestVersion: 2,
        name: '@synergenius/flow-weaver-pack-test',
        version: '1.0.0',
        nodeTypes: [],
        workflows: [],
        patterns: [],
        cliEntrypoint: 'dist/bridge.js',
        cliCommands: [{
          name: 'run',
          description: 'Run something',
          usage: '<file>',
          options: [
            { flags: '-v, --verbose', description: 'Verbose output' },
            { flags: '--port <number>', description: 'Port', default: '3000' },
          ],
        }],
      },
      path: '/mock/test-pack',
    }]);

    await registerPackCommands(program);

    const group = program.commands.find(c => c.name() === 'test');
    expect(group).toBeDefined();
    const runCmd = group!.commands.find(c => c.name() === 'run')!;
    expect(runCmd).toBeDefined();
    expect(runCmd.options).toHaveLength(2);
  });
});
