/**
 * Configuration loader
 *
 * Loads configuration from files, environment variables, and CLI arguments,
 * merging them in order of precedence.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'js-yaml';
import type { DeploymentConfig, PartialDeploymentConfig, CliConfigOverrides } from './types.js';
import { DEFAULT_CONFIG, getDefaultConfig } from './defaults.js';
import type { Environment } from '../types.js';

/**
 * Configuration file names to search for
 */
const CONFIG_FILE_NAMES = ['flow-weaver.config.ts', 'flow-weaver.config.yaml'];

/**
 * Environment variable prefix
 */
const ENV_PREFIX = 'FW_';

/**
 * Load configuration with the following precedence (highest to lowest):
 * 1. CLI arguments
 * 2. Environment variables
 * 3. Config file
 * 4. Default values
 */
export async function loadConfig(
  cliOverrides?: CliConfigOverrides,
  configPath?: string
): Promise<DeploymentConfig> {
  // Start with environment-specific defaults
  const environment = detectEnvironment(cliOverrides);
  let config = getDefaultConfig(environment);

  // Load config file if it exists
  const fileConfig = await loadConfigFile(configPath);
  if (fileConfig) {
    config = mergeConfig(config, fileConfig);
  }

  // Apply environment variable overrides
  const envConfig = loadEnvConfig();
  config = mergeConfig(config, envConfig);

  // Apply CLI overrides (highest precedence)
  if (cliOverrides) {
    const cliConfig = convertCliOverrides(cliOverrides);
    config = mergeConfig(config, cliConfig);
  }

  return config;
}

/**
 * Detect environment from CLI, env vars, or defaults
 */
function detectEnvironment(cliOverrides?: CliConfigOverrides): Environment {
  // CLI override takes precedence
  if (cliOverrides?.env) {
    return cliOverrides.env;
  }

  // Check environment variables
  const envValue = process.env[`${ENV_PREFIX}ENV`] || process.env.NODE_ENV;
  if (envValue) {
    if (envValue === 'production' || envValue === 'prod') {
      return 'production';
    }
    if (envValue === 'staging' || envValue === 'stage') {
      return 'staging';
    }
  }

  return 'development';
}

/**
 * Load configuration from file
 */
async function loadConfigFile(configPath?: string): Promise<PartialDeploymentConfig | null> {
  // If a specific path is provided, try to load it
  if (configPath) {
    return loadConfigFromPath(configPath);
  }

  // Search for config file in current directory
  const cwd = process.cwd();
  for (const fileName of CONFIG_FILE_NAMES) {
    const configFilePath = path.join(cwd, fileName);
    if (fs.existsSync(configFilePath)) {
      return loadConfigFromPath(configFilePath);
    }
  }

  return null;
}

/**
 * Load configuration from a specific file path
 */
async function loadConfigFromPath(filePath: string): Promise<PartialDeploymentConfig | null> {
  const absolutePath = path.resolve(filePath);

  if (!fs.existsSync(absolutePath)) {
    return null;
  }

  const ext = path.extname(absolutePath);

  // YAML files
  if (ext === '.yaml' || ext === '.yml') {
    try {
      const content = fs.readFileSync(absolutePath, 'utf8');
      return YAML.load(content) as PartialDeploymentConfig;
    } catch {
      return null;
    }
  }

  // TypeScript files - dynamic import
  if (ext === '.ts') {
    try {
      const module = await import(absolutePath);
      return (module.default || module) as PartialDeploymentConfig;
    } catch {
      // Config file loading failed, skip it
      return null;
    }
  }

  return null;
}

/**
 * Load configuration from environment variables
 */
function loadEnvConfig(): PartialDeploymentConfig {
  const config: PartialDeploymentConfig = {};

  // Server config
  const port = process.env[`${ENV_PREFIX}PORT`];
  const host = process.env[`${ENV_PREFIX}HOST`];
  const cors = process.env[`${ENV_PREFIX}CORS_ORIGIN`];

  if (port || host || cors) {
    config.server = {};
    if (port) config.server.port = parseInt(port, 10);
    if (host) config.server.host = host;
    if (cors) config.server.cors = { origin: cors };
  }

  // Execution config
  const timeout = process.env[`${ENV_PREFIX}TIMEOUT`];
  const trace = process.env[`${ENV_PREFIX}TRACE`];

  if (timeout || trace) {
    config.execution = {};
    if (timeout) config.execution.timeout = parseInt(timeout, 10);
    if (trace) config.execution.includeTrace = trace === 'true' || trace === '1';
  }

  return config;
}

/**
 * Convert CLI overrides to partial config
 */
function convertCliOverrides(overrides: CliConfigOverrides): PartialDeploymentConfig {
  const config: PartialDeploymentConfig = {};

  if (overrides.env) {
    config.environment = overrides.env;
  }

  // Server overrides
  if (
    overrides.port ||
    overrides.host ||
    overrides.cors ||
    overrides.watch !== undefined ||
    overrides.swagger !== undefined
  ) {
    config.server = {};
    if (overrides.port) config.server.port = overrides.port;
    if (overrides.host) config.server.host = overrides.host;
    if (overrides.cors) config.server.cors = { origin: overrides.cors };
    if (overrides.watch !== undefined) config.server.watch = overrides.watch;
    if (overrides.swagger !== undefined) config.server.swagger = overrides.swagger;
  }

  // Execution overrides
  if (overrides.timeout || overrides.trace !== undefined || overrides.production !== undefined) {
    config.execution = {};
    if (overrides.timeout) config.execution.timeout = overrides.timeout;
    if (overrides.trace !== undefined) config.execution.includeTrace = overrides.trace;
    if (overrides.production) config.execution.includeTrace = false;
  }

  return config;
}

/**
 * Deep merge two configuration objects
 */
function mergeConfig(base: DeploymentConfig, override: PartialDeploymentConfig): DeploymentConfig {
  return {
    environment: override.environment ?? base.environment,
    server: {
      ...base.server,
      ...override.server,
      cors: {
        ...base.server.cors,
        ...(override.server?.cors || {}),
      },
    },
    execution: {
      ...base.execution,
      ...override.execution,
      retry: {
        ...(base.execution.retry || {}),
        ...(override.execution?.retry || {}),
      },
    },
    secrets: {
      ...base.secrets,
      ...override.secrets,
    },
  } as DeploymentConfig;
}

/**
 * Synchronous config loading (for simpler use cases)
 */
export function loadConfigSync(cliOverrides?: CliConfigOverrides): DeploymentConfig {
  const environment = detectEnvironment(cliOverrides);
  let config = getDefaultConfig(environment);

  // Apply environment variable overrides
  const envConfig = loadEnvConfig();
  config = mergeConfig(config, envConfig);

  // Apply CLI overrides
  if (cliOverrides) {
    const cliConfig = convertCliOverrides(cliOverrides);
    config = mergeConfig(config, cliConfig);
  }

  return config;
}

/**
 * Get a specific config value with fallback to default
 */
export function getConfigValue<K extends keyof DeploymentConfig>(
  key: K,
  config?: Partial<DeploymentConfig>
): DeploymentConfig[K] {
  if (config && config[key] !== undefined) {
    return config[key] as DeploymentConfig[K];
  }
  return DEFAULT_CONFIG[key];
}
