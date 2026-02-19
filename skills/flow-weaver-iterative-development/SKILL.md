---
name: Flow Weaver Iterative Development
description: Step-by-step workflow building with test-driven approach
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

Present the plan to the user.

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
  return { onSuccess: true, onFailure: false, result: null };
}
```

**IMPORTANT:** Second parameter MUST be named `params`.

Test:

```bash
flow-weaver validate <file>
```

### Phase 3: Create the Nodes

**Start with `@expression` mode for all nodes.** Only switch to normal mode when you need explicit branching (quality gates, conditional routing, error-with-data patterns).

Create nodes by adding `@flowWeaver nodeType` annotated functions.

Create at most 3 nodes at a time, test each.

Default to expression mode. Use normal mode only for:
- **Quality gates** -- routing to different paths based on success/failure
- **Conditional routing** -- explicit `onSuccess`/`onFailure` branching
- **Error-with-data patterns** -- returning error details alongside the failure signal

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

> Use `@expression` for most nodes. Only use normal mode when you need custom failure handling or void returns.

**Normal mode (for custom error handling):**

```typescript
/**
 * @flowWeaver nodeType
 * @label Risky Operation
 * @input url - URL to fetch
 * @output data - Fetched data
 */
async function riskyFetch(
  execute: boolean,
  url: string
): Promise<{ onSuccess: boolean; onFailure: boolean; data: any }> {
  if (!execute) return { onSuccess: false, onFailure: false, data: null };
  try {
    const res = await fetch(url);
    return { onSuccess: true, onFailure: false, data: await res.json() };
  } catch {
    return { onSuccess: false, onFailure: true, data: null };
  }
}
```

Add node instances with `@node` and connections with `@connect`:

```typescript
/**
 * @flowWeaver workflow
 * @node adder addNumbers
 * @connect Start.a -> adder.a
 * @connect adder.result -> Exit.result
 * @position adder 180 0
 */
```

> Expression nodes don't need explicit STEP connections — the compiler infers execution order from data connections. Add STEP connections explicitly only when you need branching control. See `examples/basic/example-expression-mode.ts` for a complete example.

Test after each change:

```bash
flow-weaver validate <file>
```

### Phase 4: Finalizing

After everything is connected:

1. Run multiple test scenarios
2. If not returning values, check return type
3. Verify node positioning with `@position nodeId x y` (in pixels)
4. Inspect the compiled source file for errors (compilation modifies the file in-place)

Final validation:

```bash
flow-weaver validate <file>
flow-weaver compile <file>
flow-weaver describe <file>  # Get workflow structure as JSON
```

Present the results.

## Common AI Mistakes

### 1. Missing STEP Connections (Normal Mode) or Adding Unnecessary Ones (Expression Mode)

**Normal mode nodes** need explicit STEP wiring: `@connect Start.execute -> firstNode.execute`. Without this, no node will run. **Expression mode** nodes auto-wire STEP connections from data flow — you only need data connections for linear pipelines. Add explicit STEP connections only for branching (e.g., routing `onFailure` to a different node).

### 2. Wrapping Node Inputs in Object

```typescript
// WRONG — this is workflow style, not node style
function myNode(execute: boolean, params: { a: number; b: number });

// CORRECT — node inputs are direct parameters
function myNode(execute: boolean, a: number, b: number);
```

### 3. Mixing STEP and Data Ports

`onSuccess` -> `inputData` is WRONG. STEP ports only connect to STEP ports. Data ports only connect to data ports.

### 4. Forgetting Exit Connections

If the workflow should return values, connect them: `@connect lastNode.result -> Exit.resultPort`. Also connect `lastNode.onSuccess -> Exit.onSuccess`.

### 5. Not Validating After Each Change

Always run `fw_validate` or `flow-weaver validate` after adding nodes/connections. Don't batch 10 changes then validate — validate incrementally. Note: `fw_modify` now auto-validates and returns results.

### 6. Using Normal Mode When Expression Mode Works

If the function returns a value and doesn't need custom error handling, use `@expression`. It's simpler and less error-prone. Expression mode eliminates the `execute` parameter, the `if (!execute)` guard, and the `onSuccess`/`onFailure` boilerplate. The compiler handles all of it.

**Rule of thumb:** If you are writing `if (!execute) return ...` and a `try/catch` that just returns `{ onSuccess: false, onFailure: true }`, you should be using expression mode instead.

### 7. Defaulting to Normal Mode

Normal mode adds boilerplate that expression mode handles automatically. Default to `@expression` for every node. Only reach for normal mode when the function needs to:
- Route to different downstream nodes on success vs. failure
- Return error data (not just signal failure)
- Perform void side-effects with explicit control flow
