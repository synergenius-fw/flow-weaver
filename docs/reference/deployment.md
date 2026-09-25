---
name: Deployment
description: Export workflows through target packs, serve them over HTTP, generate OpenAPI specs, and export multi-workflow services
keywords: [deploy, export, target, serve, openapi, swagger, multi-workflow, durable-steps, webhook, http, cors, packs, marketplace, dry-run]
---

# Deployment

The compiled output is plain TypeScript with no runtime dependency on Flow Weaver, so it runs wherever TypeScript runs. Beyond that, three paths exist: export platform-specific boilerplate through a target pack, serve workflows over HTTP with `fw serve`, or generate an OpenAPI spec for whatever hosts them.

## Export Targets

Flow Weaver core ships no export target. A target is provided by a pack — its `exportTargets` manifest entry names the target and the class that generates files — and is discovered from the current project's `node_modules` each time `fw export` runs.

```bash
fw market search <what you need>      # find a target pack
npm install <pack>                     # or: fw market install <pack>
fw export workflow.ts --target <name> --output dist/
```

- `--dry-run` lists the files that would be written and previews the handler without touching disk
- `--durable-steps` is handed to the target as a target option; a target that supports per-node durability uses it
- `--production` compiles without trace instrumentation
- An unknown target name returns `INVALID_TARGET` naming the installed targets; with no target pack installed that list is empty

What a target generates, the deploy instructions it prints, and any annotations it reads (`@deploy` keys, platform-specific tags) are documented by the pack. Once installed, the pack's topics appear in `fw docs`. Writing a target is covered in [Marketplace](marketplace.md).

---

## Multi-Workflow Export

Export all workflows in a file as a **unified service** with routing, function registry, and optional API documentation:

```bash
fw export workflows.ts --target <name> --output dist/ --multi
```

### Features

- **Unified routing** — Single entry point dispatches to the correct workflow
- **Function registry** — All workflows registered and callable by name
- **API docs** — Add `--docs` to include Swagger UI at `/docs` and OpenAPI spec at `/openapi.json`

```bash
fw export workflows.ts --target <name> --output api/ --multi --docs
```

### Selecting Workflows

Export a subset of workflows from a multi-workflow file:

```bash
fw export workflows.ts --target <name> --output dist/ --multi --workflows validatePipeline,enrichPipeline
```

---

## HTTP Serve Mode

`fw serve` puts a directory of workflows behind HTTP: the routes they declare, a run resource for every one of them, and a URL for every run.

```bash
fw serve [directory] [options]
```

Runs go through the same local coordinator `fw console` and the MCP tools use, stored under the project's `.fw/runs` (`FW_RUNS_DIR` to move it). That is what makes a workflow with durable gates an ordinary endpoint here: it runs to its first gate and answers with a run id; the gate is resolved by another request, by an agent profile, or by a person in the console — the same run, whoever picks it up. The same handler is a function you can mount in your own server; see [Embedding the API](#embedding-the-api).

### Workflows as endpoints

A workflow becomes an endpoint by declaring its route:

```typescript
/**
 * Reviews a file and reports the risk.
 * @flowWeaver workflow
 * @http POST /reviews
 * @http GET /reviews/:path
 * @param path - The file
 * @param text - Its contents
 * @returns report - The review
 */
export async function reviewFile(execute: boolean, params: { path: string; text: string }) { … }
```

Each `@http METHOD /path` line is mounted as written. The console's **Serve** pane writes the first one for you (*Expose as endpoint*), and its **Endpoints** page lists every route in the project with the request to copy.

**Parameters.** A `:name` segment binds the workflow parameter of that name, converted to its declared type. `GET` and `DELETE` take the remaining parameters from the query string; `POST`, `PUT` and `PATCH` take them from the JSON body. A missing required parameter or a wrong type is `400 VALIDATION_ERROR` with `details: [{ path, message }]`.

**The answer** is the workflow's return ports, with `onSuccess`/`onFailure` removed:

| The workflow… | Status | Body | Headers |
|---------------|--------|------|---------|
| ran to the end | `200` | the return ports, e.g. `{ "report": "…" }` | `X-Run-Id` |
| ended on its failure path | `422` | the return ports as they stand | `X-Run-Id` |
| paused at a gate | `202` | the run (below), with `gate` | `Location: /runs/<id>/result`, `Retry-After` |
| still running past the wait | `202` | the run, `status: "running"` | `Location: /runs/<id>/result`, `Retry-After` |
| failed | `500` | `{ error: { code, message }, runId, links }` | `X-Run-Id` |
| cancelled | `410` | `{ error: { code: "RUN_CANCELLED" }, runId, links }` | `X-Run-Id` |

