import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock marketplace module ───────────────────────────────────────────────────
const mockSearchPackages = vi.fn();
const mockListInstalledPackages = vi.fn();
const mockGetInstalledPackageManifest = vi.fn();

vi.mock('../../../src/marketplace/index.js', () => ({
  searchPackages: (...args: unknown[]) => mockSearchPackages(...args),
  listInstalledPackages: (...args: unknown[]) => mockListInstalledPackages(...args),
  getInstalledPackageManifest: (...args: unknown[]) => mockGetInstalledPackageManifest(...args),
}));

// ── Mock child_process ────────────────────────────────────────────────────────
const mockExecSync = vi.fn();

vi.mock('child_process', () => ({
  execSync: (...args: unknown[]) => mockExecSync(...args),
}));

// ── Mock MCP SDK ──────────────────────────────────────────────────────────────
const toolHandlers = new Map<string, (args: unknown) => Promise<unknown>>();

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => {
  class MockMcpServer {
    tool(
      name: string,
      _description: string,
      schema: Record<string, unknown> | (() => Promise<unknown>),
      handler?: (args: unknown) => Promise<unknown>,
    ): void {
      // mcp.tool can be called with or without schema
      if (typeof schema === 'function') {
        toolHandlers.set(name, schema as (args: unknown) => Promise<unknown>);
      } else if (handler) {
        toolHandlers.set(name, handler);
      }
    }
  }
  return { McpServer: MockMcpServer };
});

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerMarketplaceTools } from '../../../src/mcp/tools-marketplace.js';

function parseResult(result: unknown): { success: boolean; data?: unknown; error?: unknown } {
  const r = result as { content: Array<{ text: string }>; isError?: boolean };
  return JSON.parse(r.content[0].text);
}

