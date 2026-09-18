---
name: Durable Gates
description: Pausing a workflow at an approval, input, or agent gate, resuming it later from another process, and driving it from an AI assistant over MCP
keywords: [gate, durable, durableGate, durablePure, durableEffect, waitForAgent, waitForEvent, approval, input, agent, yield, continuation, resume, coordinator, fw_run, fw_resume, fw_runs, fw_workflow_run, fw_workflow_resume, bundleDigest, operationKey, receipt, classification, human-in-the-loop, pause]
---

# Durable Gates

A gate is a node where the workflow stops and hands control to something outside it — a person approving, an external system answering, an AI agent doing a task. The run does not wait: it returns a continuation and the process is free to exit. Later, any compatible process resumes from exactly that node with the answer.

- Three gate kinds: `approval`, `input`, `agent`
- A gate is compiler metadata, declared with `@durableGate`; it is never inferred
- Every node in a workflow that contains a gate must carry exactly one classification: `@durablePure`, `@durableGate`, or `@durableEffect`
- The engine keeps nothing after a yield — no Promise, timer, or process
- Resume needs the exact run, bundle, graph, engine version, gate, and one resolution; anything else is refused
- From an AI assistant, use `fw_run` / `fw_resume` (MCP); `fw run` on the CLI refuses gated workflows
- Author a gated workflow by writing the file, as in the example below. `fw_modify` keeps the durable tags when it rewrites annotations, and a gate's `context` input accepts any object type

## Gate kinds

| Kind | Built-in node | Declare your own with | Typical use |
|------|---------------|-----------------------|-------------|
| `approval` | — | `@durableGate approval` | A person accepts or refuses a value |
| `input` | `waitForEvent` | `@durableGate input` | An external system supplies data |
| `agent` | `waitForAgent` | `@durableGate agent` | An AI assistant performs a task and reports back |

The kind changes nothing mechanically. All three yield the same way and resume the same way; the kind is a label for whoever resolves the gate.

## Classifying every node

Once a workflow's reachable closure contains a gate — including scoped children and workflows it invokes — the compiler requires each node to state what the engine may do with it on resume:

| Tag | Meaning | On resume the engine will |
|-----|---------|---------------------------|
| `@durablePure` | No side effects; same inputs give same outputs | Re-run it freely |
| `@durableGate kind` | The pause point | Substitute the supplied resolution; never call the body |
| `@durableEffect` | Touches the outside world | Ask the effect adapter first; replay the receipt instead of running twice |

Built-ins are pre-classified: `delay` and `invokeWorkflow` are `@durablePure`; `waitForEvent` is an `input` gate; `waitForAgent` is an `agent` gate.

A missing or doubled classification is a compile error, reported by name:

```
Durable classification errors:
Every reachable node in a workflow with a durable gate must have exactly one compiler
classification: @durablePure, @durableGate, or @durableEffect.
Invalid: reviewFile.read (readTarget): unclassified
```

### A gated workflow

```typescript
/**
 * @flowWeaver nodeType
 * @durablePure
 * @input value - Value to prepare
 * @output prepared - Prepared value
 */
function prepare(execute: boolean, value: number) {
  return { onSuccess: execute, onFailure: false, prepared: value * 2 };
}

/**
 * The body is never called. Reaching it means the gate boundary was not applied.
 *
 * @flowWeaver nodeType
 * @durableGate approval
 * @input value - Value requiring approval
 * @output value - Approved value
 */
async function waitForApproval(execute: boolean, value: number): Promise<{ onSuccess: boolean; onFailure: boolean; value: number }> {
  throw new Error('durable gate implementation must not execute');
}

/**
 * @flowWeaver nodeType
 * @durablePure
 * @input value - Approved value
 * @output result - Final value
 */
function finish(execute: boolean, value: number) {
  return { onSuccess: execute, onFailure: false, result: value + 1 };
}

/**
 * @flowWeaver workflow
 * @param value - Input value
 * @returns result - Final value
 * @node prepared prepare
 * @node approval waitForApproval
 * @node finished finish
 * @connect Start.value -> prepared.value
 * @connect prepared.onSuccess -> approval.execute
 * @connect prepared.prepared -> approval.value
 * @connect approval.onSuccess -> finished.execute
 * @connect approval.value -> finished.value
 * @connect finished.result -> Exit.result
 */
export async function durableApproval(execute: boolean, params: { value: number }): Promise<{ onSuccess: boolean; onFailure: boolean; result: number }> {
  throw new Error('generated body was not installed');
}
```

