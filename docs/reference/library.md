---
name: Using the library
description: Calling a compiled workflow from your own code, driving one that pauses at a gate, and the programmatic API behind the CLI and the MCP tools — with the package's entry points
keywords: [library, programmatic, API, import, call, invoke, createWorkflowRuntime, WorkflowRuntime, runtime, services, mocks, abortSignal, coordinator, createLocalCoordinator, start, resume, parseWorkflow, validateWorkflow, compileWorkflow, generateCode, generateInPlace, runCommand, exports, subpath, entry points, testing]
---

# Using the library

`@synergenius/flow-weaver` is one package: the `fw` CLI, the MCP server, the console, and a library. This topic is about the library — what to import when your own code calls a workflow, when a service needs to drive a workflow that pauses, and when a tool needs what the CLI does without the CLI.

```bash
npm install @synergenius/flow-weaver
```

The compiled workflow file imports nothing from the package; it carries its own runtime section. The code that *calls* the workflow is what needs the package, for one object: the runtime it hands in.

## Calling a compiled workflow

After `fw compile`, the exported workflow function has three parameters:

```typescript
export async function processRecord(
  execute: boolean,
  params: { record: Record },
  __runtime__: WorkflowRuntime,
): Promise<{ onSuccess: boolean; onFailure: boolean; score: number; summary: string }>
```

`execute` is the `Start.execute` signal — pass `true`. `params` is one object with a field per `@param`. The third argument is the runtime: it carries the run's identity and the services the generated code reads. Build it with `createWorkflowRuntime`:

```typescript
import { createWorkflowRuntime } from '@synergenius/flow-weaver';
import { processRecord } from './my-workflow';

const runtime = createWorkflowRuntime({ runId: 'order-4711', workflowId: 'processRecord' });
const result = await processRecord(true, { record: { name: 'Alice', age: 30, email: 'a@x.io' } }, runtime);

result.onSuccess; // true
result.score;     // 85
```

- `runId` is any non-empty string of yours; it names the run in trace events and gate addresses. `workflowId` is the workflow's function name.
- The result is `{ onSuccess, onFailure, ...returns }`, one field per `@returns`.
- A node that throws marks itself failed; unless a `@path x:fail -> …` route catches it, the error propagates out of the call.
- The function is `async` unless it was compiled with `--production` and no node is async. `await` it either way.
- Calling it without the runtime fails at once (`Cannot read properties of undefined (reading 'services')`). The runtime is not optional.

### What the runtime carries

`createWorkflowRuntime({ runId, workflowId, abortSignal?, services? })`. Everything in `services` is optional and read by the generated code or by the built-in nodes:

| Field | Read by | Effect |
|-------|---------|--------|
| `abortSignal` | Every node boundary | Cooperative cancellation: the run stops at the next boundary with `CancellationError` — see [Cancellation](cancellation) |
| `services.mocks` | `delay`, `invokeWorkflow` | `{ fast: true }` skips real delays; `invocations` fakes `invokeWorkflow` results by function id — the same `FwMockConfig` as `fw run --mocks` ([Built-in Nodes](built-in-nodes)) |
| `services.workflowRegistry` | `invokeWorkflow` | The functions it may call, by name |
| `services.debugger` | Trace emission | Receives every trace event (`sendEvent`) — what `fw run --trace` and the console read |
| `services.debugController` | Step-through | A `DebugController` from `@synergenius/flow-weaver/runtime` pauses before and after each node — see [Debugging](debugging) |
| `services.effectAdapter` | `@durableEffect` nodes | The effect contract a coordinator implements — see [Durable Gates](durable-gates) |

```typescript
const ac = new AbortController();
setTimeout(() => ac.abort(), 5_000);

const runtime = createWorkflowRuntime({
  runId: 'nightly-12',
  workflowId: 'syncCatalog',
  abortSignal: ac.signal,
  services: { mocks: { fast: true } },
});
```

### A workflow with a gate

A workflow that contains a durable gate (`waitForEvent`, `waitForAgent`, or a `@durableGate` node) cannot be called this way to completion: at the first gate the call throws `DurableGateYield` — the run has to be persisted and resumed later, by something that owns the continuation. That is what the coordinator is for.

## Driving a workflow that pauses

The local coordinator is what `fw_run`/`fw_resume` and the console use. From code:

```typescript
import { createLocalCoordinator } from '@synergenius/flow-weaver/coordinator';

const runs = createLocalCoordinator();               // ~/.fw/runs, or { rootDir }

let run = await runs.start({
  filePath: '/abs/path/incident-triage.ts',
  workflowName: 'incidentTriage',                    // needed only when the file has several
  params: { incident: { id: 'INC-9', text: 'db is down' } },
});

if (run.status === 'waiting') {
  run.gate;                                          // { kind: 'approval', node: 'signoff', inputs: {…}, absent: […] }
  run = await runs.resume({ runId: run.runId, input: { answer: { decision: 'approved' } } });
  // or: input: { reject: 'not now' }  → continues along onFailure
}

run.status;   // 'completed' | 'failed' | 'cancelled'
run.result;   // the workflow's return value
```

