---
name: Built-in Nodes
description: Built-in runtime nodes (delay, waitForEvent, invokeWorkflow) and the mock system for testing
keywords: [delay, waitForEvent, invokeWorkflow, built-in, runtime, mock, mocks, FwMockConfig, testing, fast, events, invocations, sleep, duration, timeout]
---

# Built-in Nodes

Flow Weaver provides three built-in node types for common runtime operations. All three support a **mock system** for local testing without real side effects.

## delay

Pauses execution for a specified duration.

```typescript
/**
 * @flowWeaver nodeType
 * @input duration - Duration to sleep (e.g. "30s", "5m", "1h", "2d")
 * @output elapsed - Always true after sleep completes
 */
async function delay(execute: boolean, duration: string)
```

### Duration Format

`<number><unit>` where unit is one of:

| Unit | Meaning | Example |
|------|---------|---------|
| `ms` | Milliseconds | `500ms` |
| `s` | Seconds | `30s` |
| `m` | Minutes | `5m` |
| `h` | Hours | `1h` |
| `d` | Days | `2d` |

### Usage in Workflow

```typescript
/**
 * @flowWeaver workflow
 * @node wait delay [expr: duration="'30s'"]
 * @path Start -> wait -> Exit
 */
```

### Mock Behavior

When `fast: true` is set in mock config, `delay` sleeps for 1ms instead of the real duration.

---

## waitForEvent

Pauses execution until a named event is received. Designed for human-in-the-loop patterns and inter-workflow communication.

```typescript
/**
 * @flowWeaver nodeType
 * @input eventName - Event name to wait for (e.g. "app/approval.received")
 * @input [match] - Field to match between trigger and waited event (e.g. "data.requestId")
 * @input [timeout] - Max wait time (e.g. "24h", "7d"). Empty = no timeout
 * @output eventData - The received event's data payload
 */
async function waitForEvent(execute: boolean, eventName: string, match?: string, timeout?: string)
```

### Usage in Workflow

```typescript
/**
 * @flowWeaver workflow
 * @node wait waitForEvent [expr: eventName="'app/expense.approved'", match="'data.expenseId'", timeout="'48h'"]
 * @path Start -> wait -> Exit
 */
```

### Mock Behavior

- If `events[eventName]` is set in mock config → returns that data via `onSuccess`
- If no mock data for the event name → simulates timeout via `onFailure`

---

## invokeWorkflow

Invokes another workflow (Inngest function) and waits for its result. Enables workflow composition.

```typescript
/**
 * @flowWeaver nodeType
 * @input functionId - Inngest function ID (e.g. "my-service/sub-workflow")
 * @input payload - Data to pass as event.data to the invoked function
 * @input [timeout] - Max wait time (e.g. "1h")
 * @output result - Return value from the invoked function
 */
async function invokeWorkflow(execute: boolean, functionId: string, payload: object, timeout?: string)
```

### Usage in Workflow

```typescript
/**
 * @flowWeaver workflow
 * @node sub invokeWorkflow [expr: functionId="'my-service/payment-processor'", timeout="'5m'"]
 * @connect Start.payload -> sub.payload
 * @connect sub.result -> Exit.result
 * @path Start -> sub -> Exit
 */
```

### Mock Behavior

- If `invocations[functionId]` is set in mock config → returns that result via `onSuccess`
- If no mock data for the function ID → simulates failure via `onFailure`

---

## Mock System

The mock system lets you test workflows with built-in nodes locally without real delays, event systems, or external workflow invocations.

### FwMockConfig

```typescript
interface FwMockConfig {
  /** Mock event data keyed by event name. Used by waitForEvent. */
  events?: Record<string, object>;
  /** Mock invocation results keyed by functionId. Used by invokeWorkflow. */
  invocations?: Record<string, object>;
  /** When true, delay nodes skip the real sleep (1ms instead of full duration). */
  fast?: boolean;
}
```

### CLI Usage

Pass mock config directly:

```bash
flow-weaver run workflow.ts --mocks '{"fast": true, "events": {"app/approved": {"status": "ok"}}}'
```

Or from a file:

```bash
flow-weaver run workflow.ts --mocks-file mocks.json
```

**mocks.json:**
```json
{
  "fast": true,
  "events": {
    "app/expense.approved": { "status": "approved", "approvedBy": "manager@co.com" },
    "app/expense.withdrawn": { "status": "withdrawn" }
  },
  "invocations": {
    "my-service/payment-processor": { "transactionId": "tx-123", "success": true }
  }
}
```

### Programmatic Usage

Set mocks on `globalThis` before running the workflow:

```typescript
(globalThis as any).__fw_mocks__ = {
  fast: true,
  events: {
    'app/expense.approved': { status: 'approved' }
  },
  invocations: {
    'my-service/sub-workflow': { result: 'success' }
  }
};

// Run your compiled workflow
const result = await expenseWorkflow({ expenseId: 'exp-1', amount: 500 });
```

### Testing Patterns

**Unit test with mocks:**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('expense workflow', () => {
  beforeEach(() => {
    (globalThis as any).__fw_mocks__ = {
      fast: true,
      events: {
        'app/expense.approved': { status: 'approved' }
      }
    };
  });

  afterEach(() => {
    delete (globalThis as any).__fw_mocks__;
  });

  it('should process approved expense', async () => {
    const result = await expenseWorkflow({ expenseId: 'e1', amount: 100 });
    expect(result.onSuccess).toBe(true);
  });
});
```

**Testing timeout paths:**

```typescript
// Don't provide mock data for the event to simulate timeout
(globalThis as any).__fw_mocks__ = { fast: true };
// waitForEvent will follow onFailure path
```

---

## Related Topics

- [CLI Reference](cli-reference) — `run` command with `--mocks` flags
- [Compilation](compilation) — Inngest target for durable built-in node execution
- [Debugging](debugging) — Tracing and troubleshooting
- [Advanced Annotations](advanced-annotations) — Expression bindings for node inputs
