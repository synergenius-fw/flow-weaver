/**
 * Pointing a pack's src/ imports at its dist/ build.
 *
 * Marketplace packs ship TypeScript source for parsing and compiled
 * JavaScript under dist/. When a workflow runs from a pack's src/, a
 * relative import with no file under src/ but one under dist/ is rewritten
 * to the dist/ file, so the ESM resolver finds compiled code.
 */
import * as fs from 'node:fs';
import * as nodePath from 'node:path';

/**
 * Rewrite the relative imports of transpiled code that sits in `srcDir`.
 * Only a directory under a `src` segment is touched, and only an import
 * whose src file is missing while its dist file exists. The specifier is
 * written with forward slashes, which ESM requires on every platform.
 *
 * @param fileExists The file system check; tests pass their own.
 * @param path The path module; tests pass `path.win32` for Windows paths.
 */
export function rewriteSrcImportsToDist(
  code: string,
  srcDir: string,
  fileExists: (p: string) => boolean = fs.existsSync,
  path: typeof nodePath = nodePath,
): string {
  const srcSegment = `${path.sep}src${path.sep}`;
  if (!`${srcDir}${path.sep}`.includes(srcSegment)) return code;
  return code.replace(/from\s+['"](\.[^'"]+)['"]/g, (match, specifier: string) => {
    const resolvedSrc = path.resolve(srcDir, specifier);
    if (fileExists(resolvedSrc)) return match;
    const distEquivalent = resolvedSrc.replace(srcSegment, `${path.sep}dist${path.sep}`);
    if (!fileExists(distEquivalent)) return match;
    const relative = path.relative(srcDir, distEquivalent).replace(/\\/g, '/');
    return `from '${relative.startsWith('.') ? relative : `./${relative}`}'`;
  });
}
