---
name: Durable Gates
description: Pausing a workflow at an approval, input, or agent gate, resuming it later from another process, and driving it from an AI assistant over MCP
keywords: [gate, durable, durableGate, durablePure, durableEffect, waitForAgent, waitForEvent, approval, input, agent, yield, continuation, resume, coordinator, fw_run, fw_resume, fw_runs, fw_workflow_run, fw_workflow_resume, bundleDigest, operationKey, receipt, classification, human-in-the-loop, pause]
---

# Durable Gates

A gate is a node where the workflow stops and hands control to something outside it — a person approving, an external system answering, an AI agent doing a task. The run does not wait: it returns a continuation and the process is free to exit. Later, any compatible process resumes from exactly that node with the answer.

- Three gate kinds: `approval`, `input`, `agent`
- A gate is compiler metadata, declared with `@durableGate`; it is never inferred
- Every node in a workflow that contains a gate has exactly one classification: `@durableGate`, `@durableEffect`, or pure. An `@expression` node is pure automatically; a normal-mode pure node needs `@durablePure`
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

Once a workflow's reachable closure contains a gate — including scoped children and workflows it invokes — every node must state what the engine may do with it on resume:

| Tag | Meaning | On resume the engine will |
|-----|---------|---------------------------|
| `@durablePure` | No side effects; same inputs give same outputs | Re-run it freely |
| `@durableGate kind` | The pause point | Substitute the supplied resolution; never call the body |
| `@durableEffect` | Touches the outside world | Ask the effect adapter first; replay the receipt instead of running twice |

An **`@expression` node needs no tag**: it is a pure input-to-output function by construction — no `execute` parameter, no `onSuccess`/`onFailure`, no way to signal a side effect — so it counts as `@durablePure`. Write `@durablePure` explicitly only on a normal-mode node that is pure. A node that touches the outside world must be `@durableEffect`, and the gate itself `@durableGate`, whatever its mode.

Built-ins are pre-classified: `delay` and `invokeWorkflow` are `@durablePure`; `waitForEvent` is an `input` gate; `waitForAgent` is an `agent` gate.

A missing or doubled classification is a compile error, reported by name:

```
Durable classification errors:
Every reachable node in a workflow with a durable gate must have exactly one compiler
classification: @durablePure, @durableGate, or @durableEffect.
Invalid: reviewFile.read (readTarget): unclassified
```

### A gated workflow

Pure nodes are ordinary `@expression` functions and need no durable tag. The gate is the one node written in normal mode: its body is never called, the compiler substitutes the resolution for its return value, and it needs the `onSuccess`/`onFailure` shape that a resolution carries. With the ports named consistently, `@path` wires everything, the gate included.

```typescript
/**
 * An @expression node counts as pure automatically; no @durablePure needed.
 *
 * @flowWeaver nodeType
 * @expression
 * @input value - Value to prepare
 * @output value - Prepared value
 */
function prepare(value: number): { value: number } {
  return { value: value * 2 };
}

/**
 * The body is never called. Reaching it means the gate boundary was not applied.
 * Normal mode on purpose: a resolution supplies onSuccess/onFailure and the outputs.
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
 * @expression
 * @input value - Approved value
 * @output result - Final value
 */
function finish(value: number): { result: number } {
  return { result: value + 1 };
}

/**
 * @flowWeaver workflow
 * @param value - Input value
 * @returns result - Final value
 * @node prepared prepare
 * @node approval waitForApproval
 * @node finished finish
 * @path Start -> prepared -> approval -> finished -> Exit
 * @path Start -> prepared -> approval:fail -> Exit
 */
export async function durableApproval(execute: boolean, params: { value: number }): Promise<{ onSuccess: boolean; onFailure: boolean; result: number }> {
  throw new Error('generated body was not installed');
}
```

