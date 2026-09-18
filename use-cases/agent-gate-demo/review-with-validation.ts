// Guarding an agent answer: a validation node right after the gate turns an
// unchecked, non-deterministic reply into a value the deterministic part of
// the workflow can trust, or routes a bad reply to onFailure.

/**
 * Turns the params into the agent task.
 *
 * @flowWeaver nodeType @expression
 */
function prepare(path: string) {
  return {
    agentId: 'review',
    context: { path },
    prompt: `Review ${path}. Reply with { verdict: "ship" | "hold", reason: string }.`,
  };
}

/**
 * Validates the agent's reply. Normal mode on purpose: a malformed reply is a
 * routable outcome, not an exception. onSuccess carries the checked value;
 * onFailure carries why it was rejected. The agentResult is whatever JSON the
 * assistant chose, so it is read defensively here.
 *
 * @flowWeaver nodeType
 * @durablePure
 * @input agentResult - The unchecked reply from the gate
 * @output verdict - The validated verdict (on success)
 * @output reason - The validated reason (on success)
 * @output rejection - Why the reply was rejected (on failure)
 */
function checkReview(
  execute: boolean,
  agentResult: Record<string, unknown>,
): { onSuccess: boolean; onFailure: boolean; verdict: string; reason: string; rejection: string } {
  if (!execute) return { onSuccess: false, onFailure: false, verdict: '', reason: '', rejection: '' };
  const verdict = agentResult?.verdict;
  const reason = agentResult?.reason;
  if ((verdict !== 'ship' && verdict !== 'hold') || typeof reason !== 'string' || reason.length === 0) {
    return { onSuccess: false, onFailure: true, verdict: '', reason: '', rejection: 'malformed review: expected { verdict: "ship"|"hold", reason: non-empty string }' };
  }
  return { onSuccess: true, onFailure: false, verdict, reason, rejection: '' };
}

/**
 * @flowWeaver nodeType @expression
 */
function record(verdict: string, reason: string) {
  return { outcome: `${verdict}: ${reason}` };
}

/**
 * @flowWeaver workflow
 * @param path - File to review
 * @returns outcome - The recorded decision
 * @returns rejected - Why the reply was rejected, if it was
 * @node prep prepare
 * @node review waitForAgent [expr: agentId="prep.agentId", context="prep.context", prompt="prep.prompt"]
 * @node check checkReview [expr: agentResult="review.agentResult"]
 * @node done record
 * @path Start -> prep -> review -> check -> done -> Exit
 * @path Start -> prep -> review -> check:fail -> Exit
 * @connect check.rejection -> Exit.rejected
 */
export async function reviewFile(
  execute: boolean,
  params: { path: string },
): Promise<{ onSuccess: boolean; onFailure: boolean; outcome: string; rejected: string }> {
  throw new Error('generated body was not installed');
}
