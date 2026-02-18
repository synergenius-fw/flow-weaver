/**
 * Public API wrapper for workflow validation
 *
 * This module provides a simplified validation interface that uses
 * the consolidated WorkflowValidator internally.
 */

import type { TValidationRule, TWorkflowAST } from "../ast";
import { validator, type TValidationError } from "../validator";
import { getAgentValidationRules } from "../validation/agent-rules";

export interface ValidationResult {
  valid: boolean;
  errors: TValidationError[];
  warnings: TValidationError[];
}

/**
 * Validates a workflow AST
 *
 * Runs the built-in validator, then agent-specific rules, then any custom rules.
 * Agent rules are always applied automatically.
 *
 * @param ast - The workflow AST to validate
 * @param customRules - Optional array of additional custom validation rules
 * @returns ValidationResult with errors and warnings
 */
export function validateWorkflow(
  ast: TWorkflowAST,
  customRules?: TValidationRule[],
): ValidationResult {
  // Use the consolidated validator
  const result = validator.validate(ast);

  // Apply agent-specific rules + any custom rules
  const allRules = [...getAgentValidationRules(), ...(customRules || [])];
  for (const rule of allRules) {
    const ruleResults = rule.validate(ast);
    for (const err of ruleResults) {
      if (err.type === 'warning') {
        result.warnings.push(err);
      } else {
        result.errors.push(err);
      }
    }
  }

  // Re-evaluate validity
  result.valid = result.errors.length === 0;

  return result;
}
