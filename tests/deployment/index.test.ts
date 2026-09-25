/**
 * Tests for src/deployment/index.ts.
 * Verifies all re-exports resolve and tests the async createTargetRegistry()
 * factory with marketplace pack discovery.
 */
import { describe, it, expect } from 'vitest';

describe('deployment module re-exports', () => {
  it('exports base target classes and the registry factory', async () => {
    const mod = await import('../../src/deployment/index');
    expect(mod.BaseExportTarget).toBeDefined();
    expect(mod.ExportTargetRegistry).toBeDefined();
    expect(typeof mod.createTargetRegistry).toBe('function');
  });

  it('no longer exports the executor, config loader or OpenAPI generator (the server replaced them)', async () => {
    const mod = await import('../../src/deployment/index');
    expect((mod as any).createExecutor).toBeUndefined();
    expect((mod as any).UnifiedWorkflowExecutor).toBeUndefined();
    expect((mod as any).loadConfig).toBeUndefined();
    expect((mod as any).DEFAULT_CONFIG).toBeUndefined();
    expect((mod as any).OpenAPIGenerator).toBeUndefined();
    expect((mod as any).generateOpenAPIJson).toBeUndefined();
    expect((mod as any).generateStandaloneRuntimeModule).toBeUndefined();
  });

  it('does not export target classes or their base (moved to marketplace packs)', async () => {
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
