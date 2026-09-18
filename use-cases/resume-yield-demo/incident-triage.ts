/**
 * Incident triage: a workflow that yields twice and is resumed twice.
 *
 * The point of this file is the pause. Two different gate kinds sit on the
 * same path, so one run demonstrates the whole cycle rather than a single
 * hand-off:
 *
 *   1. `plan` (`waitForAgent`, an `agent` gate) -- an AI assistant reads the
 *      incident and drafts a remediation plan.
 *   2. `signOff` (a hand-written `approval` gate) -- a human accepts or
 *      refuses that plan before anything is applied.
 *
 * At each gate the engine keeps nothing: no Promise, no timer, no process.
 * It hands back a continuation and the run is free to end. Whoever drives it
 * resolves the gate later and execution picks up at exactly that node, with
 * the pure nodes before it replayed from the continuation rather than guessed
 * at.
 *
 * `checkPlan` sits between the two gates on purpose. An agent reply is
 * unchecked, non-deterministic JSON; validating it there is what lets every
 * node after it -- including the human gate -- work with values it can trust,
 * and routes a malformed reply to `onFailure` instead of throwing.
 *
 * Drive it from an assistant over MCP:
 *   fw_run    { filePath: ".../incident-triage.ts",
 *               params: { incidentId: "INC-4417", service: "checkout-api",
 *                         severity: "sev2", symptom: "..." } }
 *   fw_resume { runId, answer: { rootCause: "...", steps: [...], risk: "medium" } }
 *   fw_resume { runId, answer: { approved: true, approver: "...", note: "..." } }
 *
 * `fw run` on the CLI refuses a gated workflow; see the durable-gates topic.
 */

// -- Nodes --

/**
 * Turns the incident into the task the agent is given. Named under the gate's
 * own port names (`agentId`, `context`, `prompt`) so `@path` wires them
 * without an explicit `@connect`.
 *
 * `@expression` counts as pure automatically -- the engine may re-run it
 * freely on resume, which is exactly right: same incident in, same task out.
 *
 * @flowWeaver nodeType
 * @expression
 * @label Frame Incident
 * @color blue
 * @icon search
 * @input incidentId - Ticket this run is about
 * @input service - Service that is misbehaving
 * @input severity - How bad it is (sev1 | sev2 | sev3)
 * @input symptom - What was actually observed
 * @output agentId - Names the task the agent is being asked to do
 * @output context - What the agent should look at
 * @output prompt - What to do with it
 * @output incidentId - Echoed through for the report
 * @output service - Echoed through for the report
 */
export function frameIncident(
  incidentId: string,
  service: string,
  severity: string,
  symptom: string,
): { agentId: string; context: object; prompt: string; incidentId: string; service: string } {
  return {
    agentId: 'incident-triage',
    // The context rides inside the gate payload, which is serialized into the
    // continuation the driver has to carry -- so keep it small.
    context: { incidentId, service, severity, symptom: symptom.slice(0, 2000) },
    prompt:
      `Triage ${incidentId} on ${service} (${severity}): ${symptom}\n` +
      'Reply with { rootCause: string, steps: string[], risk: "low" | "medium" | "high" }.',
    incidentId,
    service,
  };
}

/**
 * Validates the agent's reply before anything downstream trusts it.
 *
 * `@expression`, so a malformed reply throws and aborts the run. That is the
 * right shape here: the node sits between two gates, and a normal-mode node
 * would put `signoff` inside two branch regions at once -- `plan`'s and this
 * node's -- which the durable validator rejects, because a node in more than
 * one region is stripped from all of them and so retains no branch path.
 *
 * Throwing keeps `plan` as the only branching node, and it is also the safer
 * behaviour: routing a bad reply onward would ask a human to approve an empty
 * plan.
 *
 * `agentResult` is whatever JSON the resolver chose, so it is read defensively.
 *
 * @flowWeaver nodeType
 * @durablePure
 * @label Check Plan
 * @color green
 * @icon shield
 * @input agentResult - The unchecked reply from the agent gate
 * @input incidentId - Ticket, carried through so the gate needs no outside data
 * @output incidentId - Ticket, passed on to the approval gate
 * @output rootCause - Validated root cause
 * @output planText - The plan rendered for a human to read
 * @output risk - Validated risk level
 */
export function checkPlan(
  execute: boolean,
  agentResult: Record<string, unknown>,
  incidentId: string,
): {
  onSuccess: boolean;
  onFailure: boolean;
  incidentId: string;
  rootCause: string;
  planText: string;
  risk: string;
} {
  if (!execute)
    return { onSuccess: false, onFailure: false, incidentId: '', rootCause: '', planText: '', risk: '' };

  const rootCause = agentResult?.rootCause;
  const steps = agentResult?.steps;
  const risk = agentResult?.risk;

  if (typeof rootCause !== 'string' || rootCause.length === 0) {
    throw new Error('malformed plan: rootCause must be a non-empty string');
  }
  if (!Array.isArray(steps) || steps.length === 0 || steps.some((s) => typeof s !== 'string')) {
    throw new Error('malformed plan: steps must be a non-empty array of strings');
  }
  if (risk !== 'low' && risk !== 'medium' && risk !== 'high') {
    throw new Error('malformed plan: risk must be "low", "medium" or "high"');
  }

  return {
    onSuccess: true,
    onFailure: false,
    incidentId,
    rootCause,
    planText: (steps as string[]).map((s, i) => `${i + 1}. ${s}`).join('\n'),
    risk,
  };
}

