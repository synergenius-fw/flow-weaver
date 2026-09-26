/**
 * Workflows as HTTP endpoints, as a handler any server can mount.
 *
 * `createWorkflowApi` builds the whole surface -- declared `@http` routes,
 * the run resources, health, the OpenAPI document -- against two small
 * interfaces (`ServerRequest`, `ServerResponse`) that Node's own request and
 * response satisfy structurally. So the same object serves `fw serve`
 * (`http.createServer(api.node())`), an Express app (`app.use('/api',
 * api.express())`), and a fetch-style host such as Hono, Next or Bun
 * (`api.fetch(request)`), without a framework dependency in this package.
 *
 * What makes a workflow an endpoint is its `@http` tag: `POST /reviews` binds
 * the workflow's params to the path, the query string or the JSON body, and
 * answers with the workflow's return ports -- `onSuccess` as 200,
 * `onFailure` as 422. A workflow that pauses at a gate answers 202 with a run
 * id and a Location to follow; `mode=async` answers 202 at once; `callback`
 * lets a caller name a URL that receives the final response. An
 * `Idempotency-Key` header makes a retried request the same run. Every run
 * lives in the shared coordinator store, so a gate reached here can be
 * answered in the console, over MCP, or by an agent profile.
 *
 * This module puts the pieces together and decides which handles a request:
 * a declared route first, since it is the workflow's own contract; then a
 * CORS preflight; then, only under the API's reserved paths and past the
 * token, the description (`routes-catalog.ts`) and the run resources
 * (`routes-runs.ts`). Runs are driven by `run-driver.ts`.
 */
import * as path from 'node:path';
import { WorkflowRegistry } from './workflow-registry.js';
import { buildOpenApi } from './openapi.js';
import type { CallbackPolicy } from './callback-url.js';
import { createLocalCoordinator, defaultRunsDir, reclaimStaleAgentAnswers, type LocalCoordinator, type RunStore } from '../coordinator/index.js';
import type { AgentProfile } from '../agent/profiles.js';
import type { AgentProvider } from '../agent/types.js';
import type { THttpRoute } from '../ast/types.js';
import type { RunResponse, ErrorBody, WorkflowEndpoint } from './types.js';
import { getErrorMessage } from '../utils/error-utils.js';
import { authorized, cors } from './access.js';
import type { ApiContext } from './context.js';
import { errorToHttp, HttpError } from './http-error.js';
import { json } from './respond.js';
import { isReserved, mountRoutes, type CompiledRoute } from './route-plan.js';
import { declaredRoute } from './routes-declared.js';
import { serveCatalog } from './routes-catalog.js';
import { serveRuns } from './routes-runs.js';
import { createRunDriver } from './run-driver.js';
import { fetchAdapter, type ServerRequest, type ServerResponse } from './transport.js';

export type { ServerRequest, ServerResponse } from './transport.js';
export { HttpError, errorToHttp } from './http-error.js';
export { isLoopback } from './access.js';
export { RESERVED_PATHS, planRoutes } from './route-plan.js';

export interface WorkflowApiOptions {
  /** The project: its workflows, and its `.flowweaver/agents.yaml`. */
  dir: string;
  /** Bearer token every route but /health must carry. Unset means open. */
  token?: string;
  /** Answer agent gates from the project's agent profiles. Default true. */
  agents?: boolean;
  /** Keep a step trace per run and stream it. Default false. */
  trace?: boolean;
  /** Error stacks in responses; `mocks` accepted in a start body. */
  dev?: boolean;
  /** Where runs are stored. Default: the project's `.fw/runs` next to `dir`, the store `fw console` and `fw_run` use too. */
  runsDir?: string;
  /** A run store of your own -- a database, for several instances -- in place of the directory. */
  store?: RunStore;
  /** Re-discover workflows when files change. Default false; `fw serve` turns it on. */
  watch?: boolean;
  /** Also mount every workflow at `POST /workflows/<name>`, declared or not. Default true. */
  legacyRoutes?: boolean;
  /** CORS origin. Unset sends no CORS headers. */
  cors?: string | string[];
  /** The environment agent profiles read their keys from. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Build the provider for a profile yourself -- an embedding's own client, or a test's fake. */
  agentProvider?: (profile: AgentProfile, env: NodeJS.ProcessEnv) => AgentProvider;
  /** How the run says where it came from; `fw serve` says `http`. */
  origin?: string;
  /** The largest request body read from the stream. Default 1 MiB. */
  maxBodyBytes?: number;
  /**
   * Which callback URLs are delivered to. By default only public http(s)
   * hosts. See `CallbackPolicy`. `sweepMs` is how often pending callbacks
   * are retried and runs finished elsewhere are checked (default 3 s).
   */
  callbacks?: CallbackPolicy & { sweepMs?: number };
  /** Called on every state change of a run this API drives: started, waiting, completed, failed, cancelled. For your logs and metrics. */
  onRun?: (run: RunResponse) => void;
  /** Called after each callback delivery attempt. */
  onCallback?: (outcome: { runId: string; url: string; ok: boolean; status?: number; error?: string; attempt: number; gaveUp?: boolean }) => void;
  /**
   * How many segments started by requests may run at once. Past it a start
   * or a resolve answers 503 with Retry-After. Default 32. Agent answers
   * and callbacks are not counted.
   */
  maxInFlight?: number;
  /**
   * The longest a request waits for its segment before answering 202 with
   * the run to follow, so a proxy never cuts a slow workflow's response.
   * `Prefer: wait=<seconds>` asks for less. Default 60 s.
   */
  maxWaitMs?: number;
  /** Serve Swagger UI at /docs and make it and /openapi.json readable without the token. Default false. */
  docs?: boolean;
}

