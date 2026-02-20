import { getMockConfig } from './mock-types.js';

/**
 * @flowWeaver nodeType
 * @input functionId - Inngest function ID (e.g. "my-service/sub-workflow")
 * @input payload - Data to pass as event.data to the invoked function
 * @input [timeout] - Max wait time (e.g. "1h")
 * @output result - Return value from the invoked function
 */
export async function invokeWorkflow(
  execute: boolean,
  functionId: string,
  payload: object,
  timeout?: string
): Promise<{ onSuccess: boolean; onFailure: boolean; result: object }> {
  if (!execute) return { onSuccess: false, onFailure: false, result: {} };

  const mocks = getMockConfig();
  if (mocks) {
    // Mock mode active — look up result by functionId
    const mockResult = mocks.invocations?.[functionId];
    if (mockResult !== undefined) {
      return { onSuccess: true, onFailure: false, result: mockResult };
    }
    // No mock data for this functionId — simulate failure
    return { onSuccess: false, onFailure: true, result: {} };
  }

  // Check local workflow registry (populated by executeWorkflowFromFile)
  const registry = (globalThis as unknown as Record<string, unknown>).__fw_workflow_registry__ as
    | Record<string, (...args: unknown[]) => unknown>
    | undefined;
  if (registry?.[functionId]) {
    try {
      const result = await registry[functionId](true, payload);
      return { onSuccess: true, onFailure: false, result: (result as object) ?? {} };
    } catch {
      return { onSuccess: false, onFailure: true, result: {} };
    }
  }

  // No mocks, no registry match: original no-op behavior (always succeeds)
  return { onSuccess: true, onFailure: false, result: {} };
}