/**
 * The second yield: a human accepts or refuses the validated plan.
 *
 * The body is never called -- reaching it means the gate boundary was not
 * applied, which is why it throws rather than returning something plausible.
 * Normal mode is required: the resolution supplies `onSuccess`/`onFailure`
 * alongside the outputs.
 *
 * @flowWeaver nodeType
 * @durableGate approval
 * @label Sign Off
 * @color orange
 * @icon verified
 * @input incidentId - Ticket being signed off
 * @input rootCause - What the agent concluded
 * @input planText - The remediation steps, for the approver to read
 * @input risk - How risky the agent thinks the plan is
 * @output approved - Whether the approver accepted the plan
 * @output approver - Who decided
 * @output note - Anything they wanted to add
 */
export async function signOff(
  execute: boolean,
  incidentId: string,
  rootCause: string,
  planText: string,
  risk: string,
): Promise<{
  onSuccess: boolean;
  onFailure: boolean;
  approved: boolean;
  approver: string;
  note: string;
}> {
  throw new Error(
    `durable approval gate must not execute: ${execute}:${incidentId}:${rootCause}:${planText}:${risk}`,
  );
}

/**
 * Writes the outcome down. Both gate answers have reached the same node, one
 * of them from before the first pause and one from after the second.
 *
 * @flowWeaver nodeType
 * @expression
 * @durablePure
 * @label Record Outcome
 * @icon checkCircle
 * @input incidentId - Ticket this run was about
 * @input service - Service that was misbehaving
 * @input rootCause - What the agent concluded
 * @input planText - The remediation steps
 * @input risk - Risk level of the plan
 * @input approved - Whether the approver accepted it
 * @input approver - Who decided
 * @input note - Anything they added
 * @output outcome - Human-readable record of the whole triage
 * @output status - "remediating" when approved, "held" when refused
 */
export function recordOutcome(
  incidentId: string,
  service: string,
  rootCause: string,
  planText: string,
  risk: string,
  approved: boolean,
  approver: string,
  note: string,
): { outcome: string; status: string } {
  const status = approved ? 'remediating' : 'held';
  return {
    status,
    outcome: [
      `${incidentId} (${service}) -> ${status}`,
      `root cause: ${rootCause}`,
      `risk: ${risk}`,
      'plan:',
      planText,
      `${approved ? 'approved' : 'refused'} by ${approver || 'unknown'}${note ? ` -- "${note}"` : ''}`,
    ].join('\n'),
  };
}

// -- Workflow --

/**
 * Wiring notes, learned the hard way -- the two constraints that shape this graph:
 *
 * 1. A gate must sit in exactly ONE branch region. `durableBranchPaths`
 *    (src/api/durable-validation.ts) drops any node found in more than one
 *    region, and a node with no retained branch path plus any earlier
 *    branching node is reported as "after branch convergence". A node counts
 *    as branching merely by having an outgoing onSuccess/onFailure edge, so
 *    `frame.onSuccess -> plan.execute` is enough to create a region.
 *
 * 2. A gate must take no data from OUTSIDE its region. An incoming data edge
 *    from a node outside the region "promotes" the gate out of every region,
 *    with the same result. That is why `incidentId` is threaded through
 *    `check` rather than wired straight from `frame` to `signoff`.
 *
 * Hence: no control edge into `plan`, and `signoff` is driven by
 * `check.onSuccess` alone. Driving `check` and `signoff` from the same
 * `plan.onSuccess` makes them siblings rather than a sequence and fails at
 * resume with "$.executionIndex is not a plain wire value".
 *
 * The gate failure arms are left unwired on purpose: routing them to Exit
 * makes each gate a second region and reintroduces constraint 1.
 *
 * @flowWeaver workflow
 * @param incidentId - Ticket to triage
 * @param service - Service that is misbehaving
 * @param severity - sev1 | sev2 | sev3
 * @param symptom - What was observed
 * @returns outcome - Human-readable record of the whole triage
 * @returns status - "remediating" or "held"
 * @node frame frameIncident [position: -250 0]
 * @node plan waitForAgent [suppress: "DESIGN_ASYNC_NO_ERROR_PATH"] [position: -60 0]
 * @node check checkPlan [position: 130 0]
 * @node signoff signOff [suppress: "DESIGN_ASYNC_NO_ERROR_PATH"] [position: 320 0]
 * @node record recordOutcome [position: 520 0]
 * @connect Start.execute -> frame.execute
 * @connect Start.incidentId -> frame.incidentId
 * @connect Start.service -> frame.service
 * @connect Start.severity -> frame.severity
 * @connect Start.symptom -> frame.symptom
 * @connect frame.agentId -> plan.agentId
 * @connect frame.context -> plan.context
 * @connect frame.prompt -> plan.prompt
 * @connect plan.onSuccess -> check.execute
 * @connect plan.agentResult -> check.agentResult
 * @connect check.onSuccess -> signoff.execute
 * @connect check.rootCause -> signoff.rootCause
 * @connect check.planText -> signoff.planText
 * @connect check.risk -> signoff.risk
 * @connect frame.incidentId -> check.incidentId
 * @connect check.incidentId -> signoff.incidentId
 * @connect frame.incidentId -> record.incidentId
 * @connect frame.service -> record.service
 * @connect check.rootCause -> record.rootCause
 * @connect check.planText -> record.planText
 * @connect check.risk -> record.risk
 * @connect signoff.approved -> record.approved
 * @connect signoff.approver -> record.approver
 * @connect signoff.note -> record.note
 * @connect record.outcome -> Exit.outcome
 * @connect record.status -> Exit.status
 * @position Start -450 0
 * @position Exit 720 0
 */
export async function incidentTriage(
  execute: boolean,
  params: { incidentId: string; service: string; severity: string; symptom: string },
): Promise<{ onSuccess: boolean; onFailure: boolean; outcome: string; status: string; }> {
  throw new Error('generated body was not installed');
}
