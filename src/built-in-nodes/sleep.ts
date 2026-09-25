import type { NodeExecutionRuntime } from '../runtime/durable-execution.js';

/**
 * @flowWeaver nodeType
 * @input duration - How long the run sleeps before it goes on (e.g. "30s", "2h", "3d")
 * @output wokeAt - When the run went on, as an ISO 8601 time
 */
export async function sleep(
  execute: boolean,
  duration: string,
  runtime?: NodeExecutionRuntime,
): Promise<{ onSuccess: boolean; onFailure: boolean; wokeAt: string }> {
  if (!execute) return { onSuccess: false, onFailure: false, wokeAt: '' };

  // A timer gate. The compiler replaces this call with a durable yield, and
  // whoever keeps the run (the coordinator's clock, or a host of its own)
  // resumes it once `duration` has passed; under test `fast` wakes it at
  // once (see `FwMockConfig` in `src/built-in-nodes/mock-types.ts`).
  // Reaching this body means the generated program did not apply the gate
  // boundary, so it fails closed. A wait that holds the process is what
  // `delay` is for.
  void duration;
  void runtime;
  throw new Error('sleep requires a generated durable timer gate');
}
