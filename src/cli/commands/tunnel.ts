/**
 * tunnel command — Self-contained tunnel for cloud Studio.
 *
 * Handles all RPC methods locally using Node.js fs and the
 * @synergenius/flow-weaver AST API.  No local server required.
 *
 * 1. Opens a WebSocket to the cloud server's /api/tunnel endpoint.
 * 2. Dispatches RPC calls directly to local handler functions.
 */

import * as path from 'node:path';
import WebSocket from 'ws';
import { logger } from '../utils/logger.js';
import { dispatch } from '../tunnel/dispatch.js';

export interface TunnelOptions {
  key: string;
  cloud?: string;
  dir?: string;
  /** Override WebSocket factory (for testing) */
  createWs?: (url: string) => WebSocket;
}

interface TunnelRequest {
  type: 'tunnel:request';
  requestId: string;
  id: string;
  method: string;
  params: Record<string, unknown>;
}

export async function tunnelCommand(options: TunnelOptions): Promise<void> {
  const cloudUrl = options.cloud || 'https://flowweaver.dev';
  const workspaceRoot = path.resolve(options.dir || process.cwd());
  const createWs = options.createWs ?? ((url: string) => new WebSocket(url));

  logger.section('Flow Weaver Tunnel');
  logger.info(`Cloud:     ${cloudUrl}`);
  logger.info(`Workspace: ${workspaceRoot}`);
  logger.newline();

  // -----------------------------------------------------------------------
  // 1. Connect to cloud server via WebSocket
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
  const ctx = { workspaceRoot };

  // -----------------------------------------------------------------------
  // 2. Handle RPC: cloud → local dispatch → cloud
  // -----------------------------------------------------------------------

  cloudWs.on('message', async (raw: WebSocket.Data) => {
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

      const response = await dispatch(req.method, req.params || {}, ctx);

      cloudWs.send(JSON.stringify({
        type: 'tunnel:response',
        requestId: req.requestId,
        id: req.id,
        success: response.success,
        result: response.result,
        error: response.error,
      }));
    }
  });

  // -----------------------------------------------------------------------
  // 3. Handle disconnections
  // -----------------------------------------------------------------------

  cloudWs.on('close', (code: number, reason: Buffer) => {
    logger.warn(`Cloud server disconnected: ${code} ${reason.toString()}`);
    logger.info('Shutting down tunnel...');
    process.exit(code === 4001 ? 1 : 0);
  });

  cloudWs.on('error', (err: Error) => {
    logger.error(`Cloud WebSocket error: ${err.message}`);
  });

  // -----------------------------------------------------------------------
  // 4. Graceful shutdown
  // -----------------------------------------------------------------------

  process.on('SIGINT', () => {
    logger.newline();
    logger.info(`Shutting down tunnel (${requestCount} requests handled)...`);
    cloudWs.close();
    process.exit(0);
  });

  // Keep alive until SIGINT or cloud disconnect
  await new Promise(() => {});
}
