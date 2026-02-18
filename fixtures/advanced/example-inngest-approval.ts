// Inngest Advanced Primitives — Expense Approval Workflow
//
// Demonstrates all 10 Phase 1B2 features:
//   1. Typed event schemas (@param → Zod)
//   2. Cron trigger (@trigger)
//   3. Cancellation (@cancelOn)
//   4. Delay built-in node (step.sleep)
//   5. Wait-for-event gate (step.waitForEvent)
//   6. Sub-workflow invocation (step.invoke)
//   7. Serve handler (generation option)
//   8. @retries annotation
//   9. @timeout annotation
//  10. @throttle annotation
//
// Scenario: An employee submits an expense report. If the amount is under
// $100, it auto-approves. Otherwise, it waits for manager approval (up to
// 48h). If not approved in time, it sends a reminder, waits another 24h,
// and escalates if still unapproved. Once approved, it invokes the payment
// sub-workflow to process reimbursement.

// ============================================================================
// NODE DEFINITIONS
// ============================================================================

/**
 * Validate expense data and determine approval routing.
 *
 * @flowWeaver nodeType
 * @input amount
 * @input description
 * @output validated
 * @output needsApproval
 */
function validateExpense(
  execute: boolean,
  amount: number,
  description: string
): { onSuccess: boolean; onFailure: boolean; validated: object; needsApproval: boolean } {
  if (!execute) return { onSuccess: false, onFailure: false, validated: {}, needsApproval: false };
  if (!description || amount <= 0) {
    return { onSuccess: false, onFailure: true, validated: {}, needsApproval: false };
  }
  return {
    onSuccess: true,
    onFailure: false,
    validated: { amount, description, validatedAt: new Date().toISOString() },
    needsApproval: amount >= 100,
  };
}

/**
 * Route based on whether manager approval is needed.
 * Auto-approves small expenses; routes larger ones to the approval gate.
 *
 * @flowWeaver nodeType
 * @input needsApproval
 * @output autoApproved
 */
function approvalRouter(
  execute: boolean,
  needsApproval: boolean
): { onSuccess: boolean; onFailure: boolean; autoApproved: boolean } {
  if (!execute) return { onSuccess: false, onFailure: false, autoApproved: false };
  // onSuccess = auto-approved (no approval needed)
  // onFailure = needs manual approval
  if (needsApproval) {
    return { onSuccess: false, onFailure: true, autoApproved: false };
  }
  return { onSuccess: true, onFailure: false, autoApproved: true };
}

/**
 * Send a reminder notification to the manager.
 *
 * @flowWeaver nodeType
 * @input expenseId
 * @output sent
 */
function sendReminder(
  execute: boolean,
  expenseId: string
): { onSuccess: boolean; onFailure: boolean; sent: boolean } {
  if (!execute) return { onSuccess: false, onFailure: false, sent: false };
  // In production: send email/Slack notification
  return { onSuccess: true, onFailure: false, sent: true };
}

/**
 * Record the final approval decision and prepare for payment.
 *
 * @flowWeaver nodeType
 * @input expenseData
 * @input approvalData
 * @output record
 */
function recordApproval(
  execute: boolean,
  expenseData: object,
  approvalData: object
): { onSuccess: boolean; onFailure: boolean; record: object } {
  if (!execute) return { onSuccess: false, onFailure: false, record: {} };
  return {
    onSuccess: true,
    onFailure: false,
    record: { ...expenseData, approval: approvalData, recordedAt: new Date().toISOString() },
  };
}

/**
 * Built-in: Wait for a specific event (maps to step.waitForEvent in Inngest).
 *
 * @flowWeaver nodeType
 * @input eventName
 * @input [match]
 * @input [timeout]
 * @output eventData
 */
async function waitForEvent(
  execute: boolean,
  eventName: string,
  match?: string,
  timeout?: string
): Promise<{ onSuccess: boolean; onFailure: boolean; eventData: object }> {
  if (!execute) return { onSuccess: false, onFailure: false, eventData: {} };
  return { onSuccess: true, onFailure: false, eventData: {} };
}

/**
 * Built-in: Sleep/delay (maps to step.sleep in Inngest).
 *
 * @flowWeaver nodeType
 * @input duration
 * @output elapsed
 */
async function delay(
  execute: boolean,
  duration: string
): Promise<{ onSuccess: boolean; onFailure: boolean; elapsed: boolean }> {
  if (!execute) return { onSuccess: false, onFailure: false, elapsed: false };
  return { onSuccess: true, onFailure: false, elapsed: true };
}

/**
 * Built-in: Invoke a sub-workflow (maps to step.invoke in Inngest).
 *
 * @flowWeaver nodeType
 * @input functionId
 * @input payload
 * @input [timeout]
 * @output result
 */
async function invokeWorkflow(
  execute: boolean,
  functionId: string,
  payload: object,
  timeout?: string
): Promise<{ onSuccess: boolean; onFailure: boolean; result: object }> {
  if (!execute) return { onSuccess: false, onFailure: false, result: {} };
  return { onSuccess: true, onFailure: false, result: {} };
}

// ============================================================================
// WORKFLOW
// ============================================================================

/**
 * Expense approval workflow with durable Inngest primitives.
 *
 * When deployed to Inngest:
 * - Triggers on expense.submitted events
 * - Cancels automatically if the expense is withdrawn
 * - Waits for manager approval via step.waitForEvent
 * - Delays before sending reminders via step.sleep
 * - Invokes payment processing via step.invoke
 * - Retries up to 5 times on transient failures
 * - Times out after 7 days
 * - Throttled to 20 concurrent executions per minute
 *
 * @flowWeaver workflow
 * @trigger event="app/expense.submitted"
 * @cancelOn event="app/expense.withdrawn" match="data.expenseId"
 * @retries 5
 * @timeout "7d"
 * @throttle limit=20 period="1m"
 *
 * @param {string} expenseId - Unique expense ID
 * @param {number} amount - Expense amount in USD
 * @param {string} description - Expense description
 * @param {string} submittedBy - Employee ID
 *
 * @node v validateExpense
 * @node router approvalRouter
 * @node wait waitForEvent [expr: eventName="'app/expense.approved'", match="'data.expenseId'", timeout="'48h'"]
 * @node d delay [expr: duration="'24h'"]
 * @node remind sendReminder
 * @node rec recordApproval
 * @node pay invokeWorkflow [expr: functionId="'payment-service/process-payment'", timeout="'5m'"]
 * @path Start -> v -> router:fail -> wait -> rec -> pay -> Exit
 * @path Start -> v -> router:fail -> wait:fail -> d -> remind
 *
 * @connect Start.amount -> v.amount
 * @connect Start.description -> v.description
 * @connect v.onSuccess -> router.execute
 * @connect v.needsApproval -> router.needsApproval
 *
 * @connect router.onFailure -> wait.execute
 * @connect wait.onSuccess -> rec.execute
 * @connect wait.eventData -> rec.approvalData
 * @connect v.validated -> rec.expenseData
 *
 * @connect wait.onFailure -> d.execute
 * @connect d.onSuccess -> remind.execute
 * @connect Start.expenseId -> remind.expenseId
 *
 * @connect rec.onSuccess -> pay.execute
 * @connect rec.record -> pay.payload
 *
 * @connect pay.result -> Exit.result
 *
 * @returns {object} result - Payment processing result
 */
export function expenseApproval(
  execute: boolean,
  params: { expenseId: string; amount: number; description: string; submittedBy: string }
): { onSuccess: boolean; onFailure: boolean; result: object } {
  throw new Error('Not compiled');
}
