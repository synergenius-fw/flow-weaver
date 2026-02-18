import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { EditorConnection } from './editor-connection.js';
import type { EventBuffer } from './event-buffer.js';

/**
 * Registers MCP resources that expose editor state and event data.
 * Registers two resources:
 * - `fw://events` - read-only peek at the event buffer.
 * - `fw://state` - current editor/workflow state fetched via the editor connection.
 * @param mcp - The MCP server instance to register resources on.
 * @param connection - The editor WebSocket connection used to query state.
 * @param buffer - The event buffer to read events from.
 */
export function registerResources(
  mcp: McpServer,
  connection: EditorConnection,
  buffer: EventBuffer
): void {
  mcp.resource(
    'events',
    'fw://events',
    { description: 'Read-only view of the event buffer (does not clear it)' },
    async () => ({
      contents: [
        {
          uri: 'fw://events',
          text: JSON.stringify(buffer.peek(), null, 2),
        },
      ],
    })
  );

  mcp.resource(
    'state',
    'fw://state',
    { description: 'Current editor/workflow state' },
    async () => {
      if (!connection.isConnected) {
        return {
          contents: [
            {
              uri: 'fw://state',
              text: JSON.stringify({ error: 'Not connected to editor' }),
            },
          ],
        };
      }
      try {
        const result = await connection.sendCommand('get-state', {});
        return {
          contents: [
            {
              uri: 'fw://state',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          contents: [
            {
              uri: 'fw://state',
              text: JSON.stringify({
                error: `Failed to get state: ${err instanceof Error ? err.message : String(err)}`,
              }),
            },
          ],
        };
      }
    }
  );
}
