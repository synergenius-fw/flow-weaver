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

The compiled workflow file imports nothing from the package; it carries its own runtime section, the durable engine included, and exports the helper that builds the one object the workflow takes: the runtime. Calling a compiled workflow needs nothing from the package. The package is for compiling, and for the coordinator, the server and the console when you want them.

## Calling a compiled workflow

After `fw compile`, the exported workflow function has three parameters:

```typescript
export async function processRecord(
  execute: boolean,
  params: { record: Record },
  __runtime__: WorkflowRuntime,
): Promise<{ onSuccess: boolean; onFailure: boolean; score: number; summary: string }>
```

`execute` is the `Start.execute` signal — pass `true`. `params` is one object with a field per `@param`. The third argument is the runtime: it carries the run's identity and the services the generated code reads. Build it with `createWorkflowRuntime`, which the compiled file exports beside the workflow (the package exports the same function, from the same source, for code that already depends on it):

```typescript
import { processRecord, createWorkflowRuntime } from './my-workflow';

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
| `abortSignal` | Every node boundary | Cooperative cancellation: the run stops at the next boundary with `CancellationError` — see [Cancellation](cancellation.md) |
| `services.mocks` | `delay`, `invokeWorkflow` | `{ fast: true }` skips real delays; `invocations` fakes `invokeWorkflow` results by function id — the same `FwMockConfig` as `fw run --mocks` ([Built-in Nodes](built-in-nodes.md)) |
| `services.workflowRegistry` | `invokeWorkflow` | The functions it may call, by name |
| `services.debugger` | Trace emission | Receives every trace event (`sendEvent`) — what `fw run --trace` and the console read |
| `services.debugController` | Step-through | A `DebugController` from `@synergenius/flow-weaver/runtime` pauses before and after each node — see [Debugging](debugging.md) |
| `services.effectAdapter` | `@durableEffect` nodes | The effect contract a coordinator implements — see [Durable Gates](durable-gates.md) |

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

A workflow that contains a durable gate (`waitForEvent`, `waitForAgent`, or a `@durableGate` node) cannot be called this way to completion: at the first gate the call throws `DurableGateYield` — the run has to be persisted and resumed later, by something that owns the continuation. The coordinator below does that for you, with a store, a console and an HTTP API around it. A host of your own can do it with the compiled file alone; see [A host of your own](#a-host-of-your-own).

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
- A run that pauses is written to its store, by default `<rootDir>/<runId>/run.json`, so `resume` can happen in another process, or tomorrow. One record holds the gate and the continuation it resumes from, so one write commits both. `FW_RUNS_DIR` moves the default directory. The console and the MCP tools read the same store: a gate your service reaches can be answered by a person in `fw console`, and the other way round.
- `input` follows the answer rules in [Durable Gates](durable-gates.md): one data output → `answer` is the value; several → an object with every one; none → `null`.
- `await runs.get(runId)`, `runs.list({ filePath? })`, `runs.record(runId)` (everything persisted), `runs.trace(runId)` (the kept step trace), `runs.cancel(runId)`, `runs.remove(runId)`, `runs.keep(runId, name, data)` / `runs.kept(runId, name)` for a document of your own beside the run. Every method returns a promise, because a store may be remote.
- `await runs.tick()` is the clock: it wakes every run whose `sleep` is over and times out every gate whose `timeout` has passed, and returns `{ woke, timedOut, skipped }`. `fw serve` and the console call it every few seconds; a service of your own that drives runs should call it on a timer too, or nothing sleeping ever wakes. A waiting run says when the clock will act in `due: { at, action: 'wake' | 'timeout' }`. See [Time](durable-gates.md#time).
- The second argument to `start`/`resume` watches the run: `{ onEvent(event) {…}, trace: true, abortSignal }`. `trace: true` keeps the step trace beside the record so a later reader has it — the console asks for it; an assistant over MCP does not.
- While a segment runs, the run is **claimed** in the store; a second resume, cancel or `setAgent` of the same run, from this coordinator or another, gets `RunBusyError` until the claim is released, or lapses (`claimTtlMs`, one hour by default). Two processes on one store never drive the same run at once.
- Errors are classes you can `instanceof`: `ParseError`, `AmbiguousWorkflowError`, `RunNotFoundError`, `RunNotWaitingError`, `RunBusyError`, `BundleChangedError`, `MissingOutputsError`, `InvalidAnswerError`.

### Run stores

Everything the coordinator keeps goes through a `RunStore`. Two come with the package: the file store (the default, `createFileRunStore(rootDir)`) and a memory store for tests (`createMemoryRunStore()`). Past one machine — several API instances behind a balancer, a container with no disk — you give the coordinator a store of your own, and `fw serve`, the console and the MCP tools all work on it unchanged.

```typescript
import { createLocalCoordinator, type RunStore } from '@synergenius/flow-weaver/coordinator';

