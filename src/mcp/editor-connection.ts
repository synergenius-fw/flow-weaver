import { io as socketIO, type Socket } from 'socket.io-client';
import type { AckResponse, EditorConnectionOptions } from './types.js';
import type { EventBuffer } from './event-buffer.js';

/**
 * Manages a WebSocket connection to Flow Weaver Studio via socket.io.
 * Supports sending commands and batches with request/response correlation,
 * and forwards incoming `fw:` and `integration:` events to an {@link EventBuffer}.
 */
export class EditorConnection {
  private socket: Socket | null = null;
  private serverUrl: string;
  private buffer: EventBuffer;
  private ioFactory: typeof socketIO;
  private ackTimeout: number;
  private hasLoggedDisconnect = false;
  private wasConnected = false;

  /**
   * @param serverUrl - The base URL of the Studio WebSocket server.
   * @param buffer - The event buffer to push incoming events into.
   * @param options - Optional connection configuration (custom io factory, ack timeout).
   */
  constructor(serverUrl: string, buffer: EventBuffer, options?: EditorConnectionOptions) {
    this.serverUrl = serverUrl;
    this.buffer = buffer;
    this.ioFactory = options?.ioFactory ?? socketIO;
    this.ackTimeout = options?.ackTimeout ?? 10_000;
  }

  /**
   * Establishes a WebSocket connection to Studio's `/integrations` namespace.
   * Cleans up any previous connection first. Incoming `fw:` and `integration:` events
   * are automatically forwarded to the event buffer.
   * @param log - Optional logging callback for connection lifecycle events.
   */
  connect(log?: (msg: string) => void): void {
    // Clean up previous connection to prevent duplicate listeners
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }

    // Write a startup event immediately so the hook file exists from the start
    this.buffer.push('mcp:status', { status: 'connecting', server: this.serverUrl });

    this.socket = this.ioFactory(`${this.serverUrl}/integrations`, {
      query: { clientType: 'mcp' },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: Infinity,
    });

    this.socket.on('connect', () => {
      const msg = this.wasConnected
        ? `Reconnected to Studio at ${this.serverUrl}`
        : `Connected to Studio at ${this.serverUrl}`;
      log?.(msg);
      this.hasLoggedDisconnect = false;
      this.wasConnected = true;
      this.buffer.push('mcp:status', { status: 'connected', server: this.serverUrl });
    });

    if (log) {
      this.socket.on('disconnect', () => {
        if (!this.hasLoggedDisconnect) {
          log('Studio disconnected');
          this.hasLoggedDisconnect = true;
        }
      });
      this.socket.on('connect_error', () => {
        if (!this.hasLoggedDisconnect) {
          log(`Studio not reachable at ${this.serverUrl}`);
          this.hasLoggedDisconnect = true;
        }
      });
    }

    this.socket.onAny((event: string, data: unknown) => {
      if (event.startsWith('fw:') || event.startsWith('integration:')) {
        this.buffer.push(event, data);
      }
    });
  }

  /** Whether the socket is currently connected to Studio. */
  get isConnected(): boolean {
    return this.socket?.connected ?? false;
  }

  /**
   * Sends a single command to Studio and waits for an acknowledgement.
   * Returns an error response if not connected or if the ack times out.
   * @param action - The command action name (e.g. "get-state", "add-node").
   * @param params - Parameters for the command.
   * @returns Studio's acknowledgement response.
   */
  async sendCommand(action: string, params: Record<string, unknown>): Promise<AckResponse> {
    if (!this.socket) {
      return { requestId: '', success: false, error: 'Not connected' };
    }

    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    return new Promise<AckResponse>((resolve) => {
      const handler = (data: AckResponse) => {
        if (data.requestId === requestId) {
          clearTimeout(timeout);
          this.socket!.off('fw:ack', handler);
          resolve(data);
        }
      };
      const timeout = setTimeout(() => {
        this.socket!.off('fw:ack', handler);
        resolve({ requestId, success: false, error: 'Timeout' });
      }, this.ackTimeout);

      this.socket!.on('fw:ack', handler);
      this.socket!.emit('integration:command', { requestId, action, params });
    });
  }

  /**
   * Sends a batch of commands to Studio as a single request and waits for acknowledgement.
   * Returns an error response if not connected or if the ack times out.
   * @param commands - Array of commands, each with an action name and optional params.
   * @returns Studio's acknowledgement response for the entire batch.
   */
  async sendBatch(
    commands: Array<{ action: string; params?: Record<string, unknown> }>
  ): Promise<AckResponse> {
    if (!this.socket) {
      return { requestId: '', success: false, error: 'Not connected' };
    }

    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    return new Promise<AckResponse>((resolve) => {
      const handler = (data: AckResponse) => {
        if (data.requestId === requestId) {
          clearTimeout(timeout);
          this.socket!.off('fw:ack', handler);
          resolve(data);
        }
      };
      const timeout = setTimeout(() => {
        this.socket!.off('fw:ack', handler);
        resolve({ requestId, success: false, error: 'Timeout' });
      }, this.ackTimeout);

      this.socket!.on('fw:ack', handler);
      this.socket!.emit('integration:batch', { requestId, commands });
    });
  }

  /** Disconnects from Studio and releases the socket. */
  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
  }
}
