/**
 * CI/CD-Specific Validation Rules
 *
 * Custom TValidationRule implementations for CI/CD pipeline workflows.
 * These run AFTER the built-in validator via the api/validate.ts custom rules injection.
 *
 * Rules:
 * 1. CICD_SECRET_NOT_DECLARED - secret:X referenced but no @secret X declared
 * 2. CICD_SECRET_UNUSED - @secret X declared but never wired
 * 3. CICD_TRIGGER_MISSING - No trigger annotations — pipeline would never run
 * 4. CICD_JOB_MISSING_RUNNER - Job has no runner (uses workflow default or none)
 * 5. CICD_ARTIFACT_CROSS_JOB - Data flows between jobs without @artifact declaration
 * 6. CICD_CIRCULAR_JOB_DEPS - Job dependency cycle detected
 * 7. CICD_MATRIX_WITH_ENVIRONMENT - Matrix + environment = N approval prompts
 */

import type {
  TValidationRule,
  TValidationError,
  TWorkflowAST,
} from '../ast/types';
import {
  getDeclaredSecrets,
  getReferencedSecrets,
  getJobNames,
} from './cicd-detection';

// ---------------------------------------------------------------------------
// Rule 1: Secret Not Declared
// ---------------------------------------------------------------------------

/**
 * A `secret:X` pseudo-node is referenced in @connect but no `@secret X` is declared.
 * This means the export target won't know about the secret and can't generate
 * proper environment variable references.
 */
export const secretNotDeclaredRule: TValidationRule = {
  name: 'CICD_SECRET_NOT_DECLARED',
  validate(ast: TWorkflowAST): TValidationError[] {
    const errors: TValidationError[] = [];
    const declared = new Set(getDeclaredSecrets(ast));
    const referenced = getReferencedSecrets(ast);

    for (const secretName of referenced) {
      if (!declared.has(secretName)) {
        errors.push({
          type: 'error',
          code: 'CICD_SECRET_NOT_DECLARED',
          message: `Secret '${secretName}' is referenced via @connect but not declared with @secret. Add: @secret ${secretName} - description`,
        });
      }
    }

    return errors;
  },
};

// ---------------------------------------------------------------------------
// Rule 2: Secret Unused
// ---------------------------------------------------------------------------

/**
 * A `@secret X` is declared but never wired via `@connect secret:X -> ...`.
 * The secret might be intentional (used in a shell-command step) or a leftover.
 */
export const secretUnusedRule: TValidationRule = {
  name: 'CICD_SECRET_UNUSED',
  validate(ast: TWorkflowAST): TValidationError[] {
    const errors: TValidationError[] = [];
    const referenced = new Set(getReferencedSecrets(ast));
    const declared = getDeclaredSecrets(ast);

    for (const secretName of declared) {
      if (!referenced.has(secretName)) {
        errors.push({
          type: 'warning',
          code: 'CICD_SECRET_UNUSED',
          message: `Secret '${secretName}' is declared but not wired to any node. If used in a shell command, this is fine. Otherwise, wire it with: @connect secret:${secretName} -> node.port`,
        });
      }
    }

    return errors;
  },
};

// ---------------------------------------------------------------------------
// Rule 3: Trigger Missing
// ---------------------------------------------------------------------------

/**
 * A CI/CD workflow with no trigger annotations would never run automatically.
 * Needs at least one @trigger (push, pull_request, schedule, dispatch, or tag).
 */
export const triggerMissingRule: TValidationRule = {
  name: 'CICD_TRIGGER_MISSING',
  validate(ast: TWorkflowAST): TValidationError[] {
    const triggers = ast.options?.cicd?.triggers || [];
    // Also check for FW-style triggers (event=, cron=)
    const fwTrigger = ast.options?.trigger;

    if (triggers.length === 0 && !fwTrigger) {
      return [
        {
          type: 'warning',
          code: 'CICD_TRIGGER_MISSING',
          message:
            'No trigger annotations found. The pipeline will never run automatically. Add at least one: @trigger push branches="main" or @trigger dispatch',
        },
      ];
    }

    return [];
  },
};

// ---------------------------------------------------------------------------
// Rule 4: Job Missing Runner
// ---------------------------------------------------------------------------

/**
 * A job (group of nodes with same [job: "name"]) has no explicit runner
 * and the workflow has no default @runner. The export target will use a
 * platform default, which may not be what the user expects.
 */
export const jobMissingRunnerRule: TValidationRule = {
  name: 'CICD_JOB_MISSING_RUNNER',
  validate(ast: TWorkflowAST): TValidationError[] {
    const errors: TValidationError[] = [];
    const defaultRunner = ast.options?.cicd?.runner;
    const jobNames = getJobNames(ast);

    // If there's a default runner, all jobs are covered
    if (defaultRunner) return [];

    // If there are jobs but no default runner, warn
    if (jobNames.length > 0) {
      errors.push({
        type: 'warning',
        code: 'CICD_JOB_MISSING_RUNNER',
        message: `No @runner annotation found. Jobs (${jobNames.join(', ')}) will use platform defaults. Add: @runner ubuntu-latest`,
      });
    }

    return errors;
  },
};

// ---------------------------------------------------------------------------
// Rule 5: Artifact Cross-Job
// ---------------------------------------------------------------------------

/**
 * Data flows between nodes in different jobs via connections, but no @artifact
 * is declared. In CI/CD, each job runs in a fresh environment — data must be
 * explicitly passed via artifacts.
 */
