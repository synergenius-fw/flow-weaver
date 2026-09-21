import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock marketplace module ───────────────────────────────────────────────────
const mockSearchPackages = vi.fn();
const mockSearchAllRegistries = vi.fn();
const mockListInstalledPackages = vi.fn();
const mockGetInstalledPackageManifest = vi.fn();

vi.mock('../../../src/marketplace/index.js', () => ({
  searchPackages: (...args: unknown[]) => mockSearchPackages(...args),
  searchAllRegistries: (...args: unknown[]) => mockSearchAllRegistries(...args),
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

    it('returns matching packages from every configured registry, saying which had them', async () => {
      mockSearchAllRegistries.mockResolvedValue({
        results: [
          { name: 'flow-weaver-pack-openai', version: '1.2.0', description: 'OpenAI node types', official: true, publisher: 'synergenius', registry: 'registry.npmjs.org' },
          { name: '@acme/flow-weaver-pack-audio', version: '0.3.0', official: false, registry: 'npm.acme.dev' },
        ],
        searched: [
          { url: 'https://registry.npmjs.org/', scopes: [], authenticated: false, ok: true, count: 1 },
          { url: 'https://npm.acme.dev/', scopes: ['@acme'], authenticated: true, ok: true, count: 1 },
        ],
      });

      const result = parseResult(await callSearch({ query: 'openai' }));
      expect(result.success).toBe(true);
      const data = result.data as { count: number; packages: Array<{ registry: string }>; searched: Array<{ url: string; ok: boolean }>; hint: string };
      expect(data.count).toBe(2);
      expect(data.packages[1].registry).toBe('npm.acme.dev');
      expect(data.searched.map((s) => s.url)).toEqual(['https://registry.npmjs.org/', 'https://npm.acme.dev/']);
      expect(data.hint).toContain('fw_market_install');
      expect(mockSearchAllRegistries).toHaveBeenCalledWith({ query: 'openai', limit: undefined, projectDir: process.cwd() });
      expect(mockSearchPackages).not.toHaveBeenCalled();
    });

    it('returns empty results with helpful hint', async () => {
      mockSearchAllRegistries.mockResolvedValue({ results: [], searched: [] });

      const result = parseResult(await callSearch({ query: 'nonexistent' }));
      expect(result.success).toBe(true);
      const data = result.data as { count: number; hint: string };
      expect(data.count).toBe(0);
      expect(data.hint).toContain('No packs found');
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
      mockSearchAllRegistries.mockResolvedValue({
        results: [{ name: 'flow-weaver-pack-a', version: '1.0.0', description: 'A', official: false, publisher: 'user', registry: 'registry.npmjs.org' }],
        searched: [],
      });

      const result = parseResult(await callSearch({}));
      expect(result.success).toBe(true);
      expect(mockSearchAllRegistries).toHaveBeenCalledWith({ query: undefined, limit: undefined, projectDir: process.cwd() });
    });

    it('handles search failures', async () => {
      mockSearchAllRegistries.mockRejectedValue(new Error('network timeout'));

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
      });

      const result = parseResult(await callInstall({ package: 'flow-weaver-pack-openai' }));
      expect(result.success).toBe(true);
      const data = result.data as {
        installed: string;
        version: string;
        nodeTypes: unknown[];
        workflows: unknown[];
      };
      expect(data.installed).toBe('flow-weaver-pack-openai');
      expect(data.version).toBe('2.0.0');
      expect(data.nodeTypes).toHaveLength(1);
      expect(data.workflows).toHaveLength(1);
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

      const result = parseResult(await callInstall({ package: '@scope/flow-weaver-pack' }));
      expect(result.success).toBe(true);
      const data = result.data as { installed: string };
      expect(data.installed).toBe('@scope/flow-weaver-pack');
    });

    it('strips version from scoped package specifier', async () => {
      mockExecSync.mockReturnValue(Buffer.from('ok'));
      mockGetInstalledPackageManifest.mockReturnValue(null);

      const result = parseResult(await callInstall({ package: '@scope/flow-weaver-pack@1.0.0' }));
      expect(result.success).toBe(true);
      const data = result.data as { installed: string };
      expect(data.installed).toBe('@scope/flow-weaver-pack');
    });

    it('strips version from unscoped package specifier', async () => {
      mockExecSync.mockReturnValue(Buffer.from('ok'));
      mockGetInstalledPackageManifest.mockReturnValue(null);

      const result = parseResult(await callInstall({ package: 'flow-weaver-pack-x@2.3.1' }));
      expect(result.success).toBe(true);
      const data = result.data as { installed: string };
      expect(data.installed).toBe('flow-weaver-pack-x');
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
          name: 'flow-weaver-pack-openai',
          version: '1.0.0',
          path: '/project/node_modules/flow-weaver-pack-openai',
          manifest: {
            nodeTypes: [{ name: 'Chat', description: 'LLM chat' }],
            workflows: [],
          },
        },
      ]);

      const result = parseResult(await callList());
      expect(result.success).toBe(true);
      const data = result.data as { count: number; packages: unknown[] };
      expect(data.count).toBe(1);
    });

    it('maps workflows from installed packages', async () => {
      mockListInstalledPackages.mockResolvedValue([
        {
          name: 'flow-weaver-pack-full',
          version: '2.0.0',
          path: '/project/node_modules/flow-weaver-pack-full',
          manifest: {
            nodeTypes: [{ name: 'NodeA', description: 'A node' }],
            workflows: [
              { name: 'emailFlow', description: 'Sends emails' },
              { name: 'slackFlow', description: 'Posts to Slack' },
            ],
          },
        },
      ]);

      const result = parseResult(await callList());
      expect(result.success).toBe(true);
      const data = result.data as {
        packages: Array<{
          workflows: Array<{ name: string; description: string }>;
          nodeTypes: Array<{ name: string; description: string }>;
        }>;
      };
      expect(data.packages[0].workflows).toHaveLength(2);
      expect(data.packages[0].workflows[0].name).toBe('emailFlow');
      expect(data.packages[0].workflows[1].name).toBe('slackFlow');
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