### Restrictions inside a gated closure

The compiler refuses these rather than guessing:

- Parallel lanes — a gated closure is generated sequentially, so a yield never has a sibling still running
- Scope callbacks (`@scope` node types) — the scope owner might call back concurrently
- Pull or lazy nodes — an optional predecessor cannot form a complete prefix
- A gate after branch convergence — the selected arm is no longer in the address
- A gate inside an active branch is fine; the branch path is retained

## What happens at a gate

On first execution:

1. Every predecessor and its outputs are committed to engine state
2. The gate's inputs are evaluated and tagged positionally as `{ value: … }` or `{ absent: true }` — an omitted optional input never becomes `undefined`
3. The gate body is **not** called; no successor starts
4. The executor returns `{ kind: 'yielded', gate, continuation }` and retains nothing

The `continuation` is a closed, bounded wire value — run id, gate id, bundle digest, graph fingerprint, engine version, exact execution address, committed variables, effect receipts, checksum. Limits: 1 MiB encoded, nesting 32, 10,000 entries, 256 KiB per string. Keep gate inputs small; pass a file path, not a file body.

On resume, the caller supplies the same source, the continuation, and one resolution `{ gateId, value }`. The `value` is the gate node's **entire output envelope including control ports**, e.g. `{ onSuccess: true, onFailure: false, value: 8 }`. Sending only the data port is accepted and quietly wrong: `onSuccess` is never set and the successor never fires.

Resume is refused, before any node runs, when anything does not match exactly:

| Refusal | Cause |
|---------|-------|
| `stale-gate` | This gate was already consumed, or the resolution names a different gate |
| `wrong-run` / `wrong-workflow` | Continuation belongs to another run or workflow |
| `wrong-bundle` / `wrong-graph` | `bundleDigest` or graph fingerprint differs — the code changed |
| `incompatible-engine` / `incompatible-generator` | Different Flow Weaver version |
| `checksum-mismatch` / `malformed` / `oversized` | Continuation was altered, truncated, or exceeds limits |
| `ambiguous-effect` | An effect may have run but its receipt was not recorded; needs an operator |

## The effect contract

An effect node is a normal node with two additions. It receives a trailing `operationKey: string` after its declared inputs, and it returns a `{ result, receipt }` envelope instead of bare outputs:

```typescript
/**
 * @flowWeaver nodeType
 * @durableEffect
 * @input orderId - Order to charge
 * @output chargeId - Provider charge id
 */
async function chargeCard(execute: boolean, orderId: string, operationKey: string): Promise<{
  result: { onSuccess: boolean; onFailure: boolean; chargeId: string };
  receipt: { providerRef: string };
}> {
  const charge = await provider.charge(orderId, { idempotencyKey: operationKey });
  return {
    result: { onSuccess: true, onFailure: false, chargeId: charge.id },
    receipt: { providerRef: charge.id },
  };
}
```

- `operationKey` is stable: derived from the run id and the node's exact execution address, so a retry of the same run sends the same key
- The `receipt` is stored in the continuation before any later gate can yield
- Whoever runs the workflow must supply an `EffectAdapter`; without one, a gated workflow that contains an effect is refused before its first node

The adapter answers one question per effect — *did this already happen?*

| `recover()` returns | Engine behaviour |
|---------------------|------------------|
| `{ kind: 'not-committed' }` | Run the effect, then `commit()` the result and receipt |
| `{ kind: 'committed', receipt, result }` | Restore both; do not run the body |
| `{ kind: 'repeatable' }` | Run again under the same key |
| `{ kind: 'ambiguous' }` | Refuse to resume; never re-run |

## Driving a run from an AI assistant

The MCP server exposes a local coordinator so an assistant only ever sees a run id and a labeled gate — not the continuation. Runs are stored under `~/.fw/runs/<runId>/` (override with `FW_RUNS_DIR`).

| Tool | Arguments | Returns |
|------|-----------|---------|
| `fw_run` | `filePath`, `workflowName?`, `params?` | `completed` with `result`, or `waiting` with `runId` and `gate` |
| `fw_resume` | `runId`, and exactly one of `answer` or `reject` | Same shape; a later gate yields `waiting` again |
| `fw_runs` | `runId?` or `filePath?` | One run in full, or a compact list newest first |

