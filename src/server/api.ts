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
 */
import { randomUUID, timingSafeEqual, createHash, createHmac } from 'node:crypto';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { WorkflowRegistry } from './workflow-registry.js';
import { VERSION } from '../generated-version.js';
import { buildOpenApi } from './openapi.js';
import { refuseCallbackUrl, type CallbackPolicy } from './callback-url.js';
import type { ExecutionTraceEvent } from '../mcp/workflow-executor.js';
import {
  createLocalCoordinator,
  buildGateResolution,
  computeBundleDigest,
  answerAgentGate,
  transcriptName,
  ParseError,
  AmbiguousWorkflowError,
  RunNotFoundError,
  RunNotWaitingError,
  BundleChangedError,
  MissingOutputsError,
  InvalidAnswerError,
  isAnswering,
  reclaimStaleAgentAnswers,
  RunBusyError,
  MissingParamsError,
  type LocalCoordinator,
  type RunStore,
  type RunRecord,
  type TraceEntry,
} from '../coordinator/index.js';
import { loadAgentProfiles, type AgentProfiles, type AgentProfile } from '../agent/profiles.js';
import type { AgentGateEvent } from '../agent/gate.js';
import type { AgentProvider } from '../agent/types.js';
import { gateOutputSchemas } from '../console/schema.js';
import { parseWorkflow } from '../api/parse.js';
import type { FwMockConfig } from '../built-in-nodes/mock-types.js';
import type { THttpRoute } from '../ast/types.js';
import type { RunResponse, HealthResponse, WorkflowListResponse, ErrorBody, WorkflowEndpoint } from './types.js';

type Json = Record<string, unknown>;

// ---------------------------------------------------------------- transport

/** What the handler reads from a request. Node's IncomingMessage is one; so is the fetch shim below. */
export interface ServerRequest {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  [Symbol.asyncIterator](): AsyncIterator<Uint8Array | string>;
  on(event: 'close', listener: () => void): unknown;
  /**
   * A body a framework already parsed (`express.json()`, `express.urlencoded()`
   * set this). When present the stream is not read again, which it could not
   * be anyway. A string or Buffer is parsed by the request's content type.
   */
  body?: unknown;
}

/** What the handler writes to a response. Node's ServerResponse is one. */
export interface ServerResponse {
  headersSent: boolean;
  writeHead(status: number, headers?: Record<string, string | number>): unknown;
  setHeader(name: string, value: string): unknown;
  write(chunk: string): unknown;
  end(chunk?: string): unknown;
}

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
  /** Where runs are stored; defaults to the shared `~/.fw/runs`. */
  runsDir?: string;
  /** A run store of your own -- a database, for several instances -- in place of the directory. */
  store?: RunStore;
  /** Re-discover workflows when files change. Default false; `fw serve` turns it on. */
  watch?: boolean;
  /** Also mount every workflow at `POST /workflows/<name>`, declared or not. Default true. */
  legacyRoutes?: boolean;
  /** CORS origin; unset sends no CORS headers. */
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
   * hosts; see `CallbackPolicy`. `sweepMs` is how often pending callbacks
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
  /** Discovery done; safe to serve. Called for you by the adapters. */
  ready(): Promise<void>;
  /**
   * Handle a request if it is ours. `basePath` is the mount prefix, for the
   * links in responses; `body` is a body your framework already parsed
   * (Fastify's `request.body`, say), used instead of reading the stream.
   */
  handle(req: ServerRequest, res: ServerResponse, opts?: { basePath?: string; body?: unknown }): Promise<boolean>;
  /** Deliver every pending callback now, instead of waiting for the next sweep. */
  deliverCallbacks(): Promise<void>;
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

// ------------------------------------------------------------------ errors

export class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown, readonly headers?: Record<string, string>) {
    super(message);
    this.name = 'HttpError';
  }
}

/** The status and code a coordinator refusal maps to. */
export function errorToHttp(err: unknown): HttpError {
  if (err instanceof HttpError) return err;
  if (err instanceof ParseError) return new HttpError(400, 'PARSE_ERROR', err.message);
  if (err instanceof AmbiguousWorkflowError) return new HttpError(400, 'AMBIGUOUS_WORKFLOW', err.message);
  if (err instanceof RunNotFoundError) return new HttpError(404, 'RUN_NOT_FOUND', err.message);
  if (err instanceof RunNotWaitingError) return new HttpError(409, 'RUN_NOT_WAITING', err.message);
  if (err instanceof BundleChangedError) return new HttpError(409, 'BUNDLE_CHANGED', err.message);
  if (err instanceof MissingOutputsError) return new HttpError(400, 'MISSING_OUTPUTS', err.message);
  if (err instanceof InvalidAnswerError) return new HttpError(400, 'INVALID_INPUT', err.message);
  if (err instanceof RunBusyError) return new HttpError(409, 'RUN_IN_FLIGHT', err.message, undefined, { 'Retry-After': '2' });
  if (err instanceof MissingParamsError) return new HttpError(400, 'VALIDATION_ERROR', err.message, err.missing.map((k) => ({ path: k, message: 'required' })));
  const name = (err as { name?: string })?.name;
  if (name === 'ContinuationRefusalError') return new HttpError(409, 'CONTINUATION_REFUSED', err instanceof Error ? err.message : String(err));
  return new HttpError(500, 'EXECUTION_ERROR', err instanceof Error ? err.message : String(err));
}

export const isLoopback = (host: string) => ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host);

const DEFAULT_MAX_BODY = 1024 * 1024;
/** Delay before each retry of a callback; after the last, the server gives up and records why. */
const CALLBACK_BACKOFF_MS = [2_000, 10_000, 60_000, 300_000, 900_000];
/** Paths the API keeps for itself; a declared route under one is refused. */
export const RESERVED_PATHS = ['/health', '/workflows', '/runs', '/openapi.json', '/docs'];
const RESERVED = RESERVED_PATHS;