- `start` takes the **source** file. The coordinator compiles a private copy and runs it, so the file does not have to be compiled in place, and the bundle digest it records is what protects a paused run from a changed file.
- A run that pauses is written to `<rootDir>/<runId>/` (`run.json`, `continuation.json`), so `resume` can happen in another process, or tomorrow. `FW_RUNS_DIR` moves the default directory. The console and the MCP tools read the same directory: a gate your service reaches can be answered by a person in `fw console`, and the other way round.
- `input` follows the answer rules in [Durable Gates](durable-gates): one data output → `answer` is the value; several → an object with every one; none → `null`.
- `runs.get(runId)`, `runs.list({ filePath? })`, `runs.record(runId)` (everything persisted), `runs.trace(runId)` (the kept step trace), `runs.cancel(runId)`.
- The second argument to `start`/`resume` watches the run: `{ onEvent(event) {…}, trace: true, abortSignal }`. `trace: true` keeps the step trace beside the record so a later reader has it — the console asks for it; an assistant over MCP does not.
- Errors are classes you can `instanceof`: `ParseError`, `AmbiguousWorkflowError`, `RunNotFoundError`, `RunNotWaitingError`, `BundleChangedError`, `MissingOutputsError`, `InvalidAnswerError`.

If you are writing your own coordinator — persisting continuations in your own store, vouching for the bundle yourself — the engine's contract is described in [Durable Gates](durable-gates) under *Driving a run as a coordinator*.

## The tooling API

Everything the CLI and the MCP tools do to a workflow file is a function on `@synergenius/flow-weaver/api` (also re-exported from the package root):

```typescript
import { parseWorkflow, validateWorkflow, compileWorkflow, generateInPlace, applyModifyOperation } from '@synergenius/flow-weaver/api';

const { ast, errors, warnings } = await parseWorkflow('/abs/order.ts', { workflowName: 'placeOrder' });
if (errors.length) throw new Error(errors.join('\n'));

const report = validateWorkflow(ast);               // { valid, errors, warnings }, each with code, message, nodeId
report.errors.map((e) => `${e.code}: ${e.message}`);

const { ast: next } = applyModifyOperation(ast, 'addConnection', { from: 'price.total', to: 'Exit.total' });
const { code } = generateInPlace(await fs.readFile('/abs/order.ts', 'utf8'), next);   // the file with its annotations and body regenerated

await compileWorkflow('/abs/order.ts');              // parse → validate → generate, written in place
```

| Need | Function | Notes |
|------|----------|-------|
| The AST of a file | `parseWorkflow(file, { workflowName?, projectDir? })` | `projectDir` loads the project's packs first, so their tags parse |
| Is it valid | `validateWorkflow(ast, { mode?: 'draft' })` | The same rules as `fw validate`; `draft` tolerates unimplemented nodes |
| Compile | `compileWorkflow(file, { inPlace?, outputFile?, generate: { production? } })` | In place by default, like `fw compile` |
| Generate without writing | `generateCode(ast)` / `generateInPlace(source, ast)` | Standalone module, or the source file with its marker sections rewritten |
| Change structure | `applyModifyOperation(ast, op, params)` and the `addNode`/`removeNode`/`addConnection`/… functions | What `fw_modify` runs; regenerate with `generateInPlace` afterwards |
| Ask about structure | `getNode`, `getConnections`, `getDependencies`, `getTopologicalOrder`, `findIsolatedNodes`, … | What `fw_query` answers |
| Build an AST from nothing | `new WorkflowBuilder(name).addNodeType(…).addNode(…).connect(…).build()` | Rare; annotations are the intended source |
| Compare two versions | `WorkflowDiffer.compare(before, after)`, `formatDiff` | What `fw diff` prints |
| Run a CLI command in process | `runCommand('validate', { file })` | Same names as the CLI; it refuses to run a gated workflow — use the coordinator |

Beside it:

- `@synergenius/flow-weaver/diagram` — `workflowToSVG(ast)` (the console's spine as an image), `workflowToASCII(ast, { format })`, `buildProcessModel(ast)` (steps in run order, pauses, arms), `buildLanes(model)` (the lane layout)
- `@synergenius/flow-weaver/docs` — `listTopics()`, `readTopic(slug)`, `searchDocs(query)`: this guide, from code
- `@synergenius/flow-weaver/console` — `createConsoleServer({ projectDir, port? })`: the server behind `fw console`, to embed or to run on a port of your own
- `@synergenius/flow-weaver/testing` — `createMockLlmProvider`, `createMockApprovalProvider`, recorders and replayers for the agent templates' adapters

## Entry points

| Import from | For |
|-------------|-----|
| `@synergenius/flow-weaver` | `createWorkflowRuntime`, the AST types, and everything `./api` exports |
| `…/api` | Parse, validate, compile, generate, query, modify |
| `…/runtime` | `createWorkflowRuntime`, `DebugController`, `CancellationError`, `DurableGateYield`, the runtime types |
| `…/coordinator` | `createLocalCoordinator` and its request, view and error types |
| `…/diagram`, `…/docs`, `…/console`, `…/diff`, `…/testing` | As above |
| `…/marketplace`, `…/deployment`, `…/built-in-nodes`, `…/compiler`, `…/generator`, `…/agent` | What packs and export targets build on — see [Marketplace](marketplace) and [Deployment](deployment) |
| `…/cli`, `…/context`, `…/editor`, `…/doc-metadata`, `…/describe`, `…/ast`, `…/constants`, `…/version`, `…/browser`, `…/npm-packages`, `…/generated-branding` | Tooling surfaces used by the CLI, the MCP server and editor integrations |

Anything not on this list is internal and can move between releases.

## Related Topics

- [Tutorial](tutorial) — From an empty file to a compiled workflow; its last step calls the result the way this page describes
- [Durable Gates](durable-gates) — What a gate is, the answer rules, and the contract behind a coordinator
- [Built-in Nodes](built-in-nodes) — `FwMockConfig` and which nodes read it
- [Debugging](debugging) — `DebugController` and trace events
- [Cancellation](cancellation) — What `abortSignal` does at a node boundary
- [Console](console) — The same runs, watched and answered by a person
- [MCP Tools](mcp-tools) — The same operations, from an assistant
