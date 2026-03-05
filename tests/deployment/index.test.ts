/**
 * Tests for src/deployment/index.ts.
 * Verifies all re-exports resolve and tests the async createTargetRegistry()
 * factory with marketplace pack discovery.
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
    expect(typeof mod.createAdapter).toBe('function');
  });

  it('exports formatter functions', async () => {
    const mod = await import('../../src/deployment/index');
    expect(typeof mod.formatCliResponse).toBe('function');
    expect(typeof mod.formatHttpResponse).toBe('function');
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

  it('exports base target classes', async () => {
    const mod = await import('../../src/deployment/index');
    expect(mod.BaseExportTarget).toBeDefined();
    expect(mod.ExportTargetRegistry).toBeDefined();
  });

  it('does not export target classes or CI/CD base (moved to extensions/cicd)', async () => {
    const mod = await import('../../src/deployment/index');
    expect((mod as any).BaseCICDTarget).toBeUndefined();
    expect((mod as any).LambdaTarget).toBeUndefined();
    expect((mod as any).VercelTarget).toBeUndefined();
    expect((mod as any).CloudflareTarget).toBeUndefined();
    expect((mod as any).InngestTarget).toBeUndefined();
    expect((mod as any).GitHubActionsTarget).toBeUndefined();
    expect((mod as any).GitLabCITarget).toBeUndefined();
  });
});

describe('createTargetRegistry', () => {
  it('returns an empty registry when called without a projectDir', async () => {
    const { createTargetRegistry } = await import('../../src/deployment/index');
    const registry = await createTargetRegistry();

    expect(registry.getNames()).toEqual([]);
    expect(registry.getAll()).toEqual([]);
  });

  it('returns a fresh registry each time', async () => {
    const { createTargetRegistry } = await import('../../src/deployment/index');
    const a = await createTargetRegistry();
    const b = await createTargetRegistry();
    expect(a).not.toBe(b);
  });

  it('registry.get returns undefined for unknown target', async () => {
    const { createTargetRegistry } = await import('../../src/deployment/index');
    const registry = await createTargetRegistry();
    expect(registry.get('nonexistent')).toBeUndefined();
  });

  it('get returns undefined for well-known names when no packs installed', async () => {
    const { createTargetRegistry } = await import('../../src/deployment/index');
    const registry = await createTargetRegistry();

    expect(registry.get('lambda')).toBeUndefined();
    expect(registry.get('vercel')).toBeUndefined();
    expect(registry.get('cloudflare')).toBeUndefined();
    expect(registry.get('inngest')).toBeUndefined();
    expect(registry.get('github-actions')).toBeUndefined();
    expect(registry.get('gitlab-ci')).toBeUndefined();
  });
});
