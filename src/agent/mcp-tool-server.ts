#!/usr/bin/env node
/**
 * Minimal MCP stdio server that bridges tool calls to a parent process.
 *
 * Spawned by the Claude CLI via --mcp-config. Advertises tool definitions
 * and delegates execution to the parent process through a Unix domain socket.
 *
 * Environment:
 *   FW_TOOL_SOCKET - Unix socket path for tool execution RPC
 *   FW_TOOL_DEFS   - Path to JSON file with tool definitions
 *
 * Protocol over Unix socket (newline-delimited JSON):
 *   Request:  {"name":"fw_run_command","args":{"command":"ls"}}
 *   Response: {"result":"...","isError":false}
 *
 * IMPORTANT — Transport compatibility:
 *   Claude Code CLI v2.1.76+ uses NDJSON (newline-delimited JSON) for MCP
 *   stdio, NOT the Content-Length framing from the MCP SDK spec. This server
 *   auto-detects the transport on the first stdin chunk: if the first
 *   non-whitespace character is '{', it uses NDJSON; otherwise Content-Length.
 *   Responses match the detected format.
 *
 *   The CLI also sends protocolVersion "2025-11-25" (not the spec's
 *   "2024-11-05"). We echo back whatever version the client requests.
 *
 *   If these behaviors change in a future CLI version, the auto-detect
 *   and version echo should adapt automatically.
 */

import * as net from 'node:net';
import * as fs from 'node:fs';

const SOCKET_PATH = process.env.FW_TOOL_SOCKET;
const DEFS_PATH = process.env.FW_TOOL_DEFS;

if (!SOCKET_PATH || !DEFS_PATH) {
  process.stderr.write('mcp-tool-server: FW_TOOL_SOCKET and FW_TOOL_DEFS are required\n');
  process.exit(1);
}

// Load tool definitions (written by the bridge before spawning the CLI)
const toolDefs: Array<{
  name: string;
  description: string;
  inputSchema: { type: string; properties: Record<string, unknown>; required?: string[] };
}> = JSON.parse(fs.readFileSync(DEFS_PATH, 'utf-8'));

// ---------------------------------------------------------------------------
// Unix socket RPC: send tool call, receive result
// ---------------------------------------------------------------------------

function callTool(
  name: string,
  args: Record<string, unknown>,
): Promise<{ result: string; isError: boolean }> {
  return new Promise((resolve, reject) => {
    const client = net.createConnection(SOCKET_PATH!, () => {
      client.write(JSON.stringify({ name, args }) + '\n');
    });
    let buf = '';
    client.on('data', (chunk) => {
      buf += chunk.toString();
    });
    client.on('end', () => {
      try {
        resolve(JSON.parse(buf.trim()));
      } catch {
        reject(new Error(`Invalid response from tool bridge: ${buf}`));
      }
    });
    client.on('error', (err) => reject(err));
    // Safety timeout
    setTimeout(() => {
      client.destroy();
      reject(new Error('Tool execution timed out'));
    }, 130_000);
  });
}

// ---------------------------------------------------------------------------
// MCP stdio protocol (JSON-RPC over stdin/stdout)
// ---------------------------------------------------------------------------

// Auto-detect transport: NDJSON (newline-delimited) or Content-Length framed.
// Claude Code CLI uses NDJSON; standard MCP SDK uses Content-Length.
let useNdjson = false;
let transportDetected = false;

function send(msg: Record<string, unknown>) {
  const json = JSON.stringify(msg);
  if (useNdjson) {
    process.stdout.write(json + '\n');
  } else {
    const header = `Content-Length: ${Buffer.byteLength(json)}\r\n\r\n`;
    process.stdout.write(header + json);
  }
}

async function handleMessage(msg: {
  jsonrpc: string;
  method?: string;
  id?: number | string;
  params?: Record<string, unknown>;
}) {
  const { method, id, params } = msg;

  if (method === 'initialize') {
    // Echo back the client's protocol version for compatibility
    const clientVersion = (params?.protocolVersion as string) || '2024-11-05';
    send({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: clientVersion,
        capabilities: { tools: {} },
        serverInfo: { name: 'fw-agent-tools', version: '1.0.0' },
      },
    });
    return;
  }

  if (method === 'notifications/initialized') {
    // No response needed for notifications
    return;
  }

  if (method === 'tools/list') {
    send({
      jsonrpc: '2.0',
      id,
      result: { tools: toolDefs },
    });
    return;
  }

  if (method === 'tools/call') {
    const toolName = (params as Record<string, unknown>)?.name as string;
    const toolArgs = ((params as Record<string, unknown>)?.arguments as Record<string, unknown>) ?? {};
    try {
      const { result, isError } = await callTool(toolName, toolArgs);
      send({
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: result }],
          isError,
        },
      });
    } catch (err) {
      send({
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        },
      });
    }
    return;
  }

  // Unknown method — return empty result for requests, ignore notifications
  if (id !== undefined) {
    send({ jsonrpc: '2.0', id, result: {} });
  }
}

// ---------------------------------------------------------------------------
// Read JSON-RPC messages from stdin (auto-detect NDJSON vs Content-Length)
// ---------------------------------------------------------------------------

let inputBuf = '';

process.stdin.on('data', (chunk) => {
  inputBuf += chunk.toString();
  // Auto-detect transport on first data: if it starts with '{', it's NDJSON
  if (!transportDetected) {
    const trimmed = inputBuf.trimStart();
    if (trimmed.startsWith('{')) {
      useNdjson = true;
    }
    transportDetected = true;
  }
  if (useNdjson) {
    processNdjson();
  } else {
    processContentLength();
  }
});

function processNdjson() {
  const lines = inputBuf.split('\n');
  inputBuf = lines.pop() || '';
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      handleMessage(msg).catch((err) => {
        process.stderr.write(`mcp-tool-server error: ${err}\n`);
      });
    } catch {
      process.stderr.write(`mcp-tool-server: failed to parse line: ${line.slice(0, 200)}\n`);
    }
  }
}

function processContentLength() {
  while (true) {
    const headerEnd = inputBuf.indexOf('\r\n\r\n');
    if (headerEnd === -1) break;

    const header = inputBuf.slice(0, headerEnd);
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) {
      inputBuf = inputBuf.slice(headerEnd + 4);
      continue;
    }

    const contentLength = parseInt(match[1], 10);
    const bodyStart = headerEnd + 4;
    if (inputBuf.length < bodyStart + contentLength) break;

    const body = inputBuf.slice(bodyStart, bodyStart + contentLength);
    inputBuf = inputBuf.slice(bodyStart + contentLength);

    try {
      const msg = JSON.parse(body);
      handleMessage(msg).catch((err) => {
        process.stderr.write(`mcp-tool-server error: ${err}\n`);
      });
    } catch {
      process.stderr.write(`mcp-tool-server: failed to parse message: ${body}\n`);
    }
  }
}

process.stdin.on('end', () => process.exit(0));
