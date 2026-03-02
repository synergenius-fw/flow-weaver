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
  const opts = ast.options;
  if (!opts) return false;

  // Check workflow-level CI/CD annotations
  if (opts.secrets && opts.secrets.length > 0) return true;
  if (opts.runner) return true;
  if (opts.caches && opts.caches.length > 0) return true;
  if (opts.artifacts && opts.artifacts.length > 0) return true;
  if (opts.environments && opts.environments.length > 0) return true;
  if (opts.matrix) return true;
  if (opts.services && opts.services.length > 0) return true;
  if (opts.concurrency) return true;
  if (opts.cicdTriggers && opts.cicdTriggers.length > 0) return true;

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
  return (ast.options?.secrets || []).map((s) => s.name);
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
