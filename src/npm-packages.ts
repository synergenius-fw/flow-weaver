/**
 * NPM Package Type Resolution
 *
 * Functions for discovering and extracting type information from npm packages
 * that have TypeScript declaration files (.d.ts).
 */

import * as path from 'node:path';
import * as fs from 'node:fs';
import { resolvePackageTypesPath } from './resolve-package-types';
import { extractFunctionLikes, type FunctionLike } from './function-like';
import { inferDataTypeFromTS } from './type-mappings';
import type { TDataType } from './ast/types';
import { getSharedProject } from './shared-project';

/**
 * Port definition compatible with TNodeType.ports
 */
export type TNpmPackagePort = {
  name: string;
  defaultLabel?: string;
  reference?: string;
  type: TDataType;
  direction: 'INPUT' | 'OUTPUT';
  scope?: string;
};

/**
 * Node type for npm package functions
 */
export type TNpmNodeType = {
  name: string;
  variant: 'FUNCTION';
  category: string;
  function: string;
  label: string;
  importSource: string;
  ports: TNpmPackagePort[];
  synchronicity: 'SYNC' | 'ASYNC';
  description: string;
};

/**
 * Find all node_modules directories starting from fromDir and walking up.
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
 * List all packages in a node_modules directory (including scoped packages).
 */
function listPackagesInNodeModules(nmDir: string): string[] {
  const packages: string[] = [];

  if (!fs.existsSync(nmDir)) return packages;

  try {
    const entries = fs.readdirSync(nmDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      // Handle scoped packages (@scope/pkg)
      if (entry.name.startsWith('@')) {
        const scopeDir = path.join(nmDir, entry.name);
        try {
          const scopedEntries = fs.readdirSync(scopeDir, { withFileTypes: true });
          for (const scopedEntry of scopedEntries) {
            if (scopedEntry.isDirectory()) {
              packages.push(`${entry.name}/${scopedEntry.name}`);
            }
          }
        } catch {
          // Ignore permission errors
        }
      } else {
        // Regular package
        packages.push(entry.name);
      }
    }
  } catch {
    // Ignore permission errors
  }

  return packages;
}

/**
 * Get list of packages that have TypeScript declarations (.d.ts files).
 * Excludes @types/* packages as they are type augmentations.
 *
 * @param workdir - Directory to start searching from
 * @param nodeModulesOverride - Optional explicit node_modules path (for testing)
 * @returns Object with packages array, each containing name and typesPath
 */
export function getTypedPackages(
  workdir: string,
  nodeModulesOverride?: string
): { packages: Array<{ name: string; typesPath: string | null }> } {
  const nodeModulesDirs = nodeModulesOverride
    ? [nodeModulesOverride]
    : findNodeModulesDirs(workdir);

  const typed: Array<{ name: string; typesPath: string | null }> = [];
  const seenPackages = new Set<string>();

  for (const nmDir of nodeModulesDirs) {
    const packages = listPackagesInNodeModules(nmDir);

    for (const pkg of packages) {
      // Skip @types/* packages - they are type augmentations, not actual packages
      if (pkg.startsWith('@types/')) continue;

      // Skip if already seen (from a closer node_modules)
      if (seenPackages.has(pkg)) continue;
      seenPackages.add(pkg);

      // Check if package has types
      const typesPath = resolvePackageTypesPath(pkg, workdir, nodeModulesOverride);
      if (typesPath) {
        typed.push({ name: pkg, typesPath });
      }
    }
  }

  return { packages: typed };
}

/**
 * Capitalize first letter of a string.
 */
function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Infer node type from a function declaration in a .d.ts file.
 */
