import { getMockConfig, lookupMock } from './mock-types.js';
import { CancellationError } from '../runtime/CancellationError.js';
import type { NodeExecutionRuntime } from '../runtime/durable-execution.js';

/**
 * @flowWeaver nodeType
 * @input functionId - Function ID of the workflow to invoke (e.g. "my-service/sub-workflow")
 * @input payload - Data to pass as event.data to the invoked function
 * @input [timeout] - Max wait time (e.g. "1h")
 * @output result - Return value from the invoked function
 */
export async function invokeWorkflow(
  execute: boolean,
  functionId: string,
  payload: object,
  timeout?: string,
  abortSignal?: AbortSignal,
  runtime?: NodeExecutionRuntime,
): Promise<{ onSuccess: boolean; onFailure: boolean; result: object }> {
  if (!execute) return { onSuccess: false, onFailure: false, result: {} };

  const mocks = getMockConfig(runtime);
  if (mocks) {
    // Mock mode — look up result by functionId (supports instance-qualified keys)
    const mockResult = lookupMock(mocks.invocations, functionId, runtime);
    if (mockResult !== undefined) {
      return { onSuccess: true, onFailure: false, result: mockResult };
    }
    // No mock data for this functionId — simulate failure
    return { onSuccess: false, onFailure: true, result: {} };
  }

  // Check local workflow registry (populated by executeWorkflow)
  const registry = runtime?.runtime.services.workflowRegistry;
  if (registry?.[functionId]) {
    const nodeRuntime = runtime!;
    if (
      !Number.isSafeInteger(nodeRuntime.recursionDepth) ||
      nodeRuntime.recursionDepth < 0 ||
      nodeRuntime.recursionDepth >= 999
    ) {
      throw new Error('Max recursion depth exceeded (1000) in dynamic workflow invocation');
    }
    try {
      const result = await registry[functionId](
        true,
        { ...payload, __rd__: nodeRuntime.recursionDepth + 1 },
        nodeRuntime.createNestedRuntime(functionId),
      );
      return { onSuccess: true, onFailure: false, result: (result as object) ?? {} };
    } catch (error) {
      const controlFlowCode =
        typeof error === 'object' && error !== null
          ? (error as { code?: unknown }).code
          : undefined;
      if (
        CancellationError.isCancellationError(error) ||
        controlFlowCode === 'FLOW_WEAVER_DURABLE_GATE_YIELD' ||
        controlFlowCode === 'FLOW_WEAVER_AMBIGUOUS_EFFECT'
      ) {
        throw error;
      }
      return { onSuccess: false, onFailure: true, result: {} };
    }
  }

  // No mocks, no registry match: original no-op behavior (always succeeds)
  return { onSuccess: true, onFailure: false, result: {} };
}
