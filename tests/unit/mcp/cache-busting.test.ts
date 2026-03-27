/**
 * Tests that the workflow executor's import rewriting adds cache-busting
 * query parameters when redirecting src/ imports to dist/ equivalents.
 *
 * This prevents Node's ESM module cache from serving stale pack code
 * after a pack upgrade via npm install.
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('Executor import cache-busting', () => {
  let packRoot: string;
  let srcDir: string;
  let distDir: string;

  beforeEach(() => {
    packRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-cache-bust-'));
    srcDir = path.join(packRoot, 'src', 'workflows');
    distDir = path.join(packRoot, 'dist', 'node-types');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.mkdirSync(distDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(packRoot, { recursive: true, force: true });
  });

  /**
   * Simulate the executor's import rewriting logic (extracted from workflow-executor.ts lines 146-171).
   * This is a faithful copy so we can test the regex + fs checks in isolation.
   */
  function rewriteImports(transpiledCode: string, srcDirPath: string): string {
    if (!srcDirPath.includes(`${path.sep}src${path.sep}`)) return transpiledCode;

    return transpiledCode.replace(
      /from\s+['"](\.[^'"]+)['"]/g,
      (_match, specifier: string) => {
        const resolvedSrc = path.resolve(srcDirPath, specifier);
        if (!fs.existsSync(resolvedSrc)) {
          const distEquivalent = resolvedSrc.replace(
            `${path.sep}src${path.sep}`,
            `${path.sep}dist${path.sep}`,
          );
          if (fs.existsSync(distEquivalent)) {
            const relative = path.relative(srcDirPath, distEquivalent);
            const posixRelative = relative.replace(/\\/g, '/');
            const normalized = posixRelative.startsWith('.') ? posixRelative : `./${posixRelative}`;
            return `from '${normalized}?v=${Date.now()}'`;
          }
        }
        return _match;
      },
    );
  }

  it('rewrites src/ imports to dist/ with ?v= cache-bust when dist file exists', () => {
    // Create the dist file
    fs.writeFileSync(path.join(distDir, 'my-node.js'), 'export default 42;');

    const input = `import { myNode } from '../node-types/my-node.js';`;
    const result = rewriteImports(input, srcDir);

    // Should be rewritten to point to dist and have ?v=
    expect(result).toMatch(/from '\.\.\/\.\.\/dist\/node-types\/my-node\.js\?v=\d+'/);
    expect(result).not.toContain('src/node-types');
  });

  it('does NOT rewrite when source file exists (prefers src)', () => {
    // Create both src and dist files
    const srcNodeDir = path.join(packRoot, 'src', 'node-types');
    fs.mkdirSync(srcNodeDir, { recursive: true });
    fs.writeFileSync(path.join(srcNodeDir, 'local.js'), 'export default 1;');
    fs.writeFileSync(path.join(distDir, 'local.js'), 'export default 2;');

    const input = `import { local } from '../node-types/local.js';`;
    const result = rewriteImports(input, srcDir);

    // Should NOT rewrite — src file exists
    expect(result).toBe(input);
  });

  it('does NOT rewrite when dist file does not exist', () => {
    // No file in dist/
    const input = `import { missing } from '../node-types/missing.js';`;
    const result = rewriteImports(input, srcDir);

    // Should NOT rewrite — no dist equivalent
    expect(result).toBe(input);
  });

  it('does NOT rewrite when srcDir is not under src/', () => {
    const nonSrcDir = path.join(packRoot, 'other', 'workflows');
    fs.mkdirSync(nonSrcDir, { recursive: true });

    const input = `import { foo } from '../node-types/foo.js';`;
    const result = rewriteImports(input, nonSrcDir);

    // Should not rewrite at all
    expect(result).toBe(input);
  });

  it('each call produces a different ?v= timestamp (cache invalidation)', () => {
    fs.writeFileSync(path.join(distDir, 'versioned.js'), 'export default 1;');

    const input = `import { versioned } from '../node-types/versioned.js';`;
    const result1 = rewriteImports(input, srcDir);

    // Small delay to ensure Date.now() differs
    const before = Date.now();
    while (Date.now() === before) { /* busy-wait 1ms */ }

    const result2 = rewriteImports(input, srcDir);

    // Both should have ?v= but with different timestamps
    const v1 = result1.match(/\?v=(\d+)/)?.[1];
    const v2 = result2.match(/\?v=(\d+)/)?.[1];
    expect(v1).toBeDefined();
    expect(v2).toBeDefined();
    expect(v1).not.toBe(v2);
  });

  it('handles multiple imports in the same file', () => {
    fs.writeFileSync(path.join(distDir, 'a.js'), 'export const a = 1;');
    fs.writeFileSync(path.join(distDir, 'b.js'), 'export const b = 2;');

    const input = [
      `import { a } from '../node-types/a.js';`,
      `import { b } from '../node-types/b.js';`,
    ].join('\n');

    const result = rewriteImports(input, srcDir);

    expect(result).toMatch(/from '.*dist\/node-types\/a\.js\?v=\d+'/);
    expect(result).toMatch(/from '.*dist\/node-types\/b\.js\?v=\d+'/);
    expect(result).not.toContain('src/node-types');
  });

  it('preserves non-relative imports (bare specifiers)', () => {
    fs.writeFileSync(path.join(distDir, 'local.js'), 'export default 1;');

    const input = [
      `import { something } from 'some-package';`,
      `import { local } from '../node-types/local.js';`,
    ].join('\n');

    const result = rewriteImports(input, srcDir);

    // Bare specifier untouched
    expect(result).toContain(`from 'some-package'`);
    // Relative import rewritten
    expect(result).toMatch(/from '.*dist\/node-types\/local\.js\?v=\d+'/);
  });

  it('handles double-quoted imports', () => {
    fs.writeFileSync(path.join(distDir, 'dq.js'), 'export default 1;');

    const input = `import { dq } from "../node-types/dq.js";`;
    const result = rewriteImports(input, srcDir);

    expect(result).toMatch(/from '.*dist\/node-types\/dq\.js\?v=\d+'/);
  });
});
