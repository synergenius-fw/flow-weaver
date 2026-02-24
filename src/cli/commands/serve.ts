/**
 * Serve command - start HTTP server exposing workflows as endpoints
 */

import * as path from 'path';
import * as fs from 'fs';
import { WebhookServer } from '../../server/webhook-server.js';
import { logger } from '../utils/logger.js';

export interface ServeOptions {
  /** Server port */
  port?: number;
  /** Server host */
  host?: string;
  /** Enable file watching for hot reload */
  watch?: boolean;
  /** Production mode (no trace events) */
  production?: boolean;
  /** Precompile all workflows on startup */
  precompile?: boolean;
  /** CORS origin */
  cors?: string;
  /** Enable Swagger UI at /docs */
  swagger?: boolean;
}

/**
 * Start a webhook server exposing workflows as HTTP endpoints.
 *
 * @param dir - Directory containing workflow files (defaults to current directory)
 * @param options - Server options
 *
 * @example
 * ```bash
 * # Start server with current directory
 * flow-weaver serve
 *
 * # Specify workflow directory
 * flow-weaver serve ./workflows
 *
 * # Custom port
 * flow-weaver serve --port 8080
 *
 * # Production mode
 * flow-weaver serve --production --precompile
 *
 * # Disable hot reload
 * flow-weaver serve --no-watch
 * ```
 */
export async function serveCommand(dir: string | undefined, options: ServeOptions): Promise<void> {
  const workflowDir = path.resolve(dir || '.');

  // Validate directory exists
  if (!fs.existsSync(workflowDir)) {
    throw new Error(`Directory not found: ${workflowDir}`);
  }

  if (!fs.statSync(workflowDir).isDirectory()) {
    throw new Error(`Not a directory: ${workflowDir}`);
  }

  const port = options.port ?? 3000;
  const host = options.host ?? '0.0.0.0';

  logger.section('Flow Weaver Webhook Server');
  logger.info(`Workflow directory: ${workflowDir}`);
  logger.info(`Server: http://${host}:${port}`);
  logger.info(`File watching: ${options.watch !== false ? 'enabled' : 'disabled'}`);
  logger.info(`Production mode: ${options.production ? 'yes' : 'no'}`);
  if (options.swagger) {
    logger.info(`Swagger UI: http://${host}:${port}/docs`);
  }
  logger.newline();

  const server = new WebhookServer({
    port,
    host,
    workflowDir,
    watchEnabled: options.watch !== false,
    production: options.production ?? false,
    precompile: options.precompile ?? false,
    corsOrigin: options.cors ?? '*',
    swaggerEnabled: options.swagger ?? false,
  });

  // Graceful shutdown handlers
  const shutdown = async (signal: string) => {
    logger.newline();
    logger.info(`Received ${signal}, shutting down...`);
    await server.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  if (process.platform !== 'win32') process.on('SIGTERM', () => shutdown('SIGTERM'));

  try {
    await server.start();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      throw new Error(`Port ${port} is already in use. Try a different port with --port <number>`);
    }
    throw error;
  }
}
