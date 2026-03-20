/**
 * MCP bridge — creates a Unix domain socket server that the MCP tool server
 * connects to for executing tools. Also generates the temporary MCP config
 * and tool definition files needed by the Claude CLI.
 *
 * Usage:
 *   const bridge = await createMcpBridge(tools, executor, onToolEvent);
 *   // pass bridge.configPath to --mcp-config
 *   // ...run CLI...
 *   bridge.cleanup();
 */

import * as net from 'node:net';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';
import type { ToolDefinition, ToolExecutor, ToolEvent, McpBridge, Logger } from './types.js';

/**
 * Create an MCP bridge that the Claude CLI can connect to for tool execution.
 *
 * @param tools       Tool definitions to advertise to the CLI
 * @param executor    Function that executes a tool call
 * @param onToolEvent Optional callback for relaying tool events
 * @param logger      Optional logger
 */
export async function createMcpBridge(
  tools: ToolDefinition[],
  executor: ToolExecutor,
  onToolEvent?: (event: ToolEvent) => void,
  logger?: Logger,
): Promise<McpBridge> {
  // Create temp directory for bridge files
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-mcp-bridge-'));
  fs.chmodSync(tmpDir, 0o700);

  const socketPath = path.join(tmpDir, 'bridge.sock');
  const defsPath = path.join(tmpDir, 'tools.json');
  const configPath = path.join(tmpDir, 'mcp-config.json');

  // Write tool definitions in MCP format
  const mcpToolDefs = tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));
  fs.writeFileSync(defsPath, JSON.stringify(mcpToolDefs), 'utf-8');

  // Resolve the MCP tool server script path.
  // In prod: sibling .js file. In dev (tsx): sibling .ts file.
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const jsPath = path.resolve(__dirname, 'mcp-tool-server.js');
  const tsPath = path.resolve(__dirname, 'mcp-tool-server.ts');
  const scriptPath = fs.existsSync(jsPath) ? jsPath : tsPath;

  // In dev the script is .ts — use tsx as the loader.
  const mcpCommand = process.execPath; // node
  let mcpArgs = [scriptPath];
  if (scriptPath.endsWith('.ts')) {
    // Look for tsx in the package's node_modules
    const tsxCli = path.resolve(__dirname, '../../node_modules/tsx/dist/cli.mjs');
    if (fs.existsSync(tsxCli)) {
      mcpArgs = [tsxCli, scriptPath];
    }
  }

  // Write MCP config
  const mcpConfig = {
    mcpServers: {
      'fw-agent': {
        type: 'stdio',
        command: mcpCommand,
        args: mcpArgs,
        env: {
          FW_TOOL_SOCKET: socketPath,
          FW_TOOL_DEFS: defsPath,
        },
      },
    },
  };
  fs.writeFileSync(configPath, JSON.stringify(mcpConfig), 'utf-8');

  // Mutable handlers — swapped per request via setHandlers()
  let currentExecutor = executor;
  let currentOnToolEvent = onToolEvent;

  // Create Unix domain socket server.
  // The tool server sends a newline-terminated JSON request and waits for a
  // JSON response on the same connection.
  const server = net.createServer((conn) => {
    let buf = '';
    conn.on('data', async (chunk) => {
      buf += chunk.toString();
      const nlIdx = buf.indexOf('\n');
      if (nlIdx === -1) return; // wait for complete line

      const line = buf.slice(0, nlIdx).trim();
      buf = ''; // consume — one request per connection

      try {
        const { name, args } = JSON.parse(line);
        currentOnToolEvent?.({ type: 'tool_call_start', name, args });
        const { result, isError } = await currentExecutor(name, args);
        currentOnToolEvent?.({ type: 'tool_call_result', name, result, isError });
        conn.end(JSON.stringify({ result, isError }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger?.error('MCP bridge tool execution error', err);
        conn.end(JSON.stringify({ result: msg, isError: true }));
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.on('error', reject);
    server.listen(socketPath, () => resolve());
  });

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    server.close();
    try { fs.unlinkSync(socketPath); } catch {}
    try { fs.unlinkSync(defsPath); } catch {}
    try { fs.unlinkSync(configPath); } catch {}
    try { fs.rmdirSync(tmpDir); } catch {}
  };

  const setHandlers = (exec: ToolExecutor, onEvt?: (event: ToolEvent) => void) => {
    currentExecutor = exec;
    currentOnToolEvent = onEvt;
  };

  return { configPath, setHandlers, cleanup };
}
