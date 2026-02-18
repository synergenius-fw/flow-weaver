import type { NodeTemplate, ConfigSchema } from '../index';
import { toPascalCase } from '../index';
import { APPROVAL_TYPES } from '../shared/approval-types';
import { getApprovalCode } from '../approvals/index';

const configSchema: ConfigSchema = {
  strategy: {
    type: 'select',
    label: 'Approval Strategy',
    description: 'How approval requests are handled',
    default: 'mock',
    options: [
      { value: 'mock', label: 'Mock (Testing)' },
      { value: 'callback', label: 'Callback (Promise-based)' },
      { value: 'webhook', label: 'Webhook (HTTP handler)' },
    ],
  },
};

export const humanApprovalNodeTemplate: NodeTemplate = {
  id: 'human-approval',
  name: 'Human Approval',
  description: 'Pause workflow and wait for human approval',
  category: 'workflow',
  configSchema,
  generate: (name: string, config?: Record<string, unknown>): string => {
    const funcName = name || 'humanApproval';
    const label = toPascalCase(funcName);
    const strategy = (config?.strategy as string) || 'mock';
    const approvalCode = getApprovalCode(strategy);

    return `
// ============================================================
// APPROVAL TYPES
// ============================================================
//
// On Inngest targets, consider using the built-in waitForEvent node instead —
// it maps to step.waitForEvent() for zero-cost durable pauses.
// See: https://www.inngest.com/docs/reference/functions/step-wait-for-event

${APPROVAL_TYPES}

// ============================================================
// APPROVAL PROVIDER
// ============================================================

${approvalCode}

/**
 * Pause workflow and wait for human approval.
 * Returns whether the request was approved, along with the reviewer's response.
 *
 * @flowWeaver nodeType
 * @label ${label}
 * @color orange
 * @icon verified
 * @input execute [order:0] - Execute
 * @input prompt [order:1] - Approval prompt shown to reviewer
 * @input context [order:2] - Additional context for the reviewer (optional)
 * @input timeout [order:3] - Timeout duration e.g. "7d", "1h" (optional)
 * @output onSuccess [order:0] - On Success
 * @output onFailure [order:1] - On Failure (timeout or error)
 * @output approved [order:2] - Whether the request was approved
 * @output response [order:3] - Reviewer's response text
 * @output reviewer [order:4] - Reviewer identifier
 */
async function ${funcName}(
  execute: boolean,
  prompt: string,
  context?: Record<string, unknown>,
  timeout?: string
): Promise<{
  onSuccess: boolean;
  onFailure: boolean;
  approved: boolean;
  response?: string;
  reviewer?: string;
}> {
  if (!execute) {
    return {
      onSuccess: false,
      onFailure: false,
      approved: false,
    };
  }

  try {
    const result = await approvalProvider.requestApproval({
      id: crypto.randomUUID(),
      prompt,
      context,
      timeout,
    });

    return {
      onSuccess: true,
      onFailure: false,
      approved: result.approved,
      response: result.response,
      reviewer: result.reviewer,
    };
  } catch (error) {
    console.error('Approval request failed:', error);
    return {
      onSuccess: false,
      onFailure: true,
      approved: false,
    };
  }
}
`.trim();
  },
};
