---
name: Advanced Annotations
description: Pull execution, execution strategies, merge strategies, auto-connect, strict types, path, map, fan-out, fan-in, node attributes, and multi-workflow files
keywords: [pullExecution, executeWhen, mergeStrategy, autoConnect, strictTypes, path, map, fanOut, fanIn, sugar, attributes, expr, portOrder, portLabel, minimized, multi-workflow, CONJUNCTION, DISJUNCTION, FIRST, LAST, COLLECT, MERGE, CONCAT]
---

# Advanced Annotations

This guide covers annotations that go beyond the basics in [Concepts](concepts.md). Each feature is fully supported by the parser, validator, and compiler.

## Pull Execution

Pull execution enables **lazy evaluation**. Nodes marked with `@pullExecution` don't execute eagerly — they only run when a downstream node actually consumes their output.

### Node Type Level

Declare a node type as pull-executed by default:

```typescript
/**
 * @flowWeaver nodeType
 * @expression
 * @pullExecution execute
 * @input value
 * @output tripled
 */
function triple(value: number): { tripled: number } {
  return { tripled: value * 3 };
}
```

The argument (`execute`) specifies which STEP port triggers the lazy evaluation.

### Instance Level Override

Override pull execution per-instance in a workflow using the `[pullExecution: ...]` attribute:

```typescript
/**
 * @flowWeaver workflow
 * @node t triple [pullExecution: execute]
 * @connect Start.value -> t.value
 * @connect t.tripled -> Exit.result
 */
```

This is useful when a node type is not pull-executed by default, but a specific instance should be lazy.

### How It Works

1. During compilation, pull execution nodes are tracked separately
2. Their output variables use `let` declarations (initially `undefined`)
3. The node function is only called when a downstream node reads the output
4. If no downstream node reads the output, the node never executes

---

## Execution Strategies (`@executeWhen`)

Controls how a node evaluates incoming STEP signals before firing. This matters when a node has multiple STEP inputs.

| Strategy | Behavior | Use Case |
|----------|----------|----------|
| `CONJUNCTION` | Execute when **ALL** incoming signals arrive (AND) | Default. Synchronization points |
| `DISJUNCTION` | Execute when **ANY** signal arrives (OR) | Priority routing, first-response |
| `CUSTOM` | Execution controlled by custom logic | Advanced patterns |

### Node Type Level

```typescript
/**
 * @flowWeaver nodeType
 * @executeWhen DISJUNCTION
 * @input data
 * @output result
 */
function firstResponse(execute: boolean, data: string) {
  if (!execute) return { onSuccess: false, onFailure: false, result: '' };
  return { onSuccess: true, onFailure: false, result: data };
}
```

### Instance Level

```typescript
/**
 * @flowWeaver workflow
 * @node fr firstResponse [executeWhen: DISJUNCTION]
 */
```

---

## Merge Strategies

When multiple connections target the same DATA input port, a merge strategy determines how the values are combined. Without a merge strategy, multiple connections to the same input produce a validation error (`MULTIPLE_CONNECTIONS_TO_INPUT`).

| Strategy | Behavior | Result Type |
|----------|----------|-------------|
| `FIRST` | First non-undefined value | Same as port type |
| `LAST` | Last non-undefined value | Same as port type |
| `COLLECT` | Collect all values into an array | Array |
| `MERGE` | Deep merge with `Object.assign` | Object |
| `CONCAT` | Concatenate arrays/flatten | Array |

### Declaring Merge Strategy

Set the strategy on the port definition using `[mergeStrategy:X]`:

```typescript
/**
 * @flowWeaver nodeType
 * @expression
 * @input items [mergeStrategy:COLLECT] - Collect all incoming items
 * @output combined
 */
function aggregate(items: unknown[]): { combined: unknown[] } {
  return { combined: items };
}
```

### Generated Code

The compiler generates appropriate merge expressions:

```typescript
// FIRST: returns first non-undefined value
const merged = (() => { const __s__ = [a, b, c]; return __s__.find(v => v !== undefined); })();

// COLLECT: wraps all into array
const merged = [a, b, c];

// MERGE: Object.assign
const merged = Object.assign({}, a, b, c);

// CONCAT: flatten arrays
const merged = [a, b, c].flat();
```

---

## Auto-Connect (`@autoConnect`)

Enables automatic linear connection wiring. When `@autoConnect` is present and no explicit `@connect` annotations exist, nodes are wired sequentially in declaration order:

