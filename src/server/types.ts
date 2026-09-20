/**
 * Types for `fw serve`: workflows as HTTP endpoints, runs as resources.
 */
import type { AgentNote } from '../coordinator/run-store.js';

/** A workflow exposed as an HTTP endpoint. */
export interface WorkflowEndpoint {
  /** Workflow name (used in the URL). */
  name: string;
  /** Function name in the source file. */
  functionName: string;
  /** Path to the source file. */
  filePath: string;
  /** HTTP method for the endpoint. */
  method: 'POST' | 'GET';
  /** URL path for the endpoint. */
  path: string;
  /** JSON Schema for the input parameters. */
  inputSchema?: Record<string, unknown>;
  /** JSON Schema for the output. */
  outputSchema?: Record<string, unknown>;
  /** Workflow description. */
  description?: string;
  /** How many durable gates the workflow declares; a gated workflow answers 202 and a run id. */
  gates?: number;
  /** The routes the workflow declares with `@http`, in order. */
  routes?: import('../ast/types.js').THttpRoute[];
}

/** Configuration for the server. */
export interface WebhookServerConfig {
  port: number;
  host: string;
  /** Directory containing the workflow files; also where `.flowweaver/agents.yaml` is looked for. */
  workflowDir: string;
  /** Re-discover workflows when files change. */
  watchEnabled: boolean;
  /** CORS origin; unset means no CORS headers are sent. */
  corsOrigin?: string | string[];
  /** Deprecated alias for `trace: false`. */
  production?: boolean;
  /** Accepted for compatibility; workflows are compiled by the coordinator as they run. */
  precompile?: boolean;
  /** Serve Swagger UI at /docs. The spec at /openapi.json is always there. */
  swaggerEnabled?: boolean;
  /** Bearer token every route except /health must carry. Unset means open. */
  token?: string;
  /** Answer agent gates from the project's agent profiles. Default true. */
  agents?: boolean;
  /** Keep a step trace for every run and stream it on /runs/:id/events. Default false. */
  trace?: boolean;
  /** Development conveniences: error stacks in responses, `mocks` accepted in a start body. */
  dev?: boolean;
  /** Where runs are stored; defaults to the shared `~/.fw/runs`. */
  runsDir?: string;
  /** A run store of your own in place of the directory. */
  store?: import('../coordinator/store.js').RunStore;
  /** The environment agent profiles read their keys from. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Build the provider for a profile yourself -- an embedding's own client, or a test's fake. */
  agentProvider?: (profile: import('../agent/profiles.js').AgentProfile, env: NodeJS.ProcessEnv) => import('../agent/types.js').AgentProvider;
  /** Also mount every workflow at `POST /workflows/<name>`, declared or not. Default true. */
  legacyRoutes?: boolean;
  /** Which callback URLs are delivered to; public hosts only by default. */
  callbacks?: import('./callback-url.js').CallbackPolicy & { sweepMs?: number };
  /** The largest request body read. Default 1 MiB. */
  maxBodyBytes?: number;
  /** Segments started by requests that may run at once; past it, 503. Default 32. */
  maxInFlight?: number;
  /** The longest a request waits for its segment before answering 202. Default 60 s. */
  maxWaitMs?: number;
  /** Every state change of a run, for logs and metrics. */
  onRun?: (run: RunResponse) => void;
  /** Every callback delivery attempt. */
  onCallback?: (outcome: { runId: string; url: string; ok: boolean; status?: number; error?: string; attempt: number; gaveUp?: boolean }) => void;
}

/** A run as the API shows it. */
export interface RunResponse {
  runId: string;
  workflow: string;
  status: 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled';
  startedAt: string;
  updatedAt: string;
  params?: Record<string, unknown>;
  /** Present while `waiting`: the gate and what it needs. */
  gate?: {
    id: string;
    kind: 'approval' | 'input' | 'agent' | 'timer';
    node: string;
    inputs: Record<string, unknown>;
    absent: string[];
    outputs: string[];
    hasFailurePort: boolean;
  };
  /**
   * Present while `waiting` when the clock will move the run: a `timer` gate
   * wakes (`wake`) at `at`; a gate given a `timeout` takes its failure path
   * (`timeout`) at `at`. The API's sweep does it; nobody has to call resolve.
   */
  due?: { at: string; action: 'wake' | 'timeout' };
  /** What an agent profile is doing, or did, about the run's agent gate. */
  agent?: AgentNote;
  /** Present when `completed`. */
  result?: unknown;
  /** Present when `failed`. */
  error?: ErrorDetail;
  /** Milliseconds the answering segment took, on a synchronous start or resume. */
  executionTime?: number;
  /** Where to go next. */
  links: { self: string; events: string; result: string; resolve?: string; cancel?: string };
}

export interface ErrorDetail {
  code: string;
  message: string;
  /** Field-level detail, such as which parameters were missing. */
  details?: unknown;
  stack?: string;
}

export interface ErrorBody {
  error: ErrorDetail;
}

/** Health check response. */
export interface HealthResponse {
  status: 'ok' | 'error';
  timestamp: string;
  workflows: number;
  uptime?: number;
  version: string;
  auth: 'token' | 'open';
  agents: boolean;
  /** Declared `@http` routes mounted. */
  routes: number;
}

/** Workflow list response. */
export interface WorkflowListResponse {
  count: number;
  workflows: Array<{
    name: string;
    path: string;
    method: string;
    description?: string;
    gates?: number;
    routes?: import('../ast/types.js').THttpRoute[];
    inputSchema?: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
  }>;
}

/**
 * @deprecated The pre-0.39 execution response. `POST /workflows/:name` now
 * answers with a `RunResponse`. Kept so older imports still compile.
 */
export interface ExecutionResult {
  success: boolean;
  workflow: string;
  executionTime: number;
  result?: unknown;
  error?: { message: string; stack?: string };
  trace?: Array<{ type: string; timestamp: number; data?: unknown }>;
}
