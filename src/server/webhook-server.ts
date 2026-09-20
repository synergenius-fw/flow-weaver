/**
 * `fw serve`: the workflow API on its own Node server.
 *
 * Everything that answers a request lives in `createWorkflowApi`
 * (`api.ts`), which is what an Express app or a fetch-style host mounts.
 * This class only owns the listening socket, so `fw serve` and an embedded
 * mount behave identically.
 */
import * as http from 'node:http';
import { createWorkflowApi, type WorkflowApi } from './api.js';
import type { WebhookServerConfig } from './types.js';

export { HttpError, errorToHttp, isLoopback } from './api.js';
export type { CallbackPolicy } from './callback-url.js';

export class WebhookServer {
  private server: http.Server | null = null;
  readonly api: WorkflowApi;
  private config: WebhookServerConfig;
  /** Where the server is listening, once it is. */
  url = '';

  constructor(config: WebhookServerConfig) {
    this.config = config;
    this.api = createWorkflowApi({
      dir: config.workflowDir,
      token: config.token,
      agents: config.agents,
      trace: config.trace,
      dev: config.dev,
      runsDir: config.runsDir,
      store: config.store,
      watch: config.watchEnabled,
      legacyRoutes: config.legacyRoutes,
      cors: config.corsOrigin,
      env: config.env,
      agentProvider: config.agentProvider,
      origin: 'http',
      callbacks: config.callbacks,
      maxBodyBytes: config.maxBodyBytes,
      maxInFlight: config.maxInFlight,
      maxWaitMs: config.maxWaitMs,
      docs: config.swaggerEnabled,
      onRun: config.onRun,
      onCallback: config.onCallback,
    });
  }

  /** Start listening. `port: 0` picks a free one; `url` says which. */
  async start(): Promise<void> {
    await this.api.ready();
    this.server = http.createServer(this.api.node());
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(this.config.port, this.config.host, () => { this.server!.off('error', reject); resolve(); });
    });
    const addr = this.server.address();
    const port = typeof addr === 'object' && addr ? addr.port : this.config.port;
    const host = this.config.host === '0.0.0.0' || this.config.host === '::' ? '127.0.0.1' : this.config.host;
    this.url = `http://${host.includes(':') ? `[${host}]` : host}:${port}`;
  }

  /** Stop listening, end every stream, and stop what is in flight. */
  async stop(): Promise<void> {
    await this.api.close();
    if (this.server) {
      const s = this.server;
      this.server = null;
      s.closeAllConnections?.();
      await new Promise<void>((resolve) => s.close(() => resolve()));
    }
  }

  getServerInfo(): { port: number; host: string; endpoints: number; routes: number; url: string } {
    return { port: this.config.port, host: this.config.host, endpoints: this.api.endpoints().length, routes: this.api.routes().routes.length, url: this.url };
  }

  buildOpenApiSpec(): object {
    return this.api.openapi(this.url || undefined);
  }
}
