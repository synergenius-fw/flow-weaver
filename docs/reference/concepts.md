---
name: Flow Weaver Concepts
description: Fundamental concepts of Flow Weaver workflows
keywords: [annotations, nodes, workflows, ports, scopes, STEP, expression, connect, nodeType]
---

**Source**: https://github.com/synergenius-fw/flow-weaver

# Direct Code Editing

**The code IS the workflow. The visual editor is a view.**

Flow Weaver workflows are plain TypeScript files with JSDoc annotations. You write functions, annotate them, and the compiler handles everything else. No drag-and-drop required.

Here is a complete, minimal workflow written entirely by hand:

```typescript
/**
 * @flowWeaver nodeType
 * @expression
 * @label Greet
 * @input name - Name to greet
 * @output message - Greeting message
 */
function greet(name: string): string {
  return "Hello, " + name + "!";
}

/**
 * @flowWeaver nodeType
 * @expression
 * @label Uppercase
 * @input message - Text to transform
 * @output result - Uppercased text
 */
function uppercase(message: string): string {
  return message.toUpperCase();
}

/**
 * @flowWeaver workflow
 * @param name - Name to greet
 * @returns result - Uppercased greeting
 * @node greeter greet
 * @node transform uppercase
 * @path Start -> greeter -> transform -> Exit
 */
export function greetingWorkflow(
  execute: boolean,
  params: { name: string }
): { onSuccess: boolean; onFailure: boolean; result: string } {
  throw new Error('generated body was not installed');
}
```

That is it. Two expression-mode functions, one workflow annotation, zero boilerplate. The `@path` line declares the route, and the compiler wires the data ports by name (`Start.name -> greeter.name`, `greeter.message -> transform.message`, `transform.result -> Exit.result`) together with the STEP connections along the way -- no `execute`, `onSuccess`, `onFailure`, or `@connect` lines needed. The exported function is a stub; the compiler installs the real body.

---

# Quick Reference

## Topic Navigator

| Task                             | Primary Topic                | Supporting          |
| -------------------------------- | ---------------------------- | ------------------- |
| First time? Build a workflow     | `tutorial`                   | concepts            |
| Build from scratch (experienced) | `iterative-development`      | concepts, export-interface |
| Scaffold from template           | `scaffold`                   | concepts            |
| Add iteration/forEach            | `export-interface`           | concepts            |
| Convert existing functions       | `node-conversion`            | concepts            |
| Debug validation errors          | `debugging`                  | error-codes         |
| Look up specific error code      | `error-codes`                | debugging           |
| Reuse workflow fragments         | `patterns`                   | concepts            |
| Check annotation syntax          | `jsdoc-grammar`              | concepts            |
| Look up CLI commands/flags       | `cli-reference`              | —                   |
| Pull execution, merge strategies | `advanced-annotations`       | jsdoc-grammar       |
| Compile to a pack target         | `compilation`                | cli-reference       |
| Deploy to cloud                  | `deployment`                 | compilation         |
| Get the one-page map first       | `orientation`                | concepts            |
| Use delay/invokeWorkflow/mocks   | `built-in-nodes`             | debugging           |
| Pause for approval/input/agent   | `durable-gates`              | built-in-nodes      |
| Drive Flow Weaver from an editor | `mcp-tools`                  | cli-reference       |
| Publish marketplace packages     | `marketplace`                | —                   |

Use `fw docs <topic>` to read any topic.

## File Format

Workflows are TypeScript files with JSDoc annotations. Any `.ts`, `.tsx`, `.js`, or `.jsx` file with `@flowWeaver` annotations works.

## CLI Commands

```bash
fw validate <file>   # Check for errors (--json for machine parsing)
fw compile <file>    # Generate executable code
fw run <file>        # Execute a workflow directly. No compile step needed for testing.
fw describe <file>   # Get workflow structure as JSON
fw watch <file>      # Watch mode
fw dev <file>        # Watch + compile + run in one command
fw serve [dir]       # HTTP server exposing workflows as endpoints
fw diagram <file>    # Generate SVG diagram
fw export <file>     # Export for an installed pack target (e.g. a serverless function)
fw docs              # Browse documentation
fw docs <topic>      # Read a specific topic
fw docs search <q>   # Search across all docs
```

Options: `-w/--workflow-name`, `--json`, `--format text|mermaid`. See `cli-reference` for all commands and flags.

## Core Annotations

### Expression Node Type (Recommended)

> **Tip:** A node type is an `@expression` function unless it has one of the reasons listed under "Node Type (Normal Mode)" below.

```typescript
/**
 * @flowWeaver nodeType
 * @expression
 * @label Display Name
 * @input inputA - First input
 * @input inputB - Second input
 * @output outputName - Description
 */
function nodeName(inputA: TypeA, inputB: TypeB): ReturnType {
  // Pure function logic -- no execute param, no onSuccess/onFailure
  return result;
}
```