```
Start -> first @node -> second @node -> ... -> last @node -> Exit
```

Data ports are matched by name — if node A has an output named `result` and node B has an input named `result`, they are automatically connected.

```typescript
/**
 * @flowWeaver workflow
 * @autoConnect
 * @node v validateRecord
 * @node e enrichRecord
 * @node s scoreRecord
 * @param data - Input record
 * @returns result - Scored record
 */
export function pipeline(params: { data: Record<string, unknown> }): { result: Record<string, unknown> } {
  throw new Error('Not compiled');
}
```

This is equivalent to manually writing:
```
@connect Start.data -> v.data
@connect v.onSuccess -> e.execute
@connect v.result -> e.data
@connect e.onSuccess -> s.execute
@connect e.result -> s.data
@connect s.result -> Exit.result
```

**Important:** If any explicit `@connect` annotations are present, `@autoConnect` is disabled. It's all-or-nothing.

---

## Fan-Out / Fan-In (`@fanOut`, `@fanIn`)

Fan macros reduce boilerplate when broadcasting a single output to many targets, or merging many sources into a single input. Both expand to individual `@connect` lines during compilation.

### `@fanOut` — One to Many

Broadcasts a single output port to multiple targets:

```typescript
/**
 * @flowWeaver workflow
 * @node a processA
 * @node b processB
 * @node c processC
 *
 * @fanOut Start.data -> a, b, c
 * @connect a.result -> Exit.resultA
 * @connect b.result -> Exit.resultB
 * @connect c.result -> Exit.resultC
 */
```

This expands to:
```
@connect Start.data -> a.data
@connect Start.data -> b.data
@connect Start.data -> c.data
```

You can specify explicit target ports when the names don't match the source:

```
@fanOut Start.data -> a.input1, b.input2, c.rawData
```

Without an explicit port, the target port defaults to the source port name.

### `@fanIn` — Many to One

Merges multiple output ports into a single target:

```typescript
/**
 * @flowWeaver workflow
 * @node a processA
 * @node b processB
 * @node c processC
 * @node agg aggregate
 *
 * @fanIn a.result, b.result, c.result -> agg.items
 * @connect agg.merged -> Exit.result
 */
```

This expands to:
```
@connect a.result -> agg.items
@connect b.result -> agg.items
@connect c.result -> agg.items
```

The target port should have a `[mergeStrategy:COLLECT]` (or another merge strategy) to combine multiple inputs — otherwise the validator will flag `MULTIPLE_CONNECTIONS_TO_INPUT`.

### Round-Trip Preservation

Both macros are preserved through parse-regenerate round-trips. The compiler stores the original macro and regenerates the annotation rather than expanding to individual `@connect` lines.

---

## Strict Types (`@strictTypes`)

By default, type mismatches between connected ports produce warnings. With `@strictTypes`, they become errors.

```typescript
/**
 * @flowWeaver workflow
 * @strictTypes
 * @node n myNode
 * @connect Start.count -> n.text
 */
```

Type compatibility levels:
- **exact** — Same type (e.g. `STRING` → `STRING`)
- **assignable** — Safe conversion (e.g. `NUMBER` → `ANY`)
- **coercible** — Lossy conversion (e.g. `NUMBER` → `STRING`) — warning by default, error with `@strictTypes`
- **incompatible** — No conversion possible — always an error

---

## Path Sugar (`@path`)

Syntactic sugar for declaring multi-step execution routes. A `@path` annotation expands to a chain of STEP connections (execute → onSuccess) and wires the data ports along the way by name.

### Basic Syntax

```typescript
/**
 * @flowWeaver workflow
 * @param record - Raw record
 * @returns score - Final score
 * @node v validate     // @input record  @output record
 * @node e enrich       // @input record  @output record
 * @node s score        // @input record  @output score
 * @path Start -> v -> e -> s -> Exit
 */
```

This expands to:
```
@connect Start.execute -> v.execute
@connect Start.record -> v.record
@connect v.onSuccess -> e.execute
@connect v.record -> e.record
@connect e.onSuccess -> s.execute
@connect e.record -> s.record
@connect s.onSuccess -> Exit.onSuccess
@connect s.score -> Exit.score
```

### Data Resolution

For every step after the first, each data input resolves to the nearest earlier step in the path that has an output of the same name. `Start` params count as outputs, and `Exit` `@returns` ports count as inputs, so a linear pipeline with consistently named ports needs no `@connect` at all.

