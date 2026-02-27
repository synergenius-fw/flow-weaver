---
name: Flow Weaver Debugging
description: Debugging workflows, validation, diagnostics, and error resolution
keywords: [debug, troubleshooting, errors, WebSocket, diagnostics, runtime, validation, trace, step-through, checkpoint, resume, breakpoint, crash-recovery, REPL]
---

# Flow Weaver Debugging Guide

For error code lookup, use `flow-weaver docs error-codes`.

---

## Top 5 Errors Quick Fix

| Error                   | Fix                                                             |
| ----------------------- | --------------------------------------------------------------- |
| UNKNOWN_NODE_TYPE       | Check spelling, run `flow-weaver describe <file>`               |
| MISSING_REQUIRED_INPUT  | Add `@connect` or make port optional with `@input [name]`       |
| STEP_PORT_TYPE_MISMATCH | STEP ports (execute/onSuccess/onFailure) only connect to STEP   |
| CYCLE_DETECTED          | Use scoped forEach instead of graph loops                       |
| UNKNOWN_SOURCE_PORT     | Check port name spelling, run `flow-weaver describe <file>`     |

---

## WebSocket Debug Events

Flow Weaver can emit real-time execution events over WebSocket for runtime debugging. This is enabled by compiling without the `--production` flag.

### Enabling Debug Events

```bash
# Compile the workflow (debug mode is the default)
flow-weaver compile my-workflow.ts

# Run with WebSocket debug target
FLOW_WEAVER_DEBUG=ws://localhost:9000 node my-workflow.generated.js
```

Production builds (`flow-weaver compile --production`) strip all debug event code.

### Event Types

| Event              | Description                  | Key Fields                                |
| ------------------ | ---------------------------- | ----------------------------------------- |
| STATUS_CHANGED     | Node execution status change | `id`, `status` (RUNNING/SUCCEEDED/FAILED) |
| VARIABLE_SET       | Port value set               | `identifier.portName`, `value`            |
| LOG_ERROR          | Node threw an error          | `id`, `error` message                     |
| WORKFLOW_COMPLETED | Workflow finished            | `status`, `result`                        |

### WebSocket Message Format

Messages are JSON-encoded with envelope: `{ type: "event", sessionId, event: {...} }`.
On connection: `{ type: "connect", sessionId, workflowExportName, clientInfo }`.

When a workflow calls another workflow, inner events have `innerFlowInvocation: true`.

---

## Debugging Decision Tree

