import { registerPackMcpTools } from '../../src/mcp/pack-tools.js';

vi.mock('../../src/marketplace/registry.js', () => ({
  listInstalledPackages: vi.fn(),
}));

import { listInstalledPackages } from '../../src/marketplace/registry.js';

const mockList = vi.mocked(listInstalledPackages);

describe('registerPackMcpTools', () => {
  let mockMcp: { tool: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockMcp = { tool: vi.fn() };
    mockList.mockReset();
  });

  it('does nothing when no packs installed', async () => {
    mockList.mockResolvedValue([]);
    await registerPackMcpTools(mockMcp as any);
    // No tools registered
    expect(mockMcp.tool).not.toHaveBeenCalled();
  });

  it('does nothing when packs have no mcpEntrypoint', async () => {
    mockList.mockResolvedValue([{
      name: '@synergenius/flowweaver-pack-test',
      version: '1.0.0',
      manifest: {
        manifestVersion: 1,
        name: '@synergenius/flowweaver-pack-test',
        version: '1.0.0',
        nodeTypes: [],
        workflows: [],
        patterns: [],
      },
      path: '/mock/path',
    }]);
    await registerPackMcpTools(mockMcp as any);
    expect(mockMcp.tool).not.toHaveBeenCalled();
  });

  it('does nothing when packs have empty mcpTools', async () => {
    mockList.mockResolvedValue([{
      name: '@synergenius/flowweaver-pack-test',
      version: '1.0.0',
      manifest: {
        manifestVersion: 1,
        name: '@synergenius/flowweaver-pack-test',
        version: '1.0.0',
        nodeTypes: [],
        workflows: [],
        patterns: [],
        mcpEntrypoint: 'dist/mcp.js',
        mcpTools: [],
      },
      path: '/mock/path',
    }]);
    await registerPackMcpTools(mockMcp as any);
    expect(mockMcp.tool).not.toHaveBeenCalled();
  });

  it('handles listInstalledPackages failure gracefully', async () => {
    mockList.mockRejectedValue(new Error('no node_modules'));
    await registerPackMcpTools(mockMcp as any);
    expect(mockMcp.tool).not.toHaveBeenCalled();
  });

  it('handles import failure gracefully', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    mockList.mockResolvedValue([{
      name: '@synergenius/flowweaver-pack-broken',
      version: '1.0.0',
      manifest: {
        manifestVersion: 1,
        name: '@synergenius/flowweaver-pack-broken',
        version: '1.0.0',
        nodeTypes: [],
        workflows: [],
        patterns: [],
        mcpEntrypoint: 'dist/nonexistent.js',
        mcpTools: [{ name: 'test', description: 'Test' }],
      },
      path: '/mock/broken-pack',
    }]);

    // Should not throw
    await registerPackMcpTools(mockMcp as any);

    stderrSpy.mockRestore();
  });
});
