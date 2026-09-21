---
name: Export Interface (Ports)
description: How to define workflow input/output ports, scoped iteration, and forEach patterns
keywords: [ports, interface, inputs, outputs, scoped, forEach, iteration, param, returns, workflow]
---

# Code-First Architecture

Flow Weaver generates JS/TS files from TypeScript sources with `@flowWeaver` annotations. Each export becomes a callable function.

Any `.ts`, `.tsx`, `.js`, or `.jsx` file with `@flowWeaver` annotations works.

# Port Definition

## Workflow Inputs (@param)

Use JSDoc `@param` to define Start node ports:

```typescript
/**
 * @flowWeaver workflow
 * @param data - Input data to process
 * @param [optional] - Optional input (brackets = optional in TS type)
 * @param [withDefault=42] - Optional with default value
 */
export function myWorkflow(
  execute: boolean,
  params: { data: any; optional?: any; withDefault?: number }
) { ... }
```

**IMPORTANT:**

- Second parameter MUST be named `params` - generator uses this name
- Optional `[param]` marks the TypeScript type as optional, but **if you connect to that port, you must provide a value**. Use optional params for ports that may not be connected.

## Workflow Outputs (@returns)

Use JSDoc `@returns` to define Exit node ports:

```typescript
/**
 * @flowWeaver workflow
 * @returns result - The output result
 * @returns status - Status message
 */
export function myWorkflow(...): {
  onSuccess: boolean;
  onFailure: boolean;
  result: any;
  status: string
} { ... }
```

## Node Inputs/Outputs

Use `@input` and `@output` for node types. **Inputs become direct parameters**, and the return value is the output:

```typescript
/**
 * @flowWeaver nodeType
 * @expression
 * @input value - Value to process
 * @input count - Number of times
 * @output result - Processed result
 */
function processNode(value: any, count: number): any { ... }
//                   ^           ^
//             Direct parameters (NOT wrapped in object)
```

With one `@output`, the whole return value is that port. With several, return an object with one property per `@output`. A throw marks the node failed and propagates the error out of the workflow call.

**The text after the dash is the port's display label, not a description.** It renders inside the port badge in the diagram, so keep it to **1–2 words** — `@output task - Agent task`, not `@output task - The agent task (agentId, context, prompt), as one value`. There is no separate description field for a port; a long sentence just overflows the badge. Omit the dash entirely when the name already says it (`@output task`).

Only a normal-mode node (see Mandatory Ports) adds `execute: boolean` in front: `function processNode(execute: boolean, value: any, count: number)`.

## Designing ports to avoid connection sprawl

The rule: **scalar ports for what a node reads or transforms; one object port for context that flows through unchanged.** Getting this backwards is the main cause of over-wired workflows.

- **Never create a relay port pair.** An `@input x` plus `@output x` that only passes a value through is a smell. If several nodes need the same unchanging values, carry them in one object port (`@output brief`) instead of re-declaring each scalar on every node. One shared `brief` object replaced eight `surface` re-wirings in one workflow.
- **Keep port names identical along a chain** so `@path` wires the data with no `@connect`; reserve `@connect` for genuine renames.
- **Gates read the fields they need with `[expr:]`** (`context="upstream.state.field"`) rather than through relay ports — but only from their **immediate predecessor**. Reaching past a gate to an earlier node puts the gate in two branch regions and is rejected (`DURABLE_CLOSURE_INVALID`). Thread the shared object through each gate so each reads from the one before it.

The cost of an object port: type-checking is per-object, not per-field, and a consumer that declares a narrower shape than the producer emits gets an `OBJECT_TYPE_MISMATCH` warning (it still runs — structural subtyping). Keep the one or two values a node actually transforms as typed scalars so the checker still guards them.

# Mandatory Ports

Every node and workflow has these STEP ports, and `@path` wires them for every step:

**Input:**

- `execute` (STEP)

**Output:**

- `onSuccess` (STEP)
- `onFailure` (STEP)

An expression node never mentions them: the runtime passes `execute`, sets `onSuccess` on return, and on a throw sets `onFailure` and rethrows, so the error leaves the workflow call rather than following a `:fail` route. They appear in a function signature only in **normal mode** (`execute` is the first parameter, `onSuccess`/`onFailure` are in the return type) and in the **workflow export**, whose signature is always `(execute: boolean, params: {...}): { onSuccess: boolean; onFailure: boolean; ...returns }`. Normal mode is reserved for a node that routes a failure to another node or to `Exit.onFailure`, returns data alongside a failure, a void side-effect, a boolean branch, a scope owner (forEach below), or a durable gate or effect.

