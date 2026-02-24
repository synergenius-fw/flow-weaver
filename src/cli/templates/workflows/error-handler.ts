/**
 * Error Handler Template
 * Try/catch/retry pattern for robust error handling
 */

import type { WorkflowTemplate, WorkflowTemplateOptions } from '../index';

export const errorHandlerTemplate: WorkflowTemplate = {
  id: 'error-handler',
  name: 'Error Handler',
  description: 'Try/catch/retry pattern with error recovery',
  category: 'utility',
  generate: (opts: WorkflowTemplateOptions): string => {
    const { workflowName, async: isAsync } = opts;
    const asyncKeyword = isAsync ? 'async ' : '';
    const returnType = isAsync
      ? 'Promise<{ onSuccess: boolean; onFailure: boolean; result: any; attempts: number; lastError?: string }>'
      : '{ onSuccess: boolean; onFailure: boolean; result: any; attempts: number; lastError?: string }';

    return `
/**
 * Retry loop that orchestrates operation attempts
 * Uses scoped ports to handle retry iteration internally
 *
 * @flowWeaver nodeType
 * @label Retry Loop
 * @input data [order:1] - Input data to process
 * @input maxRetries [order:2] - Maximum retry attempts
 * @input success scope:attempt [order:0] - From operation onSuccess
 * @input failure scope:attempt [order:1] - From operation onFailure
 * @input result scope:attempt [order:2] - Operation result
 * @input error scope:attempt [order:3] - Error from operation
 * @input execute [order:0] - Execute
 * @output start scope:attempt [order:0] - Triggers attempt
 * @output attemptData scope:attempt [order:1] - Data for this attempt
 * @output attemptNum scope:attempt [order:2] - Current attempt number
 * @output finalResult [order:2] - Final result
 * @output attempts [order:3] - Total attempts made
 * @output lastError [order:4] - Last error if failed
 * @output onSuccess [order:0] - On Success
 * @output onFailure [order:1] - On Failure
 */
function retryLoop(
  execute: boolean,
  data: any,
  maxRetries: number,
  attempt: (start: boolean, attemptData: any, attemptNum: number) => {
    success: boolean;
    failure: boolean;
    result: any;
    error: string;
  }
): { onSuccess: boolean; onFailure: boolean; finalResult: any; attempts: number; lastError: string } {
  if (!execute) {
    return { onSuccess: false, onFailure: false, finalResult: null, attempts: 0, lastError: '' };
  }

  let lastError = '';
  for (let attemptNum = 1; attemptNum <= maxRetries; attemptNum++) {
    const result = attempt(true, data, attemptNum);

    if (result.success) {
      return { onSuccess: true, onFailure: false, finalResult: result.result, attempts: attemptNum, lastError: '' };
    }

    lastError = result.error;
    console.log(\`[Retry] Attempt \${attemptNum} failed: \${lastError}. \${attemptNum < maxRetries ? 'Retrying...' : 'Max retries reached.'}\`);
  }

  return { onSuccess: false, onFailure: true, finalResult: null, attempts: maxRetries, lastError };
}

/**
 * Attempts an operation that might fail
 *
 * @flowWeaver nodeType
 * @label Try Operation
 * @input data [order:1] - Input data
 * @input attempt [order:2] - Current attempt number
 * @input execute [order:0] - Execute
 * @output result [order:2] - Operation result
 * @output error [order:3] - Error message if failed
 * @output onSuccess [order:0] - On Success
 * @output onFailure [order:1] - On Failure
 */
function tryOperation(
  execute: boolean,
  data: any,
  attempt: number
): { onSuccess: boolean; onFailure: boolean; result: any; error: string } {
  if (!execute) {
    return { onSuccess: false, onFailure: false, result: null, error: '' };
  }

  try {
    // TODO: Replace with your operation that might fail
    // This is a placeholder that randomly fails for demonstration
    if (Math.random() < 0.3) {
      throw new Error('Simulated failure');
    }

    const result = { processed: data, attempt };
    return { onSuccess: true, onFailure: false, result, error: '' };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { onSuccess: false, onFailure: true, result: null, error };
  }
}

/**
 * @flowWeaver workflow
 * @node loop retryLoop [size: 300 200] [position: -90 0]
 * @node tryOp tryOperation loop.attempt [position: 90 0]
 * @position Start -450 0
 * @position Exit 360 0
 * @connect Start.execute -> loop.execute
 * @connect Start.data -> loop.data
 * @connect Start.maxRetries -> loop.maxRetries
 * @connect loop.start:attempt -> tryOp.execute
 * @connect loop.attemptData:attempt -> tryOp.data
 * @connect loop.attemptNum:attempt -> tryOp.attempt
 * @connect tryOp.result -> loop.result:attempt
 * @connect tryOp.error -> loop.error:attempt
 * @connect tryOp.onSuccess -> loop.success:attempt
 * @connect tryOp.onFailure -> loop.failure:attempt
 * @connect loop.finalResult -> Exit.result
 * @connect loop.attempts -> Exit.attempts
 * @connect loop.lastError -> Exit.lastError
 * @connect loop.onSuccess -> Exit.onSuccess
 * @connect loop.onFailure -> Exit.onFailure
 * @param execute [order:0] - Execute
 * @param data [order:1] - Input data to process
 * @param [maxRetries=3] [order:2] - Maximum retry attempts
 * @returns onSuccess [order:0] - Operation succeeded
 * @returns onFailure [order:1] - All retries exhausted
 * @returns result [order:2] - Operation result
 * @returns attempts [order:3] - Number of attempts made
 * @returns lastError [order:4] - Last error message if failed
 */
export ${asyncKeyword}function ${workflowName}(
  execute: boolean,
  params: { data: any; maxRetries?: number }
): ${returnType} {
  throw new Error("Compile with: flow-weaver compile <file>");
}
`.trim();
  },
};