`Location` always points at `GET /runs/<id>/result`, which answers in this same table: `202` while the run waits or runs, then the declared body. So a client polls one URL and reads one shape from its first request to the final answer; the run resource at `/runs/<id>` is there when it wants the gate, the agent, or the raw ports.

A request waits at most 60 s for its run (`maxWaitMs`); a `Prefer: wait=<seconds>` header asks for less. Past that the answer is `202` and the run goes on without the connection, so a proxy that cuts long requests never loses a client its run id. A route with `mode=async` answers `202` before the first step runs; `?async=1` or `Prefer: respond-async` asks the same of any route.

At most 32 segments started by requests run at once (`maxInFlight`); past that a start or a resolve is `503 BUSY` with `Retry-After`. Agent answers and callbacks are not counted.

The API also keeps the clock. Its sweep, every few seconds (`callbacks.sweepMs`), first wakes every run whose `sleep` is over and times out every gate whose `timeout` has passed — then delivers callbacks, so a run the clock finished still posts its result. A waiting run's JSON carries `due: { at, action }` when the clock will act on it. Embedding the API, `api.tick()` is the same pass on demand. See [Time](durable-gates.md#time).

**Retries.** An `Idempotency-Key` header makes the same request the same run: a retry after a timeout returns whatever that run has reached, with `Idempotent-Replayed: true`, instead of starting another. The key is scoped to the route.

**Callbacks.** On a route marked `callback`, the caller may add `"callbackUrl": "https://…"` to the body (or `?callbackUrl=` on a `GET`). When the run ends — however it ends, and whoever ends it: the API, an agent profile, a person in the console — the API POSTs `{ runId, workflow, status, result?, failed?, error? }` there, with `X-Flow-Weaver-Run`, `X-Flow-Weaver-Status`, `X-Flow-Weaver-Attempt` and, when the server has a token, `X-Flow-Weaver-Signature: sha256=<HMAC-SHA256 of the body, keyed with the token>`. The callback is kept beside the run, so a restart does not lose it; a failed delivery is retried after 2 s, 10 s, 1 min, 5 min and 15 min, then given up and the reason recorded. Redirects are not followed. Answer `2xx` to acknowledge.

Only public hosts receive callbacks by default: `localhost`, private ranges, link-local addresses and names that resolve to them are refused with `400 CALLBACK_REFUSED`, because a server fetching a caller-chosen URL is the classic request-forgery hole. `fw serve --dev` allows them for local testing; an embedding sets `callbacks: { hosts: ['hooks.example.com', '*.internal.example.com'] }`, `{ allowPrivate: true }`, or its own `allow(url)` rule.

To verify a callback, recompute the HMAC over the raw body with your token and compare it to the header in constant time:

```typescript
import { createHmac, timingSafeEqual } from 'node:crypto';
const expected = `sha256=${createHmac('sha256', process.env.FW_SERVE_TOKEN!).update(rawBody).digest('hex')}`;
const ok = expected.length === signature.length && timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
```

**Auth.** Every route needs the bearer token when the server has one, except a route marked `auth=none` — for a webhook from a service that cannot carry your token. A form post (`application/x-www-form-urlencoded`) is accepted too, its fields read by the parameters' types, which is what most webhook senders emit.

A route under `/health`, `/workflows`, `/runs`, `/openapi.json` or `/docs` is refused, as is a method and path two workflows both declare; `GET /workflows` lists the `problems`, and the console's Endpoints page shows them. `:name` must be a parameter of the workflow, or the validator reports `HTTP_PARAM_UNKNOWN`.

### The run resource

Every workflow, declared or not, also answers as a run resource:

```
POST /workflows/<name>
Content-Type: application/json
Authorization: Bearer <token>       # when the server has one

{ "param1": "value1", "param2": "value2" }
```

The answer is the run:

| The workflow… | Status | Body |
|---------------|--------|------|
| ran to the end | `200` | `{ runId, status: "completed", result, executionTime, links }` |
| paused at a gate | `202` | `{ runId, status: "waiting", gate: { kind, node, inputs, absent, outputs, hasFailurePort }, agent?, links }` |
| failed | `500` | `{ runId, status: "failed", error: { code, message } }` |