function inferNodeTypeFromDtsFunction(
  fn: FunctionLike,
  packageName: string,
  _dtsPath: string
): TNpmNodeType | null {
  const fnName = fn.getName();
  if (!fnName) return null;

  const ports: TNpmPackagePort[] = [];

  // Add execute input port (mandatory)
  ports.push({
    name: 'execute',
    defaultLabel: 'Execute',
    reference: 'execute',
    type: 'STEP',
    direction: 'INPUT',
  });

  // Infer inputs from parameters
  for (const param of fn.getParameters()) {
    const paramName = param.getName();
    const tsType = param.getType().getText(param);
    const dataType = inferDataTypeFromTS(tsType);

    ports.push({
      name: paramName,
      defaultLabel: capitalize(paramName),
      reference: paramName,
      type: dataType,
      direction: 'INPUT',
    });
  }

  // Infer outputs from return type
  let returnType = fn.getReturnType();
  const returnTypeText = returnType.getText();
  let isAsync = false;

  // Unwrap Promise<T>
  if (returnTypeText.startsWith('Promise<')) {
    isAsync = true;
    const typeArgs = returnType.getTypeArguments();
    if (typeArgs && typeArgs.length > 0) {
      returnType = typeArgs[0];
    }
  }

  const unwrappedText = returnType.getText();

  if (unwrappedText !== 'void' && unwrappedText !== 'undefined') {
    const primitiveTypes = new Set(['string', 'number', 'boolean', 'any', 'unknown', 'never']);
    const isPrimitive = primitiveTypes.has(unwrappedText);
    const isArray = unwrappedText.endsWith('[]') || unwrappedText.startsWith('Array<');

    const properties = returnType.getProperties();
    const isObjectLike =
      !isPrimitive && !isArray && returnType.isObject() && properties.length > 0;

    if (isObjectLike) {
      // Multiple output ports from object properties
      for (const prop of properties) {
        const propName = prop.getName();
        if (propName === 'onSuccess' || propName === 'onFailure') continue;
        const propType = prop.getTypeAtLocation(fn.getTypeResolutionNode());
        const propTypeText = propType.getText();
        const dataType = inferDataTypeFromTS(propTypeText);

        ports.push({
          name: propName,
          defaultLabel: capitalize(propName),
          reference: propName,
          type: dataType,
          direction: 'OUTPUT',
        });
      }
    } else {
      // Single result output port
      const dataType = inferDataTypeFromTS(unwrappedText);
      ports.push({
        name: 'result',
        defaultLabel: 'Result',
        reference: 'result',
        type: dataType,
        direction: 'OUTPUT',
      });
    }
  }

  // Add mandatory control flow output ports
  ports.push({
    name: 'onSuccess',
    defaultLabel: 'On Success',
    reference: 'onSuccess',
    type: 'STEP',
    direction: 'OUTPUT',
  });

  ports.push({
    name: 'onFailure',
    defaultLabel: 'On Failure',
    reference: 'onFailure',
    type: 'STEP',
    direction: 'OUTPUT',
  });

  return {
    name: `npm/${packageName}/${fnName}`,
    variant: 'FUNCTION',
    category: 'NPM Packages',
    function: fnName,
    label: fnName,
    importSource: packageName,
    ports,
    synchronicity: isAsync ? 'ASYNC' : 'SYNC',
    description: `${fnName} from ${packageName}`,
  };
}

/**
 * Get function exports from a package's .d.ts file and return as TNodeType[].
 *
 * @param packageName - The npm package name
 * @param workdir - Directory to start searching from
 * @param nodeModulesOverride - Optional explicit node_modules path (for testing)
 * @returns Array of node types for the package's exported functions
 */
export function getPackageExports(
  packageName: string,
  workdir: string,
  nodeModulesOverride?: string
): TNpmNodeType[] {
  const typesPath = resolvePackageTypesPath(packageName, workdir, nodeModulesOverride);
  if (!typesPath) {
    return [];
  }

  try {
    const project = getSharedProject();
    const dtsContent = fs.readFileSync(typesPath, 'utf-8');

    // Create source file with unique path to avoid conflicts
    const virtualPath = `__npm_exports__/${packageName}/${Date.now()}.d.ts`;
    const dtsFile = project.createSourceFile(virtualPath, dtsContent, { overwrite: true });

    const functions = extractFunctionLikes(dtsFile);
    const nodeTypes: TNpmNodeType[] = [];
    const seenFunctionNames = new Set<string>();

    for (const fn of functions) {
      const fnName = fn.getName();
      // Skip duplicates (can happen with re-exports or declaration merging)
      if (!fnName || seenFunctionNames.has(fnName)) continue;
      seenFunctionNames.add(fnName);

      const nodeType = inferNodeTypeFromDtsFunction(fn, packageName, typesPath);
      if (nodeType) {
        nodeTypes.push(nodeType);
      }
    }

    // Clean up the temporary source file
    project.removeSourceFile(dtsFile);

    return nodeTypes;
  } catch {
    return [];
  }
}
