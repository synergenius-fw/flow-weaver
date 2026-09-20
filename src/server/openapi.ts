/**
 * The OpenAPI document for a set of workflows: their declared `@http`
 * routes, the run resource each has, and the run endpoints. `fw serve`
 * publishes it at `/openapi.json`; `fw openapi` writes the same document
 * to a file, so the two never disagree.
 */
import type { THttpRoute } from '../ast/types.js';
import type { WorkflowEndpoint } from './types.js';
import { VERSION } from '../generated-version.js';

export interface OpenApiInput {
  /** Every workflow found. */
  endpoints: WorkflowEndpoint[];
  /** The declared routes that were mounted, with the parameters each path binds. */
  mounted: Array<{ endpoint: WorkflowEndpoint; route: THttpRoute; keys: string[] }>;
  /** Whether `POST /workflows/<name>` exists for every workflow. */
  legacy: boolean;
  /** Whether a bearer token guards the API. */
  secured: boolean;
  /** The server's URL, when known; `base` is the mount path under it. */
  serverUrl?: string;
  base?: string;
  info?: { title?: string; version?: string; description?: string };
}

export function buildOpenApi(input: OpenApiInput): Record<string, unknown> {
  const { endpoints, mounted, legacy, secured } = input;
  const base = input.base ?? '';
  const paths: Record<string, object> = {};
  const run = { $ref: '#/components/schemas/Run' };
  const error = { $ref: '#/components/schemas/Error' };
  for (const c of mounted) {
    const e = c.endpoint;
    const props = (e.inputSchema?.properties ?? {}) as Record<string, unknown>;
    const required = (e.inputSchema?.required as string[] | undefined) ?? [];
    const inPath = new Set(c.keys);
    const rest = Object.fromEntries(Object.entries(props).filter(([k]) => !inPath.has(k)));
    const restRequired = required.filter((k) => !inPath.has(k));
    const oaPath = c.route.path.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, '{$1}');
    const parameters: object[] = c.keys.map((k) => ({ name: k, in: 'path', required: true, schema: props[k] ?? {} }));
    const op: Record<string, unknown> = {
      operationId: `${c.route.method.toLowerCase()}_${e.functionName}${c.keys.length ? `_by_${c.keys.join('_')}` : ''}`,
      summary: e.description || `${c.route.method} ${c.route.path}`,
      tags: ['endpoints'],
      ...(c.route.auth === 'none' ? { security: [] } : {}),
      responses: {
        '200': { description: 'The workflow ran to its end', content: { 'application/json': { schema: e.outputSchema ?? { type: 'object' } } } },
        '202': { description: `Paused at a gate${c.route.mode === 'async' ? ', or running' : ''}; follow Location`, headers: { Location: { schema: { type: 'string' } } }, content: { 'application/json': { schema: run } } },
        '400': { description: 'Bad parameters, or a refused callback URL', content: { 'application/json': { schema: error } } },
        '409': { description: 'Idempotency-Key reused with different parameters', content: { 'application/json': { schema: error } } },
        '422': { description: 'The workflow finished on its failure path', content: { 'application/json': { schema: e.outputSchema ?? { type: 'object' } } } },
        '500': { description: 'The run failed', content: { 'application/json': { schema: error } } },
      },
    };
    if (c.route.method === 'GET' || c.route.method === 'DELETE') {
      parameters.push(...Object.entries(rest).map(([k, s]) => ({ name: k, in: 'query', required: restRequired.includes(k), schema: s })));
      if (c.route.callback) parameters.push({ name: 'callbackUrl', in: 'query', required: false, schema: { type: 'string', format: 'uri' }, description: 'Receives the final response by POST' });
    } else {
      op.requestBody = {
        required: restRequired.length > 0,
        content: {
          'application/json': { schema: { type: 'object', properties: { ...rest, ...(c.route.callback ? { callbackUrl: { type: 'string', format: 'uri', description: 'Receives the final response by POST' } } : {}) }, ...(restRequired.length ? { required: restRequired } : {}) } },
          'application/x-www-form-urlencoded': { schema: { type: 'object', properties: rest, ...(restRequired.length ? { required: restRequired } : {}) } },
        },
      };
    }
    parameters.push({ name: 'Idempotency-Key', in: 'header', required: false, schema: { type: 'string' }, description: 'The same key gives the same run' });
    parameters.push({ name: 'Prefer', in: 'header', required: false, schema: { type: 'string', enum: ['respond-async'] }, description: 'Answer 202 before the first step runs' });
    op.parameters = parameters;
    paths[oaPath] = { ...(paths[oaPath] as object ?? {}), [c.route.method.toLowerCase()]: op };
  }
  if (legacy) {
    for (const e of endpoints) {
      paths[e.path] = {
        ...(paths[e.path] as object ?? {}),
        get: { operationId: `describe_${e.functionName}`, summary: `Describe ${e.name}`, tags: ['workflows'], responses: { '200': { description: 'The endpoint and its schemas' } } },
        post: {
          operationId: `run_${e.functionName}`, summary: `Run ${e.name} (run resource)`, tags: ['workflows'],
          parameters: [{ name: 'async', in: 'query', schema: { type: 'boolean' } }],
          requestBody: { required: true, content: { 'application/json': { schema: e.inputSchema || { type: 'object', additionalProperties: true } } } },
          responses: { '200': { description: 'Completed', content: { 'application/json': { schema: run } } }, '202': { description: 'Waiting at a gate, or running when async', content: { 'application/json': { schema: run } } }, '500': { description: 'Failed', content: { 'application/json': { schema: run } } } },
        },
      };
    }
  }
  const runId = { name: 'runId', in: 'path', required: true, schema: { type: 'string' } };
  paths['/runs'] = { get: { operationId: 'listRuns', summary: 'List runs', tags: ['runs'], parameters: [{ name: 'workflow', in: 'query', schema: { type: 'string' } }], responses: { '200': { description: 'Runs, newest first' } } } };
  paths['/runs/{runId}'] = { get: { operationId: 'getRun', summary: 'One run', tags: ['runs'], parameters: [runId], responses: { '200': { description: 'The run', content: { 'application/json': { schema: run } } }, '404': { description: 'No such run' } } } };
  paths['/runs/{runId}/resolve'] = { post: { operationId: 'resolveRun', summary: 'Answer the gate a run is waiting at', tags: ['runs'], parameters: [runId, { name: 'async', in: 'query', schema: { type: 'boolean' } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { answer: { description: 'The gate\'s result' }, reject: { type: 'string' } } } } } }, responses: { '200': { description: 'Completed', content: { 'application/json': { schema: run } } }, '202': { description: 'Waiting at the next gate', content: { 'application/json': { schema: run } } }, '409': { description: 'Not waiting, the file changed, or an agent is answering', content: { 'application/json': { schema: error } } } } } };
  paths['/runs/{runId}/cancel'] = { post: { operationId: 'cancelRun', summary: 'Stop a run', tags: ['runs'], parameters: [runId], responses: { '200': { description: 'The run', content: { 'application/json': { schema: run } } } } } };
  paths['/runs/{runId}/events'] = { get: { operationId: 'runEvents', summary: 'Follow a run as server-sent events', tags: ['runs'], parameters: [runId], responses: { '200': { description: 'text/event-stream: run, event, agent, synced' } } } };
  paths['/runs/{runId}/agent'] = { get: { operationId: 'runAgent', summary: 'The transcript of the agent that answered the latest agent gate', tags: ['runs'], parameters: [runId], responses: { '200': { description: 'The transcript' }, '404': { description: 'No agent answered this run' } } } };
  paths['/health'] = { get: { operationId: 'health', summary: 'Liveness', tags: ['meta'], security: [], responses: { '200': { description: 'ok' } } } };
  return {
    openapi: '3.0.3',
    info: {
      title: input.info?.title ?? 'Flow Weaver API',
      version: input.info?.version ?? VERSION,
      description: input.info?.description ?? `${mounted.length} declared endpoint(s)${legacy ? ` and ${endpoints.length} workflow(s) as run resources` : ''}. A workflow that pauses at a gate answers 202 with a run id.`,
    },
    servers: [{ url: `${input.serverUrl ?? ''}${base}` || '/' }],
    paths,
    tags: [{ name: 'endpoints' }, { name: 'workflows' }, { name: 'runs' }, { name: 'meta' }],
    components: {
      schemas: {
        Run: { type: 'object', properties: { runId: { type: 'string' }, workflow: { type: 'string' }, status: { type: 'string', enum: ['running', 'waiting', 'completed', 'failed', 'cancelled'] }, gate: { type: 'object' }, agent: { type: 'object' }, result: {}, error: error, links: { type: 'object' } } },
        Error: { type: 'object', properties: { error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' }, details: {} } } } },
      },
      ...(secured ? { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } } : {}),
    },
    ...(secured ? { security: [{ bearer: [] }] } : {}),
  };
}
