---
name: Built-in Nodes
description: Built-in runtime nodes (delay, sleep, waitForEvent, invokeWorkflow, waitForAgent), which ones are durable gates, and the mock system for testing
keywords: [delay, sleep, waitForEvent, invokeWorkflow, waitForAgent, built-in, runtime, gate, timer, agent, mock, mocks, FwMockConfig, testing, fast, events, invocations, agents, duration, timeout, deadline, wake]
---

# Built-in Nodes

Flow Weaver provides five built-in node types. They need no import and no `@flowWeaver nodeType` declaration — write `@node <id> <name>` and the parser injects them.

| Node | Classification | Mockable in a compiled workflow |
|------|----------------|--------------------------------|
| `delay` | `@durablePure` | Yes — `fast: true` |
| `invokeWorkflow` | `@durablePure` | Yes — `invocations` |
| `sleep` | `@durableGate timer` | Yes — `fast: true` wakes it at once; see [Durable Gates](durable-gates) |
| `waitForEvent` | `@durableGate input` | Yes — `events`; see [Durable Gates](durable-gates) |
| `waitForAgent` | `@durableGate agent` | Yes — `agents`; see [Durable Gates](durable-gates) |

Using any gate node makes the whole workflow a gated workflow: every other node must then carry `@durablePure`, `@durableGate`, or `@durableEffect`, and `fw run` will refuse it. The other two are ordinary nodes.

## delay