Expression nodes are pure functions where:

- No `execute: boolean` parameter -- the runtime handles execution control
- No `onSuccess`/`onFailure` in return type -- the runtime auto-sets these
- Function params map directly to `@input` ports
- Return value maps to `@output` ports:
  - Primitive/array return -> single output port
  - Object return `{ a, b }` -> one port per property
- Best for: transformers, math, utilities, data mapping, async fetchers, API calls
- Optional `@color` and `@icon` annotations customize the node's appearance in SVG diagrams (see `advanced-annotations` for available values)

> **Start with expression mode.** Only switch to normal mode when the node must route a failure to another node or to `Exit.onFailure`, return data alongside a failure (error-with-data), is a void side-effect, is a boolean branch, owns a scope, or is a durable gate or effect. When an expression node throws, the runtime marks its `onFailure` port and then rethrows: the error propagates out of the workflow call, so a `:fail` route from an expression node is not taken. A failure that downstream nodes must react to is returned, not thrown, from a normal-mode node.

#### Async Expression Example

```typescript
/**
 * @flowWeaver nodeType
 * @expression
 * @label Fetch User
 * @input userId - User ID to look up
 * @output user - The fetched user object
 */
async function fetchUser(userId: string): Promise<User> {
  const res = await fetch(`/api/users/${userId}`);
  return await res.json();
}
```

### Node Type (Normal Mode)

Normal mode is the exception, not the definition of a node type. Drop `@expression` only when the node has to take over control flow itself, for one of these reasons:

- **Error-with-data** -- it must return data alongside the failure signal, not just fail
- **Void side-effect** -- it returns nothing, so there is no value to map to an output
- **Boolean branch** -- it routes on a condition (`onSuccess = cond`, `onFailure = !cond`) rather than on an error
- **Scope owner** -- it drives scoped ports itself, like a forEach or retry node (see Scoped Nodes below)
- **Durable gate or effect** -- see `durable-gates`

A normal-mode function takes `execute: boolean` as its first parameter, then each `@input` as a direct parameter, and returns `onSuccess`/`onFailure` next to its outputs. Say the reason in a comment so the next reader does not "fix" it back to expression mode:

```typescript
/**
 * @flowWeaver nodeType
 * @label Display Name
 * @input inputA - First input
 * @input inputB - Second input
 * @output outputName - Description
 */
function nodeName(
  execute: boolean,
  inputA: TypeA, // Each @input becomes a direct parameter
  inputB: TypeB // NOT wrapped in an object
): { onSuccess: boolean; onFailure: boolean; outputName: Type } {
  // Normal mode: outputName is returned even when the node fails (error-with-data)
  if (!execute) return { onSuccess: false, onFailure: false, outputName: null };
  if (!ok) return { onSuccess: false, onFailure: true, outputName: partial };
  return { onSuccess: true, onFailure: false, outputName: result };
}
```

### Workflow Export

```typescript
/**
 * @flowWeaver workflow
 * @param inputPort - Description
 * @returns outputPort - Description
 * @node instanceId nodeTypeName
 * @path Start -> instanceId -> Exit
 * @connect instanceId.output -> Exit.outputPort
 */
export function workflowName(
  execute: boolean,
  params: { inputPort: Type }
): { onSuccess: boolean; onFailure: boolean; outputPort: Type } {
  throw new Error('generated body was not installed');
}
```

`@path` declares the control flow and wires every data port by name: each input of a step resolves to the nearest earlier step with a same-name output, and Exit's `@returns` ports resolve the same way (`Start.inputPort -> instanceId.inputPort` above). Add `@connect` only for ports whose names differ, like `instanceId.output -> Exit.outputPort`; an explicit `@connect` always wins over the name resolution. A `Start` param never passes straight through to `Exit` by name -- write that as an explicit `@connect`.

The exported function keeps this signature (`execute: boolean`, a `params` object, `onSuccess`/`onFailure` plus the `@returns` ports) and a throwing stub body; the compiler installs the real body.

> `@path` writes the STEP connections (`execute`, `onSuccess`, `onFailure`) for every step, whatever the node's mode. Use `:ok`/`:fail` suffixes on a step to branch, and explicit STEP `@connect` lines only to override the automatic wiring. See `advanced-annotations` for the full `@path` rules.

### Importing External Functions

Use `@fwImport` to turn npm package functions or local module exports into node types without writing wrapper code:

```typescript
/**
 * @flowWeaver workflow
 * @fwImport npm/lodash/map map from "lodash"
 * @fwImport local/utils/format formatDate from "./utils"
 * @node mapper npm/lodash/map
 * @connect Start.items -> mapper.collection
 */
```