/** One declared route, as `routes()` reports it. */
export interface RouteInfo {
  method: THttpRoute['method'];
  path: string;
  workflow: string;
  file: string;
  mode: 'sync' | 'async';
  auth: 'bearer' | 'none';
  callback: boolean;
  gates: number;
}

export interface WorkflowApi {
  /** Discovery done, so it is safe to serve. Called for you by the adapters. */
  ready(): Promise<void>;
  /**
   * Handle a request if it is ours. `basePath` is the mount prefix, for the
   * links in responses; `body` is a body your framework already parsed
   * (Fastify's `request.body`, say), used instead of reading the stream.
   */
  handle(req: ServerRequest, res: ServerResponse, opts?: { basePath?: string; body?: unknown }): Promise<boolean>;
  /** Deliver every pending callback now, instead of waiting for the next sweep. Ticks the clock first. */
  deliverCallbacks(): Promise<void>;
  /** Let the clock act now: wake the runs whose sleep is over, time out the gates whose timeout has passed. */
  tick(): Promise<void>;
  /** A Node request listener that answers 404 for anything that is not ours. */
  node(): (req: ServerRequest, res: ServerResponse) => void;
  /** Express-style middleware: handles what is ours, calls `next()` for the rest. */
  express(): (req: ServerRequest & { baseUrl?: string }, res: ServerResponse, next: (err?: unknown) => void) => void;
  /** A fetch-style handler for hosts that speak Request and Response. */
  fetch(request: Request, opts?: { basePath?: string }): Promise<Response>;
  /** The OpenAPI document. */
  openapi(serverUrl?: string): object;
  /** The declared routes, and what was refused. */
  routes(): { routes: RouteInfo[]; problems: string[] };
  /** Every endpoint the registry found. */
  endpoints(): WorkflowEndpoint[];
  /** Stop watching, end streams, stop what is in flight. */
  close(): Promise<void>;
}

const DEFAULT_MAX_BODY = 1024 * 1024;

