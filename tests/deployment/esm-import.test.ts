/**
 * Tests that dynamic imports use pathToFileURL for Windows compatibility.
 *
 * On Windows, bare `import('/absolute/path')` fails because Node treats
 * drive letters like `C:` as URL protocols. The fix is wrapping with
 * `pathToFileURL(path).href` before passing to `import()`.
 *
 * Since we can't test actual Windows paths on macOS, these are source-level
 * assertions that verify the fix is in place.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const SRC_ROOT = path.resolve(__dirname, '../../src');

describe('Windows ESM import compatibility', () => {
  it('deployment/index.ts uses pathToFileURL for dynamic imports', () => {
    const source = fs.readFileSync(path.join(SRC_ROOT, 'deployment/index.ts'), 'utf8');
    expect(source).toContain("import { pathToFileURL } from 'url'");
    // Should NOT have bare import(filePath) — must use pathToFileURL
    expect(source).toContain('pathToFileURL(filePath).href');
    expect(source).not.toMatch(/await import\(filePath\)/);
  });

  it('deployment/config/loader.ts uses pathToFileURL for dynamic imports', () => {
    const source = fs.readFileSync(path.join(SRC_ROOT, 'deployment/config/loader.ts'), 'utf8');
    expect(source).toContain("import { pathToFileURL } from 'url'");
    expect(source).toContain('pathToFileURL(absolutePath).href');
    expect(source).not.toMatch(/await import\(absolutePath\)/);
  });

  it('mcp/workflow-executor.ts already uses pathToFileURL (reference)', () => {
    const source = fs.readFileSync(path.join(SRC_ROOT, 'mcp/workflow-executor.ts'), 'utf8');
    expect(source).toContain("import { pathToFileURL } from 'url'");
    expect(source).toContain('pathToFileURL(tmpFile).href');
  });
});
