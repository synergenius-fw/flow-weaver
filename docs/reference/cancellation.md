# Cancellation

Flow Weaver accepts one parent-owned `AbortSignal` per public executor request:

```ts
await executeWorkflow({
  filePath,
  params,
  abortSignal: controller.signal,
});
```

The engine never aborts the caller's signal. It forwards that signal to the
generated root context, nested workflow calls, child scopes, first-party
engine-owned waits, and the deployment executor's derived timeout signal.
Cancellation is observed before execution and at compiler-generated node
boundaries. The built-in `delay` and `waitForAgent` waits stop promptly, and
local workflow invocation forwards the same signal.

Cancellation is cooperative, not preemptive. A node that blocks synchronously
or awaits work that ignores cancellation continues until it returns; the engine
then refuses to start the next node. A deployment requiring a hard stop must
isolate each run in a parent-owned process and terminate that process. This
process boundary is executor policy and is not implemented by the engine.

The contract uses only standard Node.js `AbortController` and `AbortSignal`
APIs. It does not depend on Electron lifecycle, renderer/main-process state, or
Electron-only serialization.
