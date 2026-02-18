import { io as socketIO } from 'socket.io-client';
import { logger } from '../utils/logger.js';
import type { AckResponse } from './listen.js';
import { DEFAULT_SERVER_URL } from '../../defaults.js';

const DEFAULT_SERVER = DEFAULT_SERVER_URL;
const ACK_TIMEOUT = 10_000;

const VERBOSE_OUTPUT = !!(process.env.DEBUG || process.argv.includes('--verbose'));

async function sendCommand(
  serverUrl: string,
  action: string,
  params: Record<string, unknown>
): Promise<void> {
  const socket = socketIO(`${serverUrl}/integrations`, {
    query: { clientType: 'cli' },
    transports: ['websocket', 'polling'],
  });

  try {
    await new Promise<void>((resolve, reject) => {
      socket.on('connect', () => resolve());
      socket.on('connect_error', (err: Error) => reject(err));
      setTimeout(() => reject(new Error('Connection timeout')), ACK_TIMEOUT);
    });

    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const result = await new Promise<AckResponse>((resolve) => {
      const timeout = setTimeout(() => {
        resolve({ requestId, success: false, error: 'Timeout' });
      }, ACK_TIMEOUT);

      socket.on('fw:ack', (data: AckResponse) => {
        if (data.requestId === requestId) {
          clearTimeout(timeout);
          resolve(data);
        }
      });

      socket.emit('integration:command', { requestId, action, params });
    });

    if (result.success) {
      if (VERBOSE_OUTPUT) {
        logger.success(JSON.stringify(result, null, 2));
      } else {
        logger.success(`Command "${action}" executed successfully`);
      }
    } else {
      logger.error(
        VERBOSE_OUTPUT
          ? JSON.stringify(result, null, 2)
          : `Command "${action}" failed: ${result.error || 'unknown error'}`
      );
      process.exitCode = 1;
    }
  } catch (err) {
    logger.error(String(err instanceof Error ? err.message : err));
    process.exitCode = 1;
  } finally {
    socket.disconnect();
  }
}

async function sendBatch(serverUrl: string, commands: unknown): Promise<void> {
  const socket = socketIO(`${serverUrl}/integrations`, {
    query: { clientType: 'cli' },
    transports: ['websocket', 'polling'],
  });

  try {
    await new Promise<void>((resolve, reject) => {
      socket.on('connect', () => resolve());
      socket.on('connect_error', (err: Error) => reject(err));
      setTimeout(() => reject(new Error('Connection timeout')), ACK_TIMEOUT);
    });

    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const result = await new Promise<AckResponse>((resolve) => {
      const timeout = setTimeout(() => {
        resolve({ requestId, success: false, error: 'Timeout' });
      }, ACK_TIMEOUT);

      socket.on('fw:ack', (data: AckResponse) => {
        if (data.requestId === requestId) {
          clearTimeout(timeout);
          resolve(data);
        }
      });

      socket.emit('integration:batch', { requestId, commands });
    });

    if (result.success) {
      if (VERBOSE_OUTPUT) {
        logger.success(JSON.stringify(result, null, 2));
      } else {
        logger.success('Batch executed successfully');
      }
    } else {
      logger.error(
        VERBOSE_OUTPUT
          ? JSON.stringify(result, null, 2)
          : `Batch failed: ${result.error || 'unknown error'}`
      );
      process.exitCode = 1;
    }
  } catch (err) {
    logger.error(String(err instanceof Error ? err.message : err));
    process.exitCode = 1;
  } finally {
    socket.disconnect();
  }
}

export async function uiFocusNode(nodeId: string, options: { server?: string }): Promise<void> {
  const server = options.server || DEFAULT_SERVER;
  await sendCommand(server, 'focus-node', { nodeId });
}

export async function uiAddNode(nodeTypeName: string, options: { server?: string }): Promise<void> {
  const server = options.server || DEFAULT_SERVER;
  await sendCommand(server, 'add-node', { nodeTypeName });
}

export async function uiOpenWorkflow(
  filePath: string,
  options: { server?: string }
): Promise<void> {
  const server = options.server || DEFAULT_SERVER;
  await sendCommand(server, 'open-workflow', { filePath });
}

export async function uiGetState(options: { server?: string }): Promise<void> {
  const server = options.server || DEFAULT_SERVER;
  await sendCommand(server, 'get-state', {});
}

export async function uiBatch(json: string, options: { server?: string }): Promise<void> {
  let commands: unknown;
  try {
    commands = JSON.parse(json);
  } catch {
    logger.error('Invalid JSON. Provide an array of {action, params} objects.');
    process.exitCode = 1;
    return;
  }

  const server = options.server || DEFAULT_SERVER;
  await sendBatch(server, commands);
}