**Syntax**: `@fwImport <nodeTypeName> <functionName> from "<package-or-path>"`

- **Node type name** (first identifier): used in `@node` declarations. Convention: `npm/pkg/fn` for packages, `local/path/fn` for local modules.
- **Function name** (second identifier): the actual exported function name to import.
- **Source** (quoted string): npm package name or relative path to a local module.

**Prefix semantics**:
- `npm/` — resolves to a bare package specifier. The package must be installed in `node_modules`. At compile time, the compiler generates an `import { fn } from "package"` statement in the output.
- `local/` — resolves to a relative import from the workflow file's directory. Generates `import { fn } from "./path"`.

**Type inference**: port types are inferred from the function's TypeScript signature (from `.d.ts` files for npm packages, or from the source for local modules). If type information isn't available, ports default to `ANY`.

**What happens at compile time**: the compiler parses the `@fwImport` annotation, resolves the function signature, creates a virtual node type with inferred ports, and emits the corresponding import statement in the generated code. The imported function is called as an expression node — no `execute` parameter, no STEP ports.

**Common errors**:
- Package not installed: `npm install <package>` before compiling.
- Wrong export name: check the package's exports with your IDE or `npm info <package>`.
- No type information: install `@types/<package>` for community type definitions.

## Mandatory Signatures

### Node Types (direct parameters)

Expression mode (the default, with `@expression`):

```typescript
function myNode(inputA: Type, inputB: Type): ReturnType
```

- Params: each `@input` as a direct parameter, in declaration order
- Return: the value of the single `@output`, or an object with one property per `@output`
- Failure: throw; the runtime marks `onFailure` and rethrows, so the error leaves the workflow call

Normal mode (only for the reasons listed under "Node Type (Normal Mode)"):

```typescript
function myNode(execute: boolean, inputA: Type, inputB: Type): {...}
```

- First param: `execute: boolean`
- Remaining params: Each `@input` as a direct parameter
- Return: `{ onSuccess: boolean, onFailure: boolean, ...outputs }`

### Workflow Exports (params object)

```typescript
export function myWorkflow(execute: boolean, params: { inputA: Type }): {...}
```

- First param: `execute: boolean`
- Second param: `params: {...}` object containing all `@param` inputs
- Return: `{ onSuccess: boolean, onFailure: boolean, ...outputs }`

> **Key difference:** Nodes use direct params, workflows use `params` object. The workflow export always has the `execute` / `onSuccess` / `onFailure` shape, even when every node in it is an expression node.

## Node Registration

Every node used in a workflow must be declared with `@node`. The compiler builds a static directed graph from annotations at compile time, so it needs to know about every node before code generation begins. This is different from normal function calls where you just invoke a function directly.

A `@node` reference must resolve to a node type the compiler knows: a function annotated `@flowWeaver nodeType` in the same file, one imported via `@fwImport`, or a built-in.

Built-in nodes (`delay`, `waitForEvent`, `invokeWorkflow`, `waitForAgent`) need no import and no declaration — the parser injects them and the compiler inlines their bodies:

```typescript
/**
 * @flowWeaver workflow
 * @node wait delay [expr: duration="'30s'"]
 * @path Start -> wait -> Exit
 */
export async function myWorkflow(execute: boolean): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  throw new Error('generated body was not installed');
}
```

- `waitForEvent` and `waitForAgent` are durable gates: using either makes the workflow pause and yield, and every other node must then be classified `@durablePure`, `@durableGate`, or `@durableEffect`. See [Durable Gates](durable-gates)
- The full signatures are in [Built-in Nodes](built-in-nodes)

## Port Types

STRING, NUMBER, BOOLEAN, OBJECT, ARRAY, FUNCTION, ANY, STEP

Types are inferred from TypeScript signature. STEP is for control flow (execute, onSuccess, onFailure).

## Reserved Nodes

- `Start` - Flow entry point (exposes workflow inputs via @param)
- `Exit` - Flow exit point (receives workflow outputs via @returns)

## Scoped Nodes (Iteration/forEach)

For loops/iteration, use **per-port scopes** with explicit `scope:scopeName` suffixes.

A scope owner is one of the cases that needs normal mode: the node receives `execute`, calls the generated callback for each item itself, and reports `onSuccess`/`onFailure` when the loop is done. The nodes inside the scope are ordinary expression nodes.

### ForEach Node Pattern

