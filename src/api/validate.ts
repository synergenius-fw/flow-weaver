/**
 * Public API wrapper for workflow validation
 *
 * This module provides a simplified validation interface that uses
 * the consolidated WorkflowValidator internally.
 */

import type { TValidationRule, TWorkflowAST } from "../ast";
import { validator, type TValidationError } from "../validator";
import { getAgentValidationRules } from "../validation/agent-rules";
import { getDesignValidationRules } from "../validation/design-rules";
import { validationRuleRegistry } from "./validation-registry";

export interface ValidationResult {
  valid: boolean;
  errors: TValidationError[];
  warnings: TValidationError[];
}

/**
 * Validates a workflow AST
 *
 * Runs the built-in validator, then agent-specific rules, then registry rules
 * (pack-contributed), then any custom rules.
 *
 * @param ast - The workflow AST to validate
 * @param options - Validation options: custom rules and/or draft mode
 * @returns ValidationResult with errors and warnings
 */
export function validateWorkflow(
  ast: TWorkflowAST,
  options?: { customRules?: TValidationRule[]; mode?: 'strict' | 'draft' },
): ValidationResult {
  // Use the consolidated validator
  const result = validator.validate(ast, { mode: options?.mode });

  // Apply agent-specific rules, registry rules (pack-contributed,
  // including CI/CD when applicable), and custom rules
  const allRules = [
    ...getAgentValidationRules(),
    ...getDesignValidationRules(),
    ...validationRuleRegistry.getApplicableRules(ast),
    ...(options?.customRules || []),
  ];
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

  // Filter warnings from additional rules through per-instance suppressWarnings
  // (core validator already filters its own warnings, but agent/registry rules
  // run after the core validator and need the same treatment)
  const suppressMap = new Map<string, Set<string>>();
  for (const inst of ast.instances) {
    if (inst.config?.suppressWarnings?.length) {
      suppressMap.set(inst.id, new Set(inst.config.suppressWarnings));
    }
  }
  if (suppressMap.size > 0) {
    result.warnings = result.warnings.filter((w) => {
      if (!w.node) return true;
      const codes = suppressMap.get(w.node);
      return !codes || !codes.has(w.code);
    });
  }

  // Re-evaluate validity
  result.valid = result.errors.length === 0;

  return result;
}
