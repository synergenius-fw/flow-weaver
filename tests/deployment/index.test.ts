/**
 * Tests for src/deployment/index.ts.
 * Verifies all re-exports resolve, and tests the factory functions
 * createTargetRegistry() and getSupportedTargetNames().
 */
import { describe, it, expect } from 'vitest';

describe('deployment module re-exports', () => {
  it('exports createExecutor and ExecutorOptions', async () => {
    const mod = await import('../../src/deployment/index');
    expect(mod.createExecutor).toBeDefined();
    expect(typeof mod.createExecutor).toBe('function');
    expect(mod.UnifiedWorkflowExecutor).toBeDefined();
  });

  it('exports adapter classes and createAdapter', async () => {
    const mod = await import('../../src/deployment/index');
    expect(mod.CliRequestAdapter).toBeDefined();
    expect(mod.HttpRequestAdapter).toBeDefined();
    expect(mod.LambdaRequestAdapter).toBeDefined();
    expect(mod.VercelRequestAdapter).toBeDefined();
    expect(mod.CloudflareRequestAdapter).toBeDefined();
    expect(typeof mod.createAdapter).toBe('function');
  });

  it('exports formatter functions', async () => {
    const mod = await import('../../src/deployment/index');
    expect(typeof mod.formatCliResponse).toBe('function');
    expect(typeof mod.formatHttpResponse).toBe('function');
    expect(typeof mod.formatLambdaResponse).toBe('function');
    expect(typeof mod.formatCloudflareResponse).toBe('function');
    expect(typeof mod.formatError).toBe('function');
  });

  it('exports config defaults', async () => {
    const mod = await import('../../src/deployment/index');
    expect(mod.DEFAULT_CONFIG).toBeDefined();
    expect(mod.DEFAULT_SERVER_CONFIG).toBeDefined();
    expect(mod.DEFAULT_EXECUTION_CONFIG).toBeDefined();
    expect(typeof mod.getDefaultConfig).toBe('function');
  });

  it('exports config loader functions', async () => {
    const mod = await import('../../src/deployment/index');
    expect(typeof mod.loadConfig).toBe('function');
    expect(typeof mod.loadConfigSync).toBe('function');
    expect(typeof mod.getConfigValue).toBe('function');
  });

  it('exports OpenAPI generator', async () => {
    const mod = await import('../../src/deployment/index');
    expect(mod.OpenAPIGenerator).toBeDefined();
    expect(typeof mod.generateOpenAPIJson).toBe('function');
    expect(typeof mod.generateOpenAPIYaml).toBe('function');
  });

  it('exports SchemaConverter', async () => {
    const mod = await import('../../src/deployment/index');
    expect(mod.SchemaConverter).toBeDefined();
    expect(mod.schemaConverter).toBeDefined();
  });

  it('exports target classes', async () => {
    const mod = await import('../../src/deployment/index');
    expect(mod.LambdaTarget).toBeDefined();
    expect(mod.VercelTarget).toBeDefined();
    expect(mod.CloudflareTarget).toBeDefined();
    expect(mod.InngestTarget).toBeDefined();
    expect(mod.BaseExportTarget).toBeDefined();
    expect(mod.ExportTargetRegistry).toBeDefined();
  });
});

describe('createTargetRegistry', () => {
  it('returns a registry with all four built-in targets', async () => {
    const { createTargetRegistry } = await import('../../src/deployment/index');
    const registry = createTargetRegistry();

    expect(registry.get('lambda')).toBeDefined();
    expect(registry.get('vercel')).toBeDefined();
    expect(registry.get('cloudflare')).toBeDefined();
    expect(registry.get('inngest')).toBeDefined();

    const names = registry.getNames();
    expect(names).toContain('lambda');
    expect(names).toContain('vercel');
    expect(names).toContain('cloudflare');
    expect(names).toContain('inngest');
    expect(names).toHaveLength(4);
  });

  it('each target has a name and description', async () => {
    const { createTargetRegistry } = await import('../../src/deployment/index');
    const registry = createTargetRegistry();

    for (const target of registry.getAll()) {
      expect(target.name).toBeTruthy();
      expect(target.description).toBeTruthy();
      expect(typeof target.generate).toBe('function');
      expect(typeof target.getDeployInstructions).toBe('function');
    }
  });

  it('returns a fresh registry each time', async () => {
    const { createTargetRegistry } = await import('../../src/deployment/index');
    const a = createTargetRegistry();
    const b = createTargetRegistry();
    expect(a).not.toBe(b);
  });

  it('registry.get returns undefined for unknown target', async () => {
    const { createTargetRegistry } = await import('../../src/deployment/index');
    const registry = createTargetRegistry();
    expect(registry.get('nonexistent')).toBeUndefined();
  });
});

describe('getSupportedTargetNames', () => {
  it('returns the four supported target names', async () => {
    const { getSupportedTargetNames } = await import('../../src/deployment/index');
    const names = getSupportedTargetNames();

    expect(names).toEqual(['lambda', 'vercel', 'cloudflare', 'inngest']);
  });

  it('returns a new array each time', async () => {
    const { getSupportedTargetNames } = await import('../../src/deployment/index');
    const a = getSupportedTargetNames();
    const b = getSupportedTargetNames();
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });
});
