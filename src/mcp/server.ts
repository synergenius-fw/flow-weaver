import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { McpServerOptions, EventFilterConfig } from './types.js';
import { DEFAULT_SERVER_URL } from '../defaults.js';
import { EventBuffer } from './event-buffer.js';
import { EditorConnection } from './editor-connection.js';
import { offerClaudeRegistration } from './auto-registration.js';
import { registerEditorTools } from './tools-editor.js';
import { registerQueryTools } from './tools-query.js';
import { registerTemplateTools } from './tools-template.js';
import { registerPatternTools } from './tools-pattern.js';
import { registerExportTools } from './tools-export.js';
import { registerMarketplaceTools } from './tools-marketplace.js';
import { registerDiagramTools } from './tools-diagram.js';
import { registerResources } from './resources.js';

function parseEventFilterFromEnv(): Partial<EventFilterConfig> {
  const filter: Partial<EventFilterConfig> = {};
  const include = process.env.FW_EVENT_INCLUDE;
  if (include) {
    filter.include = include
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  const exclude = process.env.FW_EVENT_EXCLUDE;
  if (exclude) {
    filter.exclude = exclude
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  const dedupeMs = process.env.FW_EVENT_DEDUPE_MS;
  if (dedupeMs) {
    const parsed = parseInt(dedupeMs, 10);
    if (!isNaN(parsed)) filter.dedupeWindowMs = parsed;
  }
  const maxBuf = process.env.FW_EVENT_MAX;
  if (maxBuf) {
    const parsed = parseInt(maxBuf, 10);
    if (!isNaN(parsed)) filter.maxBufferSize = parsed;
  }
  return filter;
}

export async function startMcpServer(options: McpServerOptions): Promise<void> {
  const serverUrl = options.server || DEFAULT_SERVER_URL;

  // Parse event filter config from environment variables
  const filterFromEnv = parseEventFilterFromEnv();

  // Use injected deps for testing, or create real ones
  const buffer = options._testDeps?.buffer ?? new EventBuffer(undefined, undefined, filterFromEnv);
  const connection = options._testDeps?.connection ?? new EditorConnection(serverUrl, buffer);

  // Connect to editor (non-blocking)
  if (!options._testDeps) {
    const log = options.stdio
      ? (msg: string) => process.stderr.write(msg + '\n')
      : // eslint-disable-next-line no-console
        (msg: string) => console.log(msg);
    connection.connect(log);
  }

  // Create MCP server
  const mcp = new McpServer({
    name: 'flow-weaver',
    version: '1.0.0',
  });

  // Register all tools and resources
  registerEditorTools(mcp, connection, buffer);
  registerQueryTools(mcp);
  registerTemplateTools(mcp);
  registerPatternTools(mcp);
  registerExportTools(mcp);
  registerMarketplaceTools(mcp);
  registerDiagramTools(mcp);
  registerResources(mcp, connection, buffer);

  // Connect transport (only in stdio MCP mode)
  if (!options._testDeps && options.stdio) {
    const transport = new StdioServerTransport();
    await mcp.connect(transport);
  }
}

export async function mcpServerCommand(options: McpServerOptions): Promise<void> {
  const serverUrl = options.server || DEFAULT_SERVER_URL;
  // In stdio mode, stdout is reserved for JSON-RPC — log to stderr.
  // In interactive mode, log to stdout (write + flush to survive SIGTERM).
  const log = options.stdio
    ? (msg: string) => process.stderr.write(msg + '\n')
    : (msg: string) => process.stdout.write(msg + '\n');

  if (!options.stdio) {
    // Interactive mode — offer registration first
    await offerClaudeRegistration(options);
    log(`Starting MCP server (editor: ${serverUrl})...`);
  }

  await startMcpServer(options);

  if (!options.stdio) {
    log('MCP server running. Waiting for connections...');
  }

  // Keep alive
  await new Promise(() => {});
}