Two rules keep this predictable:

- **An explicit `@connect` wins.** If a port already has a connection, `@path` leaves it alone. Use this to take a value from an earlier step than the nearest one.
- **A `Start` param never passes straight through to `Exit`.** Echoing an input as an output would hide a missing producer, so `Start.x -> Exit.x` is only ever an explicit `@connect`.

A port with no same-name ancestor stays unconnected and is reported by validation as usual (`MISSING_REQUIRED_INPUT` for a node, `UNREACHABLE_EXIT_PORT` for Exit).

### Branching with `:ok` and `:fail`

Use `:ok` or `:fail` suffixes to route through `onSuccess` or `onFailure`:

```typescript
/**
 * @flowWeaver workflow
 * @node v validate
 * @node router routeUrgency
 * @node handler handle
 * @node esc escalate
 *
 * @path Start -> v -> router:ok -> handler -> Exit
 * @path Start -> v -> router:fail -> esc -> Exit
 */
```

Without a suffix, `:ok` (onSuccess) is the default. Duplicate connections from overlapping paths are automatically deduplicated.

### Comma-Separated Paths

Multiple paths can be declared in a single `@path` tag using commas. This is equivalent to separate `@path` tags:

```typescript
/**
 * @flowWeaver workflow @autoConnect
 * @node enrichCompany enrichCompany
 * @node enrichContact enrichContact
 * @node scoreLead scoreLead
 * @path Start -> enrichCompany -> scoreLead -> Exit, Start -> enrichContact -> scoreLead
 */
```

This creates a parallel fork from Start to both `enrichCompany` and `enrichContact`, then both converge on `scoreLead`.

### Path Validation

The sugar optimizer validates that all nodes referenced in `@path` exist and that the expected control-flow connections are still valid. Stale paths are automatically filtered during parse-regenerate round-trips.

---

## Map Sugar (`@map`)

Syntactic sugar for forEach iteration patterns. A `@map` expands to a synthetic iterator node type with proper scopes and connections.

### Basic Syntax

```typescript
/**
 * @flowWeaver workflow
 * @node proc doubleIt
 * @map loop proc over Start.items
 * @connect loop.results -> Exit.results
 */
```

This creates a `loop` instance of a synthetic `MAP_ITERATOR` node type that:
1. Takes `Start.items` as the array to iterate
2. Calls `proc` (doubleIt) for each element
3. Collects results into `loop.results`

### With Explicit Port Mapping

Specify which input/output ports to use on the child node:

```typescript
@map loop proc(file -> post) over scan.files
```

This maps:
- `scan.files` array elements → `proc.file` (input)
- `proc.post` (output) → collected into `loop.results`

If ports are omitted, the first non-STEP input and first non-STEP output are used automatically.

---

## Node Instance Attributes

Node instances in workflows support attribute brackets `[...]` for configuration. Multiple brackets can be combined.

### Expression Bindings (`[expr: ...]`)

Set port values via JavaScript expressions instead of connections:

```typescript
@node wait delay [expr: duration="'30s'"]
```

Each assignment is `portName="expression"`. Multiple assignments are comma-separated. (`waitForEvent` and `waitForAgent` accept expressions the same way, but using either makes the workflow a gated one — see [Durable Gates](durable-gates.md).)

#### Referencing upstream ports

An expression may read values the workflow already has: `Start.<param>` for a workflow input, `<node>.<port>` for an output of an earlier node. Any property access after the port is ordinary JavaScript, so `Start.expense.id` reads the `id` field of the `expense` param.

```typescript
/**
 * @flowWeaver workflow
 * @param expense - The expense
 * @returns decision
 * @node route route
 * @node reviewer waitForAgent [expr:
 *   agentId="'review'",
 *   context="{ id: Start.expense.id, amount: Start.expense.amount, risk: route.risk }",
 *   prompt="`Draft an approve/reject decision for expense ${Start.expense.id}`"]
 * @node approval waitForApproval [expr: draft="reviewer.agentResult"]
 * @path Start -> route -> reviewer -> approval -> Exit
 */
```

This replaces the node that would otherwise exist only to shape those three values, and it replaces a `@connect` whose only purpose is a rename (`[expr: draft="reviewer.agentResult"]`).

