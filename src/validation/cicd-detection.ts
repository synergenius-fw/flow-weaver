/**
 * CI/CD Workflow Detection
 *
 * Determines whether a workflow is a CI/CD pipeline based on annotations.
 * A workflow is CI/CD if it has any CI/CD-specific annotations:
 * @secret, @runner, @cache, @artifact, @environment, @matrix, @service,
 * @concurrency, [job: "..."], or CI/CD trigger types (push, pull_request, etc.)
 */

import type { TWorkflowAST } from '../ast/types';

/**
 * Check if a workflow is a CI/CD pipeline.
 *
 * Detection signals (any one is sufficient):
 * 1. Workflow options contain CI/CD fields (secrets, runner, caches, etc.)
 * 2. Any node instance has a `job` attribute
 * 3. Workflow has cicdTriggers
 */
export function isCICDWorkflow(ast: TWorkflowAST): boolean {
  // Check CI/CD domain annotations
  const cicd = ast.options?.cicd;
  if (cicd) {
    if (cicd.secrets && cicd.secrets.length > 0) return true;
    if (cicd.runner) return true;
    if (cicd.caches && cicd.caches.length > 0) return true;
    if (cicd.artifacts && cicd.artifacts.length > 0) return true;
    if (cicd.environments && cicd.environments.length > 0) return true;
    if (cicd.matrix) return true;
    if (cicd.services && cicd.services.length > 0) return true;
    if (cicd.concurrency) return true;
    if (cicd.triggers && cicd.triggers.length > 0) return true;
  }

  // Check node-level CI/CD annotations
  if (ast.instances.some((inst) => inst.job)) return true;

  return false;
}

/**
 * Get all unique job names from a CI/CD workflow.
 * Returns empty array if no jobs are defined.
 */
export function getJobNames(ast: TWorkflowAST): string[] {
  const jobs = new Set<string>();
  for (const inst of ast.instances) {
    if (inst.job) jobs.add(inst.job);
  }
  return Array.from(jobs);
}

/**
 * Get all declared secret names from a CI/CD workflow.
 */
export function getDeclaredSecrets(ast: TWorkflowAST): string[] {
  return (ast.options?.cicd?.secrets || []).map((s) => s.name);
}

/**
 * Get all secret:NAME references from connections.
 * Returns array of secret names that are wired via @connect.
 */
export function getReferencedSecrets(ast: TWorkflowAST): string[] {
  const secrets = new Set<string>();
  for (const conn of ast.connections) {
    if (conn.from.node.startsWith('secret:')) {
      secrets.add(conn.from.node.substring(7)); // strip "secret:" prefix
    }
  }
  return Array.from(secrets);
}
