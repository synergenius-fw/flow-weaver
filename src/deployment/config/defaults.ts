/**
 * Default configuration values for the deployment system
 */

import type { DeploymentConfig, ServerConfig, ExecutionConfig, SecretsConfig } from './types.js';

/**
 * Default server configuration
 */
export const DEFAULT_SERVER_CONFIG: ServerConfig = {
  port: 3000,
  host: '0.0.0.0',
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    headers: ['Content-Type', 'Authorization', 'X-Request-Id'],
    credentials: false,
  },
  swagger: false,
  watch: true,
};

/**
 * Default execution configuration
 */
export const DEFAULT_EXECUTION_CONFIG: ExecutionConfig = {
  timeout: 30000,
  includeTrace: true,
  maxConcurrent: 10,
  retry: {
    maxRetries: 0,
    initialDelay: 100,
    maxDelay: 5000,
    backoffMultiplier: 2,
  },
};

/**
 * Default secrets configuration
 */
export const DEFAULT_SECRETS_CONFIG: SecretsConfig = {
  fromEnv: [],
  files: ['.env', '.env.local'],
};

/**
 * Default deployment configuration
 */
export const DEFAULT_CONFIG: DeploymentConfig = {
  environment: 'development',
  server: DEFAULT_SERVER_CONFIG,
  execution: DEFAULT_EXECUTION_CONFIG,
  secrets: DEFAULT_SECRETS_CONFIG,
};

/**
 * Production configuration overrides
 */
export const PRODUCTION_OVERRIDES: Partial<DeploymentConfig> = {
  environment: 'production',
  server: {
    ...DEFAULT_SERVER_CONFIG,
    watch: false,
    cors: {
      ...DEFAULT_SERVER_CONFIG.cors,
      origin: [], // Must be explicitly configured in production
    },
  },
  execution: {
    ...DEFAULT_EXECUTION_CONFIG,
    includeTrace: false,
    timeout: 60000,
  },
};

/**
 * Get default configuration for a given environment
 */
export function getDefaultConfig(
  environment: 'development' | 'staging' | 'production'
): DeploymentConfig {
  if (environment === 'production') {
    return {
      ...DEFAULT_CONFIG,
      ...PRODUCTION_OVERRIDES,
      server: {
        ...DEFAULT_CONFIG.server,
        ...PRODUCTION_OVERRIDES.server,
      },
      execution: {
        ...DEFAULT_CONFIG.execution,
        ...PRODUCTION_OVERRIDES.execution,
      },
    };
  }

  if (environment === 'staging') {
    return {
      ...DEFAULT_CONFIG,
      environment: 'staging',
      execution: {
        ...DEFAULT_CONFIG.execution,
        includeTrace: true, // Keep traces in staging for debugging
      },
    };
  }

  return DEFAULT_CONFIG;
}
