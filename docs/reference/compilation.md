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
fw compile workflow.ts
```

Generates code like:
```typescript
// @flow-weaver-runtime — start
// (inline runtime: GeneratedExecutionContext, CancellationError, types)
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

## Compile Targets

`fw compile` and `fw_compile` default to the `typescript` target described above. Any other `--target` name must be registered by an installed pack; core ships none, and an unknown name fails before parsing:

```
✗ Unknown compile target: <name>. No custom targets registered.
```

A pack target receives the parsed workflow and its node types and returns the code to write, so what it generates is documented by the pack. Find target packs with `fw market search`; see [Marketplace](marketplace).

---

## Deployment Annotations

These workflow-level annotations are parsed by core into the workflow's options. The default `typescript` target ignores them; a pack target reads the ones it supports. They go inside `@flowWeaver workflow` blocks.

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
 * @node wait delay [expr: duration="'48h'"]
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

## Target Options

These `fw compile` flags exist for pack targets. They are handed to the target unchanged; the default `typescript` target does not use them.

| Flag | Meaning for a target that supports it |
|------|---------------------------------------|
| `--serve` | Also generate an HTTP serve handler |
| `--framework <name>` | Framework for that handler: `next`, `express`, `hono`, `fastify`, `remix` |
| `--typed-events` | Generate Zod event schemas from the workflow's `@param` annotations |
| `--cron <schedule>` | Override `@trigger cron=` |
| `--retries <n>` | Override `@retries` |
| `--timeout <duration>` | Override `@timeout` |

```bash
fw compile workflow.ts --target <pack-target> --serve --framework next
fw compile workflow.ts --target <pack-target> --retries 5 --timeout "1h"
```

---

## Related Topics

- [CLI Reference](cli-reference) — Full compile command flags
- [Deployment](deployment) — Export targets, HTTP serve mode, OpenAPI
- [Advanced Annotations](advanced-annotations) — Annotations that affect compilation
- [Debugging](debugging) — Debug instrumentation and WebSocket events
- [Built-in Nodes](built-in-nodes) — delay, waitForEvent, invokeWorkflow, waitForAgent
- [Durable Gates](durable-gates) — Workflows that pause and resume across processes