**Keep expressions short.** A reference or a small reshape (`shape.top`, `{ path: Start.path }`, `Start.count + 1`) reads well inline. A multi-line string, a template literal with its own quotes, or anything you would want to format across lines belongs in a node function body, not in a `[expr:]` string, where JSDoc forces it onto one line with escaped quotes. If the value is a prompt or a paragraph, write a one-line `@expression` node that builds it — the template literal lives in real code — and let `@path` wire it. The expression form is for wiring and reshaping, not for authoring prose.

Each reference is a real data dependency. The parser records it as a connection marked as derived from the expression, so execution order, cycle detection, `fw_query` (`data-deps`, `execution-order`), the diagram and the durable continuation all see the edge. A derived connection is not written as `@connect` (the expression implies it), is exempt from the one-source-per-input rule (one expression may read several ports) and from type checks (the expression transforms the value), and cannot be removed on its own; edit the expression.

What is recognised, exactly:

- A property access on a bare identifier that is `Start` or a node id, where the property is a declared data port. The expression is parsed as TypeScript, so a name inside a string literal (`'Start.path'`) is text, a name inside a template substitution (`` `${Start.path}` ``) is a reference, and `Start["path"]`, `f().port` or `x[0].port` are never references.
- A node id that is also a top-level binding of the file (an import, a `const`, a class) is ambiguous when the property is a port and plain JavaScript when it is not. Node type functions do not count: `@node route route` with `route.risk` reads the node.
- References are between top-level nodes. A scoped child, or a reference to one, is refused; scoped ports keep their explicit `@connect node.port:scope` form.

Errors are reported at parse time, prefixed with the instance and port, for example `[expr] reviewer.context: "route.rsk" is not an output of "route". Available: risk.`, and for a control port, a self-reference, a scope boundary or an ambiguous name. A reference cycle between two expressions is `CYCLE_DETECTED` like any other cycle.

The decision record is [ADR 0002](../adr/0002-expression-port-references.md).

### Port Order (`[portOrder: ...]`)

Control the visual ordering of ports:

```typescript
@node myNode MyType [portOrder: input1=1, input2=2, output1=3]
```

### Port Labels (`[portLabel: ...]`)

Override port display labels:

```typescript
@node myNode MyType [portLabel: execute="Start Here", onSuccess="Done"]
```

### Minimized (`[minimized]`)

Display the node in a collapsed/minimized state:

```typescript
@node helper HelperNode [minimized]
```

### Size (`[size: W H]`)

Custom node dimensions when the workflow is rendered as a diagram:

```typescript
@node big BigNode [size: 400 300]
```

### Color (`[color: "..."]`)

Custom node color:

```typescript
@node special MyType [color: "#ff6b35"]
```

### Icon (`[icon: "..."]`)

Custom node icon:

```typescript
@node db DatabaseNode [icon: "database"]
```

### Tags (`[tags: ...]`)

Visual tags/badges on the instance. Each tag has a label string and optional tooltip:

```typescript
@node myNode MyType [tags: "async" "Runs asynchronously", "beta"]
```

### Suppress Warnings (`[suppress: ...]`)

Silences specific validator warnings on a per-instance basis. Useful when a warning is intentional, such as an output port deliberately left unconnected because its value is discarded by design.

```typescript
@node fetch fetchData [suppress: "UNUSED_OUTPUT_PORT"]
@node check runCheck [suppress: "UNUSED_OUTPUT_PORT", "UNREACHABLE_EXIT_PORT"]
```

The suppression is scoped to the annotated instance only. Other instances of the same type still produce warnings normally. The codes correspond to the warning codes listed in the error codes reference.

### Combining Attributes

Multiple attribute brackets can appear on the same `@node`:

```typescript
@node wait delay [expr: duration="'24h'"] [minimized] [color: "#3b82f6"]
```

---

## Multi-Workflow Files

A single TypeScript file can contain multiple `@flowWeaver workflow` annotations. Each workflow is a separate exported function.

```typescript
/**
 * @flowWeaver workflow
 * @node v validate
 * @path Start -> v -> Exit
 */
export function validatePipeline(params: { data: string }) { ... }

/**
 * @flowWeaver workflow
 * @node e enrich
 * @path Start -> e -> Exit
 */
export function enrichPipeline(params: { data: string }) { ... }
```

### Targeting a Specific Workflow

Most CLI commands accept `--workflow-name` or `-w` to target a specific workflow:

```bash
fw compile multi.ts --workflow-name validatePipeline
fw validate multi.ts -w enrichPipeline
fw run multi.ts -w validatePipeline --params '{"data": "test"}'
fw describe multi.ts --workflow-name enrichPipeline
```

