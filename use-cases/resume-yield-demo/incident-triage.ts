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
 * node after it -- including the human gate -- work with values it can trust.
 *
 * Port design (see the export-interface topic): the invariant context --
 * `incidentId` and `service`, which never change -- rides in one `ticket`
 * object port that flows through the chain unchanged, instead of being
 * re-declared and re-wired on every node. The values a node actually produces
 * (`rootCause`, `planText`, `risk`) stay as typed scalar ports. Because every
 * port name matches along the chain, `@path` wires all the data; the only
 * `@connect` needed is the one genuine rename, `plan.agentResult -> check`.
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

interface Ticket {
  incidentId: string;
  service: string;
}

// -- Nodes --

/**
 * Turns the incident into the task the agent is given, under the gate's own
 * port names (`agentId`, `context`, `prompt`) so `@path` wires them. The
 * invariant context is bundled into `ticket` and passed on whole.
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
 * @output ticket - Invariant context, carried through unchanged
 */
export function frameIncident(
  incidentId: string,
  service: string,
  severity: string,
  symptom: string,
): { agentId: string; context: object; prompt: string; ticket: Ticket } {
  return {
    agentId: 'incident-triage',
    // The context rides inside the gate payload, which is serialized into the
    // continuation the driver has to carry -- so keep it small.
    context: { incidentId, service, severity, symptom: symptom.slice(0, 2000) },
    prompt:
      `Triage ${incidentId} on ${service} (${severity}): ${symptom}\n` +
      'Reply with { rootCause: string, steps: string[], risk: "low" | "medium" | "high" }.',
    ticket: { incidentId, service },
  };
}

/**
 * Validates the agent's reply before anything downstream trusts it, and
 * forwards `ticket` on so the approval gate reads it from here -- its
 * immediate predecessor -- rather than reaching back to `frame`, which would
 * put `signoff` in two branch regions.
 *
 * `@expression`, so a malformed reply throws and aborts the run. That is the
 * right shape here: routing a bad reply onward would ask a human to approve an
 * empty plan.
 *
 * `agentResult` is whatever JSON the resolver chose, so it is read defensively.
 *
 * @flowWeaver nodeType
 * @expression
 * @label Check Plan
 * @color green
 * @icon shield
 * @input agentResult - The unchecked reply from the agent gate
 * @input ticket - Invariant context, forwarded
 * @output ticket - Passed on to the approval gate
 * @output rootCause - Validated root cause
 * @output planText - The plan rendered for a human to read
 * @output risk - Validated risk level
 */
export function checkPlan(
  agentResult: Record<string, unknown>,
  ticket: Ticket,
): { ticket: Ticket; rootCause: string; planText: string; risk: string } {
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
    ticket,
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
 * alongside the outputs. It forwards `ticket` so the record node reads it
 * from here.
 *
 * @flowWeaver nodeType
 * @durableGate approval
 * @label Sign Off
 * @color orange
 * @icon verified
 * @input ticket - Invariant context (shown to the approver)
 * @input rootCause - What the agent concluded
 * @input planText - The remediation steps, for the approver to read
 * @input risk - How risky the agent thinks the plan is
 * @output approved - Whether the approver accepted the plan
 * @output approver - Who decided
 * @output note - Anything they wanted to add
 */
export async function signOff(
  execute: boolean,
  ticket: Ticket,
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
    `durable approval gate must not execute: ${execute}:${ticket.incidentId}:${rootCause}:${planText}:${risk}`,
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
 * @input ticket - The incident this run was about
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
  ticket: Ticket,
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
      `${ticket.incidentId} (${ticket.service}) -> ${status}`,
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
 * `@path` wires the name-matched chain up to `signoff`. `record` is wired
 * explicitly instead of via `@path`, because it must run on BOTH gate arms:
 * a rejection should still be recorded as "held". Driving it from
 * `signoff.onSuccess` (what `@path` would do) would skip it on reject. So it
 * takes the decision from `signoff` and the plan fields from `check` (which
 * `record`, not being a gate itself, may read across the gate), and feeds
 * Exit directly. `plan.onFailure` is left unwired on purpose: routing it to
 * Exit would make `plan` a second branch region.
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
 * @path Start -> frame -> plan -> check -> signoff -> Exit
 * @connect plan.agentResult -> check.agentResult
 * @connect signoff.approved -> record.approved
 * @connect signoff.approver -> record.approver
 * @connect signoff.note -> record.note
 * @connect check.ticket -> record.ticket
 * @connect check.rootCause -> record.rootCause
 * @connect check.planText -> record.planText
 * @connect check.risk -> record.risk
 * @connect record.outcome -> Exit.outcome
 * @connect record.status -> Exit.status
 * @position Start -450 0
 * @position Exit 720 0
 */
export async function incidentTriage(
  execute: boolean,
  params: { incidentId: string; service: string; severity: string; symptom: string },
): Promise<{ onSuccess: boolean; onFailure: boolean; outcome: string; status: string }> {
  throw new Error('generated body was not installed');
}
