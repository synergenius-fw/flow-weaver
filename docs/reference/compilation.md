---
name: Compilation
description: How compilation works, the TypeScript target, pack targets and target options, compile options
keywords: [compile, compilation, target, typescript, production, source-map, format, strict, clean, trigger, cancelOn, retries, timeout, throttle, cron, markers, pack target]
---

# Compilation

Flow Weaver compiles annotated TypeScript into executable workflow code. The compiler parses JSDoc annotations, validates the workflow graph, and generates runtime code — all while preserving your existing code.

## How Compilation Works

Compilation is **in-place** by default. The compiler inserts generated code into marker sections within your source file:

```typescript
// Your node types and annotations above (untouched)

// @flow-weaver-runtime-start
// The engine, copied in
// @flow-weaver-runtime-end

export async function myWorkflow(execute: boolean, params: { data: string }, __runtime__: WorkflowRuntime) {
  // @flow-weaver-body-start
  // Generated execution logic
  // @flow-weaver-body-end
}
```

The workflow function keeps its name and parameters and gains a third, the runtime: see [Using the library](library.md) for calling it.

**Key guarantee:** Code outside the marker sections is never modified. Your node type functions, imports, and other code are preserved exactly as written.

### Compilation Steps

1. **Parse** — Extract annotations using Chevrotain grammar parser
2. **Validate** — Check graph structure, types, connections, and constraints
3. **Generate** — Produce executable code based on the target
4. **Write** — Insert generated code into marker sections (or write to output file)

---

## TypeScript Target (Default)

The default `typescript` target generates code that runs directly in Node.js or any JavaScript runtime.

### Generated Code Structure

- **The engine, inlined** between the runtime markers — `GeneratedExecutionContext` (port values, execution indices, cancellation checks), `CancellationError`, the durable-gate engine, and `createWorkflowRuntime`, all exported from the file, so the compiled workflow imports nothing from Flow Weaver
- **The body** between the body markers — each step in run order: its inputs read, its function called, its outputs recorded, its `:ok`/`:fail` route taken
- **Trace events** — `STATUS_CHANGED`, `VARIABLE_SET`, `LOG_ERROR` and `WORKFLOW_COMPLETED`, sent to the runtime's `services.debugger` (left out with `--production`); see [Debugging](debugging.md)
- **Step-through hooks** — the runtime's `services.debugController` can pause before and after each step
- **Scope functions** — Async functions for forEach/iteration patterns
- **Abort signal support** — Cancellation checked at every step boundary
- **Recursion depth protection** — A workflow that calls itself stops at a depth of 1,000

### Example

```bash
fw compile workflow.ts
```

Generates code like:
```typescript
// @flow-weaver-runtime-start
// (the engine, inlined: GeneratedExecutionContext, CancellationError, the durable-gate engine, createWorkflowRuntime, types)
// @flow-weaver-runtime-end

export async function processRecord(execute: boolean, params: { record: Record }, __runtime__: WorkflowRuntime
): Promise<{ onSuccess: boolean; onFailure: boolean; score: number; summary: string }> {
  // @flow-weaver-body-start
  const ctx = new GeneratedExecutionContext(true, __runtime__);
  // ... one block per step, in run order
  // @flow-weaver-body-end
}
```

---

## Other Platforms

`fw compile` and `fw_compile` always produce the TypeScript described above. Generating code for another platform is an export: `fw export --target <name>` hands the parsed workflow to a target an installed pack provides, and the pack documents what it writes. See [Deployment](deployment.md) and [Marketplace](marketplace.md).

---

## Deployment Annotations

These workflow-level annotations are parsed by core into the workflow's options. The compiler ignores them; an export target reads the ones it supports. They go inside `@flowWeaver workflow` blocks.

### `@trigger`

Define what triggers the workflow:

```typescript
/**
 * @flowWeaver workflow
 * @trigger event="app/expense.submitted"
 */
```

**Event trigger:**
```
@trigger event="app/expense.submitted"
```

**Cron trigger:**
```
@trigger cron="0 9 * * *"
```