The first `@path` expands to the control flow between the four steps plus `Start.value -> prepared.value`, `prepared.value -> approval.value`, `approval.value -> finished.value` and `finished.result -> Exit.result`. The second routes a rejected approval to `Exit.onFailure`.

### Restrictions inside a gated closure

The compiler refuses these rather than guessing:

- Parallel lanes — a gated closure is generated sequentially, so a yield never has a sibling still running
- Scope callbacks (`@scope` node types) — the scope owner might call back concurrently
- Pull or lazy nodes — an optional predecessor cannot form a complete prefix
- A gate **or an effect** that does not sit in exactly one branch region — the selected arm is no longer in the address, so the boundary cannot be replayed
- A gate or effect inside an active branch is fine; the branch path is retained

#### Exactly one branch region

This is the restriction authors hit most, and it bites in graphs that contain no
visible "convergence" at all, so it is worth stating mechanically.

A node **branches** as soon as it has an outgoing `onSuccess` or `onFailure`
connection — including the ordinary `a.onSuccess -> b.execute` used to sequence
two steps. Each branching node owns a **region**: the nodes reachable along its
arms. A boundary is refused when it ends up with no retained branch path, which
happens two ways:

1. **It sits in more than one region.** A node found in several regions is
   dropped from all of them. A linear chain `frame -> plan(gate) -> check ->
   signoff(gate)` is enough: if both `frame` and `plan` branch, `signoff` is in
   two regions and is refused.
2. **It takes data from outside its region.** Any incoming *data* connection
   from a node outside the region promotes the boundary out of every region.
   `Start` and `execute` ports are exempt. A gate reading a value wired straight
   from a pre-gate node is refused for this reason, even though the graph is a
   straight line.

Both produce the same message:

```
Durable boundaries after branch convergence are not supported because the
continuation must retain an independently active branch path. Invalid: wf.signoff
```

To satisfy it:

- Drive the second gate from **one** predecessor's `onSuccess`, and leave the
  first gate without an incoming control edge if that would add a second region
- Thread values the gate needs **through** the nodes in its own region instead
  of wiring them around, so it has no external data dependency
- Leave gate failure arms unwired unless you need them; wiring `gate.onFailure
  -> Exit.onFailure` makes that gate a second region

Sequencing matters too: driving two nodes from the same `gate.onSuccess` makes
them siblings rather than a sequence, which fails at resume with
`$.executionIndex is not a plain wire value`.

Two further rules keep a gated workflow cheap to resolve and honest on its
failure arms:

- **Hand a gate only what its resolver needs.** A gate's inputs are serialized
  into the continuation and shown to whoever resolves it -- an assistant, a
  person -- on every yield. A value that a *later* node needs does not travel
  through the gate: the later node reads it across the gate from the node that
  produced it, which is allowed because that reader is not itself a boundary.
  Threading a large object through an approval gate "so the next node can have
  it" puts the whole object in front of an approver who only needed the plan.
- **Converge refusal arms on one reporting node, wired explicitly.** A node that
  must run on `check:fail`, on `plan:fail` and after the last step is not
  reached by `@path Start -> ... -> Exit` alone; write each arm:
  `@path check:fail -> report`, `@path plan:fail -> report`, `@path last ->
  report -> Exit`. Give each refusal its own input port (or declare a
  `mergeStrategy` on a shared one): on any given arm the other producers did
  not run, and their ports arrive as `undefined`. The reporter decides the
  outcome from what actually arrived, not from which arm called it.

Worked examples: `use-cases/resume-yield-demo/incident-triage.ts` (two gates,
both region rules) and `use-cases/figma-to-page/figma-to-page.ts` (four gates,
a value read across the approval gate, three arms converging on a report node).

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

## Validate the answer

Resume verifies the run, the bundle, the graph and the engine version. It does **not** verify the answer's content: `agentResult` is whatever JSON the resolver chose, and the engine wraps it and moves on. The gate is a coordination boundary, not a trust boundary. Nothing forces the answer to be well-formed, or true.

