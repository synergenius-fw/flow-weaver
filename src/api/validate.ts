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
import { validateDurableClosure } from "./durable-validation";

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

  // Durable-closure checks (branch regions, pull/lazy, gate classification,
  // effect contracts) otherwise fire only when the coordinator computes the
  // bundle digest, so a gated workflow could validate here and then fail at
  // run time. Surface them at author time as ordinary errors. The analysis
  // throws a single message on the first violation; we do not have per-node
  // locations for it, so it is reported without a node.
  if (ast.instances.some((inst) => inst.nodeType === 'waitForAgent' || inst.nodeType === 'waitForEvent')
      || ast.nodeTypes.some((nt) => nt.durableGate !== undefined || nt.durableEffect === true)) {
    try {
      validateDurableClosure(ast);
    } catch (e) {
      result.errors.push({
        type: 'error',
        code: 'DURABLE_CLOSURE_INVALID',
        message: e instanceof Error ? e.message : String(e),
      });
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
    // Report suppress entries that cannot be a code at all, before filtering.
    // The grammar is `suppress: "CODE", "CODE2"` -- comma-separated string
    // literals -- so the common mistake `suppress: "CODE,CODE2"` is one string
    // naming nothing and silently suppresses neither code. Only structurally
    // impossible entries are reported: the documented catalogue is not a
    // complete list of every code the validator emits, so matching against it
    // would flag legitimate codes.
    for (const [nodeId, codes] of suppressMap) {
      for (const code of codes) {
        if (/^[A-Z][A-Z0-9_]*$/.test(code)) continue;
        const hint = code.includes(',')
          ? ` Codes are separate strings: [suppress: ${code
              .split(',')
              .map((c) => `"${c.trim()}"`)
              .join(', ')}].`
          : '';
        result.warnings.push({
          type: 'warning',
          code: 'SUPPRESS_UNKNOWN_CODE',
          message: `Node '${nodeId}' suppresses '${code}', which cannot be a validation code, so it suppresses nothing.${hint}`,
          node: nodeId,
        });
      }
    }

    result.warnings = result.warnings.filter((w) => {
      if (!w.node) return true;
      // A SUPPRESS_UNKNOWN_CODE warning must not be silenced by the very list
      // it is reporting on.
      if (w.code === 'SUPPRESS_UNKNOWN_CODE') return true;
      const codes = suppressMap.get(w.node);
      return !codes || !codes.has(w.code);
    });
  }

  // Re-evaluate validity
  result.valid = result.errors.length === 0;

  return result;
}