**Both (event + cron):**
```
@trigger event="app/expense.submitted" cron="0 9 * * *"
```

Cron expressions use standard 5-field format and are validated at parse time.

### `@cancelOn`

Cancel a running function when an event is received:

```
@cancelOn event="app/expense.withdrawn"
@cancelOn event="app/expense.withdrawn" match="data.expenseId"
@cancelOn event="app/expense.withdrawn" match="data.expenseId" timeout="1h"
```

| Field | Required | Description |
|-------|----------|-------------|
| `event=` | Yes | Event name that triggers cancellation |
| `match=` | No | Field to match between trigger and cancel events |
| `timeout=` | No | Maximum wait time for the cancel event |

### `@retries`

Number of retries per function:

```
@retries 5
@retries 0
```

Must be a non-negative integer.

### `@timeout`

Function-level timeout:

```
@timeout "30m"
@timeout "7d"
@timeout "1h"
```

### `@throttle`

Rate limiting:

```
@throttle limit=20
@throttle limit=3 period="1h"
```

| Field | Required | Description |
|-------|----------|-------------|
| `limit=` | Yes | Maximum concurrent executions (integer) |
| `period=` | No | Time period for the limit |

### Complete Example

```typescript
/** @flowWeaver nodeType @expression */
function validateExpense(expenseId: string, amount: number): { expenseId: string; amount: number } {
  if (amount <= 0) throw new Error('amount must be positive');
  return { expenseId, amount };
}

/** @flowWeaver nodeType @expression */
async function processPayment(expenseId: string, amount: number): Promise<{ result: object }> {
  return { result: { expenseId, paid: amount } };
}

/**
 * @flowWeaver workflow
 * @trigger event="app/expense.submitted"
 * @cancelOn event="app/expense.withdrawn" match="data.expenseId"
 * @retries 3
 * @timeout "7d"
 * @throttle limit=10 period="1m"
 *
 * @node v validateExpense
 * @node pay processPayment
 * @node wait delay [expr: duration="'48h'"]
 * @path Start -> v -> wait -> pay -> Exit
 */
export async function expenseWorkflow(
  execute: boolean,
  params: { expenseId: string; amount: number }
): Promise<{ onSuccess: boolean; onFailure: boolean; result: object }> {
  throw new Error('generated body was not installed');
}
```

---

## Compile Options

### Production Mode (`--production`)

Strips all debug instrumentation from generated code. No `STATUS_CHANGED`, `VARIABLE_SET`, or `LOG_ERROR` events are emitted. Use this for deployed workflows.

```bash
fw compile workflow.ts --production
```

### Source Maps (`--source-map`)

Generate source maps alongside compiled output:

```bash
fw compile workflow.ts --source-map
```

### Module Format (`--format`)

Control the output module format:

| Value | Description |
|-------|-------------|
| `auto` | Auto-detect from `package.json` type field (default) |
| `esm` | ES modules (`import`/`export`) |
| `cjs` | CommonJS (`require`/`module.exports`) |

```bash
fw compile workflow.ts --format cjs
```

### Strict Mode (`--strict`)

Promote type coercion warnings to errors:

```bash
fw compile workflow.ts --strict
```

Equivalent to adding `@strictTypes` to the workflow annotation.

### Clean Output (`--clean`)

Omit redundant `@param`/`@returns` annotations from the compiled output. Produces cleaner generated code.

```bash
fw compile workflow.ts --clean
```

### Dry Run (`--dry-run`)

Preview compilation output without writing any files:

```bash
fw compile workflow.ts --dry-run
```

---

## Related Topics

- [CLI Reference](cli-reference.md) — Full compile command flags
- [Deployment](deployment.md) — Export targets, HTTP serve mode, OpenAPI
- [Advanced Annotations](advanced-annotations.md) — Annotations that affect compilation
- [Debugging](debugging.md) — Trace events and the step-through debugger
- [Built-in Nodes](built-in-nodes.md) — delay, waitForEvent, invokeWorkflow, waitForAgent
- [Durable Gates](durable-gates.md) — Workflows that pause and resume across processes
