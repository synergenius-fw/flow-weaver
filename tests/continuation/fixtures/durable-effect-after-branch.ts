// A gated workflow whose branches converge on a durable effect.
// The durable-gates restrictions forbid a GATE after branch convergence;
// this fixture checks that an EFFECT after convergence is accepted and that
// its operation key is stable across the yield/resume boundary.

/**
 * Boolean branch: onSuccess when a person must decide, onFailure otherwise.
 *
 * @flowWeaver nodeType
 * @durablePure
 * @input needsHuman - Whether a person must decide
 * @output risk - Echoed risk label
 */
function route(execute: boolean, needsHuman: boolean): { onSuccess: boolean; onFailure: boolean; risk: string } {
  return { onSuccess: execute && needsHuman, onFailure: execute && !needsHuman, risk: needsHuman ? 'high' : 'low' };
}

/**
 * @flowWeaver nodeType
 * @expression
 * @durablePure
 * @output decision - Constant decision on the automatic arm
 */
function autoApprove(): { decision: string } {
  return { decision: 'approved' };
}

/**
 * Never called. The compiler replaces this gate with a durable yield.
 *
 * @flowWeaver nodeType
 * @durableGate approval
 * @input risk - Risk label shown to the approver
 * @output decision - What the person decided
 */
async function waitForApproval(execute: boolean, risk: string): Promise<{ onSuccess: boolean; onFailure: boolean; decision: string }> {
  throw new Error(`durable gate implementation must not execute: ${execute}:${risk}`);
}

/**
 * @flowWeaver nodeType
 * @durableEffect
 * @executeWhen DISJUNCTION
 * @input decision [mergeStrategy:FIRST] - From whichever arm ran
 * @output stored - What was written
 * @output key - The operation key used
 */
async function record(execute: boolean, decision: string, operationKey: string): Promise<{
  result: { onSuccess: boolean; onFailure: boolean; stored: string; key: string };
  receipt: { key: string };
}> {
  return {
    result: { onSuccess: execute, onFailure: false, stored: decision, key: operationKey },
    receipt: { key: operationKey },
  };
}

/**
 * @flowWeaver workflow
 * @param needsHuman - Whether to take the gated arm
 * @returns stored - The recorded decision
 * @returns key - The effect's operation key
 * @node route route
 * @node approval waitForApproval
 * @node auto autoApprove
 * @node record record
 * @path Start -> route:ok -> approval -> record -> Exit
 * @path Start -> route:fail -> auto -> record
 * @connect record.stored -> Exit.stored
 * @connect record.key -> Exit.key
 */
export async function effectAfterBranch(
  execute: boolean,
  params: { needsHuman: boolean }
): Promise<{ onSuccess: boolean; onFailure: boolean; stored: string; key: string }> {
  throw new Error('generated body was not installed');
}
