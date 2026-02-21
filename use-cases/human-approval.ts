// =============================================================================
// Human Approval - Durable pause waiting for external user input.
//
// Demonstrates:
//   - Scoped retry node: loops the prompt until the reviewer provides valid input
//   - Agent channel for interactive human-in-the-loop (maps to step.waitForEvent
//     on Inngest targets)
//   - Validation with early-exit failure routing
//   - Mock system for non-interactive testing
//
// Pattern: Start -> validate -> retry(prompt) -> finalize -> Exit
//          validate:fail ------------------------------------> Exit
//          retry:fail (max attempts) ------------------------> Exit
//
// Run (interactive):
//   flow-weaver run use-cases/human-approval.ts --params '{"requesterId":"u_jane","item":"MacBook Pro 16\"","amount":3499,"justification":"Development machine for new hire"}'
//
// Run (approved mock):
//   flow-weaver run use-cases/human-approval.ts \
//     --params '{"requesterId":"u_jane","item":"MacBook Pro","amount":3499,"justification":"Dev machine"}' \
//     --mocks '{"agents":{"human-reviewer":{"approved":true,"reviewer":"u_manager","note":"Go for it"}}}'
//
// Run (rejected mock):
//   flow-weaver run use-cases/human-approval.ts \
//     --params '{"requesterId":"u_jane","item":"MacBook Pro","amount":3499,"justification":"Dev machine"}' \
//     --mocks '{"agents":{"human-reviewer":{"approved":false,"reviewer":"u_boss","note":"Over budget"}}}'
// =============================================================================

// -- Types --

interface ReviewDecision {
  approved: boolean;
  reviewer: string;
  note?: string;
}

// -- Nodes --

/**
 * Validates a purchase request before sending it for approval.
 * Rejects requests with missing fields or amounts outside policy limits.
 *
 * @flowWeaver nodeType
 * @label Validate Request
 * @color green
 * @icon shield
 * @input requesterId [order:1] - Who submitted the request
 * @input item [order:2] - What they want to purchase
 * @input amount [order:3] - Purchase amount in USD
 * @input justification [order:4] - Why they need it
 * @output requesterId [order:2] - Validated requester
 * @output item [order:3] - Validated item
 * @output amount [order:4] - Validated amount
 * @output reason [order:5] - Rejection reason (on failure)
 */
function validateRequest(
  execute: boolean,
  requesterId: string,
  item: string,
  amount: number,
  justification: string
): {
  onSuccess: boolean;
  onFailure: boolean;
  requesterId: string;
  item: string;
  amount: number;
  reason: string;
} {
  if (!execute)
    return { onSuccess: false, onFailure: false, requesterId: '', item: '', amount: 0, reason: '' };

  if (!requesterId || !item) {
    return {
      onSuccess: false,
      onFailure: true,
      requesterId,
      item,
      amount,
      reason: 'Missing required fields: requesterId and item are mandatory',
    };
  }
  if (amount <= 0) {
    return {
      onSuccess: false,
      onFailure: true,
      requesterId,
      item,
      amount,
      reason: `Invalid amount: ${amount}. Must be positive.`,
    };
  }
  if (amount > 50000) {
    return {
      onSuccess: false,
      onFailure: true,
      requesterId,
      item,
      amount,
      reason: `Amount $${amount.toLocaleString()} exceeds $50,000 policy limit. Use the procurement portal instead.`,
    };
  }

  return { onSuccess: true, onFailure: false, requesterId, item, amount, reason: '' };
}

/**
 * Retries its child node until it succeeds or the attempt limit is reached.
 * Passes request context through to the child on every iteration via scoped ports.
 *
 * @flowWeaver nodeType
 * @label Retry Until Valid
 * @color blue
 * @icon refresh
 * @input [maxAttempts=10] - Max retries before giving up
 * @input requesterId - Requester ID to pass through
 * @input item - Item description to pass through
 * @input amount - Amount to pass through
 * @output start scope:attempt - Triggers child execute
 * @output requesterId scope:attempt - Passed to child
 * @output item scope:attempt - Passed to child
 * @output amount scope:attempt - Passed to child
 * @input success scope:attempt - Child succeeded (stop retrying)
 * @input failure scope:attempt - Child failed (retry)
 * @input result scope:attempt - Result data from child
 * @output result - Final result from the successful attempt
 */