/**
 * Which declared routes can be mounted together, and why the rest cannot:
 * a route under a reserved path, or the same method and path declared by
 * two workflows. The console asks this of the whole project; the API asks
 * it of what the registry found.
 */
export function planRoutes<T extends { name: string; routes: THttpRoute[] }>(list: T[]): { mounted: Array<{ owner: T; route: THttpRoute }>; problems: string[] } {
  const mounted: Array<{ owner: T; route: THttpRoute }> = [];
  const problems: string[] = [];
  const seen = new Map<string, string>();
  for (const owner of list) {
    for (const route of owner.routes) {
      if (RESERVED.some((r) => route.path === r || route.path.startsWith(`${r}/`))) {
        problems.push(`${owner.name}: @http ${route.method} ${route.path} is under a reserved path (${RESERVED.join(', ')}); not mounted`);
        continue;
      }
      const key = `${route.method} ${route.path}`;
      const other = seen.get(key);
      if (other) { problems.push(`${owner.name}: @http ${key} is already declared by ${other}; not mounted`); continue; }
      seen.set(key, owner.name);
      mounted.push({ owner, route });
    }
  }
  return { mounted, problems };
}
const CONTROL = new Set(['onSuccess', 'onFailure']);

/** A segment in flight here. */
interface Live {
  id: string;
  workflow: string;
  params: Json;
  startedAt: number;
  events: TraceEntry[];
  abort: AbortController;
  error?: string;
}
interface AgentEntry { t: number; e: AgentGateEvent }
interface Compiled { endpoint: WorkflowEndpoint; route: THttpRoute; regex: RegExp; keys: string[] }
/**
 * What a declared-route start remembers beside the run: the route, and the
 * callback with its delivery state. Kept in the run store, so a callback
 * survives a restart and is delivered by whichever API process finds the
 * run finished -- the gate may well have been answered in the console.
 */
interface HttpNote {
  route: { method: string; path: string };
  callbackUrl?: string;
  /** When the callback was accepted. */
  delivered?: string;
  /** Attempts so far, and when the next may be made. */
  attempts?: number;
  nextAt?: string;
  lastError?: string;
  /** Set when every attempt failed; nothing more is tried. */
  gaveUp?: string;
}

