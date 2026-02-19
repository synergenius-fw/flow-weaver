/**
 * Shared Approval type definitions for human-approval template code generation.
 *
 * These strings are embedded into generated node code by the human-approval template.
 * They provide the common type system for approval workflows.
 */

/** Core approval types — embedded in generated human-approval nodes */
export const APPROVAL_TYPES = `interface ApprovalRequest {
  /** Unique identifier for this approval request */
  id: string;
  /** Human-readable prompt describing what needs approval */
  prompt: string;
  /** Additional context for the reviewer */
  context?: Record<string, unknown>;
  /** Timeout duration (e.g. "7d", "1h") */
  timeout?: string;
}

interface ApprovalResult {
  /** Whether the request was approved */
  approved: boolean;
  /** Reviewer's response text */
  response?: string;
  /** Reviewer identifier */
  reviewer?: string;
}

interface ApprovalProvider {
  requestApproval(request: ApprovalRequest): Promise<ApprovalResult>;
}`;
