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
  BaseExportTarget,
  ExportTargetRegistry,
} from './targets/base.js';

export { LambdaTarget } from './targets/lambda.js';
export { VercelTarget } from './targets/vercel.js';
export { CloudflareTarget } from './targets/cloudflare.js';
export { InngestTarget } from './targets/inngest.js';

// Convenience: Create a pre-configured target registry
import { ExportTargetRegistry } from './targets/base.js';
import { LambdaTarget } from './targets/lambda.js';
import { VercelTarget } from './targets/vercel.js';
import { CloudflareTarget } from './targets/cloudflare.js';
import { InngestTarget } from './targets/inngest.js';

/**
 * Default export target registry with all built-in targets
 */
export function createTargetRegistry(): ExportTargetRegistry {
  const registry = new ExportTargetRegistry();
  registry.register(new LambdaTarget());
  registry.register(new VercelTarget());
  registry.register(new CloudflareTarget());
  registry.register(new InngestTarget());
  return registry;
}

/**
 * Get names of all supported export targets
 */
export function getSupportedTargetNames(): string[] {
  return ['lambda', 'vercel', 'cloudflare', 'inngest'];
}