Add `?async=1` (or `Prefer: respond-async`) to be answered at once with `202` and `status: "running"`, then follow `links.self` or `links.events`. `gate.inputs` are labelled by port, as `fw_run` shows them.

### Runs

| Request | Does |
|---------|------|
| `GET /runs?workflow=<name>` | Lists runs, newest first — those in flight here and those in the store |
| `GET /runs/:id` | The run: `status`, `gate` while waiting, `agent` when a profile is involved, `result` or `error` |
| `GET /runs/:id/result` | The declared answer: `202` while waiting or running, `200`/`422` with the return ports, `500`, `410` when cancelled |
| `POST /runs/:id/resolve` | Body `{ "answer": … }` or `{ "reject": "why" }`. The rules for `answer` are the ones under [Durable Gates](durable-gates.md): one output → the value; several → an object with every one; none → `null`. Answers `200` on completion, `202` at the next gate, `409` when the run is not waiting, the file changed since it paused (`BUNDLE_CHANGED`), or an agent is answering |
| `POST /runs/:id/cancel` | Stops a segment in flight or drops a waiting continuation |
| `GET /runs/:id/events` | Server-sent events: the run (`type: "run"`), each step when the server keeps a trace (`type: "event"`), what an agent says while it answers (`type: "agent"`), then `synced` and whatever happens next |
| `GET /runs/:id/agent` | The transcript of the agent that answered the run's latest agent gate |

Errors are `{ "error": { "code", "message" } }`; `--dev` adds the stack. Codes: `UNAUTHORIZED`, `WORKFLOW_NOT_FOUND`, `RUN_NOT_FOUND`, `RUN_NOT_WAITING`, `BUNDLE_CHANGED`, `MISSING_OUTPUTS`, `INVALID_INPUT`, `INVALID_JSON`, `AGENT_ANSWERING`, `EXECUTION_ERROR`.

### Agent gates

When the project has `.flowweaver/agents.yaml`, a run that pauses at a `waitForAgent` gate is answered by the matching profile in the background: the server records `agent: { profile, status: "answering" }` on the run, streams the model's words on `/runs/:id/events`, and resumes with the answer. The caller sees `202 waiting` and, a moment later, `completed` — or `waiting` with `agent.status: "failed"` and the reason, when the profile could not answer and a person must. `--no-agents` turns this off. See [Agent profiles](durable-gates.md#agent-profiles).

While a profile is answering, a resolve from elsewhere is refused with `409 AGENT_ANSWERING`, so two answers never race. The note records which process is answering; if that process dies mid-answer, the next server or console to start marks the note failed and the gate is open again, and a resolve in the meantime ignores a note whose process is gone.

### Options

| Option | Default | Does |
|--------|---------|------|
| `--port <n>` | `3000` | |
| `--host <h>` | `127.0.0.1` | Loopback only. Anything else needs `--token` or `--insecure`, because whoever reaches the port can run your workflows |
| `--token <t>` | `FW_SERVE_TOKEN` | Every request but `/health` must carry `Authorization: Bearer <t>` |
| `--no-agents` | agents on | Agent gates wait for a person |
| `--trace` | off | Keep a step trace per run and stream it; costs a debug build of each workflow |
| `--dev` | off | Stacks in error bodies; a start body may be `{ "params", "mocks" }`; callbacks may go to localhost and private addresses |
| `--insecure` | off | Listen beyond loopback with no token |
| `--no-watch` | watching | Do not re-discover workflows when files change |
| `--cors <origin>` | none | Send CORS headers for that origin |
| `--swagger` | off | Swagger UI at `/docs`; with it on, `/docs` and `/openapi.json` are readable without the token, since a browser page cannot send one. Off, `/docs` is `404` and `/openapi.json` needs the token |

`GET /health` answers without a token: `{ status, workflows, routes, uptime, version, auth: "token" | "open", agents }`. `GET /workflows` lists every workflow with its declared `routes`, its input and output JSON Schema and how many gates it has, plus the `problems` with routes that could not be mounted; `GET /workflows/<name>` is one of them. `GET /openapi.json` describes the declared routes with their path and query parameters and the `200`/`202`/`422` answers, the run resources, and the bearer scheme.

### Embedding the API