describe('tools-marketplace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    toolHandlers.clear();
    const mcp = new McpServer({ name: 'test', version: '1.0.0' });
    registerMarketplaceTools(mcp);
  });

  // ── fw_market_search ────────────────────────────────────────────────────────

  describe('fw_market_search', () => {
    function callSearch(args: Record<string, unknown>) {
      const handler = toolHandlers.get('fw_market_search')!;
      expect(handler).toBeDefined();
      return handler(args);
    }

    it('returns matching packages', async () => {
      mockSearchPackages.mockResolvedValue([
        {
          name: 'flowweaver-pack-openai',
          version: '1.2.0',
          description: 'OpenAI node types',
          official: true,
          publisher: 'synergenius',
        },
      ]);

      const result = parseResult(await callSearch({ query: 'openai' }));
      expect(result.success).toBe(true);
      const data = result.data as { count: number; packages: unknown[]; hint: string };
      expect(data.count).toBe(1);
      expect(data.packages).toHaveLength(1);
      expect(data.hint).toContain('fw_market_install');
    });

    it('returns empty results with helpful hint', async () => {
      mockSearchPackages.mockResolvedValue([]);

      const result = parseResult(await callSearch({ query: 'nonexistent' }));
      expect(result.success).toBe(true);
      const data = result.data as { count: number; hint: string };
      expect(data.count).toBe(0);
      expect(data.hint).toContain('No packages found');
    });

    it('passes limit and registryUrl through to searchPackages', async () => {
      mockSearchPackages.mockResolvedValue([]);

      await callSearch({ query: 'test', limit: 5, registryUrl: 'https://custom.registry.io' });
      expect(mockSearchPackages).toHaveBeenCalledWith({
        query: 'test',
        limit: 5,
        registryUrl: 'https://custom.registry.io',
      });
    });

    it('searches with no query to browse all packages', async () => {
      mockSearchPackages.mockResolvedValue([
        { name: 'flowweaver-pack-a', version: '1.0.0', description: 'A', official: false, publisher: 'user' },
      ]);

      const result = parseResult(await callSearch({}));
      expect(result.success).toBe(true);
      expect(mockSearchPackages).toHaveBeenCalledWith({
        query: undefined,
        limit: undefined,
        registryUrl: undefined,
      });
    });

    it('handles search failures', async () => {
      mockSearchPackages.mockRejectedValue(new Error('network timeout'));

      const result = parseResult(await callSearch({ query: 'test' }));
      expect(result.success).toBe(false);
      expect((result.error as { code: string }).code).toBe('SEARCH_FAILED');
      expect((result.error as { message: string }).message).toContain('network timeout');
    });
  });

  // ── fw_market_install ───────────────────────────────────────────────────────

  describe('fw_market_install', () => {
    function callInstall(args: Record<string, unknown>) {
      const handler = toolHandlers.get('fw_market_install')!;
      expect(handler).toBeDefined();
      return handler(args);
    }

    it('installs a package and returns manifest info', async () => {
      mockExecSync.mockReturnValue(Buffer.from('added 1 package'));
      mockGetInstalledPackageManifest.mockReturnValue({
        version: '2.0.0',
        nodeTypes: [
          { name: 'OpenAIChat', description: 'Chat completion', inputs: { prompt: {} }, outputs: { response: {} } },
        ],
        workflows: [{ name: 'summarize', description: 'Summarize text' }],
        patterns: [{ name: 'retry', description: 'Retry pattern' }],
      });

      const result = parseResult(await callInstall({ package: 'flowweaver-pack-openai' }));
      expect(result.success).toBe(true);
      const data = result.data as {
        installed: string;
        version: string;
        nodeTypes: unknown[];
        workflows: unknown[];
        patterns: unknown[];
      };
      expect(data.installed).toBe('flowweaver-pack-openai');
      expect(data.version).toBe('2.0.0');
      expect(data.nodeTypes).toHaveLength(1);
      expect(data.workflows).toHaveLength(1);
      expect(data.patterns).toHaveLength(1);
    });

    it('handles package without manifest', async () => {
      mockExecSync.mockReturnValue(Buffer.from('added 1 package'));
      mockGetInstalledPackageManifest.mockReturnValue(null);

      const result = parseResult(await callInstall({ package: 'some-plain-pkg' }));
      expect(result.success).toBe(true);
      const data = result.data as { installed: string; note: string };
      expect(data.installed).toBe('some-plain-pkg');
      expect(data.note).toContain('no flowweaver.manifest.json');
    });

    it('handles scoped package without version specifier', async () => {
      mockExecSync.mockReturnValue(Buffer.from('ok'));
      mockGetInstalledPackageManifest.mockReturnValue(null);

      const result = parseResult(await callInstall({ package: '@scope/flowweaver-pack' }));
      expect(result.success).toBe(true);
      const data = result.data as { installed: string };
      expect(data.installed).toBe('@scope/flowweaver-pack');
    });

    it('strips version from scoped package specifier', async () => {
      mockExecSync.mockReturnValue(Buffer.from('ok'));
      mockGetInstalledPackageManifest.mockReturnValue(null);

      const result = parseResult(await callInstall({ package: '@scope/flowweaver-pack@1.0.0' }));
      expect(result.success).toBe(true);
      const data = result.data as { installed: string };
      expect(data.installed).toBe('@scope/flowweaver-pack');
    });

    it('strips version from unscoped package specifier', async () => {
      mockExecSync.mockReturnValue(Buffer.from('ok'));
      mockGetInstalledPackageManifest.mockReturnValue(null);

      const result = parseResult(await callInstall({ package: 'flowweaver-pack-x@2.3.1' }));
      expect(result.success).toBe(true);
      const data = result.data as { installed: string };
      expect(data.installed).toBe('flowweaver-pack-x');
    });

    it('handles npm install failure', async () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('npm ERR! 404 Not Found');
      });

      const result = parseResult(await callInstall({ package: 'nonexistent-pkg' }));
      expect(result.success).toBe(false);
      expect((result.error as { code: string }).code).toBe('INSTALL_FAILED');
    });
  });

  // ── fw_market_list ──────────────────────────────────────────────────────────

  describe('fw_market_list', () => {
    function callList() {
      const handler = toolHandlers.get('fw_market_list')!;
      expect(handler).toBeDefined();
      return handler({});
    }

    it('returns installed packages with manifests', async () => {
      mockListInstalledPackages.mockResolvedValue([
        {
          name: 'flowweaver-pack-openai',
          version: '1.0.0',
          path: '/project/node_modules/flowweaver-pack-openai',
          manifest: {
            nodeTypes: [{ name: 'Chat', description: 'LLM chat' }],
            workflows: [],
            patterns: [{ name: 'retry', description: 'Retry' }],
          },
        },
      ]);

      const result = parseResult(await callList());
      expect(result.success).toBe(true);
      const data = result.data as { count: number; packages: unknown[] };
      expect(data.count).toBe(1);
    });

    it('maps workflows and patterns from installed packages', async () => {
      mockListInstalledPackages.mockResolvedValue([
        {
          name: 'flowweaver-pack-full',
          version: '2.0.0',
          path: '/project/node_modules/flowweaver-pack-full',
          manifest: {
            nodeTypes: [{ name: 'NodeA', description: 'A node' }],
            workflows: [
              { name: 'emailFlow', description: 'Sends emails' },
              { name: 'slackFlow', description: 'Posts to Slack' },
            ],
            patterns: [
              { name: 'retry', description: 'Retry pattern' },
            ],
          },
        },
      ]);

      const result = parseResult(await callList());
      expect(result.success).toBe(true);
      const data = result.data as {
        packages: Array<{
          workflows: Array<{ name: string; description: string }>;
          patterns: Array<{ name: string; description: string }>;
          nodeTypes: Array<{ name: string; description: string }>;
        }>;
      };
      expect(data.packages[0].workflows).toHaveLength(2);
      expect(data.packages[0].workflows[0].name).toBe('emailFlow');
      expect(data.packages[0].workflows[1].name).toBe('slackFlow');
      expect(data.packages[0].patterns).toHaveLength(1);
      expect(data.packages[0].nodeTypes).toHaveLength(1);
    });

    it('returns empty list with hint', async () => {
      mockListInstalledPackages.mockResolvedValue([]);

      const result = parseResult(await callList());
      expect(result.success).toBe(true);
      const data = result.data as { count: number; hint: string };
      expect(data.count).toBe(0);
      expect(data.hint).toContain('fw_market_search');
    });

    it('handles list failure', async () => {
      mockListInstalledPackages.mockRejectedValue(new Error('read error'));

      const result = parseResult(await callList());
      expect(result.success).toBe(false);
      expect((result.error as { code: string }).code).toBe('LIST_FAILED');
    });
  });
});
