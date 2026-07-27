import type { NodeTemplate } from '../index';
import { toPascalCase } from '../index';

export const humanApprovalNodeTemplate: NodeTemplate = {
  id: 'human-approval',
  name: 'Human Approval',
  description: 'Pause workflow and wait for human approval',
  category: 'workflow',
  generate: (name: string): string => {
    const funcName = name || 'humanApproval';
    const label = toPascalCase(funcName);

    return `
/**
 * Yield a durable human-approval gate.
 *
 * The generated engine never calls this body. A coordinator persists the
 * yielded continuation and gate atomically, then supplies the exact resolution
 * to a later compatible Node.js executor invocation.
 *
 * @flowWeaver nodeType
 * @durableGate approval
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
  throw new Error(
    \`durable approval gate must not execute: \${execute}:\${prompt}:\${String(context)}:\${String(timeout)}\`,
  );
}
`.trim();
  },
};
