---
name: Compilation
description: How compilation works, TypeScript and Inngest targets, compile options, and serve handler generation
keywords: [compile, compilation, target, typescript, inngest, production, source-map, format, strict, inline-runtime, clean, serve, framework, step.run, durable, trigger, cancelOn, retries, timeout, throttle, cron, markers]
---

# Compilation

Flow Weaver compiles annotated TypeScript into executable workflow code. The compiler parses JSDoc annotations, validates the workflow graph, and generates runtime code — all while preserving your existing code.

## How Compilation Works

Compilation is **in-place** by default. The compiler inserts generated code into marker sections within your source file:

```typescript
// Your node types and annotations above — untouched

// @flow-weaver-runtime — start
// Generated imports and runtime setup
// @flow-weaver-runtime — end

export function myWorkflow(params: { data: string }) {
  // @flow-weaver-body — start
  // Generated execution logic
  // @flow-weaver-body — end
}
```

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

- **ExecutionContext** — Runtime context for variable storage, abort signals, and debug events
- **FunctionRegistry** — Registry of 25+ built-in functions (branching, iteration, error handling)
- **Debug instrumentation** — `STATUS_CHANGED`, `VARIABLE_SET` events via WebSocket (omitted in production mode)
- **Scope functions** — Async functions for forEach/iteration patterns
- **Abort signal support** — Cancellation propagation through the execution graph
- **Recursion depth protection** — Prevents infinite loops in cyclic workflows

### Example

```bash
flow-weaver compile workflow.ts
```

Generates code like:
```typescript
// @flow-weaver-runtime — start
import { ExecutionContext } from '@synergenius/flow-weaver/runtime';
// @flow-weaver-runtime — end

export function myWorkflow(params: { data: string }) {
  // @flow-weaver-body — start
  const ctx = new ExecutionContext();
  const validate_result = validateRecord(true, params.data);
  // ... execution chain
  return { onSuccess: true, onFailure: false, result: score_result.score };
  // @flow-weaver-body — end
}
```

---

## Inngest Target

The `inngest` target generates **durable functions** using [Inngest](https://www.inngest.com/). Each workflow node becomes a `step.run()` call, providing automatic retries, event-driven triggers, and crash recovery.

```bash
flow-weaver compile workflow.ts --target inngest
```

### Per-Node Durability

Each node in the workflow becomes an individually durable step:

```typescript
const validate_result = await step.run('validate', async () => {
  return validateRecord(true, params.data);
});

const enrich_result = await step.run('enrich', async () => {
  return enrichRecord(true, validate_result.data);
});
```

If the process crashes after `validate` completes, Inngest replays the function and skips already-completed steps.

### Parallel Execution

Independent nodes execute in parallel using `Promise.all`:

```typescript
const [branch_a, branch_b] = await Promise.all([
  step.run('branchA', async () => processA(true, data)),
  step.run('branchB', async () => processB(true, data)),
]);
```

### Iteration

ForEach patterns use indexed `step.run()` for per-element durability:

```typescript
const results = [];
for (let i = 0; i < items.length; i++) {
  results.push(await step.run(`process-${i}`, async () => processItem(true, items[i])));
}
```

---

## Inngest Annotations

These annotations configure Inngest-specific behavior. They go inside `@flowWeaver workflow` blocks.

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
 * @node wait waitForEvent [expr: eventName="'app/expense.approved'", match="'data.expenseId'", timeout="'48h'"]
 * @path Start -> v -> wait -> pay -> Exit
 */
export async function expenseWorkflow(
  params: { expenseId: string; amount: number }
): Promise<{ result: object }> {
  throw new Error('Not compiled');
}
```

---

## Compile Options

### Production Mode (`--production`)

Strips all debug instrumentation from generated code. No `STATUS_CHANGED`, `VARIABLE_SET`, or `LOG_ERROR` events are emitted. Use this for deployed workflows.

```bash
flow-weaver compile workflow.ts --production
```

### Source Maps (`--source-map`)

Generate source maps alongside compiled output:

```bash
flow-weaver compile workflow.ts --source-map
```

### Module Format (`--format`)

Control the output module format:

| Value | Description |
|-------|-------------|
| `auto` | Auto-detect from `package.json` type field (default) |
| `esm` | ES modules (`import`/`export`) |
| `cjs` | CommonJS (`require`/`module.exports`) |

```bash
flow-weaver compile workflow.ts --format cjs
```

### Strict Mode (`--strict`)

Promote type coercion warnings to errors:

```bash
flow-weaver compile workflow.ts --strict
```

Equivalent to adding `@strictTypes` to the workflow annotation.

### Inline Runtime (`--inline-runtime`)

Force inline runtime code even when `@synergenius/flow-weaver` is installed as a dependency. Normally the compiler generates an import; this flag embeds the runtime directly.

```bash
flow-weaver compile workflow.ts --inline-runtime
```

### Clean Output (`--clean`)

Omit redundant `@param`/`@returns` annotations from the compiled output. Produces cleaner generated code.

```bash
flow-weaver compile workflow.ts --clean
```

### Dry Run (`--dry-run`)

Preview compilation output without writing any files:

```bash
flow-weaver compile workflow.ts --dry-run
```

---

## Serve Handler Generation

Generate a complete HTTP handler for receiving Inngest events:

```bash
flow-weaver compile workflow.ts --target inngest --serve --framework next
```

### Supported Frameworks

| Framework | Handler |
|-----------|---------|
| `next` | Next.js App Router route handler |
| `express` | Express middleware |
| `hono` | Hono route handler |
| `fastify` | Fastify plugin |
| `remix` | Remix action |

### Typed Events (`--typed-events`)

Generate Zod schemas for event validation from `@param` annotations:

```bash
flow-weaver compile workflow.ts --target inngest --typed-events
```

---

## CLI Overrides

Several Inngest annotations can be overridden from the CLI without modifying the source file:

| CLI Flag | Overrides |
|----------|-----------|
| `--cron <schedule>` | `@trigger cron=` |
| `--retries <n>` | `@retries` |
| `--timeout <duration>` | `@timeout` |

```bash
flow-weaver compile workflow.ts --target inngest --retries 5 --timeout "1h"
```

---

## Related Topics

- [CLI Reference](cli-reference) — Full compile command flags
- [Deployment](deployment) — Export to serverless platforms
- [Advanced Annotations](advanced-annotations) — Annotations that affect compilation
- [Debugging](debugging) — Debug instrumentation and WebSocket events
- [Built-in Nodes](built-in-nodes) — delay, waitForEvent, invokeWorkflow