```
START: What is the problem?
|
+-- "Compilation fails" (parse or validation errors)
|   |
|   +-- Run: flow-weaver validate <file> --verbose
|   |
|   +-- Are there PARSE errors?
|   |   |
|   |   +-- YES --> Check annotation syntax:
|   |   |           - @flowWeaver nodeType / workflow present?
|   |   |           - @connect format: Source.port -> Target.port ?
|   |   |           - Function signature: (execute: boolean, ...) => { onSuccess, ... } ?
|   |   |           - Proper JSDoc comment blocks (/** ... */) not line comments (//)?
|   |   |
|   |   +-- NO --> Are there VALIDATION errors?
|   |       |
|   |       +-- YES --> Look up the error code: flow-weaver docs error-codes
|   |       |           Common quick fixes:
|   |       |           - UNKNOWN_*: Check spelling, use validator suggestions
|   |       |           - MISSING_REQUIRED_INPUT: Add connection or default
|   |       |           - CYCLE_DETECTED: Break the loop, use scoped nodes
|   |       |           - STEP_PORT_TYPE_MISMATCH: Don't mix control/data flow
|   |       |
|   |       +-- NO --> Warnings only. Workflow is valid but review warnings.
|   |                   Common warnings to address:
|   |                   - UNUSED_NODE: Remove or connect it
|   |                   - MULTIPLE_EXIT_CONNECTIONS: Use separate exit ports
|   |                   - TYPE_MISMATCH: Verify data compatibility
|
+-- "Runtime error" (workflow compiled but fails when executed)
|   |
|   +-- Enable WebSocket debugging:
|   |   FLOW_WEAVER_DEBUG=ws://localhost:9000 node <file>
|   |
|   +-- Is the error "Variable not found: X.Y[Z]"?
|   |   |
|   |   +-- YES --> A node tried to read a port value that was never set.
|   |               Causes: upstream node failed silently, connection goes
|   |               through a branch that was not taken, execution order issue.
|   |               Check: onSuccess/onFailure path taken by upstream node.
|   |
|   |   +-- NO --> Is it a CancellationError?
|   |       |
|   |       +-- YES --> The AbortSignal was triggered. Check abort logic.
|   |       |
|   |       +-- NO --> Check the LOG_ERROR events for the failing node.
|   |                   Read the compiled source file to see the actual code.
|   |                   Common issues:
|   |                   - NaN from string-to-number coercion
|   |                   - undefined property access on OBJECT ports
|   |                   - JSON.parse failure on string-to-object coercion
|
+-- "Wrong output" (workflow runs but returns unexpected values)
|   |
|   +-- Use VARIABLE_SET events to trace data through the graph
|   |
|   +-- Check Exit port connections:
|   |   - Is the correct node connected to the Exit port?
|   |   - Are there MULTIPLE_EXIT_CONNECTIONS? (only one value used)
|   |   - Is the Exit port receiving data from the right branch?
|   |
|   +-- Check branching:
|   |   - Which branch was taken (onSuccess vs onFailure)?
|   |   - Are conditional nodes evaluating as expected?
|   |
|   +-- Read the compiled source file to verify wiring
|
+-- "Node not executing" (node appears to be skipped)
    |
    +-- Is the execute port connected?
    |   - Check: Start.onSuccess -> Node.execute or PreviousNode.onSuccess -> Node.execute
    |
    +-- Is the execute signal true?
    |   - CONJUNCTION strategy: ALL upstream STEP sources must be true
    |   - DISJUNCTION strategy: ANY upstream STEP source must be true
    |
    +-- Is the node on a branch that was not taken?
    |   - If upstream node failed, onSuccess=false, onFailure=true
    |   - Nodes on the onSuccess branch will receive execute=false
    |
    +-- Is the node in a scope?
        - Scoped nodes only execute when their parent iterates
        - Check the parent node's execution and scope function
```

---

## CLI Debugging Commands

### flow-weaver validate -- Validate a Workflow

The first command to use when something seems wrong. Returns all errors and warnings with codes, messages, and hints.

```bash
flow-weaver validate src/workflows/my-workflow.ts
flow-weaver validate src/workflows/my-workflow.ts --json    # machine-readable
flow-weaver validate src/workflows/my-workflow.ts --verbose  # detailed diagnostics
```

### flow-weaver describe -- Understand Workflow Structure

Provides a full description of the workflow: nodes, connections, ports, types, and execution graph.

```bash
flow-weaver describe src/workflows/my-workflow.ts                      # JSON
flow-weaver describe src/workflows/my-workflow.ts --format text        # human-readable
flow-weaver describe src/workflows/my-workflow.ts --format mermaid     # diagram
flow-weaver describe src/workflows/my-workflow.ts --node fetcher1      # focus on a node
```

### flow-weaver run --stream vs --trace

Both flags give you execution trace data, but in different ways:

**`--stream`** writes events to stderr in real-time as nodes execute. Each STATUS_CHANGED event prints the node ID, new status, and duration. Use this for live debugging during development — you can watch the workflow progress node by node.

```bash
flow-weaver run workflow.ts --stream
# Output (to stderr):
#   [STATUS_CHANGED] fetcher: → RUNNING
#   [STATUS_CHANGED] fetcher: → SUCCEEDED (142ms)
#   [STATUS_CHANGED] processor: → RUNNING
#   [VARIABLE_SET] processor.result
#   [STATUS_CHANGED] processor: → SUCCEEDED (38ms)
```

**`--trace`** collects all ExecutionTraceEvent objects during execution and includes them in the output after completion. Use this for post-mortem analysis or programmatic consumption (e.g., in CI or with `--json`).

```bash
flow-weaver run workflow.ts --trace
# Shows: "12 events captured" + first 5 events as summary

flow-weaver run workflow.ts --trace --json | jq '.traceCount'
# Outputs: 12
```

**Combining both**: `--stream --trace` gives you real-time output during execution AND the collected trace array in the result. Useful when you want to watch progress live but also capture the full event log.