const runs = createLocalCoordinator({ store: myStore, claimTtlMs: 10 * 60_000 });
```

A store is nine methods over three kinds of thing — a run's record, named JSON documents beside it, and a claim while a process drives it:

| Method | Contract |
|--------|----------|
| `get(runId)`, `put(record)`, `remove(runId)` | `put` is all or nothing: a concurrent `get` sees the old record or the new one, never a mix. It is the commit point of every step, so it keeps the whole record, including the `continuation` a waiting run carries. `get` returns a copy. `remove` takes the documents and the claim too. |
| `list({ filePath? })` | Every record, newest first by `updatedAt`; only one file's when asked. |
| `getDoc`, `putDoc`, `deleteDoc(runId, name)` | JSON documents under a slug name: `trace`, `effect-<sha>` receipts, and whatever a driver keeps (`agent-*` transcripts, `http`). A document may precede its record. |
| `claim(runId, owner, ttlMs)`, `release(runId, owner)` | Atomic: of two claimers at once, one gets `true`. The holder may claim again. A claim lapses after `ttlMs`, or when released by its owner. A store that can tell the owner's process is gone may lapse it sooner, as the file store does on one host. |

In SQL that is a `runs` table with the record as JSON, a `run_docs` table keyed by run and name, and a `run_claims` table where `claim` is one conditional insert-or-update. Before relying on a store, run the contract against it:

```typescript
import { checkRunStore } from '@synergenius/flow-weaver/testing';

it('keeps the run store contract', () => checkRunStore(() => createMyStore(url)));
```

It throws on the first thing that is wrong and names it. Both built-in stores pass it in this package's own tests, so what it checks is what the coordinator relies on. The memory store (`src/coordinator/memory-store.ts`, forty lines) is the reference implementation to read first; a database store is the same nine methods with a table behind each `Map`.

The console follows the store too. `fw console` on the command line uses the directory, since a store is code; from code, `createConsoleServer({ projectDir, store })` from `@synergenius/flow-weaver/console` puts the console on your store, so the person answering gates sees the runs your API instances made. It polls the store every few seconds for changes made elsewhere, where the directory is watched.

The store holds runs, not code. Every instance parses the project's workflow files from its own disk, and a waiting run resumes on the code the instance has, checked against the digest recorded when the run started; a file that changed since is `BundleChangedError`, whichever store the run is in.

## A host of your own

Everything a gated run needs at run time is in the compiled file: the engine that records progress by execution address, the yield that carries the continuation, and the check that takes a continuation back. A host that keeps the continuation somewhere and brings it back with the answer is a coordinator, and it needs no package to be one.

```typescript
import { approveSpend, createWorkflowRuntime, isDurableGateYield, acceptContinuation } from './approve';

// First segment: run until the gate.
try {
  return await approveSpend(true, params, createWorkflowRuntime({ runId, workflowId: 'approveSpend' }));
} catch (error) {
  if (!isDurableGateYield(error)) throw error;
  await db.save(runId, { gate: error.gate, continuation: error.continuation, params });   // any JSON store
}

