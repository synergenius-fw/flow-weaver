/**
 * Resilience tests: projectDir propagation, cross-OS path handling,
 * and platform-safe stub defaults.
 */
import { describe, it, expect, vi } from 'vitest';
import * as path from 'node:path';
import * as os from 'node:os';

// ── Patch 2: parseWorkflow calls must include projectDir ────────────

describe('parseWorkflow callers pass projectDir', () => {
  it('tools-export.ts passes projectDir derived from filePath', async () => {
    const src = await import('../../src/mcp/tools-export.js');
    const code = await import('fs').then(fs =>
      fs.readFileSync(
        path.resolve(__dirname, '../../src/mcp/tools-export.ts'),
        'utf-8',
      ),
    );
    // Every parseWorkflow call should include projectDir
    const calls = code.match(/parseWorkflow\([^)]+\)/g) || [];
    for (const call of calls) {
      expect(call).toContain('projectDir');
    }
    expect(calls.length).toBeGreaterThan(0);
  });

  it('tools-query.ts passes projectDir derived from filePath', async () => {
    const code = await import('fs').then(fs =>
      fs.readFileSync(
        path.resolve(__dirname, '../../src/mcp/tools-query.ts'),
        'utf-8',
      ),
    );
    const calls = code.match(/parseWorkflow\([^)]+\)/g) || [];
    for (const call of calls) {
      expect(call).toContain('projectDir');
    }
    expect(calls.length).toBeGreaterThan(0);
  });

  it('generator.ts passes projectDir derived from filePath', async () => {
    const code = await import('fs').then(fs =>
      fs.readFileSync(
        path.resolve(__dirname, '../../src/generator.ts'),
        'utf-8',
      ),
    );
    const calls = code.match(/parseWorkflow\([^)]+\)/g) || [];
    for (const call of calls) {
      expect(call).toContain('projectDir');
    }
    expect(calls.length).toBeGreaterThan(0);
  });
});

// ── Cross-OS: stubs.ts must not hardcode /tmp ───────────────────────

describe('stub handlers use os.tmpdir()', () => {
  it('getUserDataPath stub returns os.tmpdir()', async () => {
    const { stubHandlers } = await import('../../src/cli/tunnel/handlers/stubs.js');
    const result = await stubHandlers.getUserDataPath({} as any);
    expect(result).toBe(os.tmpdir());
  });

  it('getTempDirectory stub returns os.tmpdir()', async () => {
    const { stubHandlers } = await import('../../src/cli/tunnel/handlers/stubs.js');
    const result = await stubHandlers.getTempDirectory({} as any);
    expect(result).toBe(os.tmpdir());
  });
});

// ── Cross-OS: path-resolver backslash handling ──────────────────────

describe('resolvePath handles backslash paths', () => {
  // Import at module level works fine for sync functions
  let resolvePath: typeof import('../../src/cli/tunnel/path-resolver.js').resolvePath;
  let toVirtualPath: typeof import('../../src/cli/tunnel/path-resolver.js').toVirtualPath;

  beforeAll(async () => {
    const mod = await import('../../src/cli/tunnel/path-resolver.js');
    resolvePath = mod.resolvePath;
    toVirtualPath = mod.toVirtualPath;
  });

  it('strips \\cloud prefix (Windows-style)', () => {
    const root = '/workspace/project';
    // A Windows client might send backslash-prefixed paths
    const result = resolvePath(root, '\\cloud\\workflow.ts');
    expect(result).toBe(path.join(root, 'workflow.ts'));
  });

  it('strips leading backslashes', () => {
    const root = '/workspace/project';
    const result = resolvePath(root, '\\workflow.ts');
    expect(result).toBe(path.join(root, 'workflow.ts'));
  });

  it('toVirtualPath always uses forward slashes', () => {
    const root = '/workspace/project';
    const real = path.join(root, 'src', 'workflow.ts');
    const virtual = toVirtualPath(root, real);
    expect(virtual).not.toContain('\\');
    expect(virtual).toBe('/src/workflow.ts');
  });
});
