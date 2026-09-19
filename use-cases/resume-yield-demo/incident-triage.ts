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
 * Port design (see the export-interface topic): values that travel together
 * ride in one object port instead of loose scalars. `Start` passes a single
 * `incident`; the invariant slice flows on as `ticket`; the validated plan is
 * one `plan` object; the human's answer is one `decision`. That keeps the
 * graph edges few and legible -- each arrow carries a whole thing, not a
 * field. Because port names match along the chain, `@path` wires the spine;
 * the handful of `@connect` lines are the cross-gate reads into `record`.
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

/** What the caller reports. One object, not four loose params. */
interface Incident {
  incidentId: string;
  service: string;
  severity: string;
  symptom: string;
}

/** The invariant slice of an incident that flows through the whole run. */
interface Ticket {
  incidentId: string;
  service: string;
}

/** The agent task, as one value; its fields feed the gate's three inputs. */
interface AgentTask {
  agentId: string;
  context: object;
  prompt: string;
}

/** The validated remediation plan, produced once and read by several nodes. */
interface Plan {
  rootCause: string;
  planText: string;
  risk: string;
}

/** What the human decided at the approval gate. */
interface Decision {
  approved: boolean;
  approver: string;
  note: string;
}

// -- Nodes --

/**
 * Turns the incident into the agent task. Emits one `task` object; the gate
 * reads its three fields via `[expr:]`, so `frame` exposes a single data
 * output rather than three loose ports. The invariant context rides on as
 * `ticket`.
 *
 * `@expression` counts as pure automatically -- the engine may re-run it
 * freely on resume, which is exactly right: same incident in, same task out.
 *
 * @flowWeaver nodeType
 * @expression
 * @label Frame Incident
 * @color blue
 * @icon search
 * @input incident - Incident
 * @output task - Agent task
 * @output ticket - Ticket
 */
export function frameIncident(
  incident: Incident,
): { task: AgentTask; ticket: Ticket } {
  const { incidentId, service, severity, symptom } = incident;
  return {
    task: {
      agentId: 'incident-triage',
      // The context rides inside the gate payload, which is serialized into
      // the continuation the driver has to carry -- so keep it small.
      context: { incidentId, service, severity, symptom: symptom.slice(0, 2000) },
      prompt:
        `Triage ${incidentId} on ${service} (${severity}): ${symptom}\n` +
        'Reply with { rootCause: string, steps: string[], risk: "low" | "medium" | "high" }.',
    },
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
 * @input agentResult - Agent reply
 * @input ticket - Ticket
 * @output ticket - Ticket
 * @output plan - Plan
 */
export function checkPlan(
  agentResult: Record<string, unknown>,
  ticket: Ticket,
): { ticket: Ticket; plan: Plan } {
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
    plan: {
      rootCause,
      planText: (steps as string[]).map((s, i) => `${i + 1}. ${s}`).join('\n'),
      risk,
    },
  };
}

/**
 * The second yield: a human accepts or refuses the validated plan.
 *
 * The body is never called -- reaching it means the gate boundary was not
 * applied, which is why it throws rather than returning something plausible.
 * Normal mode is required: the resolution supplies `onSuccess`/`onFailure`
 * alongside the outputs. It forwards `ticket` so the record node reads it
 * from here. Its one data output is `decision`; on a rejection that output is
 * nulled, so `recordOutcome` guards for a null decision.
 *
 * @flowWeaver nodeType
 * @durableGate approval
 * @label Sign Off
 * @color orange
 * @icon verified
 * @input ticket - Ticket
 * @input plan - Plan
 * @output decision - Decision
 */
export async function signOff(
  execute: boolean,
  ticket: Ticket,
  plan: Plan,
): Promise<{ onSuccess: boolean; onFailure: boolean; decision: Decision }> {
  throw new Error(
    `durable approval gate must not execute: ${execute}:${ticket.incidentId}:${plan.risk}`,
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
 * @input ticket - Ticket
 * @input plan - Plan
 * @input decision - Decision
 * @output outcome - Outcome
 * @output status - Status
 */
export function recordOutcome(
  ticket: Ticket,
  plan: Plan,
  decision: Decision | null,
): { outcome: string; status: string } {
  // A rejected gate nulls its `decision` output, so treat a missing decision
  // as a refusal rather than destructuring null.
  const { approved, approver, note } = decision ?? { approved: false, approver: '', note: '' };
  const status = approved ? 'remediating' : 'held';
  return {
    status,
    outcome: [
      `${ticket.incidentId} (${ticket.service}) -> ${status}`,
      `root cause: ${plan.rootCause}`,
      `risk: ${plan.risk}`,
      'plan:',
      plan.planText,
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
 * @param incident - Incident
 * @returns outcome - Outcome
 * @returns status - Status
 * @node frame frameIncident [position: -250 0]
 * @node plan waitForAgent [expr: agentId="frame.task.agentId", context="frame.task.context", prompt="frame.task.prompt"] [position: -60 0]
 * @node check checkPlan [position: 130 0]
 * @node signoff signOff [position: 320 0]
 * @node record recordOutcome [position: 520 0]
 * @path Start -> frame -> plan -> check -> signoff -> Exit
 * @connect plan.agentResult -> check.agentResult
 * @connect check.ticket -> record.ticket
 * @connect check.plan -> record.plan
 * @connect signoff.decision -> record.decision
 * @connect record.outcome -> Exit.outcome
 * @connect record.status -> Exit.status
 * @position Start -450 0
 * @position Exit 720 0
 */
export async function incidentTriage(
  execute: boolean,
  params: { incident: Incident },
): Promise<{ onSuccess: boolean; onFailure: boolean; outcome: string; status: string }> {
  throw new Error('generated body was not installed');
}
