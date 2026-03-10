/**
 * Tests that the executor's import path rewriting normalizes backslashes
 * to forward slashes for cross-platform ESM compatibility.
 *
 * On Windows, path.relative() returns backslash-separated paths. When these
 * are written into generated .mjs files as ESM import specifiers, Node.js
 * fails to parse them. The fix applies .replace(/\\/g, '/') before writing
 * the import path into the generated output.
 */

import * as path from 'path';

describe('ESM import path normalization', () => {
  // Isolated test of the normalization logic extracted from workflow-executor.ts.
  // This mirrors lines 160-162 of src/mcp/workflow-executor.ts.
  function rewriteImportPath(srcDir: string, distEquivalent: string): string {
    const relative = path.relative(srcDir, distEquivalent);
    const posixRelative = relative.replace(/\\/g, '/');
    const normalized = posixRelative.startsWith('.') ? posixRelative : `./${posixRelative}`;
    return `from '${normalized}'`;
  }

  it('produces forward slashes from a Unix-style relative path', () => {
    const srcDir = '/project/src/workflows';
    const distFile = '/project/dist/node-types/upper.js';
    const result = rewriteImportPath(srcDir, distFile);
    expect(result).not.toContain('\\');
    expect(result).toMatch(/^from '\.\.\//);
    expect(result).toContain('upper.js');
  });

  it('normalizes backslashes in simulated Windows relative paths', () => {
    // Simulate what path.relative would return on Windows by manually
    // constructing a backslash-separated path and running the normalization.
    const windowsRelative = '..\\..\\dist\\node-types\\load-config.js';
    const posixRelative = windowsRelative.replace(/\\/g, '/');
    const normalized = posixRelative.startsWith('.') ? posixRelative : `./${posixRelative}`;

    expect(normalized).toBe('../../dist/node-types/load-config.js');
    expect(normalized).not.toContain('\\');
  });

  it('prepends ./ when relative path does not start with a dot', () => {
    // On some path configurations, path.relative may return a path
    // that doesn't start with '..' or './'
    const relative = 'dist/node-types/upper.js';
    const posixRelative = relative.replace(/\\/g, '/');
    const normalized = posixRelative.startsWith('.') ? posixRelative : `./${posixRelative}`;

    expect(normalized).toBe('./dist/node-types/upper.js');
  });

  it('preserves relative paths that already use forward slashes', () => {
    const result = rewriteImportPath(
      '/project/src/workflows',
      '/project/dist/node-types/upper.js',
    );
    expect(result).not.toContain('\\');
    expect(result).toMatch(/from '\.\.?\//);
  });

  it('handles deeply nested paths', () => {
    const srcDir = '/project/src/packs/my-pack/src/workflows';
    const distFile = '/project/src/packs/my-pack/dist/node-types/helpers/format.js';
    const result = rewriteImportPath(srcDir, distFile);
    expect(result).not.toContain('\\');
    expect(result).toContain('format.js');
  });

  it('handles paths at the same directory level', () => {
    const srcDir = '/project/src';
    const distFile = '/project/src/sibling.js';
    const result = rewriteImportPath(srcDir, distFile);
    expect(result).not.toContain('\\');
    expect(result).toContain('sibling.js');
  });

  it('produces valid ESM from syntax that mirrors the executor regex', () => {
    // The executor uses: /from\s+['"](\.[^'"]+)['"]/g
    // Verify that our normalized output matches this pattern.
    const result = rewriteImportPath(
      '/project/src/workflows',
      '/project/dist/node-types/upper.js',
    );
    const esmRegex = /^from '(\.[^']+)'$/;
    expect(result).toMatch(esmRegex);
  });

  describe('Windows path simulation', () => {
    // These tests directly verify the .replace(/\\\\/g, '/') fix works on
    // paths that contain backslashes, without requiring an actual Windows host.

    const windowsPaths = [
      { input: '..\\..\\dist\\node-types\\load-config.js', expected: '../../dist/node-types/load-config.js' },
      { input: '..\\utils\\helper.js', expected: '../utils/helper.js' },
      { input: 'dist\\index.js', expected: './dist/index.js' },
      { input: '..\\..\\..\\shared\\types.js', expected: '../../../shared/types.js' },
    ];

    for (const { input, expected } of windowsPaths) {
      it(`normalizes "${input}" to "${expected}"`, () => {
        const posixRelative = input.replace(/\\/g, '/');
        const normalized = posixRelative.startsWith('.') ? posixRelative : `./${posixRelative}`;
        expect(normalized).toBe(expected);
      });
    }
  });

  describe('mixed separator paths', () => {
    it('normalizes paths with mixed forward and back slashes', () => {
      const mixed = '..\\dist/node-types\\upper.js';
      const posixRelative = mixed.replace(/\\/g, '/');
      const normalized = posixRelative.startsWith('.') ? posixRelative : `./${posixRelative}`;
      expect(normalized).toBe('../dist/node-types/upper.js');
    });
  });

  describe('generated ESM import statement validation', () => {
    it('produces a syntactically valid ESM import for a simple path', () => {
      const result = rewriteImportPath('/src/workflows', '/dist/types/config.js');
      // Should look like: from '../../dist/types/config.js'
      expect(result).toMatch(/^from '\.\.\//);
      expect(result).not.toContain('\\');
    });

    it('produces a syntactically valid ESM import for a parent-relative path', () => {
      const result = rewriteImportPath(
        '/project/src/deep/workflows',
        '/project/dist/shallow/types.js',
      );
      expect(result).toMatch(/^from '\.\.\//);
      expect(result).not.toContain('\\');
      expect(result).toContain('types.js');
    });
  });
});