async function retryUntilValid(
  execute: boolean,
  maxAttempts: number,
  requesterId: string,
  item: string,
  amount: number,
  attempt: (
    start: boolean,
    requesterId: string,
    item: string,
    amount: number
  ) => Promise<{ success: boolean; failure: boolean; result: object }>
): Promise<{ onSuccess: boolean; onFailure: boolean; result: object }> {
  if (!execute) return { onSuccess: false, onFailure: false, result: {} };

  const limit = maxAttempts > 0 ? maxAttempts : 10;
  for (let i = 0; i < limit; i++) {
    const res = await attempt(true, requesterId, item, amount);
    if (res.success) {
      return { onSuccess: true, onFailure: false, result: res.result };
    }
  }

  return { onSuccess: false, onFailure: true, result: {} };
}

/**
 * Prompts a human reviewer for a purchase decision via the agent channel.
 * Returns onSuccess with the decision if the response contains a valid
 * "approved" boolean. Returns onFailure on empty or malformed input so
 * the parent retry scope re-prompts.
 *
 * @flowWeaver nodeType
 * @label Prompt Reviewer
 * @color orange
 * @icon verified
 * @input requesterId - Who submitted the request
 * @input item - Item description (shown to reviewer)
 * @input amount - Amount in USD (shown to reviewer)
 * @output result - Review decision object ({approved, reviewer, note})
 */
async function promptReviewer(
  execute: boolean,
  requesterId: string,
  item: string,
  amount: number
): Promise<{ onSuccess: boolean; onFailure: boolean; result: object }> {
  if (!execute) return { onSuccess: false, onFailure: false, result: {} };

  // 1. Check mocks first (--mocks '{"agents": {"human-reviewer": {...}}}')
  const mocks = (globalThis as unknown as Record<string, unknown>).__fw_mocks__ as
    | { agents?: Record<string, object> }
    | undefined;
  if (mocks?.agents?.['human-reviewer']) {
    const raw = mocks.agents['human-reviewer'] as Record<string, unknown>;
    if (typeof raw.approved !== 'boolean') {
      return { onSuccess: false, onFailure: true, result: {} };
    }
    return { onSuccess: true, onFailure: false, result: raw };
  }

  // 2. Agent channel (interactive terminal or pause/resume)
  const channel = (globalThis as unknown as Record<string, unknown>).__fw_agent_channel__ as
    | { request: (req: object) => Promise<object> }
    | undefined;

  let raw: Record<string, unknown>;

  if (channel) {
    raw = (await channel.request({
      agentId: 'human-reviewer',
      context: { requesterId, item, amount },
      prompt: `Approve purchase of ${item} ($${amount.toLocaleString()}) requested by ${requesterId}?\nRespond with JSON, e.g. {"approved": true, "reviewer": "your name"}`,
    })) as Record<string, unknown>;
  } else {
    // 3. No mocks, no channel: auto-approve for demo/testing
    raw = { approved: true, reviewer: 'auto', note: 'Auto-approved (no review channel)' };
  }

  // Validate: must have an explicit "approved" boolean
  if (raw == null || typeof raw.approved !== 'boolean') {
    return { onSuccess: false, onFailure: true, result: {} };
  }

  return { onSuccess: true, onFailure: false, result: raw };
}

/**
 * Takes the reviewer decision and produces the final outcome summary.
 *
 * @flowWeaver nodeType
 * @label Finalize Decision
 * @color purple
 * @icon checkCircle
 * @input requesterId [order:1] - Who submitted the request
 * @input item [order:2] - What they want to purchase
 * @input amount [order:3] - Purchase amount in USD
 * @input result [order:4] - Review decision from the retry scope
 * @output summary [order:2] - Human-readable outcome summary
 * @output status [order:3] - Approved or rejected
 */
