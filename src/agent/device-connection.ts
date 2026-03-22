/**
 * Device Connection — WebSocket client for connecting a local machine
 * to the Flow Weaver platform as a mounted device.
 *
 * This is the transport layer. Packs register their own request handlers
 * on top of this connection (e.g., improve status, bot management).
 *
 * The platform relays Studio requests to connected devices and forwards
 * device events to Studio subscribers.
 */

export interface DeviceInfo {
  name: string;
  hostname: string;
  projectDir: string;
  platform: string;
  capabilities: string[];
}

export interface DeviceConnectionOptions {
  platformUrl: string;
  token: string;
  projectDir: string;
  deviceName?: string;
  onConnect?: () => void;
  onDisconnect?: (code: number) => void;
  onEvent?: (event: DeviceEvent) => void;
  logger?: (msg: string) => void;
}

export interface DeviceEvent {
  type: string;
  data: Record<string, unknown>;
  timestamp: number;
}

type RequestHandler = (method: string, params: Record<string, unknown>) => Promise<unknown>;

export class DeviceConnection {
  private ws: WebSocket | null = null;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private requestHandlers = new Map<string, RequestHandler>();
  private connected = false;
  private shouldReconnect = true;
  private readonly options: DeviceConnectionOptions;
  private readonly deviceInfo: DeviceInfo;
  private readonly log: (msg: string) => void;

  constructor(options: DeviceConnectionOptions) {
    this.options = options;
    this.log = options.logger ?? (() => {});
    const os = require('node:os') as typeof import('node:os');
    this.deviceInfo = {
      name: options.deviceName ?? os.hostname(),
      hostname: os.hostname(),
      projectDir: options.projectDir,
      platform: process.platform,
      capabilities: [],
    };
  }

  /**
   * Add a capability to advertise to the platform.
   */
  addCapability(capability: string): void {
    if (!this.deviceInfo.capabilities.includes(capability)) {
      this.deviceInfo.capabilities.push(capability);
    }
  }

  /**
   * Register a handler for incoming requests from the platform.
   */
  onRequest(method: string, handler: RequestHandler): void {
    this.requestHandlers.set(method, handler);
  }

  /**
   * Connect to the platform. Reconnects automatically on disconnect.
   */
  async connect(): Promise<void> {
    const wsUrl = this.options.platformUrl
      .replace(/^http/, 'ws')
      .replace(/\/$/, '') + '/ws/device';

    this.log(`Connecting to ${wsUrl}...`);
    this.shouldReconnect = true;

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(`${wsUrl}?token=${encodeURIComponent(this.options.token)}`);
      } catch (err) {
        reject(err);
        return;
      }

      this.ws.addEventListener('open', () => {
        this.connected = true;
        this.log(`Connected as "${this.deviceInfo.name}"`);

        // Send device registration
        this.send({ type: 'device:register', device: this.deviceInfo });

        // Start heartbeat
        this.heartbeatInterval = setInterval(() => {
          if (this.ws?.readyState === WebSocket.OPEN) {
            this.send({ type: 'heartbeat', timestamp: Date.now() });
          }
        }, 30_000);

        this.options.onConnect?.();
        resolve();
      });

      this.ws.addEventListener('message', async (event) => {
        try {
          const msg = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data));
          await this.handleMessage(msg);
        } catch (err) {
          this.log(`Parse error: ${err instanceof Error ? err.message : err}`);
        }
      });

      this.ws.addEventListener('close', (event) => {
        this.connected = false;
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        this.options.onDisconnect?.(event.code);
        if (this.shouldReconnect) {
          this.log(`Disconnected (${event.code}). Reconnecting in 5s...`);
          this.scheduleReconnect();
        }
      });

      this.ws.addEventListener('error', () => {
        if (!this.connected) {
          reject(new Error('WebSocket connection failed'));
        } else {
          this.log('Connection error');
        }
      });
    });
  }

  /**
   * Emit an event to the platform.
   */
  emit(event: DeviceEvent): void {
    if (!this.connected) return;
    this.send({ type: 'device:event', event });
    this.options.onEvent?.(event);
  }

  /**
   * Disconnect from the platform. No auto-reconnect.
   */
  disconnect(): void {
    this.shouldReconnect = false;
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
    if (this.ws) {
      this.ws.close(1000, 'Device disconnecting');
      this.ws = null;
    }
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  getDeviceInfo(): Readonly<DeviceInfo> {
    return this.deviceInfo;
  }

  // --- Private ---

  private send(msg: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private async handleMessage(msg: Record<string, unknown>): Promise<void> {
    const type = String(msg.type ?? '');
    const requestId = String(msg.requestId ?? '');

    if (type === 'request') {
      const method = String(msg.method ?? '');
      const params = (msg.params as Record<string, unknown>) ?? {};
      const handler = this.requestHandlers.get(method);

      if (!handler) {
        this.send({ type: 'response', requestId, success: false, error: `Unknown method: ${method}` });
        return;
      }

      try {
        const result = await handler(method, params);
        this.send({ type: 'response', requestId, success: true, result });
      } catch (err) {
        this.send({ type: 'response', requestId, success: false, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
    this.reconnectTimeout = setTimeout(async () => {
      try {
        await this.connect();
      } catch {
        this.log('Reconnect failed. Retrying in 10s...');
        this.reconnectTimeout = setTimeout(() => this.scheduleReconnect(), 10_000);
      }
    }, 5_000);
  }
}