/** JSON with keys in a fixed order, so two parameter objects compare by content. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (typeof v === 'object' && v !== null) return `{${Object.keys(v as Json).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Json)[k])}`).join(',')}}`;
  return JSON.stringify(v) ?? 'null';
}

/** A stable run id from an idempotency key, in UUID form so the store treats it like any other. */
function idempotentRunId(scope: string, key: string): string {
  const h = createHash('sha256').update(`${scope}\0${key}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** `/reviews/:id` → a matcher and the names it binds. */
function compileRoute(routePath: string): { regex: RegExp; keys: string[] } {
  const keys: string[] = [];
  const pattern = routePath.split('/').map((seg) => {
    if (seg.startsWith(':')) { keys.push(seg.slice(1)); return '([^/]+)'; }
    return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('/');
  return { regex: new RegExp(`^${pattern}/?$`), keys };
}

/** A query-string or path value as the parameter's declared type. */
function coerce(value: string, schema: Record<string, unknown> | undefined): unknown {
  const type = schema?.type;
  if (type === 'number') { const n = Number(value); return Number.isFinite(n) ? n : value; }
  if (type === 'boolean') return value === 'true' ? true : value === 'false' ? false : value;
  if (type === 'object' || type === 'array' || type === undefined) {
    if (/^[[{]/.test(value.trim())) { try { return JSON.parse(value); } catch { return value; } }
  }
  return value;
}

export function createWorkflowApi(options: WorkflowApiOptions): WorkflowApi {
  const dir = path.resolve(options.dir);
  const registry = new WorkflowRegistry(dir);
  const coordinator: LocalCoordinator = createLocalCoordinator(options.store ? { store: options.store } : options.runsDir ? { rootDir: options.runsDir } : {});
  const live = new Map<string, Live>();
  const agentEvents = new Map<string, AgentEntry[]>();
  const subs = new Map<string, Set<ServerResponse>>();
  let profilesCache: { mtime: number; profiles: AgentProfiles } | undefined;
  let compiled: Compiled[] = [];
  let routeProblems: string[] = [];
  let readyPromise: Promise<void> | undefined;
  const legacy = options.legacyRoutes !== false;
  const agentsOn = options.agents !== false;
  const maxBody = options.maxBodyBytes ?? DEFAULT_MAX_BODY;
  const maxInFlight = options.maxInFlight ?? 32;
  const maxWait = options.maxWaitMs ?? 60_000;
  // Runs with a callback still owed. Filled from the store when the API
  // starts, added to as requests come in, swept on a timer.
  const pending = new Set<string>();
  const delivering = new Set<string>();
  let sweeper: NodeJS.Timeout | undefined;

  // ------------------------------------------------------------ discovery

  function compileRoutes(): void {
    const plan = planRoutes(registry.getAllEndpoints().map((endpoint) => ({ name: endpoint.name, routes: endpoint.routes ?? [], endpoint })));
    compiled = plan.mounted.map(({ owner, route }) => ({ endpoint: owner.endpoint, route, ...compileRoute(route.path) }));
    routeProblems = plan.problems;
  }

  async function ready(): Promise<void> {
    readyPromise ??= (async () => {
      await registry.initialize();
      compileRoutes();
      if (options.watch) await registry.startWatching(compileRoutes);
      // A process that died mid-answer must not keep its gate locked.
      await reclaimStaleAgentAnswers(coordinator);
      await scanPending();
      const every = options.callbacks?.sweepMs ?? 3_000;
      sweeper = setInterval(() => { void sweep(); }, every);
      sweeper.unref?.();
    })();
    return readyPromise;
  }

  /** Runs of our workflows still owing a callback, found once at start. */
  async function scanPending(): Promise<void> {
    const names = new Set(registry.getAllEndpoints().map((e) => e.functionName));
    for (const s of await coordinator.list()) {
      if (!names.has(s.workflowName)) continue;
      const note = await coordinator.kept<HttpNote>(s.runId, 'http');
      if (note?.callbackUrl && !note.delivered && !note.gaveUp) pending.add(s.runId);
    }
  }

  async function sweep(): Promise<void> {
    for (const id of [...pending]) await deliverCallback(id);
  }

  function profiles(): AgentProfiles {
    const file = path.join(dir, '.flowweaver', 'agents.yaml');
    let mtime = 0;
    try { mtime = fs.statSync(file).mtimeMs; } catch { mtime = 0; }
    if (!profilesCache || profilesCache.mtime !== mtime) profilesCache = { mtime, profiles: loadAgentProfiles(dir) };
    return profilesCache.profiles;
  }

  // -------------------------------------------------------------- helpers

  function authorized(req: ServerRequest): boolean {
    const token = options.token;
    if (!token) return true;
    const raw = req.headers.authorization;
    const header = Array.isArray(raw) ? raw[0] : raw;
    const given = /^Bearer\s+(.+)$/i.exec(header ?? '')?.[1]?.trim() ?? '';
    const a = Buffer.from(given), b = Buffer.from(token);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  function header(req: ServerRequest, name: string): string | undefined {
    const v = req.headers[name.toLowerCase()];
    return Array.isArray(v) ? v[0] : v;
  }

  function cors(res: ServerResponse): void {
    const origin = options.cors;
    if (!origin) return;
    res.setHeader('Access-Control-Allow-Origin', Array.isArray(origin) ? origin.join(', ') : origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Prefer, Idempotency-Key, X-Callback-Url');
  }

  function json(res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}): void {
    const text = JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(text), ...extra });
    res.end(text);
  }

  function html(res: ServerResponse, body: string): void {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(body);
  }

  const isForm = (req: ServerRequest) => /application\/x-www-form-urlencoded/i.test(header(req, 'content-type') ?? '');

  /** A body's text as an object: JSON, or a form post's fields as strings. */
  function parseBodyText(text: string, form: boolean): Json {
    const t = text.trim();
    if (!t) return {};
    if (form) {
      const out: Json = {};
      for (const [k, v] of new URLSearchParams(t)) out[k] = v;
      return out;
    }
    let parsed: unknown;
    try { parsed = JSON.parse(t); } catch { throw new HttpError(400, 'INVALID_JSON', 'the body is not valid JSON'); }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new HttpError(400, 'INVALID_JSON', 'the body must be a JSON object');
    return parsed as Json;
  }

  /**
   * The request body. A body the framework already parsed is used as is --
   * the stream cannot be read twice, and `express.json()` will have read
   * it. Otherwise the stream, up to the size limit. `form` says the values
   * are strings from a form post, to be read by the parameters' types.
   */
  async function readBody(req: ServerRequest, given?: unknown): Promise<{ body: Json; form: boolean }> {
    const form = isForm(req);
    const pre = given !== undefined ? given : req.body;
    if (pre !== undefined && pre !== null) {
      if (typeof pre === 'string') return { body: parseBodyText(pre, form), form };
      if (Buffer.isBuffer(pre) || pre instanceof Uint8Array) return { body: parseBodyText(Buffer.from(pre).toString('utf8'), form), form };
      if (typeof pre !== 'object' || Array.isArray(pre)) throw new HttpError(400, 'INVALID_JSON', 'the body must be a JSON object');
      return { body: pre as Json, form };
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      const buf = typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk);
      size += buf.length;
      if (size > maxBody) throw new HttpError(413, 'BODY_TOO_LARGE', `the body may not exceed ${maxBody} bytes`);
      chunks.push(buf);
    }
    return { body: parseBodyText(Buffer.concat(chunks).toString('utf8'), form), form };
  }

  function wantsAsync(req: ServerRequest, url: URL): boolean {
    const q = url.searchParams.get('async');
    if (q !== null) return q !== '0' && q !== 'false';
    return /respond-async/i.test(header(req, 'prefer') ?? '');
  }

  /** How long this request is willing to wait: `Prefer: wait=<seconds>`, never more than the server's limit. */
  function waitBudget(req: ServerRequest): number {
    const m = /wait=(\d+(?:\.\d+)?)/i.exec(header(req, 'prefer') ?? '');
    return m ? Math.min(maxWait, Math.max(0, Number(m[1]) * 1000)) : maxWait;
  }

  /**
   * Wait for the segment, but not past the budget. True when it settled in
   * time (a rejection is rethrown by the caller's own await); false when
   * the request should answer 202 and let the run go on without it.
   */
  async function settledWithin(segment: Promise<unknown>, ms: number): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;
    const done = await Promise.race([
      segment.then(() => true, () => true),
      new Promise<boolean>((r) => { timer = setTimeout(() => r(false), ms); timer.unref?.(); }),
    ]);
    if (timer) clearTimeout(timer);
    if (!done) segment.catch(() => undefined);
    return done;
  }

  /** Refuse a new segment when the server is at its limit. */
  function admit(): void {
    if (live.size >= maxInFlight) throw new HttpError(503, 'BUSY', `${live.size} runs are in flight, the limit here; try again shortly`, undefined, { 'Retry-After': '2' });
  }

  /** The output ports of a completed run, without the control ports. */
  function dataOf(result: unknown): { data: Json; failed: boolean } {
    if (typeof result !== 'object' || result === null || Array.isArray(result)) return { data: { result } as Json, failed: false };
    const r = result as Json;
    const data: Json = {};
    for (const [k, v] of Object.entries(r)) if (!CONTROL.has(k)) data[k] = v;
    return { data, failed: r.onFailure === true };
  }

  // ------------------------------------------------------------ snapshots

  async function snapshot(id: string, base = ''): Promise<RunResponse | undefined> {
    const links = { self: `${base}/runs/${id}`, events: `${base}/runs/${id}/events`, result: `${base}/runs/${id}/result` };
    const l = live.get(id);
    const rec = await coordinator.record(id);
    if (l && !rec) {
      return l.error
        ? { runId: id, workflow: l.workflow, status: 'failed', startedAt: new Date(l.startedAt).toISOString(), updatedAt: new Date().toISOString(), params: l.params, error: { code: 'EXECUTION_ERROR', message: l.error }, links }
        : { runId: id, workflow: l.workflow, status: 'running', startedAt: new Date(l.startedAt).toISOString(), updatedAt: new Date().toISOString(), params: l.params, links: { ...links, cancel: `${base}/runs/${id}/cancel` } };
    }
    if (l && rec) {
      return { runId: id, workflow: rec.workflowName, status: 'running', startedAt: rec.createdAt, updatedAt: new Date().toISOString(), params: rec.params, agent: rec.agent, links: { ...links, cancel: `${base}/runs/${id}/cancel` } };
    }
    if (!rec) return undefined;
    const out: RunResponse = { runId: id, workflow: rec.workflowName, status: rec.status, startedAt: rec.createdAt, updatedAt: rec.updatedAt, params: rec.params, links };
    if (rec.status === 'waiting' && rec.gate) {
      out.gate = { id: rec.gate.id, kind: rec.gate.kind, node: rec.gate.node, inputs: rec.gate.inputs, absent: rec.gate.absent, outputs: rec.gate.outputs, hasFailurePort: rec.gate.hasFailurePort };
      out.links = { ...links, resolve: `${base}/runs/${id}/resolve`, cancel: `${base}/runs/${id}/cancel` };
    }
    if (rec.agent) out.agent = rec.agent;
    if (rec.status === 'completed') out.result = rec.result;
    if (rec.status === 'failed') out.error = { code: 'EXECUTION_ERROR', message: rec.error ?? 'failed' };
    return out;
  }

  /** The HTTP status a run's state reads as on a run resource. */
  const statusFor = (run: RunResponse) => (run.status === 'completed' ? 200 : run.status === 'failed' ? 500 : 202);

  /**
   * Answer in the declared shape from the run's state: the data ports with
   * 200 or 422, the error with 500, or 202 with the run and a Location to
   * poll -- `/runs/:id/result`, which answers in this same shape, so a
   * client sees one shape from its first request to the final answer.
   */
  async function answerDeclared(res: ServerResponse, id: string, base: string, replayed: boolean, executionTime?: number): Promise<void> {
    const snap = (await snapshot(id, base))!;
    const extra: Record<string, string> = { 'X-Run-Id': id, ...(replayed ? { 'Idempotent-Replayed': 'true' } : {}) };
    if (snap.status === 'completed') {
      const { data, failed } = dataOf(snap.result);
      return json(res, failed ? 422 : 200, data, extra);
    }
    if (snap.status === 'failed') return json(res, 500, { error: snap.error, runId: id, links: snap.links } as unknown as Json, extra);
    if (snap.status === 'cancelled') return json(res, 410, { error: { code: 'RUN_CANCELLED', message: 'the run was cancelled' }, runId: id, links: snap.links }, extra);
    if (executionTime !== undefined) snap.executionTime = executionTime;
    return json(res, 202, snap, { ...extra, Location: snap.links.result, 'Retry-After': '2' });
  }

  async function listRuns(workflow: string | undefined, base: string): Promise<{ count: number; runs: RunResponse[] }> {
    const seen = new Set<string>();
    const runs: RunResponse[] = [];
    for (const l of live.values()) {
      if (workflow && l.workflow !== workflow) continue;
      const s = await snapshot(l.id, base); if (s) { runs.push(s); seen.add(l.id); }
    }
    const names = new Set(registry.getAllEndpoints().map((e) => e.functionName));
    for (const r of await coordinator.list()) {
      if (seen.has(r.runId) || !names.has(r.workflowName)) continue;
      if (workflow && r.workflowName !== workflow) continue;
      const s = await snapshot(r.runId, base); if (s) runs.push(s);
    }
    runs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { count: runs.length, runs };
  }

  // --------------------------------------------------------------- driving

  function push(id: string, msg: Json): void {
    const set = subs.get(id);
    if (!set?.size) return;
    const line = `data: ${JSON.stringify(msg)}\n\n`;
    for (const res of set) res.write(line);
  }

  /** The run changed state: tell the streams and the embedding. */
  async function announce(id: string): Promise<void> {
    const run = await snapshot(id);
    push(id, { type: 'run', run: run as unknown as Json });
    if (run) { try { options.onRun?.(run); } catch { /* the hook's problem */ } }
  }

  async function drive(l: Live, segment: (l: Live, onEvent: (ev: ExecutionTraceEvent) => void) => Promise<unknown>): Promise<void> {
    live.set(l.id, l);
    const onEvent = (ev: ExecutionTraceEvent) => {
      const entry = { t: ev.timestamp, e: ev.data ?? ev };
      l.events.push(entry);
      push(l.id, { type: 'event', ...entry });
    };
    try {
      await segment(l, onEvent);
      live.delete(l.id);
    } catch (err) {
      if (await coordinator.record(l.id)) live.delete(l.id);
      else l.error = err instanceof Error ? err.message : String(err);
    }
    await announce(l.id);
    void afterSegment(l.id);
  }

  async function afterSegment(id: string): Promise<void> {
    const rec = await coordinator.record(id);
    if (!rec) return;
    if (rec.status === 'completed' || rec.status === 'failed' || rec.status === 'cancelled') { void deliverCallback(id); return; }
    if (!agentsOn || rec.status !== 'waiting' || rec.gate?.kind !== 'agent') return;
    try {
      const step = await answerAgentGate(coordinator, id, {
        projectDir: dir,
        env: options.env,
        profiles: profiles(),
        provider: options.agentProvider,
        outputSchema: (r) => outputShape(r),
        onEvent: (e) => {
          const entry = { t: Date.now(), e };
          (agentEvents.get(id) ?? agentEvents.set(id, []).get(id)!).push(entry);
          push(id, { ...e, t: entry.t });
        },
      });
      await announce(id);
      if (step.kind === 'answer') await resume(id, { answer: step.answer });
      else if (step.kind === 'reject') await resume(id, { reject: step.reason });
    } catch (err) {
      const rec2 = await coordinator.record(id);
      if (rec2?.agent && (err instanceof MissingOutputsError || err instanceof InvalidAnswerError)) {
        await coordinator.setAgent(id, { ...rec2.agent, status: 'failed', error: `the answer did not fit the gate: ${err.message}` });
        await announce(id);
      }
    }
  }

  async function outputShape(rec: RunRecord) {
    try {
      const parsed = await parseWorkflow(rec.filePath, { workflowName: rec.workflowName, projectDir: path.dirname(rec.filePath) });
      if (parsed.errors.length || !rec.gate) return undefined;
      const inst = parsed.ast.instances.find((i) => i.id === rec.gate!.node);
      const nt = inst ? parsed.ast.nodeTypes.find((n) => n.name === inst.nodeType) ?? parsed.ast.nodeTypes.find((n) => n.functionName === inst.nodeType) : undefined;
      const types = Object.fromEntries(rec.gate.outputs.map((o) => [o, nt?.outputs?.[o]?.tsType ?? 'unknown']));
      return { schema: gateOutputSchemas(parsed.ast, rec.gate.node, rec.filePath), types };
    } catch { return undefined; }
  }

  async function start(endpoint: WorkflowEndpoint, id: string, params: Json, mocks: FwMockConfig | undefined): Promise<void> {
    await drive({ id, workflow: endpoint.name, params, startedAt: Date.now(), events: [], abort: new AbortController() }, (l, onEvent) =>
      coordinator.start(
        { filePath: endpoint.filePath, workflowName: endpoint.functionName, params, runId: id, mocks, agents: agentsOn ? 'auto' : 'manual', origin: options.origin ?? 'http' },
        { onEvent, trace: options.trace === true, abortSignal: l.abort.signal },
      ));
  }

  async function resume(id: string, input: { answer?: unknown } | { reject: string }): Promise<void> {
    const rec = await coordinator.record(id);
    if (!rec) throw new RunNotFoundError(id);
    if (rec.status !== 'waiting' || !rec.gate) throw new RunNotWaitingError(rec.status);
    if (live.has(id)) throw new HttpError(409, 'RUN_IN_FLIGHT', 'the run is already resuming');
    if (isAnswering(rec.agent, rec.gate.id)) throw new HttpError(409, 'AGENT_ANSWERING', `agent profile ${rec.agent!.profile} is answering this gate`);
    const resolve = 'reject' in input ? { reject: input.reject } : { answer: input.answer };
    buildGateResolution(rec.gate, rec.gate.id, resolve);
    if (await computeBundleDigest(rec.filePath, rec.workflowName) !== rec.bundleDigest) throw new BundleChangedError();
    await drive({ id, workflow: rec.workflowName, params: rec.params, startedAt: Date.parse(rec.createdAt), events: [], abort: new AbortController() }, (l, onEvent) =>
      coordinator.resume({ runId: id, input: resolve }, { onEvent, trace: options.trace === true, abortSignal: l.abort.signal }));
  }

  async function cancel(id: string): Promise<void> {
    const l = live.get(id);
    if (l) { l.abort.abort(); return; }
    if ((await coordinator.record(id))?.status === 'waiting') {
      await coordinator.cancel(id);
      await announce(id);
      void deliverCallback(id);
    }
  }

  /**
   * POST the final response to the URL a declared-route caller named.
   *
   * One attempt per call: a failure records when the next may be made and
   * the sweep comes back to it, with growing delays, until the last attempt
   * gives up and says why. Redirects are not followed -- a redirect to a
   * private address would undo the URL check. Signed when the server has a
   * token, with an HMAC of the body.
   */
  async function deliverCallback(id: string): Promise<void> {
    const note = await coordinator.kept<HttpNote>(id, 'http');
    if (!note?.callbackUrl || note.delivered || note.gaveUp) { pending.delete(id); return; }
    const rec = await coordinator.record(id);
    if (!rec) { pending.delete(id); return; }
    if (rec.status === 'waiting' || live.has(id)) { pending.add(id); return; }
    if (note.nextAt && Date.parse(note.nextAt) > Date.now()) { pending.add(id); return; }
    if (delivering.has(id)) return;
    delivering.add(id);
    const attempt = (note.attempts ?? 0) + 1;
    try {
      const body: Json = { runId: id, workflow: rec.workflowName, status: rec.status };
      if (rec.status === 'completed') { const { data, failed } = dataOf(rec.result); body.result = data; body.failed = failed; }
      if (rec.status === 'failed') body.error = { code: 'EXECUTION_ERROR', message: rec.error };
      const text = JSON.stringify(body);
      const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Flow-Weaver-Run': id, 'X-Flow-Weaver-Status': rec.status, 'X-Flow-Weaver-Attempt': String(attempt) };
      if (options.token) headers['X-Flow-Weaver-Signature'] = `sha256=${createHmac('sha256', options.token).update(text).digest('hex')}`;
      let error = '';
      let status: number | undefined;
      try {
        const r = await fetch(note.callbackUrl, { method: 'POST', headers, body: text, redirect: 'manual', signal: AbortSignal.timeout(10_000) });
        status = r.status;
        if (r.ok) {
          await coordinator.keep(id, 'http', { ...note, attempts: attempt, delivered: new Date().toISOString() });
          pending.delete(id);
          options.onCallback?.({ runId: id, url: note.callbackUrl, ok: true, status, attempt });
          return;
        }
        error = r.status >= 300 && r.status < 400 ? `callback answered ${r.status}; redirects are not followed` : `callback answered ${r.status}`;
      } catch (e) { error = e instanceof Error ? e.message : String(e); }
      const gaveUp = attempt >= CALLBACK_BACKOFF_MS.length;
      const next: HttpNote = { ...note, attempts: attempt, lastError: error, ...(gaveUp ? { gaveUp: new Date().toISOString() } : { nextAt: new Date(Date.now() + CALLBACK_BACKOFF_MS[attempt - 1]).toISOString() }) };
      if (await coordinator.record(id)) await coordinator.keep(id, 'http', next);
      if (gaveUp) pending.delete(id); else pending.add(id);
      options.onCallback?.({ runId: id, url: note.callbackUrl, ok: false, status, error, attempt, gaveUp });
    } finally {
      delivering.delete(id);
    }
  }

  // ---------------------------------------------------------------- routes

  /** Parameters for a declared route: the path, then the query or the body, coerced by the params schema. */
  function paramsFor(c: Compiled, m: RegExpMatchArray, url: URL, body: Json, form: boolean): { params: Json; callbackUrl?: string; mocks?: FwMockConfig } {
    const props = (c.endpoint.inputSchema?.properties ?? {}) as Record<string, Record<string, unknown>>;
    const params: Json = {};
    let callbackUrl: string | undefined;
    let mocks: FwMockConfig | undefined;
    if (c.route.method === 'GET' || c.route.method === 'DELETE') {
      for (const [k, v] of url.searchParams) {
        if (k === 'async') continue;
        if (k === 'callbackUrl') { callbackUrl = v; continue; }
        params[k] = coerce(v, props[k]);
      }
    } else {
      for (const [k, v] of Object.entries(body)) {
        if (k === 'callbackUrl' && typeof v === 'string') { callbackUrl = v; continue; }
        if (k === 'mocks' && options.dev && typeof v === 'object' && v !== null) { mocks = v as FwMockConfig; continue; }
        // A form post's fields are strings; a JSON body's types are the caller's own.
        params[k] = form && typeof v === 'string' ? coerce(v, props[k]) : v;
      }
    }
    c.keys.forEach((k, i) => { params[k] = coerce(decodeURIComponent(m[i + 1]), props[k]); });
    const missing = ((c.endpoint.inputSchema?.required as string[] | undefined) ?? []).filter((k) => params[k] === undefined);
    if (missing.length) throw new HttpError(400, 'VALIDATION_ERROR', `missing parameter${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}`, missing.map((k) => ({ path: k, message: 'required' })));
    for (const [k, v] of Object.entries(params)) {
      const t = props[k]?.type;
      if (t === 'number' && typeof v !== 'number') throw new HttpError(400, 'VALIDATION_ERROR', `parameter ${k} must be a number`, [{ path: k, message: 'must be a number' }]);
      if (t === 'boolean' && typeof v !== 'boolean') throw new HttpError(400, 'VALIDATION_ERROR', `parameter ${k} must be true or false`, [{ path: k, message: 'must be a boolean' }]);
      if (t === 'string' && typeof v !== 'string') throw new HttpError(400, 'VALIDATION_ERROR', `parameter ${k} must be text`, [{ path: k, message: 'must be a string' }]);
    }
    return { params, callbackUrl: c.route.callback ? callbackUrl : undefined, mocks };
  }

  async function declaredRoute(req: ServerRequest, res: ServerResponse, c: Compiled, m: RegExpMatchArray, url: URL, base: string, given?: unknown): Promise<void> {
    if (c.route.auth !== 'none' && !authorized(req)) throw new HttpError(401, 'UNAUTHORIZED', 'a bearer token is required');
    const { body, form } = c.route.method === 'GET' || c.route.method === 'DELETE' ? { body: {}, form: false } : await readBody(req, given);
    const { params, callbackUrl, mocks } = paramsFor(c, m, url, body, form);
    if (callbackUrl) {
      const why = await refuseCallbackUrl(callbackUrl, options.callbacks);
      if (why) throw new HttpError(400, 'CALLBACK_REFUSED', `callbackUrl refused: ${why}`, [{ path: 'callbackUrl', message: why }]);
    }
    const idem = header(req, 'idempotency-key');
    const id = idem ? idempotentRunId(`${c.route.method} ${c.route.path}`, idem) : randomUUID();
    if (idem) {
      const before = (await coordinator.record(id))?.params ?? live.get(id)?.params;
      if (before) {
        // The same request again: the same run, wherever it got to. The
        // same key with other parameters is a caller's bug, not a replay.
        if (stable(before) !== stable(params)) throw new HttpError(409, 'IDEMPOTENCY_MISMATCH', 'this Idempotency-Key was already used with different parameters');
        return answerDeclared(res, id, base, true);
      }
    }
    admit();
    const started = Date.now();
    const async = c.route.mode === 'async' || wantsAsync(req, url);
    const segment = start(c.endpoint, id, params, mocks);
    // The note lands right after the run directory exists, so a callback
    // survives a restart between now and the run's end.
    const noteWhenPossible = (async () => {
      for (let i = 0; i < 50 && !(await coordinator.record(id)); i++) await new Promise((r) => setTimeout(r, 20));
      if (!(await coordinator.record(id))) return;
      await coordinator.keep(id, 'http', { route: { method: c.route.method, path: c.route.path }, ...(callbackUrl ? { callbackUrl } : {}) } satisfies HttpNote);
      if (callbackUrl) { pending.add(id); void deliverCallback(id); }
    })();
    if (async) { segment.catch(() => undefined); void noteWhenPossible; return json(res, 202, await snapshot(id, base), { 'X-Run-Id': id, Location: `${base}/runs/${id}/result` }); }
    if (!(await settledWithin(segment, waitBudget(req)))) {
      // Still running past what this request will wait: hand over the run.
      void noteWhenPossible;
      return answerDeclared(res, id, base, false, Date.now() - started);
    }
    await segment;
    await noteWhenPossible;
    // A callback named on a run that already ended fires now.
    void deliverCallback(id);
    return answerDeclared(res, id, base, false, Date.now() - started);
  }

  async function legacyStart(req: ServerRequest, res: ServerResponse, endpoint: WorkflowEndpoint, url: URL, base: string, given?: unknown): Promise<void> {
    const { body: b } = await readBody(req, given);
    const envelope = 'params' in b && typeof b.params === 'object' && b.params !== null && !Array.isArray(b.params) && Object.keys(b).every((k) => ['params', 'mocks'].includes(k));
    const params = (envelope ? b.params : b) as Json;
    const mocks = envelope && options.dev && typeof b.mocks === 'object' && b.mocks !== null ? (b.mocks as FwMockConfig) : undefined;
    admit();
    const id = randomUUID();
    const started = Date.now();
    const segment = start(endpoint, id, params, mocks);
    if (wantsAsync(req, url)) { segment.catch(() => undefined); return json(res, 202, await snapshot(id, base), { Location: `${base}/runs/${id}` }); }
    if (await settledWithin(segment, waitBudget(req))) await segment;
    const snap = (await snapshot(id, base))!;
    snap.executionTime = Date.now() - started;
    return json(res, statusFor(snap), snap, snap.status === 'running' ? { Location: snap.links.self, 'Retry-After': '2' } : {});
  }

  async function resolveRoute(req: ServerRequest, res: ServerResponse, id: string, url: URL, base: string, given?: unknown): Promise<void> {
    const { body: b } = await readBody(req, given);
    const hasAnswer = 'answer' in b, hasReject = 'reject' in b;
    if (hasAnswer === hasReject) throw new HttpError(400, 'INVALID_INPUT', 'give exactly one of answer or reject');
    const input = hasReject ? { reject: String(b.reject ?? '') } : { answer: b.answer };
    admit();
    const started = Date.now();
    const segment = resume(id, input);
    if (wantsAsync(req, url)) { segment.catch(() => undefined); return json(res, 202, await snapshot(id, base), { Location: `${base}/runs/${id}` }); }
    if (await settledWithin(segment, waitBudget(req))) await segment;
    const snap = (await snapshot(id, base))!;
    snap.executionTime = Date.now() - started;
    return json(res, statusFor(snap), snap, snap.status === 'running' ? { Location: snap.links.self, 'Retry-After': '2' } : {});
  }

  async function events(req: ServerRequest, res: ServerResponse, id: string, base: string): Promise<void> {
    const first = await snapshot(id, base);
    const kept = await coordinator.trace(id);
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(`data: ${JSON.stringify({ type: 'run', run: first })}\n\n`);
    const entries: Array<{ t: number; line: string }> = [];
    for (const e of [...kept, ...(live.get(id)?.events ?? [])]) entries.push({ t: e.t, line: JSON.stringify({ type: 'event', ...e }) });
    for (const a of agentEvents.get(id) ?? []) entries.push({ t: a.t, line: JSON.stringify({ ...a.e, t: a.t }) });
    entries.sort((a, b) => a.t - b.t);
    for (const e of entries) res.write(`data: ${e.line}\n\n`);
    res.write(`data: ${JSON.stringify({ type: 'synced' })}\n\n`);
    const set = subs.get(id) ?? subs.set(id, new Set()).get(id)!;
    set.add(res);
    req.on('close', () => { set.delete(res); if (!set.size) subs.delete(id); });
  }

  function describeEndpoint(e: WorkflowEndpoint) {
    return { name: e.name, path: e.path, method: e.method, description: e.description, gates: e.gates, routes: e.routes ?? [], inputSchema: e.inputSchema, outputSchema: e.outputSchema };
  }

  function health(): HealthResponse {
    return { status: 'ok', timestamp: new Date().toISOString(), workflows: registry.getAllEndpoints().length, uptime: registry.getUptime(), version: VERSION, auth: options.token ? 'token' : 'open', agents: agentsOn, routes: compiled.length };
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
        cors(res);
        await declaredRoute(req, res, c, m, url, base, opts.body);
        return true;
      }
      if (method === 'OPTIONS' && (compiled.some((c) => p.match(c.regex)) || RESERVED.some((r) => p === r || p.startsWith(`${r}/`)))) {
        cors(res); res.writeHead(204); res.end(); return true;
      }
      const ours = RESERVED.some((r) => p === r || p.startsWith(`${r}/`));
      if (!ours) return false;
      cors(res);
      // Swagger UI is a page in a browser, which cannot send the token; when
      // the docs are on, the page and the document it loads are readable.
      const open = p === '/health' || (options.docs && (p === '/docs' || p === '/openapi.json'));
      if (!open && !authorized(req)) throw new HttpError(401, 'UNAUTHORIZED', 'a bearer token is required');

      if (method === 'GET' && p === '/health') { json(res, 200, health()); return true; }
      if (method === 'GET' && p === '/workflows') { json(res, 200, { count: registry.getAllEndpoints().length, workflows: registry.getAllEndpoints().map(describeEndpoint), problems: routeProblems } satisfies WorkflowListResponse & { problems: string[] }); return true; }
      if (method === 'GET' && p === '/openapi.json') { json(res, 200, openapi(undefined, base)); return true; }
      if (method === 'GET' && p === '/docs') {
        if (!options.docs) throw new HttpError(404, 'NOT_FOUND', 'docs are off; start with --swagger, or docs: true');
        html(res, swaggerPage(`${base}/openapi.json`)); return true;
      }

      let m = p.match(/^\/workflows\/([^/]+)$/);
      if (m) {
        const endpoint = registry.getEndpoint(decodeURIComponent(m[1]));
        if (!endpoint) throw new HttpError(404, 'WORKFLOW_NOT_FOUND', `Workflow "${m[1]}" not found`);
        if (method === 'GET') { json(res, 200, describeEndpoint(endpoint)); return true; }
        if (method === 'POST') {
          if (!legacy && (endpoint.routes?.length ?? 0) > 0) throw new HttpError(404, 'USE_DECLARED_ROUTE', `use ${endpoint.routes!.map((r) => `${r.method} ${r.path}`).join(' or ')}`);
          if (!legacy) throw new HttpError(404, 'NOT_AN_ENDPOINT', `${endpoint.name} declares no @http route`);
          await legacyStart(req, res, endpoint, url, base, opts.body); return true;
        }
        throw new HttpError(405, 'METHOD_NOT_ALLOWED', `${method} is not allowed here`);
      }

      if (method === 'GET' && p === '/runs') { json(res, 200, await listRuns(url.searchParams.get('workflow') ?? undefined, base)); return true; }
      m = p.match(/^\/runs\/([^/]+)(?:\/(events|resolve|cancel|agent|result))?$/);
      if (m) {
        const id = m[1];
        const snap = await snapshot(id, base);
        if (!snap) throw new HttpError(404, 'RUN_NOT_FOUND', `no run with id ${id}`);
        if (!m[2] && method === 'GET') { json(res, 200, snap); return true; }
        if (m[2] === 'result' && method === 'GET') { await answerDeclared(res, id, base, false); return true; }
        if (m[2] === 'events' && method === 'GET') { await events(req, res, id, base); return true; }
        if (m[2] === 'agent' && method === 'GET') {
          const rec = await coordinator.record(id);
          const gateId = rec?.agent?.gateId;
          const kept = gateId ? await coordinator.kept(id, transcriptName(gateId)) : undefined;
          if (!kept) throw new HttpError(404, 'NO_TRANSCRIPT', 'no agent has answered this run');
          json(res, 200, kept); return true;
        }
        if (m[2] === 'resolve' && method === 'POST') { await resolveRoute(req, res, id, url, base, opts.body); return true; }
        if (m[2] === 'cancel' && method === 'POST') { await cancel(id); json(res, 200, (await snapshot(id, base))!); return true; }
        throw new HttpError(405, 'METHOD_NOT_ALLOWED', `${method} is not allowed here`);
      }
      throw new HttpError(404, 'NOT_FOUND', `no route for ${method} ${p}`);
    } catch (err) {
      const e = errorToHttp(err);
      const body: ErrorBody = { error: { code: e.code, message: e.message, ...(e.details !== undefined ? { details: e.details } : {}), ...(options.dev && err instanceof Error && err.stack ? { stack: err.stack } : {}) } };
      if (!res.headersSent) json(res, e.status, body, e.headers ?? {});
      else res.end();
      return true;
    }
  }

  // --------------------------------------------------------------- openapi

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
      }).catch((err) => { if (!res.headersSent) json(res, 500, { error: { code: 'INTERNAL', message: err instanceof Error ? err.message : String(err) } }); });
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
    close: async () => {
      if (sweeper) clearInterval(sweeper);
      sweeper = undefined;
      await registry.stopWatching();
      for (const l of live.values()) l.abort.abort();
      for (const set of subs.values()) for (const res of set) res.end();
      subs.clear();
    },
  };
  return api;
}

/**
 * Run the handler against a Web Request, answering a Web Response. The
 * response resolves as soon as headers are written, with a stream for the
 * body, so server-sent events flow through hosts that support streaming.
 */
async function fetchAdapter(handle: WorkflowApi['handle'], request: Request, opts?: { basePath?: string }): Promise<Response> {
  const url = new URL(request.url);
  const headers: Record<string, string> = {};
  request.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
  const closeListeners: Array<() => void> = [];
  request.signal?.addEventListener('abort', () => closeListeners.forEach((f) => f()));
  const req: ServerRequest = {
    method: request.method,
    url: url.pathname + url.search,
    headers,
    async *[Symbol.asyncIterator]() {
      if (!request.body) return;
      const reader = request.body.getReader();
      for (;;) { const { value, done } = await reader.read(); if (done) return; yield value; }
    },
    on: (_e, l) => closeListeners.push(l),
  };
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let status = 200;
  const outHeaders = new Headers();
  let resolveResponse!: (r: Response) => void;
  const response = new Promise<Response>((r) => { resolveResponse = r; });
  const stream = new ReadableStream<Uint8Array>({ start(c) { controller = c; }, cancel() { closeListeners.forEach((f) => f()); } });
  let sent = false, ended = false;
  const send = () => { if (sent) return; sent = true; resolveResponse(new Response(status === 204 || status === 304 ? null : stream, { status, headers: outHeaders })); };
  const res: ServerResponse = {
    get headersSent() { return sent; },
    writeHead(s, h) { status = s; for (const [k, v] of Object.entries(h ?? {})) outHeaders.set(k, String(v)); send(); return this; },
    setHeader(k, v) { outHeaders.set(k, v); return this; },
    write(chunk) { send(); controller?.enqueue(encoder.encode(chunk)); return true; },
    end(chunk) { if (ended) return this; if (chunk) this.write(chunk); send(); ended = true; try { controller?.close(); } catch { /* already closed */ } return this; },
  };
  void handle(req, res, opts).then((handled) => {
    if (!handled && !sent) { status = 404; outHeaders.set('Content-Type', 'application/json'); res.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: `no route for ${request.method} ${url.pathname}` } })); }
    else if (!ended) res.end();
  }).catch((err) => { if (!sent) { status = 500; res.end(JSON.stringify({ error: { code: 'INTERNAL', message: err instanceof Error ? err.message : String(err) } })); } else res.end(); });
  return response;
}

function swaggerPage(specUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Flow Weaver API Documentation</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({ url: ${JSON.stringify(specUrl)}, dom_id: '#swagger-ui', presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset], layout: 'BaseLayout' });
  </script>
</body>
</html>`;
}
