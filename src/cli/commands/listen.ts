import { io as socketIO } from 'socket.io-client';
import { logger } from '../utils/logger.js';
import { DEFAULT_SERVER_URL } from '../../defaults.js';

export interface AckResponse {
  requestId: string;
  success: boolean;
  result?: unknown;
  error?: string;
}

export interface ListenOptions {
  server?: string;
  /** Override the socket.io-client `io` factory (for testing) */
  ioFactory?: typeof socketIO;
  /** Override stdout (for testing) */
  output?: NodeJS.WritableStream;
}

export async function listenCommand(options: ListenOptions): Promise<void> {
  const serverUrl = options.server || DEFAULT_SERVER_URL;
  const ioFactory = options.ioFactory ?? socketIO;
  const output = options.output ?? process.stdout;

  const socket = ioFactory(`${serverUrl}/integrations`, {
    query: { clientType: 'cli' },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionAttempts: Infinity,
  });

  socket.on('connect', () => {
    logger.info(`Connected to ${serverUrl}/integrations`);
    socket.emit('integration:getContext', (ctx: unknown) => {
      if (ctx) {
        output.write(JSON.stringify({ event: 'integration:context', data: ctx }) + '\n');
      }
    });
  });

  socket.on('disconnect', (reason: string) => {
    logger.warn(`Disconnected: ${reason}`);
  });

  socket.onAny((event: string, data: unknown) => {
    if (event.startsWith('fw:') || event.startsWith('integration:')) {
      output.write(JSON.stringify({ event, data }) + '\n');
    }
  });

  process.on('SIGINT', () => {
    logger.info('Disconnecting...');
    socket.disconnect();
    process.exit(0);
  });

  // Keep alive until SIGINT
  await new Promise(() => {});
}