`fw serve` is a thin wrapper around a handler that your own server can mount. `@synergenius/flow-weaver/server` exports it:

```typescript
import { createWorkflowApi } from '@synergenius/flow-weaver/server';

const api = createWorkflowApi({
  dir: './workflows',                    // the project: its workflows and .flowweaver/agents.yaml
  token: process.env.FW_SERVE_TOKEN,     // bearer token, unset means open
  agents: true,                          // answer agent gates from the project's profiles
  trace: false,                          // keep and stream a step trace per run
  legacyRoutes: true,                    // also POST /workflows/<name> for every workflow
  runsDir: undefined,                    // where runs live; unset is ~/.fw/runs (fw serve passes the project's .fw/runs)
  maxWaitMs: 60_000,                     // answer 202 with the result URL past this
  maxInFlight: 32,                       // 503 past this many running segments
  callbacks: { hosts: ['hooks.example.com'] },
  docs: false,                           // Swagger UI at /docs, readable without the token
});
```

Then one of the adapters, all serving the same routes:

```typescript
// Node
import * as http from 'node:http';
http.createServer(api.node()).listen(3000);

// Express (or anything with app.use(path, (req, res, next) => …))
app.use('/api', api.express());          // declared routes, /runs, /openapi.json, all under /api

// A fetch host: Bun, Deno, Hono, Cloudflare Workers, Next.js route handlers
export default { fetch: (req: Request) => api.fetch(req) };
```

Links in responses — `Location`, `links.self`, the OpenAPI `servers` entry — are written under the mount path, so a client that follows them never needs to know where the API sits. The `handle(req, res, { basePath })` method under the adapters takes any request and response with Node's shape and returns whether the request was one of ours, for a framework not listed here.

`api.routes()` says what was mounted and what was refused; `api.openapi(serverUrl)` is the document; `api.close()` stops watching, ends every stream and aborts what is in flight. Pass `agentProvider` to build the model client for a profile yourself, and `env` to read keys from somewhere other than `process.env`.

Runs made through an embedded API land in the same store as `fw console` and `fw_run` on the same machine, so a gate reached in your server is answered in the console, and a run started in the console is visible at `GET /runs`. Every run records its `origin` — `http`, `console` or `mcp` — and the console's run list says so.

### Integrating for real

What comes up when the API goes into an existing code base, and what the API does about it:

- **Body parsers.** `express.json()` and `express.urlencoded()` consume the request stream before any later middleware; the API notices `req.body` and uses it instead of reading the stream again. With a framework that parses bodies but does not set `req.body` on the raw request, pass the parsed body yourself:

  ```typescript
  // Fastify
  fastify.all('/api/*', async (request, reply) => {
    reply.hijack();
    const handled = await api.handle(request.raw, reply.raw, { basePath: '/api', body: request.body });
    if (!handled) {
      reply.raw.writeHead(404);
      reply.raw.end();
    }
  });
  ```