function finalizeDecision(
  execute: boolean,
  requesterId: string,
  item: string,
  amount: number,
  result: Record<string, unknown>
): { onSuccess: boolean; onFailure: boolean; summary: string; status: string } {
  if (!execute) return { onSuccess: false, onFailure: false, summary: '', status: '' };

  const decision = result as unknown as ReviewDecision;
  const reviewer = decision.reviewer || 'unknown';
  const note = decision.note || '';

  if (decision.approved) {
    const po = `PO-${Date.now().toString(36).toUpperCase()}`;
    return {
      onSuccess: true,
      onFailure: false,
      summary: [
        `Purchase order ${po} created.`,
        `${item} ($${amount.toLocaleString()}) approved by ${reviewer}.`,
        note ? `Note: "${note}"` : '',
        `Requester ${requesterId} has been notified.`,
      ]
        .filter(Boolean)
        .join(' '),
      status: 'approved',
    };
  }

  return {
    onSuccess: true,
    onFailure: false,
    summary: [
      `Purchase request for ${item} was rejected by ${reviewer}.`,
      note ? `Reason: "${note}"` : 'No reason provided.',
      `Requester ${requesterId} has been notified.`,
    ].join(' '),
    status: 'rejected',
  };
}

// -- Workflow --

/**
 * A purchase approval workflow: validates the request, retries the human
 * prompt until the reviewer provides valid input, then finalizes the outcome.
 *
 * @flowWeaver workflow
 * @node val validateRequest
 * @node retry retryUntilValid [expr: maxAttempts="10"]
 * @node prompt promptReviewer retry.attempt
 * @node fin finalizeDecision
 * @connect Start.execute -> val.execute
 * @connect Start.requesterId -> val.requesterId
 * @connect Start.item -> val.item
 * @connect Start.amount -> val.amount
 * @connect Start.justification -> val.justification
 * @connect val.onSuccess -> retry.execute
 * @connect val.requesterId -> retry.requesterId
 * @connect val.item -> retry.item
 * @connect val.amount -> retry.amount
 * @connect retry.start:attempt -> prompt.execute
 * @connect retry.requesterId:attempt -> prompt.requesterId
 * @connect retry.item:attempt -> prompt.item
 * @connect retry.amount:attempt -> prompt.amount
 * @connect prompt.onSuccess -> retry.success:attempt
 * @connect prompt.onFailure -> retry.failure:attempt
 * @connect prompt.result -> retry.result:attempt
 * @connect retry.onSuccess -> fin.execute
 * @connect retry.result -> fin.result
 * @connect val.requesterId -> fin.requesterId
 * @connect val.item -> fin.item
 * @connect val.amount -> fin.amount
 * @connect fin.onSuccess -> Exit.onSuccess
 * @connect fin.summary -> Exit.summary
 * @connect fin.status -> Exit.status
 * @connect val.onFailure -> Exit.onFailure
 * @connect val.reason -> Exit.reason
 * @connect retry.onFailure -> Exit.onFailure
 * @position Start -500 0
 * @position val -250 0
 * @position retry 0 0
 * @position prompt 0 0
 * @position fin 250 0
 * @position Exit 500 0
 * @param execute [order:0] - Execute
 * @param requesterId [order:1] - Requester's user ID
 * @param item [order:2] - Item to purchase
 * @param amount [order:3] - Amount in USD
 * @param justification [order:4] - Business justification
 * @returns onSuccess [order:0] - Request completed (approved or rejected)
 * @returns onFailure [order:1] - Validation failed or max retries exceeded
 * @returns summary [order:2] - Human-readable outcome summary
 * @returns status [order:3] - Final status: "approved" or "rejected"
 * @returns reason [order:4] - Rejection reason (validation failure only)
 */
export function purchaseApproval(
  execute: boolean,
  params: {
    requesterId: string;
    item: string;
    amount: number;
    justification: string;
  }
): {
  onSuccess: boolean;
  onFailure: boolean;
  summary: string;
  status: string;
  reason: string;
} {
  throw new Error('Compile with: flow-weaver compile <file>');
}
