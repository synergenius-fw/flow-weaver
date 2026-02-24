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
  return `Hello, ${name}!`;
}

/**
 * @flowWeaver nodeType
 * @expression
 * @label Uppercase
 * @input text - Text to transform
 * @output result - Uppercased text
 */
function uppercase(text: string): string {
  return text.toUpperCase();
}

/**
 * @flowWeaver workflow
 * @param name - Name to greet
 * @returns result - Uppercased greeting
 * @node greeter greet [position: 180 0]
 * @node transform uppercase [position: 360 0]
 * @connect Start.name -> greeter.name
 * @connect greeter.message -> transform.text
 * @connect transform.result -> Exit.result
 */
export function greetingWorkflow(
  execute: boolean,
  params: { name: string }
): { onSuccess: boolean; onFailure: boolean; result: string } {
  return { onSuccess: true, onFailure: false, result: '' };
}
```

That is it. Two expression-mode functions, one workflow annotation, zero boilerplate. The compiler infers STEP connections from the data flow -- no `execute`, `onSuccess`, or `onFailure` wiring needed.

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
| Compile to Inngest               | `compilation`                | cli-reference       |
| Deploy to cloud                  | `deployment`                 | compilation         |
| Use delay/waitForEvent/mocks     | `built-in-nodes`             | debugging           |
| Publish marketplace packages     | `marketplace`                | —                   |

Use `flow-weaver docs <topic>` to read any topic.

## File Format

Workflows are TypeScript files with JSDoc annotations. Any `.ts`, `.tsx`, `.js`, or `.jsx` file with `@flowWeaver` annotations works.

## CLI Commands

```bash
flow-weaver validate <file>   # Check for errors (--json for machine parsing)
flow-weaver compile <file>    # Generate executable code
flow-weaver run <file>        # Execute a workflow directly. No compile step needed for testing.
flow-weaver describe <file>   # Get workflow structure as JSON
flow-weaver watch <file>      # Watch mode
flow-weaver dev <file>        # Watch + compile + run in one command
flow-weaver serve [dir]       # HTTP server exposing workflows as endpoints
flow-weaver diagram <file>    # Generate SVG diagram
flow-weaver export <file>     # Export as serverless function (lambda/vercel/cloudflare/inngest)
flow-weaver docs              # Browse documentation
flow-weaver docs <topic>      # Read a specific topic
flow-weaver docs search <q>   # Search across all docs
```

Options: `-w/--workflow-name`, `--json`, `--format text|mermaid`. See `cli-reference` for all commands and flags.

## Core Annotations

### Expression Node Type (Recommended)

> **Tip:** Most nodes should use `@expression` mode. Use normal mode only for custom error handling or void returns.

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

> **Start with expression mode.** Only switch to normal mode when you need to return data alongside a failure (error-with-data patterns) or for void side-effect functions. Expression nodes handle success/failure branching automatically — throw to trigger the `onFailure` path.

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

Use normal mode when you need to return error data alongside the failure signal, or for `void` side-effect functions.

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
  if (!execute) return { onSuccess: false, onFailure: false, outputName: null };
  return { onSuccess: true, onFailure: false, outputName: result };
}
```

### Workflow Export

```typescript
/**
 * @flowWeaver workflow
 * @param inputPort - Description
 * @returns outputPort - Description
 * @node instanceId nodeTypeName [position: 180 0]
 * @connect Start.inputPort -> instanceId.input
 * @connect instanceId.output -> Exit.outputPort
 */
export function workflowName(
  execute: boolean,
  params: { inputPort: Type }
): { onSuccess: boolean; onFailure: boolean; outputPort: Type } {
  return { onSuccess: true, onFailure: false, outputPort: null };
}
```

> STEP connections (`execute`, `onSuccess`, `onFailure`) are auto-wired for expression nodes. Add explicit STEP connections only for normal mode nodes or to override the automatic wiring.

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

> **Key difference:** Nodes use direct params, workflows use `params` object.

## Node Registration

Every node used in a workflow must be explicitly declared with `@node`. The compiler builds a static directed graph from annotations at compile time, so it needs to know about every node before code generation begins. This is different from normal function calls where you just invoke a function directly.