**When to use which**:
- Debugging interactively → `--stream`
- CI pipeline or scripted analysis → `--trace --json`
- Both → `--stream --trace`

### Diagnostic Strategy

1. **flow-weaver validate** -- Get all errors and warnings. Fix errors first.
2. **flow-weaver describe --format text** -- Full readable summary.
3. **flow-weaver describe --node <id>** -- Trace data flow for a specific node.
4. **flow-weaver describe --format mermaid** -- Visual graph for inspection.

---

## Common Error Patterns

### Export Returns null/undefined

**Cause 1: Exit port not connected.** Add `@connect Processor.result -> Exit.output`.

**Cause 2: Multiple connections to same Exit port.** Only one value is used. Use separate Exit ports for each branch.

**Cause 3: Upstream node failed.** Check WebSocket events for `FAILED` status.

### "Variable not found" Runtime Error

Execution context tried to read a variable never written. Source node didn't execute, failed, or an execution index mismatch. Ensure execution path guarantees source runs before consumer.

### STEP vs Data Port Confusion

The three control flow ports (`execute`, `onSuccess`, `onFailure`) are STEP type. They only connect to other STEP ports. All other ports are data ports and only connect to data ports.

```typescript
// Control flow (STEP to STEP):
/** @connect NodeA.onSuccess -> NodeB.execute */
// Data flow (DATA to DATA):
/** @connect NodeA.result -> NodeB.inputData */
```

### Scoped Node Children Not Executing

Scoped ports use direction inversion: scoped OUTPUTS = data parent sends to children, scoped INPUTS = data parent receives from children. Ensure child instances have `parent` set to the scoped node.

### Workflow Compiles but Generated Code Has Issues

1. Read the compiled source file to inspect actual code (compilation modifies the file in-place)
2. Check connection wiring and variable resolution order
3. Re-compile without `--production` to enable tracing

---

## Mock System for Built-in Nodes

When testing workflows that use `delay`, `waitForEvent`, `invokeWorkflow`, or `waitForAgent`, use mocks to avoid real side effects:

```bash
flow-weaver run workflow.ts --mocks '{"fast": true, "events": {"app/approved": {"status": "ok"}}}'
flow-weaver run workflow.ts --mocks-file mocks.json
```

Mock config structure:
- `fast: true` — Skip real sleep in `delay` nodes (1ms instead)
- `events: { "event-name": data }` — Mock event data for `waitForEvent`
- `invocations: { "function-id": result }` — Mock results for `invokeWorkflow`
- `agents: { "agent-id": result }` — Mock results for `waitForAgent`

Use `--timeout <ms>` as a safeguard when running workflows that may block on unresolved `waitForAgent` or `waitForEvent` nodes. In non-interactive environments (piped stdin), `waitForAgent` will fail fast with an error if no mock is provided.

See `built-in-nodes` for full documentation on mock configuration and testing patterns.

## Step-Through Debugging

Flow Weaver supports pausing execution at node boundaries, inspecting all variable values, modifying them, and stepping through the workflow one node at a time. This works from both the CLI (interactive REPL) and MCP tools (for LLM-driven debugging).

The debug system intercepts execution at two points per node: before it runs (where you can inspect inputs and decide whether to proceed) and after it completes (where you can see its outputs before continuing to the next node).

### CLI Debug Mode

```bash
flow-weaver run workflow.ts --debug --params '{"x": 5}'
```

This starts an interactive debug REPL. The workflow pauses before the first node and waits for your command:

```
Flow Weaver Debug
Type "h" for help.

[paused] before: validate (1/5)
> s

  validate.isValid = true

[paused] before: compute (2/5)
> i validate
  validate:
    isValid:0 = true

> set validate.isValid false
Set validate.isValid = false

> s
```

Debug REPL commands:

| Command | Description |
|---------|-------------|
| `s`, `step` | Execute the next node, then pause |
| `c`, `continue` | Run to completion |
| `cb` | Run until the next breakpoint |
| `i`, `inspect` | Show all variables grouped by node |
| `i <node>` | Show variables for a specific node |
| `b <node>` | Add a breakpoint |
| `rb <node>` | Remove a breakpoint |
| `bl` | List all breakpoints |
| `set <node>.<port> <json>` | Modify a variable value |
| `q`, `quit` | Abort the debug session |
| `h`, `help` | Show command help |

