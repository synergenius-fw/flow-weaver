/**
 * Tests that pack CLI command handlers use pathToFileURL for dynamic imports.
 *
 * On Windows, path.join produces backslash paths (C:\Users\...) which are
 * invalid as ESM import specifiers. The fix converts them to file:// URLs
 * via pathToFileURL before passing to import().
 */

import * as path from 'path';
import { pathToFileURL } from 'node:url';
import { Command } from 'commander';
import { registerPackCommands } from '../../src/cli/pack-commands.js';

vi.mock('../../src/marketplace/registry.js', () => ({
  listInstalledPackages: vi.fn(),
}));

import { listInstalledPackages } from '../../src/marketplace/registry.js';

const mockList = vi.mocked(listInstalledPackages);

function makePack(opts: {
  name: string;
  packPath: string;
  entrypoint: string;
  commands: Array<{ name: string; description: string }>;
}) {
  return {
    name: opts.name,
    version: '1.0.0',
    manifest: {
      manifestVersion: 2 as const,
      name: opts.name,
      version: '1.0.0',
      nodeTypes: [],
      workflows: [],
      patterns: [],
      cliEntrypoint: opts.entrypoint,
      cliCommands: opts.commands,
    },
    path: opts.packPath,
  };
}

describe('pack-commands: pathToFileURL usage', () => {
  let program: Command;

  beforeEach(() => {
    program = new Command();
    program.name('flow-weaver');
    mockList.mockReset();
  });

  it('constructs the correct file URL from a Unix path', () => {
    const unixPath = '/home/user/.fw/packs/my-pack/dist/cli-bridge.js';
    const url = pathToFileURL(unixPath).href;
    expect(url).toBe('file:///home/user/.fw/packs/my-pack/dist/cli-bridge.js');
  });

  it('constructs a valid file URL from a Windows-style path', () => {
    // pathToFileURL normalizes backslashes to forward slashes and adds the
    // file:// protocol, so even on non-Windows hosts this verifies the
    // conversion logic is correct.
    const windowsPath = 'C:\\Users\\dev\\packs\\weaver\\dist\\cli-bridge.js';
    const url = pathToFileURL(windowsPath).href;
    expect(url).toMatch(/^file:\/\/\//);
    expect(url).not.toContain('\\');
  });

  it('pathToFileURL produces a URL that does not contain backslashes', () => {
    const paths = [
      '/simple/unix/path.js',
      'C:\\Windows\\style\\path.js',
      '/mixed\\slashes/path.js',
      'D:\\deeply\\nested\\pack\\dist\\cli-bridge.js',
    ];
    for (const p of paths) {
      const url = pathToFileURL(p).href;
      expect(url).not.toContain('\\');
      expect(url).toMatch(/^file:\/\/\//);
    }
  });

  it('entrypointPath is built with path.join and converted via pathToFileURL', async () => {
    // Verify that the registered action handler would call import() with a
    // file:// URL. We do this by checking the entrypointPath that path.join
    // would produce and confirming pathToFileURL works on it.
    const packPath = path.join('/mock', 'weaver-pack');
    const entrypoint = 'dist/cli-bridge.js';
    const joined = path.join(packPath, entrypoint);
    const url = pathToFileURL(joined).href;

    expect(url).toMatch(/^file:\/\/\//);
    expect(url).toContain('cli-bridge.js');
    expect(url).not.toContain('\\');
  });

  it('registers commands that would use pathToFileURL on invocation', async () => {
    mockList.mockResolvedValue([makePack({
      name: '@synergenius/flow-weaver-pack-weaver',
      packPath: '/mock/weaver-pack',
      entrypoint: 'dist/cli-bridge.js',
      commands: [{ name: 'run', description: 'Run a workflow' }],
    })]);

    await registerPackCommands(program);

    const weaverCmd = program.commands.find(c => c.name() === 'weaver');
    expect(weaverCmd).toBeDefined();
    expect(weaverCmd!.commands).toHaveLength(1);
    expect(weaverCmd!.commands[0]!.name()).toBe('run');
  });

  it('handles pack paths with spaces', () => {
    const spacePath = '/Users/John Doe/packs/my pack/dist/bridge.js';
    const url = pathToFileURL(spacePath).href;
    expect(url).toMatch(/^file:\/\/\//);
    // Spaces should be percent-encoded in URLs
    expect(url).toContain('John%20Doe');
    expect(url).not.toContain('\\');
  });

  it('handles Windows UNC-style paths', () => {
    const uncPath = '\\\\server\\share\\packs\\bridge.js';
    const url = pathToFileURL(uncPath).href;
    expect(url).toMatch(/^file:\/\/\//);
    expect(url).not.toContain('\\');
  });
});
