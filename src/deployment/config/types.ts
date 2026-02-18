/**
 * Configuration types for the deployment system
 */

import type { Environment } from '../types.js';

/**
 * Complete deployment configuration
 */
export interface DeploymentConfig {
  /** Runtime environment */
  environment: Environment;

  /** Server configuration */
  server: ServerConfig;

  /** Execution configuration */
  execution: ExecutionConfig;

  /** Secrets and environment variable configuration */
  secrets: SecretsConfig;
}

/**
 * Server configuration options
 */
export interface ServerConfig {
  /** Port to listen on */
  port: number;
  /** Host to bind to */
  host: string;
  /** CORS configuration */
  cors: CorsConfig;
  /** Enable Swagger UI */
  swagger: boolean;
  /** Enable file watching for hot reload */
  watch: boolean;
}

/**
 * CORS configuration
 */
export interface CorsConfig {
  /** Allowed origins (string or array of strings) */
  origin: string | string[];
  /** Allowed methods */
  methods?: string[];
  /** Allowed headers */
  headers?: string[];
  /** Expose headers */
  exposeHeaders?: string[];
  /** Allow credentials */
  credentials?: boolean;
  /** Max age for preflight cache */
  maxAge?: number;
}

/**
 * Execution configuration
 */
export interface ExecutionConfig {
  /** Default timeout in milliseconds */
  timeout: number;
  /** Include execution trace by default */
  includeTrace: boolean;
  /** Maximum concurrent executions */
  maxConcurrent?: number;
  /** Retry configuration */
  retry?: RetryConfig;
}

/**
 * Retry configuration
 */
export interface RetryConfig {
  /** Maximum number of retries */
  maxRetries: number;
  /** Initial delay in milliseconds */
  initialDelay: number;
  /** Maximum delay in milliseconds */
  maxDelay: number;
  /** Backoff multiplier */
  backoffMultiplier: number;
}

/**
 * Secrets and environment variable configuration
 */
export interface SecretsConfig {
  /** Environment variables to inject into execution context */
  fromEnv: string[];
  /** .env files to load */
  files: string[];
}

/**
 * Partial configuration for merging
 */
export type PartialDeploymentConfig = {
  environment?: Environment;
  server?: Partial<ServerConfig>;
  execution?: Partial<ExecutionConfig>;
  secrets?: Partial<SecretsConfig>;
};

/**
 * CLI argument overrides
 */
export interface CliConfigOverrides {
  /** Override port */
  port?: number;
  /** Override host */
  host?: string;
  /** Override environment */
  env?: Environment;
  /** Override CORS origin */
  cors?: string;
  /** Override timeout */
  timeout?: number;
  /** Override trace inclusion */
  trace?: boolean;
  /** Override file watching */
  watch?: boolean;
  /** Enable swagger */
  swagger?: boolean;
  /** Production mode */
  production?: boolean;
}
