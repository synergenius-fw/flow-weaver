/**
 * Example demonstrating Phase 10 port configurations:
 * - Expression-based port values (evaluateConstantAs: JS_EXPRESSION)
 * - Execution signal evaluation (CONJUNCTION vs DISJUNCTION)
 */

// ============================================================================
// EXAMPLE 1: Expression-based Port Values
// ============================================================================

/**
 * Node with expression-based default value
 * The 'timeout' port gets its value from an expression that reads
 * the config.maxTimeout value from ExecutionContext
 *
 * @flowWeaver nodeType
 * @label Fetch with Timeout
 * @input url
 * @input timeout - Expression: (ctx) => ctx.getVariable({ nodeName: "Start", portName: "maxTimeout", executionIndex: 0 }) || 5000
 * @output data
 */
function fetchData(execute: boolean, url: string, timeout: number) {
  if (!execute) return { onSuccess: false, onFailure: false, data: '' };
  console.log(`Fetching ${url} with timeout ${timeout}ms`);
  return { onSuccess: true, onFailure: false, data: `Data from ${url}` };
}

/**
 * Node with static default value (for comparison)
 *
 * @flowWeaver nodeType
 * @label Fetch with Static Timeout
 * @input url
 * @input [timeout=3000] - Static default
 * @output data
 */
function fetchDataStatic(execute: boolean, url: string, timeout: number) {
  if (!execute) return { onSuccess: false, onFailure: false, data: '' };
  console.log(`Fetching ${url} with static timeout ${timeout}ms`);
  return { onSuccess: true, onFailure: false, data: `Static data from ${url}` };
}

// ============================================================================
// EXAMPLE 2: Execution Signal Evaluation - CONJUNCTION (AND)
// ============================================================================

/**
 * Merge node that waits for BOTH paths to complete
 * Default behavior (CONJUNCTION): ALL execution signals must be true
 * This node has two execute ports and waits for both
 *
 * @flowWeaver nodeType
 * @label Merge Both
 * @executeWhen CONJUNCTION
 * @input dataA
 * @input dataB
 * @output merged
 */
function mergeBoth(execute: boolean, dataA: string, dataB: string) {
  if (!execute) return { onSuccess: false, onFailure: false, merged: '' };
  console.log('Merging both paths');
  return { onSuccess: true, onFailure: false, merged: `${dataA} + ${dataB}` };
}

// ============================================================================
// EXAMPLE 3: Execution Signal Evaluation - DISJUNCTION (OR)
// ============================================================================

/**
 * First responder node that executes when EITHER path completes
 * DISJUNCTION: ANY execution signal being true triggers execution
 * Useful for "whoever responds first" scenarios
 *
 * @flowWeaver nodeType
 * @label First Response
 * @executeWhen DISJUNCTION
 * @input [dataA] - Must be optional since we may only get one
 * @input [dataB] - Must be optional since we may only get one
 * @output result
 */
function firstResponse(execute: boolean, dataA?: string, dataB?: string) {
  if (!execute) return { onSuccess: false, onFailure: false, result: '' };
  console.log('First response received');
  // Return whichever came first
  const result = dataA || dataB || 'No data';
  return { onSuccess: true, onFailure: false, result: `First: ${result}` };
}

// ============================================================================
// WORKFLOW: Demonstrating Port Configurations
// ============================================================================

/**
 * Workflow that demonstrates both features:
 * 1. Expression-based timeout configuration
 * 2. Parallel paths with different merge strategies
 *
 * @flowWeaver workflow
 * @name portConfigWorkflow
 * @node fetchA fetchA
 * @node fetchB fetchB
 * @node mergeBoth mergeBoth
 * @node firstResponse firstResponse
 * @path Start -> fetchA -> mergeBoth -> Exit
 * @path Start -> fetchB -> mergeBoth -> Exit
 * @path Start -> fetchA -> firstResponse -> Exit
 * @path Start -> fetchB -> firstResponse -> Exit
 * @connect Start.urlA -> fetchA.url
 * @connect Start.urlB -> fetchB.url
 * @connect fetchA.data -> mergeBoth.dataA
 * @connect fetchB.data -> mergeBoth.dataB
 * @connect fetchA.data -> firstResponse.dataA
 * @connect fetchB.data -> firstResponse.dataB
 * @connect mergeBoth.merged -> Exit.bothComplete
 * @connect firstResponse.result -> Exit.firstComplete
 */
export async function portConfigWorkflow(execute: boolean, params: {
    urlA: string;
    urlB: string;
    maxTimeout: number;
  }): Promise<{
    onSuccess: boolean;
    onFailure: boolean;
    bothComplete: string;
    firstComplete: string;
  }> {
  throw new Error('Not implemented - will be generated');
}

// Helper nodes for the workflow
/**
 * @flowWeaver nodeType
 * @input url
 * @output data
 */
function fetchA(execute: boolean, url: string) {
  if (!execute) return { onSuccess: false, onFailure: false, data: '' };
  return { onSuccess: true, onFailure: false, data: `Data A from ${url}` };
}

/**
 * @flowWeaver nodeType
 * @input url
 * @output data
 */
function fetchB(execute: boolean, url: string) {
  if (!execute) return { onSuccess: false, onFailure: false, data: '' };
  return { onSuccess: true, onFailure: false, data: `Data B from ${url}` };
}