```typescript
/**
 * @flowWeaver nodeType
 * @input items - Array to iterate
 * @output start scope:processItem - Mandatory: triggers child execute
 * @output item scope:processItem - Current item to process
 * @input success scope:processItem - Mandatory: from child onSuccess
 * @input failure scope:processItem - Mandatory: from child onFailure
 * @input processed scope:processItem - Result from child
 * @output results - Collected results
 */
function forEach(
  execute: boolean,
  items: any[],
  processItem: (start: boolean, item: any) => { success: boolean; failure: boolean; processed: any }
) {
  // Normal mode: this node owns the processItem scope and drives the callback itself
  if (!execute) return { onSuccess: false, onFailure: false, results: [] };
  const results = items.map((item) => processItem(true, item).processed);
  return { onSuccess: true, onFailure: false, results };
}
```

Key points:

- Scope name (`processItem`) must match callback parameter name
- Callback parameter is auto-generated, receives scoped ports as args
- Node iterates by calling callback for each item
- `start`, `success`, `failure` are mandatory scoped STEP ports
- Scoped STEP wiring is written with `@connect` and the `:scopeName` suffix; `@path` does not express it

### Workflow Usage

```typescript
/**
 * @flowWeaver workflow
 * @node loop forEach
 * @node proc processor loop.processItem
 * @connect Start.execute -> loop.execute
 * @connect Start.items -> loop.items
 * @connect loop.start:processItem -> proc.execute
 * @connect loop.item:processItem -> proc.item
 * @connect proc.result -> loop.processed:processItem
 * @connect proc.onSuccess -> loop.success:processItem
 * @connect proc.onFailure -> loop.failure:processItem
 * @connect loop.results -> Exit.results
 * @connect loop.onSuccess -> Exit.onSuccess
 * @connect loop.onFailure -> Exit.onFailure
 */
```

See `fw docs export-interface` for full scope documentation.

## Workflow Recipes

### Recipe 1: Build a Workflow from Scratch

```
1. fw create workflow sequential my-workflow.ts --preview   # preview the template
2. Write the file with node types + workflow annotations
3. fw validate my-workflow.ts                               # check for errors
4. Fix any errors, re-validate
5. fw compile my-workflow.ts                                # generate executable code
6. fw describe my-workflow.ts --format text                 # verify structure
```

### Recipe 2: Add a Node to Existing Workflow

```
1. fw describe my-workflow.ts --format text   # understand current structure
2. Edit the file: add an @expression nodeType function, a @node line, and put it on the @path (add @connect only for ports whose names differ)
3. fw validate my-workflow.ts                 # verify
```

### Recipe 3: Debug a Broken Workflow

```
1. fw validate my-workflow.ts                              # get all errors
2. fw describe my-workflow.ts --format text                # get full picture
3. Fix errors based on error codes (see: fw docs error-codes)
```

### Recipe 4: Add Iteration (ForEach)

```
1. Read: fw docs export-interface              # scoped port syntax
2. Edit file: add forEach node type with scope ports
3. Edit file: add child node with parent scope reference
4. Edit file: wire scoped connections (:scopeName suffix)
5. fw validate my-workflow.ts                  # verify scope wiring
```

## Workflow Development Process

1. **Create file** - Write TypeScript file with types and node functions
2. **Add annotations** - `@flowWeaver nodeType` and `@flowWeaver workflow`
3. **Validate** - `fw validate <file>`
4. **Test** - Start with `fw run <file>` for quick testing. Compile only for production deployment.
5. **Compile** - `fw compile <file>`
6. **Inspect** - `fw describe <file>` for structure

## Additional Annotations

Beyond the core annotations above, Flow Weaver supports advanced features:

- **`@autoConnect`** — Auto-wire nodes in declaration order (no `@connect` needed)
- **`@path`** — Declare multi-step routes with `:ok`/`:fail` branching
- **`@map`** — Shorthand for forEach iteration patterns
- **`@pullExecution`** — Lazy evaluation (node only executes when output is consumed)
- **`@executeWhen`** — Control execution strategy (CONJUNCTION/DISJUNCTION/CUSTOM)
- **`@strictTypes`** — Promote type warnings to errors
- **Merge strategies** — `[mergeStrategy:COLLECT]` for fan-in patterns

See `advanced-annotations` for full documentation.

## Related Topics

- `cli-reference` - Complete CLI command reference
- `advanced-annotations` - Pull execution, merge strategies, auto-connect, and more
- `compilation` - Compilation targets (TypeScript and pack targets) and options
- `deployment` - Export to cloud, serve mode, OpenAPI
- `built-in-nodes` - delay, waitForEvent, invokeWorkflow, waitForAgent, and mock system
- `durable-gates` - Pausing at a gate, resuming, and driving a run from an AI assistant
- `mcp-tools` - Every MCP tool, which to prefer, and result sizes
- `marketplace` - Package ecosystem and plugins
- `export-interface` - Interface ports and scoped iteration
- `iterative-development` - Step-by-step building
- `debugging` - Troubleshooting workflows
- `error-codes` - Error code reference
