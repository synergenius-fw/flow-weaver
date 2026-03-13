vi.mock('../../src/marketplace/registry', () => ({
  listInstalledPackages: vi.fn(),
}));

vi.mock('../../src/generated-version', () => ({
  VERSION: '0.20.0',
}));

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerPackMcpTools } from '../../src/mcp/pack-tools';
import { listInstalledPackages } from '../../src/marketplace/registry';
import type { TInstalledPackage } from '../../src/marketplace/types';

const mockListInstalled = vi.mocked(listInstalledPackages);

function createMockMcp(): McpServer {
  return {} as McpServer;
}

function makePkg(overrides: Partial<TInstalledPackage> = {}): TInstalledPackage {
  return {
    name: 'flow-weaver-pack-test',
    version: '1.0.0',
    path: '/fake/node_modules/flow-weaver-pack-test',
    manifest: {
      manifestVersion: 2,
      name: 'flow-weaver-pack-test',
      version: '1.0.0',
      nodeTypes: [],
      workflows: [],
      patterns: [],
      mcpEntrypoint: 'dist/mcp.js',
      mcpTools: [{ name: 'test_tool', description: 'A test tool' }],
      ...overrides.manifest,
    } as TInstalledPackage['manifest'],
    ...overrides,
  };
}

describe('registerPackMcpTools', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns silently when listInstalledPackages throws', async () => {
    mockListInstalled.mockRejectedValue(new Error('no packages dir'));
    const mcp = createMockMcp();

    await expect(registerPackMcpTools(mcp)).resolves.toBeUndefined();
  });

  it('skips packages without mcpEntrypoint', async () => {
    const pkg = makePkg();
    pkg.manifest.mcpEntrypoint = undefined;
    mockListInstalled.mockResolvedValue([pkg]);

    const mcp = createMockMcp();
    await registerPackMcpTools(mcp);
    // No error, no import attempted
  });

  it('skips packages with empty mcpTools array', async () => {
    const pkg = makePkg();
    pkg.manifest.mcpTools = [];
    mockListInstalled.mockResolvedValue([pkg]);

    const mcp = createMockMcp();
    await registerPackMcpTools(mcp);
  });

  it('logs warning when pack requires newer engine version', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    const pkg = makePkg();
    // VERSION is mocked as '0.20.0', require something higher
    pkg.manifest.engineVersion = '>=99.0.0';
    // Make the import fail so we don't need a real module
    mockListInstalled.mockResolvedValue([pkg]);

    const mcp = createMockMcp();
    await registerPackMcpTools(mcp);

    const calls = stderrSpy.mock.calls.map((c) => String(c[0]));
    const warningCall = calls.find((c) => c.includes('requires flow-weaver'));
    expect(warningCall).toBeTruthy();
    expect(warningCall).toContain('>=99.0.0');

    stderrSpy.mockRestore();
  });

  it('does not warn when engine version is satisfied', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    const pkg = makePkg();
    pkg.manifest.engineVersion = '>=0.1.0';
    mockListInstalled.mockResolvedValue([pkg]);

    const mcp = createMockMcp();
    await registerPackMcpTools(mcp);

    const calls = stderrSpy.mock.calls.map((c) => String(c[0]));
    const warningCall = calls.find((c) => c.includes('requires flow-weaver'));
    expect(warningCall).toBeUndefined();

    stderrSpy.mockRestore();
  });

  it('does not warn when no engineVersion is specified', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    const pkg = makePkg();
    pkg.manifest.engineVersion = undefined;
    mockListInstalled.mockResolvedValue([pkg]);

    const mcp = createMockMcp();
    await registerPackMcpTools(mcp);

    const calls = stderrSpy.mock.calls.map((c) => String(c[0]));
    const warningCall = calls.find((c) => c.includes('requires flow-weaver'));
    expect(warningCall).toBeUndefined();

    stderrSpy.mockRestore();
  });

  it('logs error to stderr when import fails', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    const pkg = makePkg();
    pkg.path = '/nonexistent/path';
    mockListInstalled.mockResolvedValue([pkg]);

    const mcp = createMockMcp();
    await registerPackMcpTools(mcp);

    const calls = stderrSpy.mock.calls.map((c) => String(c[0]));
    const errorCall = calls.find((c) => c.includes('Failed to load pack tools'));
    expect(errorCall).toBeTruthy();
    expect(errorCall).toContain(pkg.name);

    stderrSpy.mockRestore();
  });
});

describe('compareVersions (via checkPackEngineVersion)', () => {
  // We test the version comparison logic indirectly through checkPackEngineVersion
  it('handles version with > prefix', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    const pkg = makePkg();
    pkg.manifest.engineVersion = '>99.0.0';
    mockListInstalled.mockResolvedValue([pkg]);

    const mcp = createMockMcp();
    await registerPackMcpTools(mcp);

    const calls = stderrSpy.mock.calls.map((c) => String(c[0]));
    const warningCall = calls.find((c) => c.includes('requires flow-weaver'));
    expect(warningCall).toBeTruthy();

    stderrSpy.mockRestore();
  });

  it('handles equal versions (no warning)', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    const pkg = makePkg();
    pkg.manifest.engineVersion = '>=0.20.0'; // exactly our mocked VERSION
    mockListInstalled.mockResolvedValue([pkg]);

    const mcp = createMockMcp();
    await registerPackMcpTools(mcp);

    const calls = stderrSpy.mock.calls.map((c) => String(c[0]));
    const warningCall = calls.find((c) => c.includes('requires flow-weaver'));
    expect(warningCall).toBeUndefined();

    stderrSpy.mockRestore();
  });
});