You can set breakpoints at startup with `--breakpoint`:

```bash
flow-weaver run workflow.ts --debug --breakpoint processData --breakpoint formatOutput
```

### MCP Debug Tools

For LLM-driven debugging via MCP, use these tools:

**`fw_debug_workflow`** starts a debug session. Pass the file path and optional parameters, breakpoints, and checkpoint flag. Returns a `debugId` and the initial pause state with all variable values, execution order, and current position.

**`fw_debug_step`** advances one node. Returns the updated state after the node completes.

**`fw_debug_continue`** runs to completion or to the next breakpoint (with `toBreakpoint: true`).

**`fw_debug_inspect`** reads the current state without advancing execution. Optionally filter to a specific node's variables.

**`fw_debug_set_variable`** modifies a variable value. Takes `nodeId`, `portName`, and the new `value`. The change takes effect when the next node executes.

**`fw_debug_breakpoint`** adds, removes, or lists breakpoints.

**`fw_list_debug_sessions`** shows all active debug sessions.

Example MCP sequence:

```
1. fw_debug_workflow(filePath: "workflow.ts", params: { x: 5 })
   → { debugId: "debug-...", status: "paused", state: { currentNodeId: "validate", ... } }

2. fw_debug_step(debugId: "debug-...")
   → { status: "paused", state: { currentNodeId: "compute", variables: { "validate:isValid:0": true } } }

3. fw_debug_set_variable(debugId: "debug-...", nodeId: "validate", portName: "isValid", value: false)
   → { modified: "validate:isValid:0" }

4. fw_debug_continue(debugId: "debug-...")
   → { status: "completed", result: { ... } }
```

---

## Checkpoint/Resume (Crash Recovery)

Checkpointing writes workflow state to disk after each node completes. If the process crashes mid-execution, the checkpoint file persists and can resume the workflow from the last completed node, skipping work that was already done.

### Enabling Checkpoints

```bash
flow-weaver run workflow.ts --checkpoint --params '{"data": "large-dataset"}'
```

This creates a `.fw-checkpoints/` directory next to the workflow file containing one JSON file per run. The file is automatically deleted after successful completion, so you'll only see them after a crash.

### Resuming from a Checkpoint

```bash
# Auto-detect the most recent checkpoint
flow-weaver run workflow.ts --resume

# Specify a checkpoint file
flow-weaver run workflow.ts --resume .fw-checkpoints/myWorkflow-run-123.json

# Resume in debug mode (step through from the resume point)
flow-weaver run workflow.ts --resume --debug
```

Via MCP: `fw_resume_from_checkpoint(filePath: "workflow.ts")`.

### How It Works

After each node completes, the checkpoint writer serializes the execution context (all variable values, execution indices, and completion state) to a JSON file. On resume, the controller walks the topological execution order and skips nodes that have serialized outputs, restoring their values directly into the context.

If the workflow file has changed since the checkpoint was written (detected via SHA-256 hash), a warning is shown but execution proceeds.

### Handling Non-Serializable Values

Not all values can survive serialization. Function values are invoked to get their concrete results. Promises and objects with circular references get marked as unserializable. When a checkpoint has unserializable outputs for a node, that node and all its downstream dependents are re-executed instead of being skipped.

On resume, the tool reports what happened:

```
Resuming from checkpoint: .fw-checkpoints/pipeline-run-abc.json
Skipping 5 completed nodes
Re-running 2 nodes: processImage, formatOutput
```

### Checkpoint File Location

Checkpoints live in `.fw-checkpoints/` next to the workflow file. Add this to `.gitignore`:

```
.fw-checkpoints/
```

---

## Dev Mode

Use `flow-weaver dev` to watch, compile, and run in a single command:

```bash
flow-weaver dev workflow.ts --params '{"data": "test"}'
```

This recompiles and re-runs automatically on every file save.

---

## Related Topics

- `error-codes` -- Error code reference with fixes
- `built-in-nodes` -- Mock system for delay, waitForEvent, invokeWorkflow
- `cli-reference` -- All CLI commands and flags
- `advanced-annotations` -- Pull execution, merge strategies, and other advanced features

## Still Stuck?

Read the source: https://github.com/synergenius-fw/flow-weaver