Holds the process for a duration. It is for short pauses in a running segment — a backoff, a settle time — not for waiting hours: the process has to stay up the whole time, and a gated run resumed after a `delay` waits again. For anything a person would notice, use [`sleep`](#sleep).

```typescript
/**
 * @flowWeaver nodeType
 * @input duration - Duration to sleep (e.g. "30s", "5m", "1h", "2d")
 * @output elapsed - Always true after sleep completes
 */
async function delay(execute: boolean, duration: string)
```

### Duration Format

`<number><unit>` where unit is one of:

| Unit | Meaning | Example |
|------|---------|---------|
| `ms` | Milliseconds | `500ms` |
| `s` | Seconds | `30s` |
| `m` | Minutes | `5m` |
| `h` | Hours | `1h` |
| `d` | Days | `2d` |

### Usage in Workflow

```typescript
/**
 * @flowWeaver workflow
 * @node wait delay [expr: duration="'30s'"]
 * @path Start -> wait -> Exit
 */
```

### Mock Behavior

When `fast: true` is set in mock config, `delay` sleeps for 1ms instead of the real duration.

---

## sleep

A `timer` gate. The run pauses with a wake time, the process is free to go, and whoever keeps the run — the coordinator behind `fw serve`, the console and the MCP tools, or a host of your own — resumes it once the duration has passed. Nothing runs in the meantime.

```typescript
/**
 * @flowWeaver nodeType
 * @durableGate timer
 * @input duration - How long the run sleeps before it goes on (e.g. "30s", "2h", "3d")
 * @output wokeAt - When the run went on, as an ISO 8601 time
 */
async function sleep(execute: boolean, duration: string)
```

### Usage in Workflow

```typescript
/**
 * @flowWeaver workflow
 * @node remind sleep [expr: duration="'3d'"]
 * @path Start -> notify -> remind -> followUp -> Exit
 */
```

### Waking it

- The coordinator records the wake time on the run (`due: { at, action: 'wake' }`) and its clock resumes the run when it comes: `fw serve` and the console tick every few seconds, `fw_runs` ticks before it lists. `wokeAt` is the time the clock acted.
- A person can cut the sleep short: the console's gate card has **Wake now**; over MCP or HTTP, resolve the gate with any time as the answer (`fw_resume { runId, answer: "2026-09-21T09:00:00Z" }`).
- A host of its own reads `gate.inputs.duration` (or the first positional argument of the gate payload) and resumes with `{ onSuccess: true, onFailure: false, wokeAt }` when it sees fit; see [A host of your own](library#a-host-of-your-own).
- An unreadable duration wakes at once rather than never.

### Mock Behavior

`fast: true` answers the gate at the boundary with the current time, so a run with sleeps goes straight through, as `delay` does under the same flag.

---

## waitForEvent

An `input` gate. The workflow yields here and resumes when a coordinator supplies the event data. The inputs describe what is being waited for; they are handed to whoever resolves the gate.

```typescript
/**
 * @flowWeaver nodeType
 * @durableGate input
 * @input eventName - Event name to wait for (e.g. "app/approval.received")
 * @input [match] - Field to match between trigger and waited event (e.g. "data.requestId")
 * @input [timeout] - Max wait time (e.g. "24h", "7d"). Empty = no timeout
 * @output eventData - The received event's data payload
 */
async function waitForEvent(execute: boolean, eventName: string, match?: string, timeout?: string)
```

### Usage in Workflow

```typescript
/**
 * @flowWeaver workflow
 * @node wait waitForEvent [expr: eventName="'app/expense.approved'", match="'data.expenseId'", timeout="'48h'"]
 * @path Start -> wait -> Exit
 */
```

### Resolving it

- Through MCP: `fw_run` returns `{ status: "waiting", gate: { kind: "input", inputs: { eventName, match, timeout } } }`; answer with `fw_resume { runId, answer: <eventData> }`
- Programmatically: resolution `{ gateId, value: { onSuccess: true, onFailure: false, eventData } }`
- `timeout` is a deadline the coordinator keeps, not a timer the engine runs. With a readable duration the run carries `due: { at, action: 'timeout' }`, and when that time passes with no answer the coordinator's clock takes the gate's failure path, as a `reject` would (`no answer within 48h` on the failure port). Route `wait:fail` somewhere; an unrouted failure ends the run there. The same works for any gate you declare: name an input `timeout`, give it a duration, and keep its `onFailure` port

### Mock Behavior

None in a compiled workflow. An `events` section in mock config is validated by `fw run` but a compiled `waitForEvent` yields regardless. Test the paths after the gate by resuming it with the data you want.

---

## waitForAgent

An `agent` gate. The workflow yields here with a task for an AI assistant and resumes with whatever the assistant returns.

```typescript
/**
 * @flowWeaver nodeType
 * @durableGate agent
 * @input agentId - Agent/task identifier
 * @input context - Context data to send to the agent
 * @input [prompt] - Message to display when requesting input
 * @output agentResult - Result returned by the agent
 */
async function waitForAgent(execute: boolean, agentId: string, context: object, prompt?: string)
```

### Usage in Workflow

The node before the gate produces the gate's inputs under the gate's own port names, so `@path` wires them by name and nothing else is needed:

```typescript
/**
 * @flowWeaver nodeType
 * @expression
 * @durablePure
 * @input path - Name of the thing under review
 * @input text - The material itself
 * @output agentId - Names the task
 * @output context - What the agent should look at
 * @output prompt - What to do with it
 */
export function readTarget(path: string, text: string): { agentId: string; context: object; prompt: string } {
  return {
    agentId: 'review',
    context: { path, excerpt: text.slice(0, 4000) },
    prompt: `Review ${path} and reply with { verdict: "ship" | "hold", reason }.`,
  };
}

/**
 * @flowWeaver workflow
 * @param path - Name of the thing under review
 * @param text - The material itself
 * @returns agentResult - What the agent replied
 * @node read readTarget
 * @node agent waitForAgent
 * @path Start -> read -> agent -> Exit
 * @path Start -> read -> agent:fail -> Exit
 */
export async function reviewFile(execute: boolean, params: { path: string; text: string }): Promise<{ onSuccess: boolean; onFailure: boolean; agentResult: object }> {
  throw new Error('generated body was not installed');
}
```

The complete, runnable version is `use-cases/agent-gate-demo/review-file.ts`.

### Resolving it

- Through MCP: `fw_run` returns `{ status: "waiting", gate: { kind: "agent", inputs: { agentId, context, prompt } } }`; the assistant does the task, then `fw_resume { runId, answer: <agentResult> }`
- `agentResult` is whatever JSON the assistant chooses; nothing validates its shape, so read it defensively downstream
- Keep `context` small — a path the assistant can open, not a file body. The gate's inputs travel inside the continuation, which is capped at 1 MiB

### Mock Behavior

None in a compiled workflow. An `agents` section in mock config is validated by `fw run` but a compiled `waitForAgent` yields regardless.

---

## invokeWorkflow

Invokes another workflow by function id and waits for its result. Enables workflow composition.

```typescript
/**
 * @flowWeaver nodeType
 * @input functionId - Function ID of the workflow to invoke (e.g. "my-service/sub-workflow")
 * @input payload - Data to pass as event.data to the invoked function
 * @input [timeout] - Max wait time (e.g. "1h")
 * @output result - Return value from the invoked function
 */
async function invokeWorkflow(execute: boolean, functionId: string, payload: object, timeout?: string)
```

### Usage in Workflow

```typescript
/**
 * @flowWeaver workflow
 * @node sub invokeWorkflow [expr: functionId="'my-service/payment-processor'", timeout="'5m'"]
 * @connect Start.payload -> sub.payload
 * @connect sub.result -> Exit.result
 * @path Start -> sub -> Exit
 */
```

### Mock Behavior

- If `invocations[functionId]` is set in mock config → returns that result via `onSuccess`
- If no mock data for the function ID → simulates failure via `onFailure`

---

## Mock System

Mocks let a workflow run locally without real delays, external invocations or anyone at its gates. `delay` skips its sleep, `invokeWorkflow` returns the canned result, and a gate — a built-in one or one you declared with `@durableGate` — is answered on the spot instead of pausing the run. The console's New run card builds this config from a form; `fw run` takes it as JSON.

### FwMockConfig

```typescript
interface FwMockConfig {
  /** When true, delay nodes skip the real sleep (1ms instead of full duration). */
  fast?: boolean;
  /** Mock invocation results keyed by functionId. Used by invokeWorkflow. */
  invocations?: Record<string, object>;
  /** Event payloads keyed by event name. A waitForEvent gate returns one as eventData without pausing. */
  events?: Record<string, object>;
  /** Agent results keyed by agentId. A waitForAgent gate returns one as agentResult without pausing. */
  agents?: Record<string, object>;
  /** An answer for any gate, keyed by the node's instance id: its data outputs as an object. */
  gates?: Record<string, object>;
}
```

Keys may be instance-qualified — `"sub:my-service/x"` targets only the node with id `sub` — and `"sub:*"` answers node `sub` whatever key it asks with, which is what you want when the event name or agent id is computed at run time. `gates` is keyed by node alone: `{ "gates": { "approve": { "decision": { "approved": true } } } }` sends the run through `approve` as if a person had answered that. A gate that has no mock still pauses.

### CLI Usage

```bash
fw run workflow.ts --mocks '{"fast": true, "invocations": {"my-service/x": {"ok": true}}}'
fw run workflow.ts --mocks-file mocks.json
```

`fw run` warns when a section names a node type the workflow does not contain, e.g. `has "events" entries but workflow has no waitForEvent nodes`.

### Programmatic Usage

Mocks travel in the runtime a caller hands a compiled workflow. There is no `globalThis` hook — the `__fw_mocks__` global was removed:

```typescript
import { syncCatalog, createWorkflowRuntime } from './sync-catalog';

const runtime = createWorkflowRuntime({
  runId: 'test-1',
  workflowId: 'syncCatalog',
  services: { mocks: { fast: true, invocations: { 'my-service/x': { ok: true } } } },
});
await syncCatalog(true, { amount: 500 }, runtime);
```

The public command runner (`runCommand('run', …)` from `./api`) takes no mocks option and refuses a gated workflow. See [Using the library](library) for the rest of what the runtime carries.

### Testing a gated workflow

Two ways. Mock the gate with `gates` (or `events` / `agents`) and the run goes straight through it — the quickest way to exercise everything after the gate, from the console's New run card or `fw run --mocks`. Or drive the gate for real, through the MCP tools or `executeWorkflow` in a test, when the pause itself is what you are testing. See [Durable Gates](durable-gates) for the resolution shape.

- Success path: `fw_resume { runId, answer: { status: 'approved' } }`
- Failure path: `fw_resume { runId, reject: 'declined' }` — the run continues along `onFailure` and reports `completed`

---

## Related Topics

- [Durable Gates](durable-gates) — What a gate is, classification rules, resuming, and the MCP tools
- [CLI Reference](cli-reference) — `run` command with `--mocks` flags
- [Compilation](compilation) — Compile targets
- [Debugging](debugging) — Tracing and troubleshooting
- [Advanced Annotations](advanced-annotations) — Expression bindings for node inputs