Built-in nodes (`delay`, `waitForEvent`, `invokeWorkflow`, `waitForAgent`) are exported from the library but still need explicit declaration in your workflow file. The compiler validates all `@node` references against the set of available node types — functions annotated with `@flowWeaver nodeType` in the same file or imported via `@fwImport`.

To use a built-in node, define or import the function and annotate it:

```typescript
import { waitForEvent } from '@synergenius/flow-weaver/built-in-nodes';

/**
 * @flowWeaver nodeType
 * @input eventName - Event to wait for
 * @output eventData - Received event payload
 */
// (function body provided by the library)

/**
 * @flowWeaver workflow
 * @node wait waitForEvent
 * @connect Start.eventName -> wait.eventName
 * @connect wait.eventData -> Exit.data
 */
export function myWorkflow(execute: boolean, params: { eventName: string }) { ... }
```

## Port Types

STRING, NUMBER, BOOLEAN, OBJECT, ARRAY, FUNCTION, ANY, STEP

Types are inferred from TypeScript signature. STEP is for control flow (execute, onSuccess, onFailure).

## Reserved Nodes

- `Start` - Flow entry point (exposes workflow inputs via @param)
- `Exit` - Flow exit point (receives workflow outputs via @returns)

## Scoped Nodes (Iteration/forEach)

For loops/iteration, use **per-port scopes** with explicit `scope:scopeName` suffixes.

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

See `flow-weaver docs export-interface` for full scope documentation.

## Node Positioning

Instance nodes use a bracket attribute on the `@node` line: `@node id Type [position: x y]`

The standalone `@position nodeId x y` syntax is reserved for Start and Exit virtual nodes, which have no `@node` line.

Values are in pixels on a 90px grid.

Default layout:

- Start: -450px (col -5)
- Exit: 450px (col 5)

Spacing: 180px horizontal (standard), 150px vertical for branches

## Workflow Recipes

### Recipe 1: Build a Workflow from Scratch

```
1. flow-weaver create workflow sequential my-workflow.ts --preview   # preview the template
2. Write the file with node types + workflow annotations
3. flow-weaver validate my-workflow.ts                               # check for errors
4. Fix any errors, re-validate
5. flow-weaver compile my-workflow.ts                                # generate executable code
6. flow-weaver describe my-workflow.ts --format text                 # verify structure
```

### Recipe 2: Add a Node to Existing Workflow

```
1. flow-weaver describe my-workflow.ts --format text   # understand current structure
2. Edit the file: add @flowWeaver nodeType function + @node + @connect annotations
3. flow-weaver validate my-workflow.ts                 # verify
```

### Recipe 3: Debug a Broken Workflow

```
1. flow-weaver validate my-workflow.ts                              # get all errors
2. flow-weaver describe my-workflow.ts --format text                # get full picture
3. Fix errors based on error codes (see: flow-weaver docs error-codes)
```

### Recipe 4: Add Iteration (ForEach)

```
1. Read: flow-weaver docs export-interface              # scoped port syntax
2. Edit file: add forEach node type with scope ports
3. Edit file: add child node with parent scope reference
4. Edit file: wire scoped connections (:scopeName suffix)
5. flow-weaver validate my-workflow.ts                  # verify scope wiring
```

## Workflow Development Process

1. **Create file** - Write TypeScript file with types and node functions
2. **Add annotations** - `@flowWeaver nodeType` and `@flowWeaver workflow`
3. **Validate** - `flow-weaver validate <file>`
4. **Test** - Start with `flow-weaver run <file>` for quick testing. Compile only for production deployment.
5. **Compile** - `flow-weaver compile <file>`
6. **Inspect** - `flow-weaver describe <file>` for structure

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
- `compilation` - Compilation targets (TypeScript, Inngest) and options
- `deployment` - Export to cloud, serve mode, OpenAPI
- `built-in-nodes` - delay, waitForEvent, invokeWorkflow, and mock system
- `marketplace` - Package ecosystem and plugins
- `export-interface` - Interface ports and scoped iteration
- `iterative-development` - Step-by-step building
- `debugging` - Troubleshooting workflows
- `error-codes` - Error code reference
