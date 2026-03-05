/**
 * CI/CD-Specific Validation Rules
 *
 * Custom TValidationRule implementations for CI/CD pipeline workflows.
 * Registered through the ValidationRuleRegistry by the CI/CD extension.
 *
 * Rules:
 * 1. CICD_SECRET_NOT_DECLARED - secret:X referenced but no @secret X declared
 * 2. CICD_SECRET_UNUSED - @secret X declared but never wired
 * 3. CICD_TRIGGER_MISSING - No trigger annotations
 * 4. CICD_JOB_MISSING_RUNNER - Job has no runner
 * 5. CICD_ARTIFACT_CROSS_JOB - Data flows between jobs without @artifact
 * 6. CICD_CIRCULAR_JOB_DEPS - Job dependency cycle
 * 7. CICD_MATRIX_WITH_ENVIRONMENT - Matrix + environment = N approvals
 * 8. CICD_JOB_CONFIG_ORPHAN - @job config references non-existent job
 * 9. CICD_STAGE_ORPHAN - @stage has no matching jobs
 */

import type {
  TValidationRule,
  TValidationError,
  TWorkflowAST,
} from '../../ast/types';
import {
  getDeclaredSecrets,
  getReferencedSecrets,
  getJobNames,
} from './detection';

// ---------------------------------------------------------------------------
// Rule 1: Secret Not Declared
// ---------------------------------------------------------------------------

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

export const triggerMissingRule: TValidationRule = {
  name: 'CICD_TRIGGER_MISSING',
  validate(ast: TWorkflowAST): TValidationError[] {
    const triggers = ast.options?.cicd?.triggers || [];
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

export const jobMissingRunnerRule: TValidationRule = {
  name: 'CICD_JOB_MISSING_RUNNER',
  validate(ast: TWorkflowAST): TValidationError[] {
    const errors: TValidationError[] = [];
    const defaultRunner = ast.options?.cicd?.runner;
    const jobNames = getJobNames(ast);

    if (defaultRunner) return [];

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

export const artifactCrossJobRule: TValidationRule = {
  name: 'CICD_ARTIFACT_CROSS_JOB',
  validate(ast: TWorkflowAST): TValidationError[] {
    const errors: TValidationError[] = [];
    const artifacts = ast.options?.cicd?.artifacts || [];

    const nodeJob = new Map<string, string>();
    for (const inst of ast.instances) {
      if (inst.job) nodeJob.set(inst.id, inst.job);
    }

    const crossJobPairs = new Set<string>();
    for (const conn of ast.connections) {
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

export const circularJobDepsRule: TValidationRule = {
  name: 'CICD_CIRCULAR_JOB_DEPS',
  validate(ast: TWorkflowAST): TValidationError[] {
    const errors: TValidationError[] = [];

    const nodeJob = new Map<string, string>();
    for (const inst of ast.instances) {
      if (inst.job) nodeJob.set(inst.id, inst.job);
    }

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
        break;
      }
    }

    return errors;
  },
};

// ---------------------------------------------------------------------------
// Rule 7: Matrix with Environment
// ---------------------------------------------------------------------------

export const matrixWithEnvironmentRule: TValidationRule = {
  name: 'CICD_MATRIX_WITH_ENVIRONMENT',
  validate(ast: TWorkflowAST): TValidationError[] {
    const errors: TValidationError[] = [];
    const matrix = ast.options?.cicd?.matrix;
    const environments = ast.options?.cicd?.environments || [];

    if (matrix && environments.length > 0) {
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
// Rule 8: Job Config Orphan
// ---------------------------------------------------------------------------

export const jobConfigOrphanRule: TValidationRule = {
  name: 'CICD_JOB_CONFIG_ORPHAN',
  validate(ast: TWorkflowAST): TValidationError[] {
    const errors: TValidationError[] = [];
    const jobConfigs = ast.options?.cicd?.jobs || [];
    const actualJobs = new Set(getJobNames(ast));

    for (const jc of jobConfigs) {
      if (!actualJobs.has(jc.id)) {
        errors.push({
          type: 'warning',
          code: 'CICD_JOB_CONFIG_ORPHAN',
          message: `@job '${jc.id}' is configured but no node uses [job: "${jc.id}"]. Check for typos or add a node with that job attribute.`,
        });
      }
    }

    return errors;
  },
};

// ---------------------------------------------------------------------------
// Rule 9: Stage Orphan
// ---------------------------------------------------------------------------

export const stageOrphanRule: TValidationRule = {
  name: 'CICD_STAGE_ORPHAN',
  validate(ast: TWorkflowAST): TValidationError[] {
    const errors: TValidationError[] = [];
    const stages = ast.options?.cicd?.stages || [];
    if (stages.length === 0) return [];

    const jobNames = getJobNames(ast);
    if (jobNames.length === 0) return [];

    for (const stage of stages) {
      const hasMatch = jobNames.some(
        j => j === stage.name || j.startsWith(stage.name + '-') || j.startsWith(stage.name + '_'),
      );
      if (!hasMatch && jobNames.length > 0) {
        errors.push({
          type: 'warning',
          code: 'CICD_STAGE_ORPHAN',
          message: `Stage '${stage.name}' has no jobs matching by name prefix. Jobs will be assigned by dependency depth.`,
        });
      }
    }

    return errors;
  },
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const cicdValidationRules: TValidationRule[] = [
  secretNotDeclaredRule,
  secretUnusedRule,
  triggerMissingRule,
  jobMissingRunnerRule,
  artifactCrossJobRule,
  circularJobDepsRule,
  matrixWithEnvironmentRule,
  jobConfigOrphanRule,
  stageOrphanRule,
];

export function getCICDValidationRules(): TValidationRule[] {
  return cicdValidationRules;
}