export const artifactCrossJobRule: TValidationRule = {
  name: 'CICD_ARTIFACT_CROSS_JOB',
  validate(ast: TWorkflowAST): TValidationError[] {
    const errors: TValidationError[] = [];
    const artifacts = ast.options?.cicd?.artifacts || [];

    // Build node -> job map
    const nodeJob = new Map<string, string>();
    for (const inst of ast.instances) {
      if (inst.job) nodeJob.set(inst.id, inst.job);
    }

    // Check connections between nodes in different jobs
    const crossJobPairs = new Set<string>();
    for (const conn of ast.connections) {
      // Skip secret: pseudo-nodes and Start/Exit
      if (conn.from.node.startsWith('secret:')) continue;
      if (conn.from.node === 'Start' || conn.to.node === 'Exit') continue;

      const fromJob = nodeJob.get(conn.from.node);
      const toJob = nodeJob.get(conn.to.node);

      if (fromJob && toJob && fromJob !== toJob) {
        const pairKey = `${fromJob}->${toJob}`;
        if (!crossJobPairs.has(pairKey)) {
          crossJobPairs.add(pairKey);
        }
      }
    }

    // If there are cross-job data flows but no artifacts declared, warn
    if (crossJobPairs.size > 0 && artifacts.length === 0) {
      const pairs = Array.from(crossJobPairs);
      errors.push({
        type: 'warning',
        code: 'CICD_ARTIFACT_CROSS_JOB',
        message: `Data flows between jobs (${pairs.join(', ')}) but no @artifact is declared. In CI/CD, each job runs in a fresh environment. Add @artifact declarations to pass data between jobs.`,
      });
    }

    return errors;
  },
};

// ---------------------------------------------------------------------------
// Rule 6: Circular Job Dependencies
// ---------------------------------------------------------------------------

/**
 * Job dependencies (derived from @path connections between jobs) form a cycle.
 * CI/CD platforms reject circular job dependencies.
 */
export const circularJobDepsRule: TValidationRule = {
  name: 'CICD_CIRCULAR_JOB_DEPS',
  validate(ast: TWorkflowAST): TValidationError[] {
    const errors: TValidationError[] = [];

    // Build node -> job map
    const nodeJob = new Map<string, string>();
    for (const inst of ast.instances) {
      if (inst.job) nodeJob.set(inst.id, inst.job);
    }

    // Build job dependency graph from connections
    const jobDeps = new Map<string, Set<string>>();
    for (const conn of ast.connections) {
      if (conn.from.node.startsWith('secret:')) continue;
      if (conn.from.node === 'Start' || conn.to.node === 'Exit') continue;

      const fromJob = nodeJob.get(conn.from.node);
      const toJob = nodeJob.get(conn.to.node);

      if (fromJob && toJob && fromJob !== toJob) {
        if (!jobDeps.has(toJob)) jobDeps.set(toJob, new Set());
        jobDeps.get(toJob)!.add(fromJob);
      }
    }

    // Detect cycles using DFS
    const visited = new Set<string>();
    const inStack = new Set<string>();

    function hasCycle(job: string): boolean {
      if (inStack.has(job)) return true;
      if (visited.has(job)) return false;

      visited.add(job);
      inStack.add(job);

      const deps = jobDeps.get(job);
      if (deps) {
        for (const dep of deps) {
          if (hasCycle(dep)) return true;
        }
      }

      inStack.delete(job);
      return false;
    }

    const allJobs = getJobNames(ast);
    for (const job of allJobs) {
      if (hasCycle(job)) {
        errors.push({
          type: 'error',
          code: 'CICD_CIRCULAR_JOB_DEPS',
          message: `Circular dependency detected involving job '${job}'. CI/CD platforms require a directed acyclic graph of job dependencies.`,
        });
        break; // Report once
      }
    }

    return errors;
  },
};

// ---------------------------------------------------------------------------
// Rule 7: Matrix with Environment
// ---------------------------------------------------------------------------

/**
 * Using @matrix with @environment protection means each matrix combination
 * triggers an approval prompt. For a 3x2 matrix, that's 6 prompts.
 */
export const matrixWithEnvironmentRule: TValidationRule = {
  name: 'CICD_MATRIX_WITH_ENVIRONMENT',
  validate(ast: TWorkflowAST): TValidationError[] {
    const errors: TValidationError[] = [];
    const matrix = ast.options?.cicd?.matrix;
    const environments = ast.options?.cicd?.environments || [];

    if (matrix && environments.length > 0) {
      // Calculate matrix size
      const dimensions = matrix.include
        ? matrix.include.length
        : Object.values(matrix.dimensions || {}).reduce(
            (acc, vals) => acc * vals.length,
            1,
          );

      if (dimensions > 1) {
        errors.push({
          type: 'warning',
          code: 'CICD_MATRIX_WITH_ENVIRONMENT',
          message: `Using @matrix (${dimensions} combinations) with @environment protection will trigger ${dimensions} approval prompts per deployment. Consider separating the matrix job from the deploy job.`,
        });
      }
    }

    return errors;
  },
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** All CI/CD validation rules */
export const cicdValidationRules: TValidationRule[] = [
  secretNotDeclaredRule,
  secretUnusedRule,
  triggerMissingRule,
  jobMissingRunnerRule,
  artifactCrossJobRule,
  circularJobDepsRule,
  matrixWithEnvironmentRule,
];

/**
 * Get all CI/CD validation rules.
 * Convenience function for passing to validateWorkflow().
 */
export function getCICDValidationRules(): TValidationRule[] {
  return cicdValidationRules;
}
