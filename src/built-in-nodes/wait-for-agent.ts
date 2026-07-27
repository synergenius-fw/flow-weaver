import { getMockConfig, lookupMock } from './mock-types.js';
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

  // 1. Check mocks first (supports instance-qualified keys)
  const mocks = getMockConfig(runtime);
  const mockResult = lookupMock(mocks?.agents, agentId, runtime);
  if (mockResult !== undefined) {
    return { onSuccess: true, onFailure: false, agentResult: mockResult };
  }
  // Mocks section exists but key not found — fail like waitForEvent/invokeWorkflow
  if (mocks?.agents) {
    return { onSuccess: false, onFailure: true, agentResult: {} };
  }

  // The compiler replaces this declared agent gate with a terminal durable
  // yield. Reaching the implementation without a mock means the generated
  // program did not apply the durable-gate boundary and must fail closed.
  void context;
  void prompt;
  throw new Error('waitForAgent requires a generated durable agent gate');
}
