---
name: Advanced Annotations
description: Pull execution, execution strategies, merge strategies, auto-connect, strict types, path, map, fan-out, fan-in, node attributes, and multi-workflow files
keywords: [pullExecution, executeWhen, mergeStrategy, autoConnect, strictTypes, path, map, fanOut, fanIn, sugar, attributes, expr, portOrder, portLabel, minimized, multi-workflow, CONJUNCTION, DISJUNCTION, FIRST, LAST, COLLECT, MERGE, CONCAT]
---

# Advanced Annotations

This guide covers annotations that go beyond the basics in [Concepts](concepts). Each feature is fully supported by the parser, validator, and compiler.

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

Syntactic sugar for declaring multi-step execution routes. A `@path` annotation expands to a chain of STEP connections (execute → onSuccess).

### Basic Syntax

```typescript
/**
 * @flowWeaver workflow
 * @node v validate
 * @node e enrich
 * @node s score
 * @path Start -> v -> e -> s -> Exit
 */
```

This expands to:
```
@connect Start.execute -> v.execute
@connect v.onSuccess -> e.execute
@connect e.onSuccess -> s.execute
@connect s.onSuccess -> Exit.execute
```

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
@node wait waitForEvent [expr: eventName="'app/expense.approved'", match="'data.expenseId'", timeout="'48h'"]
```

Each assignment is `portName="expression"`. Multiple assignments are comma-separated.

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

Custom node dimensions in the visual editor:

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

### Combining Attributes

Multiple attribute brackets can appear on the same `@node`:

```typescript
@node wait waitForEvent [expr: eventName="'approval'", timeout="'24h'"] [minimized] [color: "#3b82f6"]
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
flow-weaver compile multi.ts --workflow-name validatePipeline
flow-weaver validate multi.ts -w enrichPipeline
flow-weaver run multi.ts -w validatePipeline --params '{"data": "test"}'
flow-weaver describe multi.ts --workflow-name enrichPipeline
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
| `@color` | Custom color | `@color "#ff6b35"` |
| `@icon` | Custom icon | `@icon "database"` |
| `@tag` | Visual tag/badge | `@tag async` or `@tag beta "Experimental"` |
| `@scope` | Provides a named scope | `@scope processItem` |
| `@expression` | Expression mode (simplified signature) | `@expression` |
| `@executeWhen` | Execution strategy | `@executeWhen DISJUNCTION` |
| `@pullExecution` | Lazy evaluation | `@pullExecution execute` |

---

## Related Topics

- [Concepts](concepts) — Core workflow fundamentals
- [JSDoc Grammar](jsdoc-grammar) — Formal EBNF syntax for all annotations
- [Compilation](compilation) — How annotations affect code generation
- [Error Codes](error-codes) — Validation errors for annotation issues
- [CLI Reference](cli-reference) — All command flags
