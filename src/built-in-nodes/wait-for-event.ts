import type { NodeExecutionRuntime } from '../runtime/durable-execution.js';

/**
 * @flowWeaver nodeType
 * @input eventName - Event name to wait for (e.g. "app/approval.received")
 * @input [match] - Field to match between trigger and waited event (e.g. "data.requestId")
 * @input [timeout] - Max wait time (e.g. "24h", "7d"). Empty = no timeout
 * @output eventData - The received event's data payload
 */
export async function waitForEvent(
  execute: boolean,
  eventName: string,
  match?: string,
  timeout?: string,
  runtime?: NodeExecutionRuntime,
): Promise<{ onSuccess: boolean; onFailure: boolean; eventData: object }> {
  if (!execute) return { onSuccess: false, onFailure: false, eventData: {} };

  // An input gate. The compiler replaces this call with a durable yield, and
  // the engine answers the gate: from a person, or under test from the run's
  // canned answers (see `FwMockConfig` in `src/built-in-nodes/mock-types.ts`
  // for how those are read). Reaching this body means the generated program
  // did not apply the gate boundary, so it fails closed.
  void eventName;
  void match;
  void timeout;
  void runtime;
  throw new Error('waitForEvent requires a generated durable input gate');
}
