/**
 * Conditional Router Template
 * Decision branching with success/failure paths
 *
 * Design: evaluateCondition uses onSuccess for "condition met" and
 * onFailure for "condition not met". Error handling is done inside
 * the function body via try/catch — errors route to Exit.onFailure
 * via the handler chain.
 */

import type { WorkflowTemplate, WorkflowTemplateOptions } from '../index';

export const conditionalTemplate: WorkflowTemplate = {
  id: 'conditional',
  name: 'Conditional Router',
  description: 'Route data based on conditions with branching paths',
  category: 'automation',
  generate: (opts: WorkflowTemplateOptions): string => {
    const { workflowName, async: isAsync } = opts;
    const asyncKeyword = isAsync ? 'async ' : '';
    const returnType = isAsync
      ? 'Promise<{ onSuccess: boolean; onFailure: boolean; successResult?: any; failureResult?: any }>'
      : '{ onSuccess: boolean; onFailure: boolean; successResult?: any; failureResult?: any }';

    return `
/**
 * Evaluates condition and routes data.
 * onSuccess = condition met (true path), onFailure = condition not met (false path).
 * Errors are caught internally and returned via the onFailure path.
 *
 * @flowWeaver nodeType
 * @label Evaluate Condition
 * @input data [order:1] - Data to evaluate
 * @input execute [order:0] - Execute
 * @output conditionTrue [order:2] - Data if condition passed
 * @output conditionFalse [order:3] - Data if condition failed
 * @output conditionMet [order:4] - Whether condition was met
 * @output onSuccess [order:0] - Condition passed (routes to success handler)
 * @output onFailure [order:1] - Condition not met (routes to failure handler)
 */
function evaluateCondition(
  execute: boolean,
  data: any
): { onSuccess: boolean; onFailure: boolean; conditionTrue: any; conditionFalse: any; conditionMet: boolean } {
  if (!execute) {
    return { onSuccess: false, onFailure: false, conditionTrue: null, conditionFalse: null, conditionMet: false };
  }

  try {
    // TODO: Define your condition logic
    const conditionMet = Boolean(data && data.isValid);

    if (conditionMet) {
      return { onSuccess: true, onFailure: false, conditionTrue: data, conditionFalse: null, conditionMet: true };
    } else {
      return { onSuccess: false, onFailure: true, conditionTrue: null, conditionFalse: data, conditionMet: false };
    }
  } catch (err) {
    // On error, route to failure path with the original data
    return { onSuccess: false, onFailure: true, conditionTrue: null, conditionFalse: data, conditionMet: false };
  }
}

/**
 * Handles success path
 *
 * @flowWeaver nodeType
 * @label Handle Success
 * @input data [order:1] - Data from success path
 * @input execute [order:0] - Execute
 * @output result [order:2] - Success result
 * @output onSuccess [order:0] - On Success
 * @output onFailure [order:1] - On Failure
 */
function handleSuccess(
  execute: boolean,
  data: any
): { onSuccess: boolean; onFailure: boolean; result: any } {
  if (!execute) {
    return { onSuccess: false, onFailure: false, result: null };
  }

  // TODO: Handle success case
  return { onSuccess: true, onFailure: false, result: { status: "success", data } };
}

/**
 * Handles failure path
 *
 * @flowWeaver nodeType
 * @label Handle Failure
 * @input data [order:1] - Data from failure path
 * @input execute [order:0] - Execute
 * @output result [order:2] - Failure result
 * @output onSuccess [order:0] - On Success
 * @output onFailure [order:1] - On Failure
 */
function handleFailure(
  execute: boolean,
  data: any
): { onSuccess: boolean; onFailure: boolean; result: any } {
  if (!execute) {
    return { onSuccess: false, onFailure: false, result: null };
  }

  // TODO: Handle failure case
  return { onSuccess: true, onFailure: false, result: { status: "failure", data } };
}

/**
 * @flowWeaver workflow
 * @node router evaluateCondition
 * @node successHandler handleSuccess
 * @node failureHandler handleFailure
 * @position Start -450 0
 * @position router -180 0
 * @position successHandler 90 -90
 * @position failureHandler 90 90
 * @position Exit 360 0
 * @connect Start.execute -> router.execute
 * @connect Start.data -> router.data
 * @connect router.onSuccess -> successHandler.execute
 * @connect router.conditionTrue -> successHandler.data
 * @connect router.onFailure -> failureHandler.execute
 * @connect router.conditionFalse -> failureHandler.data
 * @connect successHandler.result -> Exit.successResult
 * @connect successHandler.onSuccess -> Exit.onSuccess
 * @connect failureHandler.result -> Exit.failureResult
 * @connect failureHandler.onSuccess -> Exit.onFailure
 * @param execute [order:0] - Execute
 * @param data [order:1] - Input data to route
 * @returns onSuccess [order:0] - Success path completed
 * @returns onFailure [order:1] - Failure path completed
 * @returns successResult [order:2] - Result from success path
 * @returns failureResult [order:3] - Result from failure path
 */
export ${asyncKeyword}function ${workflowName}(
  execute: boolean,
  params: { data: any }
): ${returnType} {
  throw new Error("Compile with: flow-weaver compile <file>");
}
`.trim();
  },
};
