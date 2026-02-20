---
name: Flow Weaver Debugging
description: Debugging workflows, validation, diagnostics, and error resolution
keywords: [debug, troubleshooting, errors, WebSocket, diagnostics, runtime, validation, trace]
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

When testing workflows that use `delay`, `waitForEvent`, or `invokeWorkflow`, use mocks to avoid real side effects:

```bash
flow-weaver run workflow.ts --mocks '{"fast": true, "events": {"app/approved": {"status": "ok"}}}'
flow-weaver run workflow.ts --mocks-file mocks.json
```

Mock config structure:
- `fast: true` — Skip real sleep in `delay` nodes (1ms instead)
- `events: { "event-name": data }` — Mock event data for `waitForEvent`
- `invocations: { "function-id": result }` — Mock results for `invokeWorkflow`

See `built-in-nodes` for full documentation on mock configuration and testing patterns.

## Dev Mode

Use `flow-weaver dev` to watch, compile, and run in a single command:

```bash
flow-weaver dev workflow.ts --params '{"data": "test"}'
```

This recompiles and re-runs automatically on every file save.

---

## Related Topics

- `error-codes` — Error code reference with fixes
- `built-in-nodes` — Mock system for delay, waitForEvent, invokeWorkflow
- `cli-reference` — All CLI commands and flags
- `advanced-annotations` — Pull execution, merge strategies, and other advanced features

## Still Stuck?

Read the source: https://github.com/synergenius-fw/flow-weaver
