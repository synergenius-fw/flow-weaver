/**
 * tunnel command — Relay Studio RPC calls from cloud to a local dev server.
 *
 * 1. Connects to the local server via Socket.IO (same as listen command).
 * 2. Opens a WebSocket to the cloud server's /api/tunnel endpoint.
 * 3. Relays tunnel:request messages from cloud → local Socket.IO → cloud.
 */

import { io as socketIO } from 'socket.io-client';
import WebSocket from 'ws';
import { logger } from '../utils/logger.js';
import { DEFAULT_SERVER_URL } from '../../defaults.js';

export interface TunnelOptions {
  key: string;
  cloud?: string;
  server?: string;
  /** Override WebSocket factory (for testing) */
  createWs?: (url: string) => WebSocket;
  /** Override socket.io-client factory (for testing) */
  ioFactory?: typeof socketIO;
}

interface TunnelRequest {
  type: 'tunnel:request';
  requestId: string;
  id: string;
  method: string;
  params: Record<string, unknown>;
}

interface MethodResponse {
  id: string;
  success: boolean;
  result?: unknown;
  error?: { message: string };
}

export async function tunnelCommand(options: TunnelOptions): Promise<void> {
  const cloudUrl = options.cloud || 'https://flowweaver.dev';
  const localUrl = options.server || DEFAULT_SERVER_URL;
  const createWs = options.createWs ?? ((url: string) => new WebSocket(url));
  const ioFactory = options.ioFactory ?? socketIO;

  logger.section('Flow Weaver Tunnel');
  logger.info(`Cloud:  ${cloudUrl}`);
  logger.info(`Local:  ${localUrl}`);
  logger.newline();

  // -----------------------------------------------------------------------
  // 1. Connect to local server via Socket.IO
  // -----------------------------------------------------------------------

  logger.info('Connecting to local server...');

  const localSocket = ioFactory(`${localUrl}`, {
    query: { clientType: 'tunnel' },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionAttempts: Infinity,
  });

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      localSocket.disconnect();
      reject(new Error(`Local server connection timeout (10s). Is it running on ${localUrl}?`));
    }, 10_000);

    localSocket.on('connect', () => {
      clearTimeout(timeout);
      logger.success(`Connected to local server (${localUrl})`);
      resolve();
    });

    localSocket.on('connect_error', (err: Error) => {
      clearTimeout(timeout);
      localSocket.disconnect();
      reject(new Error(`Cannot connect to local server: ${err.message}`));
    });
  });

  // -----------------------------------------------------------------------
  // 2. Connect to cloud server via WebSocket
  // -----------------------------------------------------------------------

  logger.info('Connecting to cloud server...');

  const wsProtocol = cloudUrl.startsWith('https') ? 'wss' : 'ws';
  const wsHost = cloudUrl.replace(/^https?:\/\//, '');
  const wsUrl = `${wsProtocol}://${wsHost}/api/tunnel?token=${encodeURIComponent(options.key)}`;

  const cloudWs = createWs(wsUrl);

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cloudWs.close();
      reject(new Error('Cloud server connection timeout (10s)'));
    }, 10_000);

    cloudWs.on('open', () => {
      clearTimeout(timeout);
    });

    cloudWs.on('message', (raw: WebSocket.Data) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'tunnel:hello') {
          logger.success('Connected to cloud server');
          resolve();
        } else if (msg.type === 'error') {
          clearTimeout(timeout);
          cloudWs.close();
          reject(new Error(`Cloud server rejected connection: ${msg.message}`));
        }
      } catch {
        // Ignore parse errors during handshake
      }
    });

    cloudWs.on('error', (err: Error) => {
      clearTimeout(timeout);
      reject(new Error(`Cannot connect to cloud server: ${err.message}`));
    });
  });

  logger.newline();
  logger.success('Tunnel active — local development mode enabled');
  logger.info('Press Ctrl+C to disconnect');
  logger.newline();

  let requestCount = 0;

  // -----------------------------------------------------------------------
  // 3. Relay: cloud → local → cloud
  // -----------------------------------------------------------------------

  cloudWs.on('message', (raw: WebSocket.Data) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === 'ping') {
      cloudWs.send(JSON.stringify({ type: 'pong' }));
      return;
    }

    if (msg.type === 'tunnel:request') {
      const req = msg as unknown as TunnelRequest;
      requestCount++;
      logger.debug(`[${requestCount}] → ${req.method}`);

      localSocket.emit(
        'method',
        { id: req.id, method: req.method, params: req.params },
        (response: MethodResponse) => {
          cloudWs.send(JSON.stringify({
            type: 'tunnel:response',
            requestId: req.requestId,
            id: response.id,
            success: response.success,
            result: response.result,
            error: response.error,
          }));
        },
      );
    }
  });

  // -----------------------------------------------------------------------
  // 4. Handle disconnections
  // -----------------------------------------------------------------------

  localSocket.on('disconnect', (reason: string) => {
    logger.warn(`Local server disconnected: ${reason}`);
    if (reason === 'io server disconnect') {
      logger.info('Attempting to reconnect...');
    }
  });

  localSocket.on('connect', () => {
    logger.success('Reconnected to local server');
  });

  cloudWs.on('close', (code: number, reason: Buffer) => {
    logger.warn(`Cloud server disconnected: ${code} ${reason.toString()}`);
    logger.info('Shutting down tunnel...');
    localSocket.disconnect();
    process.exit(code === 4001 ? 1 : 0);
  });

  cloudWs.on('error', (err: Error) => {
    logger.error(`Cloud WebSocket error: ${err.message}`);
  });

  // -----------------------------------------------------------------------
  // 5. Graceful shutdown
  // -----------------------------------------------------------------------

  process.on('SIGINT', () => {
    logger.newline();
    logger.info(`Shutting down tunnel (${requestCount} requests relayed)...`);
    cloudWs.close();
    localSocket.disconnect();
    process.exit(0);
  });

  // Keep alive until SIGINT or cloud disconnect
  await new Promise(() => {});
}
