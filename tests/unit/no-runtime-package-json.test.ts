/**
 * Ensures dist/ never contains runtime require('../../package.json') calls.
 *
 * Background: The compile.ts module previously used createRequire to read
 * package.json at runtime for the compiler version. This breaks in bundled
 * environments (Next.js standalone Docker builds) where the package.json
 * file is not traced/included. The fix is to inject the version at build
 * time via a generated file.
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.resolve(__dirname, '..', '..', 'dist');

function collectJsFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectJsFiles(full));
    } else if (entry.name.endsWith('.js')) {
      results.push(full);
    }
  }
  return results;
}

// Skip entirely when dist/ hasn't been built (e.g. in a worktree or fresh clone).
// The guard still runs in CI after `npm run build`.
const files = collectJsFiles(distDir);

describe.skipIf(files.length === 0)('dist/ should not contain runtime package.json requires', () => {

  it('should not use require() or createRequire() to load package.json', () => {
    const violations: string[] = [];

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8');
      // Match patterns like: require('../../package.json') or require("../package.json")
      if (/require\s*\(\s*['"][^'"]*package\.json['"]\s*\)/.test(content)) {
        violations.push(path.relative(distDir, file));
      }
    }

    expect(violations).toEqual([]);
  });

  it('should not import createRequire from node:module', () => {
    const violations: string[] = [];

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8');
      if (/from\s+['"]node:module['"]/.test(content) || /require\s*\(\s*['"]node:module['"]\s*\)/.test(content)) {
        violations.push(path.relative(distDir, file));
      }
    }

    expect(violations).toEqual([]);
  });
});
