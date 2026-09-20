/**
 * Serve command - the project's workflows as HTTP endpoints, runs as resources.
 */

import * as path from 'path';
import * as fs from 'fs';
import { WebhookServer } from '../../server/webhook-server.js';
import { logger } from '../utils/logger.js';
import { announceService } from '../../service-registry.js';
import { defaultRunsDir } from '../../coordinator/index.js';
import { loadAgentProfiles, readiness } from '../../agent/profiles.js';

export interface ServeOptions {
  /** Server port. Default 3000. */
  port?: number;
  /** Server host. Default 127.0.0.1. Anything else needs a token or --insecure. */
  host?: string;
  /** Re-discover workflows when files change. Default true. */
  watch?: boolean;
  /** Deprecated alias for `trace: false`. */
  production?: boolean;
  /** Accepted for compatibility. Has no effect. */
  precompile?: boolean;
  /** CORS origin. Unset sends no CORS headers. */
  cors?: string;
  /** Swagger UI at /docs. */
  swagger?: boolean;
  /** Bearer token. Also read from FW_SERVE_TOKEN. */
  token?: string;
  /** Answer agent gates from .flowweaver/agents.yaml. Default true. */
  agents?: boolean;
  /** Keep and stream a step trace per run. */
  trace?: boolean;
  /** Error stacks in responses. Mocks accepted in a start body. */
  dev?: boolean;
  /** Listen beyond loopback without a token. */
  insecure?: boolean;
}

const isLoopback = (host: string) => ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host);

/**
 * Start the HTTP server.
 *
 * @example
 * ```bash
 * fw serve                              # this directory, on 127.0.0.1:3000
 * fw serve ./workflows --port 8080
 * fw serve --host 0.0.0.0 --token $FW_SERVE_TOKEN   # reachable, guarded
 * fw serve --trace --dev                # streams every step, stacks in errors
 * fw serve --no-agents                  # agent gates wait for a person
 * ```
 */
export async function serveCommand(dir: string | undefined, options: ServeOptions): Promise<void> {
  const workflowDir = path.resolve(dir || '.');

  if (!fs.existsSync(workflowDir)) throw new Error(`Directory not found: ${workflowDir}`);
  if (!fs.statSync(workflowDir).isDirectory()) throw new Error(`Not a directory: ${workflowDir}`);

  const port = options.port ?? 3000;
  const host = options.host ?? '127.0.0.1';
  const token = options.token ?? process.env.FW_SERVE_TOKEN ?? undefined;
  if (!isLoopback(host) && !token && !options.insecure) {
    throw new Error(`Refusing to listen on ${host} without a token: anyone who can reach the port could run your workflows. Pass --token <secret> (or set FW_SERVE_TOKEN), or --insecure to expose the API unauthenticated.`);
  }
  const agents = options.agents !== false;
  const trace = options.trace === true;

  logger.section('Flow Weaver Server');
  logger.info(`Workflows: ${workflowDir}`);
  logger.info(`Auth: ${token ? 'bearer token' : 'open'}${!token && !isLoopback(host) ? ' (insecure)' : ''}`);
  logger.info(`Runs: ${defaultRunsDir()} (shared with fw console and fw_run)`);
  logger.info(`Trace: ${trace ? 'kept per run' : 'off (--trace to keep)'}`);
  logger.info(`Callbacks: ${options.dev ? 'any host, including localhost (--dev)' : 'public hosts only'}`);
  if (agents) {
    const profiles = loadAgentProfiles(workflowDir);
    const ready = Object.values(profiles.agents).filter((p) => readiness(p).ready).length;
    logger.info(profiles.exists
      ? `Agents: ${Object.keys(profiles.agents).length} profile(s), ${ready} ready${profiles.default ? `, default ${profiles.default}` : ''}${profiles.errors.length ? `, ${profiles.errors.length} problem(s) in ${profiles.file}` : ''}`
      : 'Agents: no .flowweaver/agents.yaml. Agent gates wait for a person (fw agents --init writes a starter)');
  } else {
    logger.info('Agents: off. Agent gates wait for a person');
  }
  logger.info(`File watching: ${options.watch !== false ? 'enabled' : 'disabled'}`);
  logger.newline();

  const server = new WebhookServer({
    port,
    host,
    workflowDir,
    watchEnabled: options.watch !== false,
    production: options.production ?? false,
    precompile: options.precompile ?? false,
    corsOrigin: options.cors,
    swaggerEnabled: options.swagger ?? false,
    token,
    agents,
    trace,
    dev: options.dev ?? false,
    // Callbacks to localhost are what testing a callback locally needs;
    // in production they are the classic request-forgery hole.
    callbacks: options.dev ? { allowPrivate: true } : undefined,
    onCallback: (o) => { if (!o.ok) logger.warn(`callback for run ${o.runId} → ${o.url}: ${o.error ?? o.status}${o.gaveUp ? ' (gave up)' : ` (attempt ${o.attempt})`}`); },
  });

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
  const url = server.url || `http://${host}:${port}`;
  const endpoints = server.getServerInfo?.().endpoints;
  logger.info(`Listening: ${url}${endpoints !== undefined ? `  (${endpoints} workflow endpoint${endpoints === 1 ? '' : 's'})` : ''}`);
  logger.info(`OpenAPI: ${url}/openapi.json`);
  if (options.swagger) logger.info(`Swagger UI: ${url}/docs`);
  announceService({ kind: 'serve', transport: 'http', url, project: workflowDir });
}
