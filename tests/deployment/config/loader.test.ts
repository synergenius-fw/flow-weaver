/**
 * Tests for configuration loader
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { loadConfig, loadConfigSync, getConfigValue } from '../../../src/deployment/config/loader';
import { DEFAULT_CONFIG } from '../../../src/deployment/config/defaults';
import type { DeploymentConfig } from '../../../src/deployment/config/types';

const tempDir = path.join(os.tmpdir(), `fw-config-test-${process.pid}`);

beforeEach(() => {
  fs.mkdirSync(tempDir, { recursive: true });
  // Clear relevant env vars
  delete process.env.FW_PORT;
  delete process.env.FW_HOST;
  delete process.env.FW_ENV;
  delete process.env.FW_TIMEOUT;
  delete process.env.FW_TRACE;
  delete process.env.FW_CORS_ORIGIN;
  delete process.env.NODE_ENV;
});

afterEach(() => {
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // Ignore
  }
});

describe('loadConfigSync', () => {
  it('should return default config when no overrides', () => {
    const config = loadConfigSync();

    expect(config.environment).toBe('development');
    expect(config.server.port).toBe(DEFAULT_CONFIG.server.port);
    expect(config.server.host).toBe(DEFAULT_CONFIG.server.host);
    expect(config.execution.timeout).toBe(DEFAULT_CONFIG.execution.timeout);
  });

  it('should apply CLI port override', () => {
    const config = loadConfigSync({ port: 8080 });

    expect(config.server.port).toBe(8080);
  });

  it('should apply CLI host override', () => {
    const config = loadConfigSync({ host: 'localhost' });

    expect(config.server.host).toBe('localhost');
  });

  it('should apply CLI environment override', () => {
    const config = loadConfigSync({ env: 'production' });

    expect(config.environment).toBe('production');
  });

  it('should apply CLI cors override', () => {
    const config = loadConfigSync({ cors: 'https://example.com' });

    expect(config.server.cors.origin).toBe('https://example.com');
  });

  it('should apply CLI timeout override', () => {
    const config = loadConfigSync({ timeout: 60000 });

    expect(config.execution.timeout).toBe(60000);
  });

  it('should apply CLI trace override', () => {
    const config = loadConfigSync({ trace: false });

    expect(config.execution.includeTrace).toBe(false);
  });

  it('should apply production mode', () => {
    const config = loadConfigSync({ production: true });

    expect(config.execution.includeTrace).toBe(false);
  });

  it('should apply watch override', () => {
    const config = loadConfigSync({ watch: false });

    expect(config.server.watch).toBe(false);
  });

  it('should apply swagger override', () => {
    const config = loadConfigSync({ swagger: true });

    expect(config.server.swagger).toBe(true);
  });
});

describe('environment variable loading', () => {
  it('should load FW_PORT from environment', () => {
    process.env.FW_PORT = '9000';
    const config = loadConfigSync();

    expect(config.server.port).toBe(9000);
  });

  it('should load FW_HOST from environment', () => {
    process.env.FW_HOST = '127.0.0.1';
    const config = loadConfigSync();

    expect(config.server.host).toBe('127.0.0.1');
  });

  it('should load FW_TIMEOUT from environment', () => {
    process.env.FW_TIMEOUT = '45000';
    const config = loadConfigSync();

    expect(config.execution.timeout).toBe(45000);
  });

  it('should load FW_TRACE from environment', () => {
    process.env.FW_TRACE = 'false';
    const config = loadConfigSync();

    expect(config.execution.includeTrace).toBe(false);
  });

  it('should load FW_CORS_ORIGIN from environment', () => {
    process.env.FW_CORS_ORIGIN = 'https://allowed.com';
    const config = loadConfigSync();

    expect(config.server.cors.origin).toBe('https://allowed.com');
  });

  it('should load FW_ENV from environment', () => {
    process.env.FW_ENV = 'staging';
    const config = loadConfigSync();

    expect(config.environment).toBe('staging');
  });

  it('should CLI override environment variables', () => {
    process.env.FW_PORT = '9000';
    const config = loadConfigSync({ port: 7000 });

    expect(config.server.port).toBe(7000);
  });
});

describe('environment detection', () => {
  it('should detect production from NODE_ENV', () => {
    process.env.NODE_ENV = 'production';
    const config = loadConfigSync();

    expect(config.environment).toBe('production');
  });

  it('should detect staging from NODE_ENV', () => {
    process.env.NODE_ENV = 'staging';
    const config = loadConfigSync();

    expect(config.environment).toBe('staging');
  });

  it('should default to development', () => {
    const config = loadConfigSync();

    expect(config.environment).toBe('development');
  });

  it('should FW_ENV override NODE_ENV', () => {
    process.env.NODE_ENV = 'production';
    process.env.FW_ENV = 'staging';
    const config = loadConfigSync();

    expect(config.environment).toBe('staging');
  });
});

describe('getConfigValue', () => {
  it('should return config value when provided', () => {
    const value = getConfigValue('environment', { environment: 'staging' });
    expect(value).toBe('staging');
  });

  it('should return default when not provided', () => {
    const value = getConfigValue('environment', {});
    expect(value).toBe(DEFAULT_CONFIG.environment);
  });

  it('should return default when config is undefined', () => {
    const value = getConfigValue('environment', undefined);
    expect(value).toBe(DEFAULT_CONFIG.environment);
  });

  it('should handle nested config', () => {
    const value = getConfigValue('server', { server: { port: 9000 } } as Partial<DeploymentConfig>);
    expect(value.port).toBe(9000);
  });
});

describe('production config defaults', () => {
  it('should have trace disabled in production', () => {
    const config = loadConfigSync({ env: 'production' });

    expect(config.execution.includeTrace).toBe(false);
  });

  it('should have watch disabled in production', () => {
    const config = loadConfigSync({ env: 'production' });

    expect(config.server.watch).toBe(false);
  });

  it('should have longer timeout in production', () => {
    const config = loadConfigSync({ env: 'production' });

    expect(config.execution.timeout).toBe(60000);
  });
});

describe('loadConfig (async)', () => {
  it('should return default config when no overrides', async () => {
    const config = await loadConfig();

    expect(config.environment).toBe('development');
    expect(config.server.port).toBe(DEFAULT_CONFIG.server.port);
  });

  it('should apply CLI overrides with highest precedence', async () => {
    process.env.FW_PORT = '9000';
    const config = await loadConfig({ port: 4000 });

    expect(config.server.port).toBe(4000);
  });

  it('should apply env var overrides over defaults', async () => {
    process.env.FW_HOST = '10.0.0.1';
    const config = await loadConfig();

    expect(config.server.host).toBe('10.0.0.1');
  });

  it('should load YAML config file', async () => {
    const yamlPath = path.join(tempDir, 'config.yaml');
    fs.writeFileSync(
      yamlPath,
      `server:
  port: 5555
  host: yaml-host
execution:
  timeout: 12345
`
    );

    const config = await loadConfig(undefined, yamlPath);

    expect(config.server.port).toBe(5555);
    expect(config.server.host).toBe('yaml-host');
    expect(config.execution.timeout).toBe(12345);
  });

  it('should load YML config file', async () => {
    const ymlPath = path.join(tempDir, 'config.yml');
    fs.writeFileSync(
      ymlPath,
      `server:
  port: 6666
`
    );

    const config = await loadConfig(undefined, ymlPath);

    expect(config.server.port).toBe(6666);
  });

  it('should return null for non-existent config path', async () => {
    const config = await loadConfig(undefined, '/nonexistent/path/config.yaml');

    // Should fall back to defaults when file does not exist
    expect(config.environment).toBe('development');
    expect(config.server.port).toBe(DEFAULT_CONFIG.server.port);
  });

  it('should handle malformed YAML gracefully', async () => {
    const yamlPath = path.join(tempDir, 'bad.yaml');
    fs.writeFileSync(yamlPath, '}{not: yaml: at: all');

    const config = await loadConfig(undefined, yamlPath);

    // Falls back to defaults
    expect(config.server.port).toBe(DEFAULT_CONFIG.server.port);
  });

  it('should return defaults for unknown file extension', async () => {
    const jsonPath = path.join(tempDir, 'config.json');
    fs.writeFileSync(jsonPath, JSON.stringify({ server: { port: 7777 } }));

    const config = await loadConfig(undefined, jsonPath);

    // .json is not a supported extension, so defaults apply
    expect(config.server.port).toBe(DEFAULT_CONFIG.server.port);
  });

  it('should handle TS config file that fails to import', async () => {
    const tsPath = path.join(tempDir, 'broken.ts');
    fs.writeFileSync(tsPath, 'this is not valid typescript export default {');

    const config = await loadConfig(undefined, tsPath);

    // TS import fails silently, defaults apply
    expect(config.server.port).toBe(DEFAULT_CONFIG.server.port);
  });

  it('should apply CLI environment override to base defaults', async () => {
    const config = await loadConfig({ env: 'production' });

    expect(config.environment).toBe('production');
    expect(config.execution.includeTrace).toBe(false);
    expect(config.server.watch).toBe(false);
  });

  it('should merge YAML config with env var overrides', async () => {
    const yamlPath = path.join(tempDir, 'config.yaml');
    fs.writeFileSync(
      yamlPath,
      `server:
  port: 4000
`
    );

    process.env.FW_HOST = 'env-host';

    const config = await loadConfig(undefined, yamlPath);

    expect(config.server.port).toBe(4000);
    expect(config.server.host).toBe('env-host');
  });

  it('should have CLI > env > file > defaults precedence', async () => {
    const yamlPath = path.join(tempDir, 'config.yaml');
    fs.writeFileSync(
      yamlPath,
      `server:
  port: 1111
`
    );

    process.env.FW_PORT = '2222';

    const config = await loadConfig({ port: 3333 }, yamlPath);

    // CLI wins over env wins over file
    expect(config.server.port).toBe(3333);
  });
});

describe('environment detection - additional cases', () => {
  it('should detect production from NODE_ENV=prod', () => {
    process.env.NODE_ENV = 'prod';
    const config = loadConfigSync();

    expect(config.environment).toBe('production');
  });

  it('should detect staging from NODE_ENV=stage', () => {
    process.env.NODE_ENV = 'stage';
    const config = loadConfigSync();

    expect(config.environment).toBe('staging');
  });

  it('should CLI env override FW_ENV', () => {
    process.env.FW_ENV = 'production';
    const config = loadConfigSync({ env: 'development' });

    expect(config.environment).toBe('development');
  });

  it('should default to development for unknown env value', () => {
    process.env.NODE_ENV = 'test';
    const config = loadConfigSync();

    expect(config.environment).toBe('development');
  });
});

describe('env var parsing edge cases', () => {
  it('should parse FW_TRACE=true as boolean true', () => {
    process.env.FW_TRACE = 'true';
    const config = loadConfigSync();

    expect(config.execution.includeTrace).toBe(true);
  });

  it('should parse FW_TRACE=1 as boolean true', () => {
    process.env.FW_TRACE = '1';
    const config = loadConfigSync();

    expect(config.execution.includeTrace).toBe(true);
  });

  it('should parse FW_TRACE=0 as boolean false', () => {
    process.env.FW_TRACE = '0';
    const config = loadConfigSync();

    expect(config.execution.includeTrace).toBe(false);
  });

  it('should parse FW_PORT as integer', () => {
    process.env.FW_PORT = '3456';
    const config = loadConfigSync();

    expect(config.server.port).toBe(3456);
    expect(typeof config.server.port).toBe('number');
  });

  it('should not set execution config when no execution env vars present', () => {
    // Only set server env vars
    process.env.FW_PORT = '5000';
    const config = loadConfigSync();

    // Execution should still have defaults (not be overwritten to undefined)
    expect(config.execution.timeout).toBe(DEFAULT_CONFIG.execution.timeout);
  });

  it('should not set server config when no server env vars present', () => {
    // Only set execution env vars
    process.env.FW_TIMEOUT = '10000';
    const config = loadConfigSync();

    // Server should still have defaults
    expect(config.server.port).toBe(DEFAULT_CONFIG.server.port);
  });
});

describe('deep merge behavior', () => {
  it('should preserve cors defaults when only overriding origin', async () => {
    const yamlPath = path.join(tempDir, 'cors.yaml');
    fs.writeFileSync(
      yamlPath,
      `server:
  cors:
    origin: "https://specific.com"
`
    );

    const config = await loadConfig(undefined, yamlPath);

    expect(config.server.cors.origin).toBe('https://specific.com');
    // Base cors properties should be preserved
    expect(config.server.cors.methods).toBeDefined();
  });

  it('should preserve retry defaults when overriding execution config', async () => {
    const yamlPath = path.join(tempDir, 'exec.yaml');
    fs.writeFileSync(
      yamlPath,
      `execution:
  timeout: 99999
`
    );

    const config = await loadConfig(undefined, yamlPath);

    expect(config.execution.timeout).toBe(99999);
    expect(config.execution.retry).toBeDefined();
    expect(config.execution.retry!.maxRetries).toBe(DEFAULT_CONFIG.execution.retry!.maxRetries);
  });

  it('should merge secrets config', async () => {
    const yamlPath = path.join(tempDir, 'secrets.yaml');
    fs.writeFileSync(
      yamlPath,
      `secrets:
  fromEnv:
    - API_KEY
    - SECRET
`
    );

    const config = await loadConfig(undefined, yamlPath);

    expect(config.secrets.fromEnv).toEqual(['API_KEY', 'SECRET']);
  });

  it('should preserve environment when only server is overridden', () => {
    const config = loadConfigSync({ port: 9999 });

    expect(config.environment).toBe('development');
    expect(config.server.port).toBe(9999);
  });
});

describe('getConfigValue - additional coverage', () => {
  it('should return server defaults when no config provided', () => {
    const value = getConfigValue('server');
    expect(value.port).toBe(DEFAULT_CONFIG.server.port);
    expect(value.host).toBe(DEFAULT_CONFIG.server.host);
  });

  it('should return execution defaults when no config provided', () => {
    const value = getConfigValue('execution');
    expect(value.timeout).toBe(DEFAULT_CONFIG.execution.timeout);
  });

  it('should return secrets defaults when no config provided', () => {
    const value = getConfigValue('secrets');
    expect(value).toEqual(DEFAULT_CONFIG.secrets);
  });
});

describe('staging config defaults', () => {
  it('should keep trace enabled in staging', () => {
    const config = loadConfigSync({ env: 'staging' });

    expect(config.execution.includeTrace).toBe(true);
  });

  it('should use staging environment string', () => {
    const config = loadConfigSync({ env: 'staging' });

    expect(config.environment).toBe('staging');
  });
});

describe('convertCliOverrides edge cases', () => {
  it('should not create server config when no server overrides', () => {
    const config = loadConfigSync({ env: 'development' });

    // env override alone should not modify server config from defaults
    expect(config.server.port).toBe(DEFAULT_CONFIG.server.port);
  });

  it('should not create execution config when no execution overrides', () => {
    const config = loadConfigSync({ port: 8080 });

    // port override alone should not modify execution config from defaults
    expect(config.execution.timeout).toBe(DEFAULT_CONFIG.execution.timeout);
  });

  it('should handle all server overrides at once', () => {
    const config = loadConfigSync({
      port: 4000,
      host: 'myhost',
      cors: 'https://cors.example.com',
      watch: true,
      swagger: true,
    });

    expect(config.server.port).toBe(4000);
    expect(config.server.host).toBe('myhost');
    expect(config.server.cors.origin).toBe('https://cors.example.com');
    expect(config.server.watch).toBe(true);
    expect(config.server.swagger).toBe(true);
  });

  it('should handle all execution overrides at once', () => {
    const config = loadConfigSync({
      timeout: 5000,
      trace: true,
    });

    expect(config.execution.timeout).toBe(5000);
    expect(config.execution.includeTrace).toBe(true);
  });

  it('should production override trace even when trace is true', () => {
    // production: true should force includeTrace to false
    const config = loadConfigSync({ production: true, trace: true });

    // production is checked after trace, so it wins
    expect(config.execution.includeTrace).toBe(false);
  });
});
