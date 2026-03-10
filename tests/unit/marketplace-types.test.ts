import type {
  TMarketplaceManifest,
  TManifestCliCommand,
  TManifestMcpTool,
} from '../../src/marketplace/types.js';

describe('marketplace types', () => {
  it('TManifestCliCommand shape is correct', () => {
    const cmd: TManifestCliCommand = {
      name: 'run',
      description: 'Run a workflow',
      usage: '<file>',
      options: [
        { flags: '-v, --verbose', description: 'Verbose', default: false },
      ],
    };
    expect(cmd.name).toBe('run');
    expect(cmd.options).toHaveLength(1);
  });

  it('TManifestMcpTool shape is correct', () => {
    const tool: TManifestMcpTool = {
      name: 'fw_test_run',
      description: 'Run a test',
    };
    expect(tool.name).toBe('fw_test_run');
  });

  it('TMarketplaceManifest accepts CLI and MCP fields', () => {
    const manifest: TMarketplaceManifest = {
      manifestVersion: 2,
      name: 'flow-weaver-pack-test',
      version: '1.0.0',
      nodeTypes: [],
      workflows: [],
      patterns: [],
      cliEntrypoint: 'dist/cli-bridge.js',
      cliCommands: [{ name: 'run', description: 'Run' }],
      mcpEntrypoint: 'dist/mcp-tools.js',
      mcpTools: [{ name: 'fw_test_run', description: 'Run' }],
    };
    expect(manifest.cliCommands).toHaveLength(1);
    expect(manifest.mcpTools).toHaveLength(1);
  });

  it('TMarketplaceManifest works without CLI and MCP fields', () => {
    const manifest: TMarketplaceManifest = {
      manifestVersion: 2,
      name: 'flow-weaver-pack-basic',
      version: '1.0.0',
      nodeTypes: [],
      workflows: [],
      patterns: [],
    };
    expect(manifest.cliEntrypoint).toBeUndefined();
    expect(manifest.cliCommands).toBeUndefined();
    expect(manifest.mcpEntrypoint).toBeUndefined();
    expect(manifest.mcpTools).toBeUndefined();
  });
});
