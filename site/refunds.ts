interface RefundRequest {
  orderId: string;
  amount: number;
  reason: string;
}

/**
 * Turns a refund request into one line for the manager.
 *
 * @flowWeaver nodeType
 * @color blue
 * @icon summarize
 * @expression
 * @input refund - The customer's refund request
 * @output summary - One line for the manager
 * @output refund - The same request, passed on
 */
function reviewRequest(refund: RefundRequest): { summary: string; refund: RefundRequest } {
  return {
    summary: `€${refund.amount} for order ${refund.orderId}: ${refund.reason}`,
    refund,
  };
}

/**
 * A manager approves or declines. The run waits here, for up to 24 hours.
 * The body never runs: the manager's answer is the gate's result.
 *
 * @flowWeaver nodeType
 * @color purple
 * @icon person
 * @durableGate approval
 * @input summary - What the manager sees
 * @input timeout - How long to wait before declining
 * @output note - What the manager said
 */
async function managerApproval(
  execute: boolean,
  summary: string,
  timeout: string,
): Promise<{ onSuccess: boolean; onFailure: boolean; note: string }> {
  throw new Error('durable gate implementation must not execute');
}

/**
 * Issues the refund. In this demo it returns a line instead of calling a payment provider.
 *
 * @flowWeaver nodeType
 * @color green
 * @icon receipt
 * @expression
 * @input refund - The approved request
 * @input note - The manager's note
 * @output outcome - What happened
 */
function issueRefund(refund: RefundRequest, note: string): { outcome: string } {
  return { outcome: `Refunded €${refund.amount} on order ${refund.orderId} (${note})` };
}

/**
 * @flowWeaver nodeType
 * @color red
 * @icon block
 * @expression
 * @input refund - The declined request
 * @output declined - Why it was not refunded
 */
function declineRefund(refund: RefundRequest): { declined: string } {
  return { declined: `Declined refund for order ${refund.orderId}` };
}

/**
 * Refund requests: a manager approves each one within 24 hours, or it is declined.
 *
 * @flowWeaver workflow
 * @http POST /refunds
 * @param refund - The customer's refund request
 * @returns outcome - The refund, when approved
 * @returns declined - Why not, when declined
 * @node review reviewRequest
 * @node approval managerApproval [expr: timeout="'24h'"]
 * @node pay issueRefund
 * @node decline declineRefund
 * @path Start -> review -> approval -> pay -> Exit
 * @path Start -> review -> approval:fail -> decline -> Exit
 */
export async function refundRequest(
  execute: boolean,
  params: { refund: RefundRequest },
): Promise<{ onSuccess: boolean; onFailure: boolean; outcome: string; declined: string }> {
  throw new Error('generated body was not installed');
}
