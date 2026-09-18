// Load built-in extensions (CI/CD, etc.) before tool registration
import '../extensions/index.js';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { McpServerOptions } from './types.js';
import { registerQueryTools } from './tools-query.js';
import { registerTemplateTools } from './tools-template.js';
import { registerPatternTools } from './tools-pattern.js';
import { registerExportTools } from './tools-export.js';
import { registerMarketplaceTools } from './tools-marketplace.js';
import { registerDiagramTools } from './tools-diagram.js';
import { registerDocsTools } from './tools-docs.js';
import { registerDebugTools } from './tools-debug.js';
import { registerWorkflowRunTools } from './tools-workflow-run.js';
import { registerRunTools } from './tools-run.js';
import { registerContextTools } from './tools-context.js';
import { registerResourceTools } from './tools-resources.js';
import { registerPrompts } from './prompts.js';
import { registerPackMcpTools } from './pack-tools.js';
import { loadPackDocTopics } from '../docs/pack-topics.js';

export async function startMcpServer(options: McpServerOptions): Promise<void> {
  // Create MCP server
  const mcp = new McpServer({
    name: 'flow-weaver',
    version: '1.0.0',
  });

  // Pack doc topics feed fw_docs and fw_context; load them before any tool
  // can be called, from the same working directory pack tools are read from.
  await loadPackDocTopics();

  // Register all tools
  registerQueryTools(mcp);
  registerTemplateTools(mcp);
  registerPatternTools(mcp);
  registerExportTools(mcp);
  registerMarketplaceTools(mcp);
  registerDiagramTools(mcp);
  registerDocsTools(mcp);
  registerDebugTools(mcp);
  registerWorkflowRunTools(mcp);
  registerRunTools(mcp);
  registerContextTools(mcp);
  registerResourceTools(mcp);
  registerPrompts(mcp);
  await registerPackMcpTools(mcp);

  // Connect transport (only in stdio MCP mode)
  if (options.stdio) {
    const transport = new StdioServerTransport();
    await mcp.connect(transport);
  }
}

export async function mcpServerCommand(options: McpServerOptions): Promise<void> {
  // In stdio mode, stdout is reserved for JSON-RPC — log to stderr.
  // In interactive mode, log to stdout (write + flush to survive SIGTERM).
  const log = options.stdio
    ? (msg: string) => process.stderr.write(msg + '\n')
    : (msg: string) => process.stdout.write(msg + '\n');

  if (!options.stdio) {
    log('Tip: run "fw mcp-setup" to register with your AI tools.');
    log('Starting MCP server...');
  }

  await startMcpServer(options);

  if (!options.stdio) {
    log('MCP server running. Waiting for connections...');
  }

  // Keep alive
  await new Promise(() => {});
}
