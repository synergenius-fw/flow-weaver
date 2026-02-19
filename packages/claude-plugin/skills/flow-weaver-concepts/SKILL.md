---
name: Flow Weaver Concepts
description: Fundamental concepts of Flow Weaver workflows
---

**Source**: https://github.com/synergenius-fw/flow-weaver — read the source when docs aren't enough.

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
 * @node greeter greet
 * @node transform uppercase
 * @connect Start.name -> greeter.name
 * @connect greeter.message -> transform.text
 * @connect transform.result -> Exit.result
 * @position greeter 180 0
 * @position transform 360 0
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

## Skill Navigator

| Task                             | Primary Skill                                   | Supporting                 |
| -------------------------------- | ----------------------------------------------- | -------------------------- |
| First time? Build a workflow     | `flow-weaver:flow-weaver-tutorial`              | concepts                   |
| Build from scratch (experienced) | `flow-weaver:flow-weaver-iterative-development` | concepts, export-interface |
| Scaffold from template           | `flow-weaver:flow-weaver-scaffold`              | concepts                   |
| Add iteration/forEach            | `flow-weaver:flow-weaver-export-interface`      | concepts                   |
| Convert existing functions       | `flow-weaver:flow-weaver-node-conversion`       | concepts                   |
| Debug validation errors          | `flow-weaver:flow-weaver-debugging`             | error-codes                |
| Look up specific error code      | `flow-weaver:flow-weaver-error-codes`           | debugging                  |
| Reuse workflow fragments         | `flow-weaver:flow-weaver-patterns`              | concepts                   |
| Check annotation syntax          | `flow-weaver:flow-weaver-jsdoc-grammar`         | concepts                   |

## File Format

Workflows are TypeScript files with JSDoc annotations. Any `.ts`, `.tsx`, `.js`, or `.jsx` file with `@flowWeaver` annotations works.

**Edit directly with Edit/Write tools.**

## CLI Commands

```bash
flow-weaver validate <file>   # Check for errors (--json for AI parsing)
flow-weaver compile <file>    # Generate executable code
flow-weaver run <file>        # Execute a workflow directly. No compile step needed for testing.
flow-weaver describe <file>   # Get workflow structure as JSON
flow-weaver watch <file>      # Watch mode
```

Options: `-w/--workflow-name`, `--json`, `--format text|mermaid`

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
  // Pure function logic — no execute param, no onSuccess/onFailure
  return result;
}
```

Expression nodes are pure functions where:

- No `execute: boolean` parameter — the runtime handles execution control
- No `onSuccess`/`onFailure` in return type — the runtime auto-sets these
- Function params map directly to `@input` ports
- Return value maps to `@output` ports:
  - Primitive/array return → single output port
  - Object return `{ a, b }` → one port per property
- Best for: transformers, math, utilities, data mapping, async fetchers, API calls

> **Start with expression mode.** Only switch to normal mode when you need explicit branching (`onSuccess`/`onFailure` routing), custom error-with-data patterns, or void returns with side effects.

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

Use normal mode when you need explicit `try/catch → onFailure` error handling or `void` returns.

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
 * @node instanceId nodeTypeName
 * @connect Start.inputPort -> instanceId.input
 * @connect instanceId.output -> Exit.outputPort
 * @position instanceId 180 0
 */
export function workflowName(
  execute: boolean,
  params: { inputPort: Type }
): { onSuccess: boolean; onFailure: boolean; outputPort: Type } {
  return { onSuccess: true, onFailure: false, outputPort: null };
}
```

> STEP connections (`execute`, `onSuccess`, `onFailure`) are auto-wired for expression nodes in linear data flows. Add them explicitly only for branching or normal mode nodes.

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

- First identifier: node type name (convention: `npm/pkg/fn` or `local/path/fn`)
- Second identifier: exported function name
- String: package name or relative path

Imported functions become expression nodes. Port types are inferred from `.d.ts` files when available.

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

See `flow-weaver:flow-weaver-export-interface` for full scope documentation.

## Node Positioning

Syntax: `@position nodeId x y` (values in pixels, 90px grid)

Default layout:

- Start: -450px (col -5)
- Exit: 450px (col 5)

Spacing: 180px horizontal (standard), 150px vertical for branches

## MCP Tool Recipes

### Recipe 1: Build a Workflow from Scratch

```
1. fw_scaffold(template="sequential", filePath="...", preview=true) -- preview the template
2. Write the file using Edit/Write tools with node types + workflow annotations
3. fw_validate(filePath="...") -- check for errors
4. Fix any errors, re-validate
5. fw_compile(filePath="...") -- generate executable code
6. fw_describe(filePath="...", format="text") -- verify structure
```

### Recipe 2: Add a Node to Existing Workflow

```
1. fw_describe(filePath="...", format="text") -- understand current structure
2. fw_query(filePath="...", query="node-types") -- see available node types
3. Edit the file: add @flowWeaver nodeType function + @node + @connect annotations
4. fw_validate(filePath="...") -- verify (or use fw_modify which auto-validates)
```

### Recipe 3: Debug a Broken Workflow

```
1. fw_validate(filePath="...") -- get all errors (includes hints for each error)
2. fw_query(filePath="...", query="isolated") -- find disconnected nodes
3. fw_query(filePath="...", query="dead-ends") -- find nodes not reaching Exit
4. fw_describe(filePath="...", format="text") -- get full picture
5. fw_query(filePath="...", query="deps", nodeId="...") -- trace specific node
```

### Recipe 4: Add Iteration (ForEach)

```
1. Read flow-weaver:flow-weaver-export-interface for scoped port syntax
2. Edit file: add forEach node type with scope ports
3. Edit file: add child node with parent scope reference
4. Edit file: wire scoped connections (:scopeName suffix)
5. fw_validate(filePath="...") -- verify scope wiring
```

### Recipe 5: Extract and Reuse a Pattern

```
1. fw_query(filePath="...", query="nodes") -- list all nodes
2. fw_extract_pattern(sourceFile="...", nodes="a,b,c", name="myPattern")
3. fw_list_patterns(filePath="...") -- verify extraction
4. fw_apply_pattern(patternFile="...", targetFile="...", prefix="p1")
5. Edit file: wire IN/OUT ports to existing workflow nodes
6. fw_validate(filePath="...") -- verify
```

## Workflow Development Process

1. **Create file** - Write TypeScript file with types and node functions
2. **Add annotations** - `@flowWeaver nodeType` and `@flowWeaver workflow`
3. **Validate** - `flow-weaver validate <file>`
4. **Test** - Start with `flow-weaver run <file>` for quick testing. Compile only for production deployment.
5. **Compile** - `flow-weaver compile <file>`
6. **Inspect** - `flow-weaver describe <file>` for structure

## Related Skills

- `flow-weaver:flow-weaver-export-interface` - Interface ports and script
- `flow-weaver:flow-weaver-iterative-development` - Step-by-step building
- `flow-weaver:flow-weaver-debugging` - Troubleshooting workflows
- `flow-weaver:flow-weaver-error-codes` - Error code reference
