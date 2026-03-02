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

// Target implementations — still exported for direct use by pack authors and tests
export { LambdaTarget } from './targets/lambda.js';
export { VercelTarget } from './targets/vercel.js';
export { CloudflareTarget } from './targets/cloudflare.js';
export { InngestTarget } from './targets/inngest.js';
export { GitHubActionsTarget } from './targets/github-actions.js';
export { GitLabCITarget } from './targets/gitlab-ci.js';
export { BaseCICDTarget, NODE_ACTION_MAP } from './targets/cicd-base.js';

import * as path from 'path';
import { ExportTargetRegistry } from './targets/base.js';

/**
 * Create an export target registry via marketplace discovery.
 *
 * Scans `node_modules/` for installed `flowweaver-pack-*` packages that
 * declare `exportTargets` in their `flowweaver.manifest.json`.
 * Each target class is eagerly imported (to resolve the async import) but
 * lazily instantiated — the constructor only runs when `registry.get()` is called.
 *
 * @param projectDir — project root to scan for installed packs.
 *   When omitted, returns an empty registry (useful for tests).
 */
export async function createTargetRegistry(projectDir?: string): Promise<ExportTargetRegistry> {
  const registry = new ExportTargetRegistry();

  if (projectDir) {
    const { listInstalledPackages } = await import('../marketplace/registry.js');
    const packages = await listInstalledPackages(projectDir);
    for (const pkg of packages) {
      for (const def of pkg.manifest.exportTargets ?? []) {
        const filePath = path.join(pkg.path, def.file);
        // Dynamic import is async, so we resolve the module here
        // but defer instantiation to the lazy factory
        const mod = await import(filePath);
        const TargetClass = def.exportName ? mod[def.exportName] : mod.default;
        registry.register(def.name, () => new TargetClass());
      }
    }
  }

  return registry;
}