export function createWorkflowApi(options: WorkflowApiOptions): WorkflowApi {
  const dir = path.resolve(options.dir);
  const registry = new WorkflowRegistry(dir);
  const coordinator: LocalCoordinator = createLocalCoordinator(options.store ? { store: options.store } : { rootDir: options.runsDir ?? defaultRunsDir(dir) });
  let compiled: CompiledRoute[] = [];
  let routeProblems: string[] = [];
  let readyPromise: Promise<void> | undefined;
  const legacy = options.legacyRoutes !== false;
  const agentsOn = options.agents !== false;
  const runs = createRunDriver({
    dir,
    coordinator,
    workflowNames: () => new Set(registry.getAllEndpoints().map((e) => e.functionName)),
    agents: agentsOn,
    env: options.env,
    agentProvider: options.agentProvider,
    trace: options.trace,
    origin: options.origin,
    maxInFlight: options.maxInFlight ?? 32,
    onRun: options.onRun,
    callbacks: options.callbacks,
    token: options.token,
    onCallback: options.onCallback,
  });
  let sweeper: NodeJS.Timeout | undefined;

  const ctx: ApiContext = {
    registry,
    coordinator,
    runs,
    token: options.token,
    dev: options.dev,
    docs: options.docs,
    legacy,
    agents: agentsOn,
    maxBody: options.maxBodyBytes ?? DEFAULT_MAX_BODY,
    maxWait: options.maxWaitMs ?? 60_000,
    callbackPolicy: options.callbacks,
    mounted: () => ({ compiled, problems: routeProblems }),
    openapi: (serverUrl, base) => openapi(serverUrl, base),
  };

  // ------------------------------------------------------------ discovery

  function compileRoutes(): void {
    ({ compiled, problems: routeProblems } = mountRoutes(registry.getAllEndpoints()));
  }

  async function ready(): Promise<void> {
    readyPromise ??= (async () => {
      await registry.initialize();
      compileRoutes();
      if (options.watch) await registry.startWatching(compileRoutes);
      // A process that died mid-answer must not keep its gate locked.
      await reclaimStaleAgentAnswers(coordinator);
      await runs.callbacks.scan(new Set(registry.getAllEndpoints().map((e) => e.functionName)));
      const every = options.callbacks?.sweepMs ?? 3_000;
      sweeper = setInterval(() => { void sweep(); }, every);
      sweeper.unref?.();
    })();
    return readyPromise;
  }

  /** The periodic pass: the clock first, then the callbacks. */
  async function sweep(): Promise<void> {
    await runs.tick();
    await runs.callbacks.deliverPending();
  }

  // -------------------------------------------------------------- handler

  async function handle(req: ServerRequest, res: ServerResponse, opts: { basePath?: string; body?: unknown } = {}): Promise<boolean> {
    await ready();
    const base = (opts.basePath ?? '').replace(/\/$/, '');
    const url = new URL(req.url ?? '/', 'http://x');
    let p = url.pathname;
    if (base && p.startsWith(base)) p = p.slice(base.length) || '/';
    const method = (req.method ?? 'GET').toUpperCase();
    try {
      // Declared routes first: they are the workflow's own contract.
      for (const c of compiled) {
        if (c.route.method !== method) continue;
        const m = p.match(c.regex);
        if (!m) continue;
        cors(req, res, options.cors);
        await declaredRoute(ctx, req, res, c, m, url, base, opts.body);
        return true;
      }
      if (method === 'OPTIONS' && (compiled.some((c) => p.match(c.regex)) || isReserved(p))) {
        cors(req, res, options.cors); res.writeHead(204); res.end(); return true;
      }
      if (!isReserved(p)) return false;
      cors(req, res, options.cors);
      // Swagger UI is a page in a browser, which cannot send the token; when
      // the docs are on, the page and the document it loads are readable.
      const open = p === '/health' || (options.docs && (p === '/docs' || p === '/openapi.json'));
      if (!open && !authorized(req, options.token)) throw new HttpError(401, 'UNAUTHORIZED', 'a bearer token is required');

      if (await serveCatalog(ctx, req, res, method, p, url, base, opts.body)) return true;
      if (await serveRuns(ctx, req, res, method, p, url, base, opts.body)) return true;
      throw new HttpError(404, 'NOT_FOUND', `no route for ${method} ${p}`);
    } catch (err) {
      const e = errorToHttp(err);
      const body: ErrorBody = { error: { code: e.code, message: e.message, ...(e.details !== undefined ? { details: e.details } : {}), ...(options.dev && err instanceof Error && err.stack ? { stack: err.stack } : {}) } };
      if (!res.headersSent) json(res, e.status, body, e.headers ?? {});
      else res.end();
      return true;
    }
  }

  function openapi(serverUrl?: string, base = ''): object {
    return buildOpenApi({ endpoints: registry.getAllEndpoints(), mounted: compiled.map((c) => ({ endpoint: c.endpoint, route: c.route, keys: c.keys })), legacy, secured: !!options.token, serverUrl, base });
  }

  // -------------------------------------------------------------- adapters

  const api: WorkflowApi = {
    ready,
    handle,
    node: () => (req, res) => {
      handle(req, res).then((handled) => {
        if (!handled && !res.headersSent) json(res, 404, { error: { code: 'NOT_FOUND', message: `no route for ${req.method} ${req.url}` } });
      }).catch((err) => { if (!res.headersSent) json(res, 500, { error: { code: 'INTERNAL', message: getErrorMessage(err) } }); });
    },
    express: () => (req, res, next) => {
      handle(req, res, { basePath: req.baseUrl ?? '' }).then((handled) => { if (!handled) next(); }).catch(next);
    },
    fetch: (request, opts) => fetchAdapter(handle, request, opts),
    openapi: (serverUrl) => openapi(serverUrl),
    routes: () => ({
      routes: compiled.map((c) => ({ method: c.route.method, path: c.route.path, workflow: c.endpoint.name, file: c.endpoint.filePath, mode: c.route.mode ?? 'sync', auth: c.route.auth ?? 'bearer', callback: !!c.route.callback, gates: c.endpoint.gates ?? 0 })),
      problems: routeProblems,
    }),
    endpoints: () => registry.getAllEndpoints(),
    deliverCallbacks: sweep,
    tick: runs.tick,
    close: async () => {
      if (sweeper) clearInterval(sweeper);
      sweeper = undefined;
      await registry.stopWatching();
      runs.close();
    },
  };
  return api;
}
