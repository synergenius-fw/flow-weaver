/**
 * How an import specifier in a workflow file becomes a file the parser reads.
 *
 * Decides which file a relative specifier points at (extension probing, the
 * ESM `.js` to `.ts` fallback, directory `package.json` main and index files),
 * which `.d.ts` a re-export in a package declaration points at, which
 * extensions can carry annotations at all, and how an in-memory source
 * override graph is loaded into the ts-morph Project before a parse.
 */
import type { Project } from 'ts-morph';
import ts from 'typescript';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { getErrorMessage } from '../utils/error-utils';

export type SourceImportResolver = (
  specifier: string,
  importer: string,
) => string | undefined;
export type SourceOverrideLoader = (filePath: string) => string | undefined;

/**
 * Extensions of files that can carry `@flowWeaver` annotations. A relative
 * import of anything else (`./data.json`, `./styles.css`) is application data
 * the workflow uses, not a node-type source, and is skipped by the parser.
 */
export const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs']);

/**
 * The file a relative `moduleSpecifier` in `currentDir` points at, or null.
 * A `package.json` that cannot be read while probing a directory is reported
 * to `warnings`.
 */
export function resolveModulePath(moduleSpecifier: string, currentDir: string, warnings?: string[]): string | null {
  const extensions = ['.ts', '.tsx', '.js', '.jsx'];

  // If already has extension, check if exists (with ESM .js → .ts fallback)
  const hasExtension = extensions.some((ext) => moduleSpecifier.endsWith(ext));
  if (hasExtension) {
    const fullPath = path.resolve(currentDir, moduleSpecifier);
    if (fs.existsSync(fullPath)) return fullPath;

    // ESM convention: TypeScript files use .js extensions in imports.
    // If the .js file doesn't exist, try the .ts/.tsx equivalent.
    if (moduleSpecifier.endsWith('.js')) {
      const tsPath = fullPath.replace(/\.js$/, '.ts');
      if (fs.existsSync(tsPath)) return tsPath;
      const tsxPath = fullPath.replace(/\.js$/, '.tsx');
      if (fs.existsSync(tsxPath)) return tsxPath;
    } else if (moduleSpecifier.endsWith('.jsx')) {
      const tsxPath = fullPath.replace(/\.jsx$/, '.tsx');
      if (fs.existsSync(tsxPath)) return tsxPath;
    }

    return null;
  }

  // Try each extension in order
  for (const ext of extensions) {
    const fullPath = path.resolve(currentDir, moduleSpecifier + ext);
    if (fs.existsSync(fullPath)) {
      return fullPath;
    }
  }

  // Try as directory with package.json main field or index file
  const dirPath = path.resolve(currentDir, moduleSpecifier);
  if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
    // Check package.json main field
    const pkgPath = path.join(dirPath, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        if (pkg.main) {
          const mainPath = path.resolve(dirPath, pkg.main);
          if (fs.existsSync(mainPath)) {
            return mainPath;
          }
        }
      } catch (e) {
        // Not a resolution: fall through to the index files, and say why.
        warnings?.push(`Could not read ${pkgPath} while resolving "${moduleSpecifier}": ${getErrorMessage(e)}`);
      }
    }

    // Try index files
    for (const ext of extensions) {
      const indexPath = path.join(dirPath, `index${ext}`);
      if (fs.existsSync(indexPath)) {
        return indexPath;
      }
    }
  }

  return null;
}

/**
 * Resolve a relative re-export specifier (as written in a `.d.ts`, which
 * commonly points at the compiled `.js`, e.g. `./node-types/index.js`) to
 * the matching `.d.ts` on disk. Tries the literal `.d.ts`, the `.js`->`.d.ts`
 * swap, and the `<dir>/index.d.ts` directory form.
 */
export function resolveReExportedDts(baseDir: string, spec: string): string | null {
  const noExt = spec.replace(/\.(js|mjs|cjs|jsx|ts|tsx)$/, '');
  const candidates = [
    path.resolve(baseDir, `${noExt}.d.ts`),
    path.resolve(baseDir, noExt, 'index.d.ts'),
    path.resolve(baseDir, spec), // already a .d.ts path
  ];
  for (const c of candidates) {
    if (c.endsWith('.d.ts') && fs.existsSync(c)) return c;
  }
  return null;
}

/**
 * Load every relative import of `source` that `sourceLoader` overrides into
 * `project`, depth first, so the virtual graph is in place before the
 * importer's types are read. `seen` guards cycles.
 */
export function preloadSourceOverrides(
  project: Project,
  importer: string,
  source: string,
  importResolver: SourceImportResolver | undefined,
  sourceLoader: SourceOverrideLoader,
  seen: Set<string>,
): void {
  const parsed = ts.createSourceFile(importer, source, ts.ScriptTarget.Latest, true);
  for (const statement of parsed.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    const specifier = statement.moduleSpecifier.text;
    if (!specifier.startsWith('.')) continue;
    const resolved = importResolver?.(specifier, importer)
      ?? resolveModulePath(specifier, path.dirname(importer));
    if (resolved === undefined || resolved === null || seen.has(resolved)) continue;
    const override = sourceLoader(resolved);
    if (override === undefined) continue;
    seen.add(resolved);
    preloadSourceOverrides(project, resolved, override, importResolver, sourceLoader, seen);
    project.createSourceFile(resolved, override, { overwrite: true });
  }
}
