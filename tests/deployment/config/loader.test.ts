/**
 * Tests for configuration loader
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { loadConfigSync, getConfigValue } from '../../../src/deployment/config/loader';
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
