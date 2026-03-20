import { describe, it, expect, afterEach } from 'vitest';
import * as net from 'node:net';
import * as fs from 'node:fs';
import { createMcpBridge } from '../../src/agent/mcp-bridge.js';
import type { McpBridge, ToolDefinition } from '../../src/agent/types.js';

const testTools: ToolDefinition[] = [
  {
    name: 'test_tool',
    description: 'A test tool',
    inputSchema: {
      type: 'object',
      properties: { input: { type: 'string' } },
      required: ['input'],
    },
  },
];

describe('createMcpBridge', () => {
  let bridge: McpBridge | null = null;

  afterEach(() => {
    bridge?.cleanup();
    bridge = null;
  });

  it('should create a bridge with config path', async () => {
    bridge = await createMcpBridge(
      testTools,
      async () => ({ result: 'ok', isError: false }),
    );

    expect(bridge.configPath).toBeTruthy();
    expect(fs.existsSync(bridge.configPath)).toBe(true);

    // Config should contain mcpServers
    const config = JSON.parse(fs.readFileSync(bridge.configPath, 'utf-8'));
    expect(config.mcpServers).toBeDefined();
    expect(config.mcpServers['fw-agent']).toBeDefined();
    expect(config.mcpServers['fw-agent'].type).toBe('stdio');
  });

  it('should write tool definitions file', async () => {
    bridge = await createMcpBridge(
      testTools,
      async () => ({ result: 'ok', isError: false }),
    );

    const config = JSON.parse(fs.readFileSync(bridge.configPath, 'utf-8'));
    const defsPath = config.mcpServers['fw-agent'].env.FW_TOOL_DEFS;
    expect(fs.existsSync(defsPath)).toBe(true);

    const defs = JSON.parse(fs.readFileSync(defsPath, 'utf-8'));
    expect(defs).toHaveLength(1);
    expect(defs[0].name).toBe('test_tool');
  });

  it('should handle tool execution via socket', async () => {
    bridge = await createMcpBridge(
      testTools,
      async (name, args) => {
        return { result: `executed ${name} with ${JSON.stringify(args)}`, isError: false };
      },
    );

    const config = JSON.parse(fs.readFileSync(bridge.configPath, 'utf-8'));
    const socketPath = config.mcpServers['fw-agent'].env.FW_TOOL_SOCKET;

    // Connect to the socket and send a tool call
    const response = await new Promise<string>((resolve, reject) => {
      const client = net.createConnection(socketPath, () => {
        client.write(JSON.stringify({ name: 'test_tool', args: { input: 'hello' } }) + '\n');
      });
      let buf = '';
      client.on('data', (chunk) => { buf += chunk.toString(); });
      client.on('end', () => resolve(buf));
      client.on('error', reject);
    });

    const parsed = JSON.parse(response);
    expect(parsed.isError).toBe(false);
    expect(parsed.result).toContain('executed test_tool');
    expect(parsed.result).toContain('hello');
  });

  it('should fire onToolEvent callbacks', async () => {
    const events: Array<{ type: string; name: string }> = [];

    bridge = await createMcpBridge(
      testTools,
      async () => ({ result: 'ok', isError: false }),
      (event) => events.push({ type: event.type, name: event.name }),
    );

    const config = JSON.parse(fs.readFileSync(bridge.configPath, 'utf-8'));
    const socketPath = config.mcpServers['fw-agent'].env.FW_TOOL_SOCKET;

    await new Promise<void>((resolve, reject) => {
      const client = net.createConnection(socketPath, () => {
        client.write(JSON.stringify({ name: 'test_tool', args: {} }) + '\n');
      });
      client.on('data', () => {});
      client.on('end', () => resolve());
      client.on('error', reject);
    });

    expect(events).toEqual([
      { type: 'tool_call_start', name: 'test_tool' },
      { type: 'tool_call_result', name: 'test_tool' },
    ]);
  });

  it('should allow swapping handlers via setHandlers', async () => {
    bridge = await createMcpBridge(
      testTools,
      async () => ({ result: 'original', isError: false }),
    );

    bridge.setHandlers(
      async () => ({ result: 'swapped', isError: false }),
    );

    const config = JSON.parse(fs.readFileSync(bridge.configPath, 'utf-8'));
    const socketPath = config.mcpServers['fw-agent'].env.FW_TOOL_SOCKET;

    const response = await new Promise<string>((resolve, reject) => {
      const client = net.createConnection(socketPath, () => {
        client.write(JSON.stringify({ name: 'test_tool', args: {} }) + '\n');
      });
      let buf = '';
      client.on('data', (chunk) => { buf += chunk.toString(); });
      client.on('end', () => resolve(buf));
      client.on('error', reject);
    });

    const parsed = JSON.parse(response);
    expect(parsed.result).toBe('swapped');
  });

  it('should cleanup temp files', async () => {
    bridge = await createMcpBridge(
      testTools,
      async () => ({ result: 'ok', isError: false }),
    );

    const configPath = bridge.configPath;
    expect(fs.existsSync(configPath)).toBe(true);

    bridge.cleanup();
    bridge = null; // Prevent double cleanup in afterEach

    expect(fs.existsSync(configPath)).toBe(false);
  });
});