- **Your own auth.** Mount the API behind your session or JWT middleware and leave `token` unset; then nothing but your middleware guards it, `auth=none` changes nothing, and callbacks go out unsigned. Or set `token` too, and clients carry both.
- **Your own CORS.** `cors` is off unless asked; a `cors()` middleware in front of the mount works as usual.
- **Long workflows.** Reverse proxies and load balancers cut a request after a minute or so. The API answers `202` with the result URL after `maxWaitMs` (60 s by default) on its own; set it under your proxy's timeout, or declare `mode=async` on a route whose workflow always runs long.
- **Back-pressure.** `maxInFlight` (32) caps the segments running at once; past it callers get `503` and `Retry-After`. Size it to what one process can run, and to the model calls agent gates will make.
- **Shutdown.** Call `api.close()` on `SIGTERM`. A run paused at a gate is safe, it lives in the store. A segment in flight is aborted and the run recorded as failed; a client that used an `Idempotency-Key` can simply repeat the request.
- **Where runs live.** By default the run store is a directory on the host, which is right for one process, or a few on one machine: they share it, and a claim keeps two from driving the same run. Past one host — instances behind a balancer, a container without a disk — pass a `RunStore` of your own (`createWorkflowApi({ store })`, nine methods over a database; see [Run stores](library.md#run-stores)) and every instance sees every run. Either way the workflows are parsed with the TypeScript compiler at startup, which takes seconds and needs Node: edge runtimes and short-lived functions are out; a long-running Node service is the shape.
- **Logs and metrics.** `onRun(run)` fires on every state change of a run the API drives; `onCallback(outcome)` on every delivery attempt. Nothing is written to the console otherwise.
- **Module format.** The package is ESM. From CommonJS, `const { createWorkflowApi } = await import('@synergenius/flow-weaver/server')`.
- **Limits.** Bodies over 1 MiB are refused with `413` (`maxBodyBytes` changes it). A JSON string where a number is declared is `400`; only form posts are coerced.

`fw openapi <dir> --server https://api.example.com/api` writes the same document `/openapi.json` serves, for a client generator or a gateway; `--no-auth` and `--no-legacy` match a server without a token or without the run resources.

### Examples

```bash
fw serve                                           # this directory, 127.0.0.1:3000
fw serve ./workflows --trace --swagger             # every step streamed, docs at /docs
fw serve --host 0.0.0.0 --token "$FW_SERVE_TOKEN"  # reachable from elsewhere, guarded
fw serve --no-agents                               # a person answers every agent gate
```

A declared route, end to end:

```bash
curl -s -X POST localhost:3000/reviews -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: review-notes-1' \
  -d '{"path":"notes.md","text":"TODO: ship it."}'
# 202 { "runId": "5c1e…", "status": "waiting", "gate": { "kind": "agent", "node": "agent", … } }
#     Location: /runs/5c1e…

curl -s -X POST localhost:3000/runs/5c1e…/resolve -H 'Content-Type: application/json' \
  -d '{"answer":{"summary":"No tests.","risk":"high"}}'
# 200 { "runId": "5c1e…", "status": "completed", "result": { "report": "…" } }

curl -s localhost:3000/reviews/notes.md?text=fine     # the GET route: 200 { "report": "…" }
```

Before 0.39, `fw serve` listened on `0.0.0.0`, sent `*` CORS headers, answered `{ success, result }`, mounted nothing but `/workflows/<name>`, and refused any workflow with a gate.

---

## OpenAPI Generation

Generate an OpenAPI specification from all workflows in a directory:

```bash
fw openapi <directory> [options]
```

It is the same document `fw serve` publishes at `/openapi.json`, built by the same code, so the two never disagree. The schemas come from each workflow's `@param` and `@returns` annotations, and the summary from its description.

### Options

```bash
# JSON output (default)
fw openapi ./workflows --output api-spec.json

# YAML output
fw openapi ./workflows --format yaml --output api-spec.yaml

# With server URL
fw openapi ./workflows --server https://api.example.com --title "My API" --version "2.0.0"

# For a server without a token, and without the run resources
fw openapi ./workflows --no-auth --no-legacy
```

### Generated Spec

The document (OpenAPI 3.0.3) describes:

- **Declared routes**: every `@http METHOD /path` that could be mounted, with `:name` segments as path parameters, the remaining parameters as query parameters (`GET`, `DELETE`) or a JSON or form request body (the other methods), the `Idempotency-Key` and `Prefer` headers, `callbackUrl` on a `callback` route, and the answers: `200` with the return ports, `202` when paused at a gate (with `Location`), `400`, `409`, `422` on the failure path, `500`. A route marked `auth=none` carries no security requirement
- **The run resource**: `GET` and `POST /workflows/<name>` for every workflow, unless `--no-legacy`
- **The run endpoints**: `/runs`, `/runs/{runId}`, `/runs/{runId}/resolve`, `/runs/{runId}/cancel`, `/runs/{runId}/events`, `/runs/{runId}/agent`, and `/health`
- **Components**: the `Run` and `Error` schemas, and the bearer security scheme applied to every operation, unless `--no-auth`

---

## Deployment Checklist

1. **Validate** — Run `fw validate workflow.ts --strict` before deploying
2. **Production compile** — Use `--production` to strip debug instrumentation
3. **Test locally** — Use `fw serve` or `fw run` with mocks
4. **Export** — Generate platform-specific code with `fw export --target <name>`
5. **Deploy** — Follow the instructions the target prints with the generated output

---

## Related Topics

- [Marketplace](marketplace.md) — Finding target packs and writing an export target
- [CLI Reference](cli-reference.md) — Full command flags for export, serve, openapi
- [Compilation](compilation.md) — Compile targets and target options
- [Built-in Nodes](built-in-nodes.md) — Mock system for local testing
