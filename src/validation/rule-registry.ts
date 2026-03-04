/**
 * ValidationRuleRegistry: dynamic dispatch for pack-contributed validation rules.
 *
 * Replaces the hardcoded `isCICDWorkflow() ? getCICDValidationRules() : []`
 * pattern. Each registered rule set has a detect predicate and a lazy rule loader.
 * The validate API calls `getApplicableRules(ast)` and merges results.
 */

import type { TValidationRule, TWorkflowAST } from '../ast/types';

export type TValidationRuleSet = {
  /** Human-readable name for this rule set */
  name: string;
  /** Deploy namespace this rule set applies to */
  namespace: string;
  /** Predicate: should these rules run for this workflow? */
  detect: (ast: TWorkflowAST) => boolean;
  /** Lazy loader for the actual rules. Called only when detect returns true. */
  getRules: () => TValidationRule[];
};

/**
 * Registry for dynamically contributed validation rule sets.
 * Core rule sets (like CI/CD) register themselves at startup.
 * Pack-contributed rule sets are loaded from manifests.
 */
export class ValidationRuleRegistry {
  private ruleSets: TValidationRuleSet[] = [];

  /** Register a validation rule set. */
  register(ruleSet: TValidationRuleSet): void {
    this.ruleSets.push(ruleSet);
  }

  /**
   * Get all validation rules applicable to the given workflow AST.
   * Runs each registered detect predicate and collects rules from matching sets.
   */
  getApplicableRules(ast: TWorkflowAST): TValidationRule[] {
    const rules: TValidationRule[] = [];
    for (const ruleSet of this.ruleSets) {
      if (ruleSet.detect(ast)) {
        rules.push(...ruleSet.getRules());
      }
    }
    return rules;
  }

  /** Get the number of registered rule sets. */
  get size(): number {
    return this.ruleSets.length;
  }
}
