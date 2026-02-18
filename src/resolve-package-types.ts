import * as path from 'node:path';
import * as fs from 'node:fs';

/**
 * Resolve a package specifier to the absolute path of its `.d.ts` type declarations.
 *
 * Resolution order:
 * 1. Find `node_modules/<pkg>/package.json` and read `types` or `typings` field
 * 2. Check `exports` field for types (modern packages use conditional exports)
 * 3. Fall back to `@types/<pkg>/index.d.ts`
 * 4. Fall back to `<pkg>/index.d.ts`
 * 5. Return `null` if nothing found
 *
 * @param packageSpecifier - The npm package name (e.g., 'date-fns', '@scope/pkg')
 * @param fromDir - Directory to start searching from (walks up to find node_modules)
 * @param nodeModulesOverride - Optional explicit node_modules path (for testing)
 * @returns Absolute path to the `.d.ts` file, or null
 */
export function resolvePackageTypesPath(
  packageSpecifier: string,
  fromDir: string,
  nodeModulesOverride?: string
): string | null {
  const nodeModulesDirs = nodeModulesOverride
    ? [nodeModulesOverride]
    : findNodeModulesDirs(fromDir);

  for (const nmDir of nodeModulesDirs) {
    const result = resolveInNodeModules(packageSpecifier, nmDir);
    if (result) return result;
  }

  return null;
}

/**
 * Walk up from `fromDir` collecting all `node_modules` directories.
 */
function findNodeModulesDirs(fromDir: string): string[] {
  const dirs: string[] = [];
  let current = path.resolve(fromDir);
  const root = path.parse(current).root;

  while (current !== root) {
    const candidate = path.join(current, 'node_modules');
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      dirs.push(candidate);
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return dirs;
}

/**
 * Resolve types path from the exports field in package.json.
 * Handles conditional exports like: { ".": { "types": "./lib/index.d.ts" } }
 */
function resolveExportsTypes(exports: unknown, pkgDir: string): string | null {
  if (typeof exports !== 'object' || exports === null) return null;

  const exportsObj = exports as Record<string, unknown>;

  // Check root export "."
  const root = exportsObj['.'];
  if (root && typeof root === 'object' && root !== null) {
    const rootObj = root as Record<string, unknown>;
    if (typeof rootObj.types === 'string') {
      const typesPath = path.resolve(pkgDir, rootObj.types);
      if (fs.existsSync(typesPath)) {
        return typesPath;
      }
    }
  }

  // Check direct types field in exports (less common but valid)
  if (typeof exportsObj.types === 'string') {
    const typesPath = path.resolve(pkgDir, exportsObj.types);
    if (fs.existsSync(typesPath)) {
      return typesPath;
    }
  }

  return null;
}

/**
 * Try to resolve a package's .d.ts within a single node_modules directory.
 */
function resolveInNodeModules(packageSpecifier: string, nmDir: string): string | null {
  // Extract the bare package name (without sub-path) for scoped packages
  const pkgDir = path.join(nmDir, packageSpecifier);

  // 1. Check package.json types/typings field
  const pkgJsonPath = path.join(pkgDir, 'package.json');
  if (fs.existsSync(pkgJsonPath)) {
    try {
      const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
      const typesField = pkgJson.types || pkgJson.typings;
      if (typesField) {
        const typesPath = path.resolve(pkgDir, typesField);
        if (fs.existsSync(typesPath)) {
          return typesPath;
        }
      }

      // 1b. Check exports field for types (modern packages)
      if (pkgJson.exports) {
        const exportsTypesPath = resolveExportsTypes(pkgJson.exports, pkgDir);
        if (exportsTypesPath) {
          return exportsTypesPath;
        }
      }
    } catch {
      // ignore malformed package.json
    }
  }

  // 2. Fall back to @types/<pkg>/index.d.ts
  // For scoped packages @scope/pkg, DefinitelyTyped uses @types/scope__pkg
  // but also check the plain name for non-scoped packages
  const atTypesName = packageSpecifier.startsWith('@')
    ? packageSpecifier.replace('@', '').replace('/', '__')
    : packageSpecifier;
  const atTypesPath = path.join(nmDir, '@types', atTypesName, 'index.d.ts');
  if (fs.existsSync(atTypesPath)) {
    return atTypesPath;
  }

  // 3. Fall back to <pkg>/index.d.ts
  const indexDtsPath = path.join(pkgDir, 'index.d.ts');
  if (fs.existsSync(indexDtsPath)) {
    return indexDtsPath;
  }

  return null;
}
