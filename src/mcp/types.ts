import type { io as socketIO } from 'socket.io-client';
import type { EventBuffer } from './event-buffer.js';
import type { EditorConnection } from './editor-connection.js';

/** Options for initializing the MCP server. */
export interface McpServerOptions {
  /** WebSocket server URL for Studio connection. */
  server?: string;
  /** Whether to use stdio transport instead of SSE. */
  stdio?: boolean;
  /** Internal: injected deps for testing */
  _testDeps?: {
    buffer?: EventBuffer;
    connection?: EditorConnection;
  };
}

/** Dependencies injected into tool registration functions for CLI interaction and logging. */
export interface RegistrationDeps {
  /** Execute a shell command and return its stdout and exit code. */
  execCommand: (cmd: string) => Promise<{ stdout: string; exitCode: number }>;
  /** Prompt the user for interactive input. */
  prompt: (question: string) => Promise<string>;
  /** Log a message to the console. */
  log: (msg: string) => void;
  /** Resolve the path to the Flow Weaver CLI executable. */
  resolveCliPath: () => string;
}

/** Acknowledgement response returned by Studio after processing a command. */
export interface AckResponse {
  /** Unique identifier correlating the response to its originating request. */
  requestId: string;
  /** Whether the command executed successfully. */
  success: boolean;
  /** The command result payload, present on success. */
  result?: unknown;
  /** Error message, present on failure. */
  error?: string;
}

/** A timestamped event stored in the event buffer. */
export interface BufferedEvent {
  /** The event name (e.g. "fw:node-added", "mcp:status"). */
  event: string;
  /** The event payload. */
  data: unknown;
  /** ISO 8601 timestamp of when the event was buffered. */
  timestamp: string;
}

/** Options for configuring the Studio WebSocket connection. */
export interface EditorConnectionOptions {
  /** Custom socket.io factory, primarily used for injecting mocks in tests. */
  ioFactory?: typeof socketIO;
  /** Timeout in milliseconds for awaiting command acknowledgements. Defaults to 10000. */
  ackTimeout?: number;
}

/** Configuration for filtering and deduplicating events in the event buffer. */
export interface EventFilterConfig {
  /** Event name patterns to include. Empty array means all events are included. Supports trailing `*` for prefix matching. */
  include: string[];
  /** Event name patterns to exclude (applied after include). Supports trailing `*` for prefix matching. */
  exclude: string[];
  /** Collapse duplicate events of the same type within this window in milliseconds. 0 disables deduplication. */
  dedupeWindowMs: number;
  /** Maximum number of events to retain before evicting the oldest. */
  maxBufferSize: number;
}

/** Default event filter configuration. Excludes `fw:ack` events, dedupes within 200ms, and retains up to 500 events. */
export const DEFAULT_EVENT_FILTER: EventFilterConfig = {
  include: [],
  exclude: ['fw:ack'],
  dedupeWindowMs: 200,
  maxBufferSize: 500,
};
