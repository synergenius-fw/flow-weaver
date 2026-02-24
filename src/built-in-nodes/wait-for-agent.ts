import { getMockConfig, lookupMock } from './mock-types.js';

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
  prompt?: string
): Promise<{ onSuccess: boolean; onFailure: boolean; agentResult: object }> {
  if (!execute) return { onSuccess: false, onFailure: false, agentResult: {} };

  // 1. Check mocks first (supports instance-qualified keys)
  const mocks = getMockConfig();
  const mockResult = lookupMock(mocks?.agents, agentId);
  if (mockResult !== undefined) {
    return { onSuccess: true, onFailure: false, agentResult: mockResult };
  }
  // Mocks section exists but key not found — fail like waitForEvent/invokeWorkflow
  if (mocks?.agents) {
    return { onSuccess: false, onFailure: true, agentResult: {} };
  }

  // 2. Check agent channel (set by executor for pause/resume)
  const channel = (globalThis as unknown as Record<string, unknown>).__fw_agent_channel__ as
    | { request: (req: object) => Promise<object> }
    | undefined;
  if (channel) {
    const result = await channel.request({ agentId, context, prompt });
    return { onSuccess: true, onFailure: false, agentResult: result };
  }

  // 3. No mocks, no channel: no-op
  return { onSuccess: true, onFailure: false, agentResult: {} };
}