So the deterministic part of the workflow should check the answer before it acts on it. The node right after an agent gate is the natural place: a normal-mode node that returns the checked value on `onSuccess` and routes a bad answer to `onFailure`. This keeps the judgement (the gate) and the guarantee (the check) separate, and a malformed reply becomes a routable outcome instead of a value that propagates.

```typescript
/**
 * Turns the params into the agent task.
 *
 * @flowWeaver nodeType @expression
 */
function prepare(path: string) {
  return {
    agentId: 'review',
    context: { path },
    prompt: `Review ${path}. Reply with { verdict: "ship" | "hold", reason: string }.`,
  };
}

/**
 * Validates the agent's reply. Normal mode on purpose: a malformed reply is a
 * routable outcome, not an exception. `agentResult` is whatever JSON the
 * resolver chose, so it is read defensively.
 *
 * @flowWeaver nodeType
 * @durablePure
 * @input agentResult - The unchecked reply from the gate
 * @output verdict - The validated verdict (on success)
 * @output reason - The validated reason (on success)
 * @output rejection - Why the reply was rejected (on failure)
 */
function checkReview(
  execute: boolean,
  agentResult: Record<string, unknown>,
): { onSuccess: boolean; onFailure: boolean; verdict: string; reason: string; rejection: string } {
  if (!execute) return { onSuccess: false, onFailure: false, verdict: '', reason: '', rejection: '' };
  const verdict = agentResult?.verdict;
  const reason = agentResult?.reason;
  if ((verdict !== 'ship' && verdict !== 'hold') || typeof reason !== 'string' || reason.length === 0) {
    return {
      onSuccess: false,
      onFailure: true,
      verdict: '',
      reason: '',
      rejection: 'malformed review: expected { verdict: "ship"|"hold", reason: non-empty string }',
    };
  }
  return { onSuccess: true, onFailure: false, verdict, reason, rejection: '' };
}

/** @flowWeaver nodeType @expression */
function record(verdict: string, reason: string) {
  return { outcome: `${verdict}: ${reason}` };
}

/**
 * @flowWeaver workflow
 * @param path - File to review
 * @returns outcome - The recorded decision
 * @returns rejected - Why the reply was rejected, if it was
 * @node prep prepare
 * @node review waitForAgent [expr: agentId="prep.agentId", context="prep.context", prompt="prep.prompt"]
 * @node check checkReview [expr: agentResult="review.agentResult"]
 * @node done record
 * @path Start -> prep -> review -> check -> done -> Exit
 * @path Start -> prep -> review -> check:fail -> Exit
 * @connect check.rejection -> Exit.rejected
 */
export async function reviewFile(
  execute: boolean,
  params: { path: string },
): Promise<{ onSuccess: boolean; onFailure: boolean; outcome: string; rejected: string }> {
  throw new Error('generated body was not installed');
}
```

A well-formed answer (`{ verdict: "ship", reason: "…" }`) completes with `onSuccess: true` and the recorded `outcome`. A malformed one (`{ verdict: "maybe", reason: "" }`) is caught by `checkReview`, follows `check:fail`, and completes with `onFailure: true` and `rejected` set — the bad value never reaches `record`. The check node is `@durablePure`: it is normal-mode (so it needs the tag, unlike an `@expression` node) but has no side effects, so the engine may re-run it freely on resume.

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

The MCP server exposes a local coordinator so an assistant only ever sees a run id and a labeled gate — not the continuation. Runs are stored under `~/.fw/runs/<runId>/` (override with `FW_RUNS_DIR`). `fw console` drives the same store, so a gate reached from either side can be answered from the other, and a person can watch or take over a run an assistant started.

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

Most code does not need to be a coordinator: `createLocalCoordinator` from `@synergenius/flow-weaver/coordinator` starts and resumes runs from code, persists them under `~/.fw/runs`, and shares them with the console and the MCP tools — see [Using the library](library).

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