A pause looks like this — inputs are named by port, not positional:

```json
{ "status": "waiting", "runId": "5c1e…", "workflowName": "reviewFile",
  "gate": { "kind": "agent", "node": "agent",
            "inputs": { "agentId": "review", "context": "TODO: ship it.", "prompt": null },
            "absent": ["prompt"] } }
```

Answering:

```json
{ "runId": "5c1e…", "answer": { "summary": "No tests.", "risk": "high" } }
```

Rules for `answer`:

- Gate has one data output → `answer` is that value; the coordinator wraps it as `{ onSuccess: true, onFailure: false, <port>: answer }`
- Gate has several data outputs → `answer` is an object containing every one of them; missing names are reported as `MISSING_OUTPUTS`
- Gate has no data outputs → `answer` is `null`
- `reject` sets `onFailure: true` and nulls the outputs; the run continues along the failure port and reports `completed`, so read `result.onFailure`, not `status`

Error codes: `PARSE_ERROR`, `AMBIGUOUS_WORKFLOW` (file has several workflows; pass `workflowName`), `RUN_NOT_FOUND`, `RUN_NOT_WAITING`, `BUNDLE_CHANGED` (the file or its compiled output changed since the pause; start a new run), `MISSING_OUTPUTS`, `INVALID_INPUT`, `AMBIGUOUS_EFFECT`, `EXECUTION_ERROR`, `RESUME_ERROR`.

Results carry no trace events, progress, or continuation. A waiting result for a three-node workflow is under 400 bytes.

## Driving a run as a coordinator

A coordinator is any caller that persists continuations itself and vouches for the bundle. The engine's continuation boundary is `executeWorkflow` (`src/mcp/workflow-executor.ts`); it is not in the package's export map, so the supported way to reach it from outside the CLI is the stateless MCP tool pair:

| Tool | Arguments | Returns |
|------|-----------|---------|
| `fw_workflow_run` | `filePath`, `params?`, `workflowName?`, `runId?`, `bundleDigest?` | `{ kind: 'completed', result }` or `{ kind: 'yielded', gate, continuation }` |
| `fw_workflow_resume` | `runId`, `filePath`, `continuation`, `gateId`, `resolution`, `bundleDigest`, `params?`, `workflowName?` | Same |

The request shape is the engine's:

```typescript
// first segment
{ runId, bundleDigest, filePath, workflowName, params, effectAdapter }
// → { kind: 'yielded', gate, continuation }   persist both before acknowledging

// later, possibly in another process
{ runId, bundleDigest, filePath, workflowName, params, effectAdapter,
  continuation,
  resolution: { gateId: gate.id, value: { onSuccess: true, onFailure: false, value: 8 } } }
// → { kind: 'completed', result }
```

- `bundleDigest` must be `sha256:<64 hex>`; the engine format-checks and records it but deliberately never derives it from the source file, because imports can change independently
- The `./api` command runner (`runCommand('run', …)`) refuses a yielded outcome; it is not a coordinator either
- The local coordinator behind `fw_run` (`src/coordinator/`) is a reference implementation of these obligations for one machine

## What does not work

- `fw run` and `fw dev` refuse a gated workflow: `a workflow graph with durable gates requires coordinator-verified whole-bundle identity before execution`. Use `fw_run` / `fw_resume`, or `fw_workflow_run` / `fw_workflow_resume` if you are writing a coordinator
- `--mocks` with `events` or `agents` entries does not resolve a gate. A compiled gate yields regardless; those sections only trigger CLI validation warnings
- The step debugger holds a live Promise and is not a coordinator; it rejects continuation and gate fields
- Nothing is reachable through `globalThis` — mocks, agent channels, and approval providers are execution-scoped or gone

## Related Topics

- [Built-in Nodes](built-in-nodes) — `waitForAgent` and `waitForEvent` signatures, and which mocks still apply
- [Advanced Annotations](advanced-annotations) — The full node-type annotation table
- [Debugging](debugging) — Why the debugger cannot resume a gate
- [Cancellation](cancellation) — Cooperative cancellation at node boundaries
- [CLI Reference](cli-reference) — `run` and `mcp-server`
- [MCP Tools](mcp-tools) — The whole tool surface and result sizes