// Later, in any process: the answer arrives.
const { gate, continuation, params } = await db.load(runId);
const decoded = acceptContinuation(continuation, { runId, workflowId: 'approveSpend', gateId: gate.id });
if (!decoded.accepted) throw new Error(`${decoded.reason}: ${decoded.message}`);
const runtime = createWorkflowRuntime({
  runId, workflowId: 'approveSpend',
  continuation: decoded.envelope,
  resolution: { gateId: gate.id, value: { onSuccess: true, onFailure: false, note: 'fine by me' } },
});
const result = await approveSpend(true, params, runtime);   // completes, or throws the next DurableGateYield
runtime.durable.assertResumeResolutionConsumed();
```

- `error.gate` is what to show whoever answers: its kind, the node, and the inputs it was given (`payload.arguments`, positional, each `{ value }` or `{ absent: true }`). `error.continuation` is a closed JSON value — under 1 MiB, checksummed — and is all the host has to keep; `params` are yours to keep beside it, since a resume replays the body from the start with completed nodes skipped.
- The resolution `value` is the gate node's whole output envelope, control ports included: `{ onSuccess: true, onFailure: false, ...outputs }` to continue, `{ onSuccess: false, onFailure: true }` to take the failure path. The answer rules in [Durable Gates](durable-gates.md#what-happens-at-a-gate) apply.
- `acceptContinuation(json, { runId, workflowId, gateId? })` returns `{ accepted: true, envelope }` or `{ accepted: false, reason, message }` with the reasons in the [refusal table](durable-gates.md#what-happens-at-a-gate): a tampered or truncated envelope, one from another run, workflow or gate, one written by another engine version. Only an accepted envelope is taken by `createWorkflowRuntime`; a raw one throws. The graph check happens when the body starts: a continuation from a workflow whose graph has since changed is refused with `continuation belongs to another workflow graph` before any node runs.
- `bundleDigest` is optional. Give `createWorkflowRuntime` your build's digest (`sha256:<64 hex>` over the artifact you deploy) on both segments and a continuation from another build is refused. Without it the engine derives one from the workflow's graph and the engine version, which tells a recompiled graph apart but not a changed node body under the same graph.
- Two engines, one source: the package's coordinator runs the same code, so a continuation is the same format on both sides. A continuation the coordinator wrote resumes in your host when you pass its `bundleDigest` from the run record; one your host wrote is refused by the coordinator, which cannot vouch for a bundle it did not hash.
- Time is yours to keep. A `timer` gate (`sleep`) yields like any other; `error.gate.inputs` is not labelled in a host, so read the duration from `error.gate.payload.arguments[0].value` and resume when it has passed with `{ onSuccess: true, onFailure: false, wokeAt: <ISO time> }`. A gate with a `timeout` input is the same, the other way: resume with `{ onSuccess: false, onFailure: true }` and `null` for each output when the time is up. See [Time](durable-gates.md#time).
- What the compiled file does not do: keep anything between segments, run a clock, answer agent gates, or check a continuation against the compiled graph structure the way the coordinator's decoder does. That decoder, and the store, the claims, the clock, the console and `fw serve`, are the package's part.

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
| Run a CLI command in process | `runCommand('validate', { file })` | Names are hyphenated (`add-node`, `market-install`, …); `getAvailableCommands()` lists them. It refuses to run a gated workflow — use the coordinator |

Beside it:

- `@synergenius/flow-weaver/diagram` — `workflowToSVG(ast)` (the console's spine as an image), `workflowToASCII(ast, { format })`, `buildProcessModel(ast)` (steps in run order, pauses, arms), `buildLanes(model)` (the lane layout)
- `@synergenius/flow-weaver/docs` — `listTopics()`, `readTopic(slug)`, `searchDocs(query)`: this guide, from code
- `@synergenius/flow-weaver/console` — `createConsoleServer({ projectDir, port?, store? })`: the server behind `fw console`, to embed or to run on a port of your own; with `store`, it shows and drives the runs in a store of yours
- `@synergenius/flow-weaver/server` — `createWorkflowApi({ dir, token? })`: the workflows' declared `@http` routes and run resources as a handler with `node()`, `express()` and `fetch()` adapters, the same one `fw serve` runs. See [Embedding the API](deployment.md#embedding-the-api)
- `@synergenius/flow-weaver/testing` — `createMockLlmProvider`, `createMockApprovalProvider`, recorders and replayers for the agent templates' adapters, and `checkRunStore` for a run store of your own

## Entry points

| Import from | For |
|-------------|-----|
| the compiled file itself | `createWorkflowRuntime`, `acceptContinuation`, `isDurableGateYield`, `DurableGateYield`, `CancellationError`, `createContinuationEnvelope`, `ENGINE_VERSION`, and the `WorkflowRuntime`, `ContinuationEnvelope`, `DurableGate` and `GateResolution` types — everything a host needs, with no package installed |
| `@synergenius/flow-weaver` | The same names, plus the AST types and everything `./api` exports, and the pieces the CLI and the console are built from: the validator (`WorkflowValidator`, `getFriendlyError`, `formatFriendlyDiagnostics`), `WorkflowGenerator` and `AnnotationGenerator`, the AST builders, the parser (`parser`, `TagHandlerRegistry`, `ValidationRuleRegistry`), the port-sync helpers that rewrite a node type's signature and JSDoc together, the workflow and node templates, `WorkflowDiffer` with `formatDiff`, the type mappings and the constants |
| `…/api` | Parse, validate, compile, generate, query, modify |
| `…/runtime` | `createWorkflowRuntime`, `acceptContinuation`, `decodeContinuation`, `DebugController`, `CancellationError`, `DurableGateYield`, the runtime types |
| `…/coordinator` | `createLocalCoordinator`, the `RunStore` interface with `createFileRunStore` and `createMemoryRunStore`, the request, view and error types, and `executeWorkflow`, the engine's own one-segment boundary for a coordinator of your own |
| `…/server` | `createWorkflowApi`, `WebhookServer`, `planRoutes`, the request and response types |
| `…/diagram`, `…/docs`, `…/console`, `…/diff`, `…/testing` | As above |
| `…/marketplace`, `…/deployment`, `…/built-in-nodes`, `…/compiler`, `…/generator`, `…/agent` | What packs and export targets build on — see [Marketplace](marketplace.md) and [Deployment](deployment.md) |
| `…/cli`, `…/context`, `…/editor`, `…/doc-metadata`, `…/describe`, `…/ast`, `…/constants`, `…/version`, `…/browser`, `…/npm-packages`, `…/generated-branding` | Tooling surfaces used by the CLI, the MCP server and editor integrations |

Anything not on this list is internal and can move between releases.

## Related Topics

- [Tutorial](tutorial.md) — From an empty file to a compiled workflow; its last step calls the result the way this page describes
- [Durable Gates](durable-gates.md) — What a gate is, the answer rules, and the contract behind a coordinator
- [Built-in Nodes](built-in-nodes.md) — `FwMockConfig` and which nodes read it
- [Debugging](debugging.md) — `DebugController` and trace events
- [Cancellation](cancellation.md) — What `abortSignal` does at a node boundary
- [Console](console.md) — The same runs, watched and answered by a person
- [MCP Tools](mcp-tools.md) — The same operations, from an assistant
