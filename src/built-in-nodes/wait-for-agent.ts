import type { NodeExecutionRuntime } from '../runtime/durable-execution.js';

/**
 * @flowWeaver nodeType
 * @input agentId - Agent/task identifier
 * @input context - Context data to send to the agent
 * @input [prompt] - Message to display when requesting input
 * @output agentResult - Result returned by the agent
 */
export async function waitForAgent(
  execute: boolean,
  agentId: string,
  context: object,
  prompt?: string,
  _abortSignal?: AbortSignal,
  runtime?: NodeExecutionRuntime,
): Promise<{ onSuccess: boolean; onFailure: boolean; agentResult: object }> {
  if (!execute) return { onSuccess: false, onFailure: false, agentResult: {} };

  // An agent gate. The compiler replaces this call with a durable yield, and
  // the engine answers the gate: from a person, or under test from the run's
  // canned answers (see `FwMockConfig` in `src/built-in-nodes/mock-types.ts`
  // for how those are read). Reaching this body means the generated program
  // did not apply the gate boundary, so it fails closed.
  void agentId;
  void context;
  void prompt;
  void runtime;
  throw new Error('waitForAgent requires a generated durable agent gate');
}
