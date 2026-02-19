---
name: Flow Weaver Debugging
description: Debugging workflows, validation, diagnostics, and error resolution
---

# Flow Weaver Debugging Guide

For error code lookup, use `flow-weaver:flow-weaver-error-codes`.

---

## Top 5 Errors Quick Fix

| Error                   | Fix                                                           |
| ----------------------- | ------------------------------------------------------------- |
| UNKNOWN_NODE_TYPE       | Check spelling, run `fw_query(query="node-types")`            |
| MISSING_REQUIRED_INPUT  | Add `@connect` or make port optional with `@input [name]`     |
| STEP_PORT_TYPE_MISMATCH | STEP ports (execute/onSuccess/onFailure) only connect to STEP |
| CYCLE_DETECTED          | Use scoped forEach instead of graph loops                     |
| UNKNOWN_SOURCE_PORT     | Check port name spelling, run `fw_describe(node="nodeId")`    |

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
|   |       +-- YES --> Look up the error code in flow-weaver:flow-weaver-error-codes
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

## MCP Tool Debugging

When working through the MCP server, the following tools are available for diagnosis.

### fw_validate -- Validate a Workflow

The first tool to use when something seems wrong. Returns all errors and warnings with codes, messages, affected nodes, and **hints** suggesting what tool to use next.

```
fw_validate({ filePath: "src/workflows/my-workflow.ts" })
```

**Response structure:**

```json
{
  "valid": false,
  "errors": [
    {
      "message": "Node \"fetcher\" has unconnected required input port \"apiKey\"",
      "severity": "error",
      "nodeId": "fetcher",
      "code": "MISSING_REQUIRED_INPUT",
      "hint": "Add a @connect to this port, or make it optional with @input [name]"
    }
  ]
}
```

**Diagnosis workflow:** Run `fw_validate` first. If `valid` is `true`, the issue is at runtime, not in the workflow definition. If `valid` is `false`, fix all errors before investigating further.

### fw_describe -- Understand Workflow Structure

Provides a full description of the workflow: nodes, connections, ports, types, and execution graph.

```
fw_describe({ filePath: "src/workflows/my-workflow.ts", format: "text" })
```

Formats: `json` (default), `text` (human-readable), `mermaid` (diagram)

Focus on a specific node:

```
fw_describe({ filePath: "src/workflows/my-workflow.ts", node: "fetcher1" })
```

### fw_query -- Targeted Graph Queries

| Query             | Usage                                      | Description               |
| ----------------- | ------------------------------------------ | ------------------------- |
| `nodes`           | `fw_query(query="nodes")`                  | All node instances        |
| `connections`     | `fw_query(query="connections")`            | All connections           |
| `execution-order` | `fw_query(query="execution-order")`        | Topological sort          |
| `isolated`        | `fw_query(query="isolated")`               | Disconnected nodes        |
| `dead-ends`       | `fw_query(query="dead-ends")`              | Nodes not reaching Exit   |
| `deps`            | `fw_query(query="deps", nodeId="x")`       | Upstream dependencies     |
| `dependents`      | `fw_query(query="dependents", nodeId="x")` | Downstream dependents     |
| `node-types`      | `fw_query(query="node-types")`             | All node type definitions |

### Diagnostic Strategy

1. **fw_validate** -- Get all errors and warnings. Fix errors first.
2. **fw_query isolated** -- Find disconnected nodes.
3. **fw_query dead-ends** -- Find nodes whose outputs are never consumed.
4. **fw_query execution-order** -- Verify the execution sequence.
5. **fw_describe (text)** -- Full readable summary.
6. **fw_query deps/dependents** -- Trace data flow for a specific node.

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

## Still Stuck?

Read the source: https://github.com/synergenius-fw/flow-weaver — check the parser, validator, and generator code directly.