Without this flag, all workflows in the file are processed.

### Cross-Workflow References

Workflows in the same file can reference each other as node types. The parser does a first-pass signature extraction, so the order of declaration doesn't matter.

---

## Node Type Annotations

These annotations go on `@flowWeaver nodeType` blocks:

| Annotation | Purpose | Example |
|------------|---------|---------|
| `@name` | Override display name | `@name MyCustomName` |
| `@label` | Human-readable label | `@label Fetch with Timeout` |
| `@description` | Node description | `@description Validates expense data` |
| `@color` | Custom color | `@color purple` or `@color "#ff6b35"` |
| `@icon` | Custom icon | `@icon "database"` |
| `@tag` | Visual tag/badge | `@tag async` or `@tag beta "Experimental"` |
| `@scope` | Provides a named scope | `@scope processItem` |
| `@expression` | Expression mode (simplified signature) | `@expression` |
| `@executeWhen` | Execution strategy | `@executeWhen DISJUNCTION` |
| `@pullExecution` | Lazy evaluation | `@pullExecution execute` |
| `@resilience` | Declare adapter-owned retry/fallback handling for static validation | `@resilience retries=3 fallback="backup-provider"` |
| `@durablePure` | No side effects; safe to re-run after a resume | `@durablePure` |
| `@durableGate` | Pause point: `approval`, `input`, or `agent` | `@durableGate approval` |
| `@durableEffect` | Touches the outside world; runs through the effect adapter | `@durableEffect` |

`@resilience` is an explicit static-analysis contract; it does not implement retries itself. Use it only when the node's shared adapter already performs the declared bounded retries or fallback. An unconnected `onFailure` port still remains an error because exhausted attempts must be handled.

The three `@durable…` tags are a closed classification: once a workflow's reachable closure contains a gate, every node in it must carry exactly one of them, or compilation fails. An effect node also changes its signature — a trailing `operationKey: string` parameter and a `{ result, receipt }` return. See [Durable Gates](durable-gates.md).

---

## Available Colors

Named colors adapt to the diagram theme (dark/light). You can also pass any hex color directly (e.g. `@color "#ff6b35"`).

`blue`, `purple`, `cyan`, `orange`, `pink`, `green`, `red`, `yellow`, `teal` (alias for cyan)

## Available Icons

Any [Material Symbols](https://fonts.google.com/icons) name is valid, in the font's `snake_case` or in `camelCase` (`swap_horiz` and `swapHoriz` are the same icon). The console draws the icon from the font; the SVG artifacts draw the icons in the visual-reference table with a path and any other as a dot.

**AI & ML:** `psychology`, `smartToy`, `autoAwesome`, `modelTraining`, `science`, `biotech`

**Data & storage:** `database`, `dataObject`, `tableChart`, `token`, `storage`, `memory`

**Cloud & network:** `api`, `webhook`, `cloudSync`, `cloudUpload`, `cloudDownload`, `dns`, `router`, `http`, `link`

**Security & auth:** `key`, `shield`, `vpnKey`, `verified`, `security`, `policy`, `adminPanelSettings`

**Logic & flow:** `altRoute`, `callSplit`, `callMerge`, `rule`, `filterAlt`, `repeat`, `sort`

**Actions & status:** `bolt`, `build`, `rocketLaunch`, `send`, `sync`, `refresh`

**Communication:** `notifications`, `email`, `campaign`

**Scheduling:** `event`, `schedule`, `timer`

**General tools:** `terminal`, `settings`, `tune`, `search`, `save`, `upload`, `download`, `edit`, `delete`

**Status:** `checkCircle`, `error`, `warning`, `info`, `help`, `visibility`

**Files:** `folder`, `description`, `attachFile`

**Structural:** `code` (default), `flow` (workflow nodes), `startNode`, `exitNode`

---

## Related Topics

- [Concepts](concepts.md) — Core workflow fundamentals
- [Durable Gates](durable-gates.md) — The `@durablePure` / `@durableGate` / `@durableEffect` classification
- [JSDoc Grammar](jsdoc-grammar.md) — Formal EBNF syntax for all annotations
- [Compilation](compilation.md) — How annotations affect code generation
- [Error Codes](error-codes.md) — Validation errors for annotation issues
- [CLI Reference](cli-reference.md) — All command flags
