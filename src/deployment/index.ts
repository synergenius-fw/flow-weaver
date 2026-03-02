/**
 * Flow Weaver Deployment System
 *
 * Unified abstractions for deploying workflows across CLI, HTTP, and serverless contexts.
 *
 * @module deployment
 */

// Types
export type {
  ExecutionSource,
  Environment,
  ExecutionContext,
  WorkflowRequest,
  WorkflowResponse,
  WorkflowError,
  WorkflowErrorCode,
  ValidationResult,
  ValidationError,
  CliInput,
  HttpInput,
  LambdaInput,
  VercelInput,
  CloudflareInput,
  AdapterInput,
} from './types.js';

// Core - Executor
export { UnifiedWorkflowExecutor, createExecutor, type ExecutorOptions } from './core/executor.js';

// Core - Adapters
export {
  type RequestAdapter,
  CliRequestAdapter,
  HttpRequestAdapter,
  LambdaRequestAdapter,
  VercelRequestAdapter,
  CloudflareRequestAdapter,
  createAdapter,
} from './core/adapters.js';

// Core - Formatters
export {
  formatCliResponse,
  formatHttpResponse,
  formatLambdaResponse,
  formatCloudflareResponse,
  formatError,
  type CliOutputOptions,
} from './core/formatters.js';

// Config
export type {
  DeploymentConfig,
  ServerConfig,
  ExecutionConfig,
  SecretsConfig,
  CorsConfig,
  RetryConfig,
  PartialDeploymentConfig,
  CliConfigOverrides,
} from './config/types.js';

export {
  DEFAULT_CONFIG,
  DEFAULT_SERVER_CONFIG,
  DEFAULT_EXECUTION_CONFIG,
  getDefaultConfig,
} from './config/defaults.js';

export { loadConfig, loadConfigSync, getConfigValue } from './config/loader.js';

// OpenAPI
export {
  OpenAPIGenerator,
  generateOpenAPIJson,
  generateOpenAPIYaml,
  type OpenAPIDocument,
  type OpenAPIInfo,
  type OpenAPIServer,
  type GeneratorOptions,
} from './openapi/generator.js';

export {
  SchemaConverter,
  schemaConverter,
  type OpenAPISchema,
} from './openapi/schema-converter.js';

// Export Targets
export {
  type ExportTarget,
  type ExportOptions,
  type ExportArtifacts,
  type GeneratedFile,
  type DeployInstructions,
  type DeploySchema,
  type DeploySchemaField,
  BaseExportTarget,
  ExportTargetRegistry,
} from './targets/base.js';

export { LambdaTarget } from './targets/lambda.js';
export { VercelTarget } from './targets/vercel.js';
export { CloudflareTarget } from './targets/cloudflare.js';
export { InngestTarget } from './targets/inngest.js';
export { GitHubActionsTarget } from './targets/github-actions.js';
export { GitLabCITarget } from './targets/gitlab-ci.js';
export { BaseCICDTarget, NODE_ACTION_MAP } from './targets/cicd-base.js';

// Convenience: Create a pre-configured target registry
import { ExportTargetRegistry } from './targets/base.js';
import { LambdaTarget } from './targets/lambda.js';
import { VercelTarget } from './targets/vercel.js';
import { CloudflareTarget } from './targets/cloudflare.js';
import { InngestTarget } from './targets/inngest.js';
import { GitHubActionsTarget } from './targets/github-actions.js';
import { GitLabCITarget } from './targets/gitlab-ci.js';

/**
 * Default export target registry with all built-in targets.
 *
 * All targets are registered as lazy factories — they're only instantiated
 * when first accessed via registry.get(). This avoids eagerly constructing
 * all 6 targets when only one is needed.
 */
export function createTargetRegistry(): ExportTargetRegistry {
  const registry = new ExportTargetRegistry();
  registry.register('lambda', () => new LambdaTarget());
  registry.register('vercel', () => new VercelTarget());
  registry.register('cloudflare', () => new CloudflareTarget());
  registry.register('inngest', () => new InngestTarget());
  registry.register('github-actions', () => new GitHubActionsTarget());
  registry.register('gitlab-ci', () => new GitLabCITarget());
  return registry;
}

/**
 * Get names of all supported export targets
 */
export function getSupportedTargetNames(): string[] {
  return ['lambda', 'vercel', 'cloudflare', 'inngest', 'github-actions', 'gitlab-ci'];
}