# Async Workflows

Use `async` keyword on function - no annotation needed:

```typescript
/**
 * @flowWeaver workflow
 * @param data - Input
 * @returns result - Output
 */
export async function asyncWorkflow(
  execute: boolean,
  params: { data: any }
): Promise<{ onSuccess: boolean; onFailure: boolean; result: any }> {
  throw new Error('generated body was not installed');
}
```

Async node types work the same way. An `async` expression function's resolved value is its output, and a rejection is its failure:

```typescript
/**
 * @flowWeaver nodeType
 * @expression
 * @input url - URL to fetch
 * @output data - Parsed response body
 */
async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}
```

# Scoped Ports (Iteration/Looping)

For iteration (forEach), use **per-port scopes** with `scope:scopeName` suffix on ports.

The forEach node owns a scope, which is one of the reasons for normal mode: it takes `execute`, calls the generated callback per item itself, and reports `onSuccess`/`onFailure` when the loop is done. The child node inside the scope is an ordinary expression node.

> **A scope and a durable gate cannot share a workflow.** A workflow whose
> reachable closure contains a gate — `waitForEvent`, `waitForAgent`, or any
> `@durableGate` — may not contain scoped children at all, and is refused with
> `DURABLE_CLOSURE_INVALID`. The owner calls the callback itself, so the engine
> cannot prove on resume that the iteration it is servicing is the one that
> paused. To loop over work that pauses, run the loop **outside** the workflow
> and invoke the gated workflow once per item, or write the passes out in full
> if there are few and the count is fixed. See [Durable Gates](durable-gates).

## 1. Define ForEach Node Type

```typescript
/**
 * @flowWeaver nodeType
 * @label For Each
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

- Scope name (`processItem`) MUST match callback parameter name
- Callback is auto-generated by compiler, receives scoped port values as args
- The node implementation iterates by calling callback for each item
- Mandatory scoped STEP ports: `start` (output), `success`/`failure` (inputs)
- Scoped wiring uses `@connect` with the `:scopeName` suffix; `@path` does not express it

## 2. Use ForEach in Workflow

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

Key syntax:

- `@node proc processor loop.processItem` - child node inside `loop`'s `processItem` scope
- `loop.item:processItem` - scoped OUTPUT port (`:scopeName` suffix)
- `loop.processed:processItem` - scoped INPUT port (`:scopeName` suffix)
- Connect child's `execute`/`onSuccess`/`onFailure` to scope's mandatory ports

**IMPORTANT:** Don't forget to wire `Start.execute` and `Exit.onSuccess/onFailure`!

# Common Mistakes

**Wrong node signature (wrapping inputs)**

```typescript
// WRONG - inputs wrapped in object
function node(params: { value: any }) { ... }

// CORRECT - direct parameters for nodes
function node(value: any): Result { ... } // expression mode
function node(execute: boolean, value: any) { ... } // normal mode only
```

**Signature does not match the mode**

```typescript
// WRONG - normal mode (no @expression tag) but no execute parameter
function node(value: any) { ... }

// CORRECT - expression mode: add @expression, no execute parameter
/** @flowWeaver nodeType @expression ... */
function node(value: any): Result { ... }

// CORRECT - normal mode: execute comes first
function node(execute: boolean, value: any) { ... }
```

**Missing return properties (normal mode)**

```typescript
// WRONG - normal mode return missing onFailure
return { onSuccess: true, result: 42 };

// CORRECT - normal mode
return { onSuccess: true, onFailure: false, result: 42 };

// CORRECT - expression mode returns the value itself
return 42;
```

**Multiple connections to same Exit port**

```typescript
// PROBLEMATIC - only one value will be used
@connect nodeA.result -> Exit.output
@connect nodeB.result -> Exit.output

// BETTER - use separate Exit ports
@connect nodeA.result -> Exit.successOutput
@connect nodeB.result -> Exit.errorOutput
```

**Using reserved names for node types**

```typescript
// WRONG - 'process' is a Node.js global
function process(item: any) { ... }

// CORRECT - use non-reserved names
function processItem(item: any) { ... }
```

Avoid: `process`, `module`, `require`, `exports`, `console`, `global`

# Validation

Always validate after changes:

```bash
fw validate <file>
```
