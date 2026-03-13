vi.mock('../../src/extensions/index', () => ({}));

let lastMcpConfig: unknown = null;
const mockConnect = vi.fn().mockResolvedValue(undefined);

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => {
  return {
    McpServer: class FakeMcpServer {
      tool = vi.fn();
      registerPrompt = vi.fn();
      connect = mockConnect;
      constructor(config: unknown) {
        lastMcpConfig = config;
      }
    },
  };
});

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: class FakeTransport {},
}));

vi.mock('../../src/mcp/tools-query', () => ({ registerQueryTools: vi.fn() }));
vi.mock('../../src/mcp/tools-template', () => ({ registerTemplateTools: vi.fn() }));
vi.mock('../../src/mcp/tools-pattern', () => ({ registerPatternTools: vi.fn() }));
vi.mock('../../src/mcp/tools-export', () => ({ registerExportTools: vi.fn() }));
vi.mock('../../src/mcp/tools-marketplace', () => ({ registerMarketplaceTools: vi.fn() }));
vi.mock('../../src/mcp/tools-diagram', () => ({ registerDiagramTools: vi.fn() }));
vi.mock('../../src/mcp/tools-docs', () => ({ registerDocsTools: vi.fn() }));
vi.mock('../../src/mcp/tools-model', () => ({ registerModelTools: vi.fn() }));
vi.mock('../../src/mcp/tools-debug', () => ({ registerDebugTools: vi.fn() }));
vi.mock('../../src/mcp/tools-context', () => ({ registerContextTools: vi.fn() }));
vi.mock('../../src/mcp/prompts', () => ({ registerPrompts: vi.fn() }));
vi.mock('../../src/mcp/pack-tools', () => ({ registerPackMcpTools: vi.fn().mockResolvedValue(undefined) }));

import { startMcpServer, mcpServerCommand } from '../../src/mcp/server';
import { registerQueryTools } from '../../src/mcp/tools-query';
import { registerTemplateTools } from '../../src/mcp/tools-template';
import { registerPatternTools } from '../../src/mcp/tools-pattern';
import { registerExportTools } from '../../src/mcp/tools-export';
import { registerMarketplaceTools } from '../../src/mcp/tools-marketplace';
import { registerDiagramTools } from '../../src/mcp/tools-diagram';
import { registerDocsTools } from '../../src/mcp/tools-docs';
import { registerModelTools } from '../../src/mcp/tools-model';
import { registerDebugTools } from '../../src/mcp/tools-debug';
import { registerContextTools } from '../../src/mcp/tools-context';
import { registerPrompts } from '../../src/mcp/prompts';
import { registerPackMcpTools } from '../../src/mcp/pack-tools';

describe('startMcpServer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastMcpConfig = null;
  });

  it('creates an McpServer with name and version', async () => {
    await startMcpServer({ stdio: false });
    expect(lastMcpConfig).toEqual({ name: 'flow-weaver', version: '1.0.0' });
  });

  it('registers all tool groups and prompts', async () => {
    await startMcpServer({ stdio: false });
    expect(registerQueryTools).toHaveBeenCalled();
    expect(registerTemplateTools).toHaveBeenCalled();
    expect(registerPatternTools).toHaveBeenCalled();
    expect(registerExportTools).toHaveBeenCalled();
    expect(registerMarketplaceTools).toHaveBeenCalled();
    expect(registerDiagramTools).toHaveBeenCalled();
    expect(registerDocsTools).toHaveBeenCalled();
    expect(registerModelTools).toHaveBeenCalled();
    expect(registerDebugTools).toHaveBeenCalled();
    expect(registerContextTools).toHaveBeenCalled();
    expect(registerPrompts).toHaveBeenCalled();
    expect(registerPackMcpTools).toHaveBeenCalled();
  });

  it('connects stdio transport when stdio option is true', async () => {
    await startMcpServer({ stdio: true });
    expect(mockConnect).toHaveBeenCalled();
  });

  it('does not connect transport when stdio is false', async () => {
    await startMcpServer({ stdio: false });
    expect(mockConnect).not.toHaveBeenCalled();
  });
});

describe('mcpServerCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('logs tip and startup messages when not in stdio mode', async () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    // mcpServerCommand awaits a never-resolving promise at the end, so race it
    mcpServerCommand({ stdio: false });
    await new Promise((r) => setTimeout(r, 50));

    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('mcp-setup'));
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('Starting MCP server'));
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('Waiting for connections'));

    stdoutSpy.mockRestore();
  });

  it('does not log to stdout in stdio mode', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    mcpServerCommand({ stdio: true });
    await new Promise((r) => setTimeout(r, 50));

    expect(stdoutSpy).not.toHaveBeenCalled();

    stderrSpy.mockRestore();
    stdoutSpy.mockRestore();
  });
});
