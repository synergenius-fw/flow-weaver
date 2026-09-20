---
name: Flow Weaver Iterative Development
description: Step-by-step workflow building with test-driven approach
keywords: [iterative, TDD, step-by-step, building, testing, development process, expression, validate]
---

# Build Process

Test every step. Building everything before testing is like writing 1000 lines of code without running it.

Workflows are TypeScript files with @flowWeaver annotations. Any `.ts`, `.tsx`, `.js`, or `.jsx` file works.

### Phase 1: Plan your Flow

First understand what the Flow is trying to achieve. Think of it as a function - it takes in data and returns data.

Plan:

- Export Interface (inputs/outputs)
- What nodes are needed
- If async behavior is required (use `async` function)

The whole point is for each node to become a module - encapsulated abstracted logic that can be swapped and changed.

### Phase 2: Specify and Test the Export Interface

Create the Export Interface by editing the workflow file directly.

Define:

- Start ports using `@param` JSDoc tags
- Exit ports using `@returns` JSDoc tags

```typescript
/**
 * @flowWeaver workflow
 * @param input - Input data
 * @returns result - Output result
 */
export function myWorkflow(
  execute: boolean,
  params: { input: any }
): { onSuccess: boolean; onFailure: boolean; result: any } {
  throw new Error('generated body was not installed');
}
```

**IMPORTANT:** Second parameter MUST be named `params`. The body is a stub: the compiler installs the real one, so never return fake data from it. The signature (`execute`, `params`, `onSuccess`/`onFailure` plus the `@returns` ports) is fixed regardless of the node modes used inside.

Test:

```bash
fw validate <file>
```

### Phase 3: Create the Nodes

**Start with `@expression` mode for all nodes.** Only switch to normal mode when you need to return error data alongside the failure signal, or for void side-effects.

Create nodes by adding `@flowWeaver nodeType` annotated functions.

Create at most 3 nodes at a time, test each.

Default to expression mode. Use normal mode only for:
- **Error-with-data patterns** -- returning structured error details alongside the failure signal
- **Void side-effects** -- functions with no return value that need explicit control flow

**Expression mode (recommended for most nodes):**

```typescript
/**
 * @flowWeaver nodeType
 * @expression
 * @label Add Numbers
 * @input a - First number
 * @input b - Second number
 * @output result - Sum
 */
function addNumbers(a: number, b: number): number {
  return a + b;
}
```

> Use `@expression` for most nodes. A throw in an expression node marks it failed and propagates the error out of the workflow call. Use normal mode when a failure must be routed to another node or to `Exit.onFailure`, must carry data, or the function returns void.

**Async expression mode (fetching, I/O):**

An `async` function is still an expression node. Its resolved value is the output; a throw (or a rejected promise) marks the node failed and propagates out of the workflow call:

```typescript
/**
 * @flowWeaver nodeType
 * @expression
 * @label Fetch JSON
 * @input url - URL to fetch
 * @output data - Parsed response body
 */
async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.json();
}
```

**Normal mode (error-with-data only):**

Switch to normal mode only when a downstream node needs data from the failure itself. Here the HTTP status must be available even when the fetch fails, so the node sets `onSuccess`/`onFailure` by hand:

```typescript
/**
 * @flowWeaver nodeType
 * @label Fetch With Status
 * @input url - URL to fetch
 * @output data - Parsed response body
 * @output status - HTTP status code, also reported on failure
 */
async function fetchWithStatus(
  execute: boolean,
  url: string
): Promise<{ onSuccess: boolean; onFailure: boolean; data: any; status: number }> {
  // Normal mode: the caller needs the status code even when the fetch fails (error-with-data).
  if (!execute) return { onSuccess: false, onFailure: false, data: null, status: 0 };
  const res = await fetch(url);
  if (!res.ok) return { onSuccess: false, onFailure: true, data: null, status: res.status };
  return { onSuccess: true, onFailure: false, data: await res.json(), status: res.status };
}
```

Add node instances with `@node` and declare the route with `@path`:

```typescript
/**
 * @flowWeaver workflow
 * @param a - First number
 * @param b - Second number
 * @returns result - Sum
 * @node adder addNumbers
 * @path Start -> adder -> Exit
 */
```

> `@path` writes the STEP connections and wires the data ports by name: `adder.a` and `adder.b` come from the `Start` params, and `Exit.result` from `adder.result`. Name your ports consistently and a linear pipeline needs no `@connect` at all. Add `@connect` only for ports whose names differ, and `:ok`/`:fail` suffixes on a step when you need branching control.

Test after each change:

```bash
fw validate <file>
```

### Phase 4: Finalizing

After everything is connected:

1. Run multiple test scenarios
2. If not returning values, check return type
3. Inspect the compiled source file for errors (compilation modifies the file in-place)

Final validation:

```bash
fw validate <file>
fw compile <file>
fw describe <file>  # Get workflow structure as JSON
```

## Common Mistakes

### 1. Leaving a Node Off the Path

Every node needs a STEP source. Put it on a `@path` and the compiler writes `execute`/`onSuccess` wiring for it, whatever its mode. **Normal mode nodes** left off the path need explicit STEP wiring by hand: `@connect Start.execute -> firstNode.execute`. Without either, the node never runs. **Expression mode** nodes auto-wire STEP connections from data flow, but a `@path` is still the clearest statement of order. To route `onFailure` to a specific node, use a `:fail` suffix on the path step (or an explicit STEP `@connect`); both expression and normal mode nodes support this.

### 2. Wrapping Node Inputs in Object

```typescript
// WRONG -- this is workflow style, not node style
function myNode(params: { a: number; b: number });

// CORRECT -- node inputs are direct parameters
function myNode(a: number, b: number): number; // expression mode
function myNode(execute: boolean, a: number, b: number); // normal mode only
```

### 3. Mixing STEP and Data Ports

`onSuccess` -> `inputData` is WRONG. STEP ports only connect to STEP ports. Data ports only connect to data ports.

### 4. Forgetting Exit Connections

If the workflow should return values, end the `@path` at `Exit` and name each `@returns` port after the output that produces it: `@path ... -> lastNode -> Exit` wires `lastNode.result -> Exit.result` and `lastNode.onSuccess -> Exit.onSuccess`. For a port whose name differs, add `@connect lastNode.result -> Exit.resultPort`. A `Start` param never reaches `Exit` by name; write that pass-through as an explicit `@connect`.

### 5. Not Validating After Each Change

Always run `fw validate` after adding nodes/connections. Don't batch 10 changes then validate -- validate incrementally.

### 6. Using Normal Mode When Expression Mode Works

If the function returns a value, use `@expression`. It's simpler and less error-prone. Expression mode eliminates the `execute` parameter, the `if (!execute)` guard, and the `onSuccess`/`onFailure` boilerplate. The compiler wraps the call in try/catch: a throw marks the node's `onFailure` port and is then rethrown out of the workflow call. If another node must run on failure, that node's predecessor has to be a normal-mode node returning `onFailure: true`.

**Rule of thumb:** If you are writing `if (!execute) return ...` and a `try/catch` that just returns `{ onSuccess: false, onFailure: true }`, you should be using expression mode instead.

### 7. Defaulting to Normal Mode

Normal mode adds boilerplate that expression mode handles automatically. Default to `@expression` for every node. Only reach for normal mode when the function needs to:
- Return error data alongside the failure signal (not just signal failure)
- Perform void side-effects with no return value
- Perform void side-effects with explicit control flow
