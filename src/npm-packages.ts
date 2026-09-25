/**
 * NPM Package Type Resolution
 *
 * Functions for discovering and extracting type information from npm packages
 * that have TypeScript declaration files (.d.ts).
 */

import * as path from 'node:path';
import * as fs from 'node:fs';
import { findNodeModulesDirs, resolvePackageTypesPath } from './parser/resolve-package-types';
import { extractFunctionLikes, type FunctionLike } from './parser/function-like';
import { inferDataTypeFromTS } from './types/type-mappings';
import type { TDataType } from './ast/types';
import { getSharedProject } from './parser/shared-project';

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
  defaultOrder?: number;
  failure?: boolean;
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
 * List all packages in a node_modules directory (including scoped packages).
 */
function listPackagesInNodeModules(nmDir: string): string[] {
  const packages: string[] = [];

  if (!fs.existsSync(nmDir)) return packages;

  try {
    const entries = fs.readdirSync(nmDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

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
        packages.push(entry.name);
      }
    }
  } catch {
    // Ignore permission errors
  }

  return packages;
}

/**
 * Get list of all packages that have TypeScript declarations (.d.ts files).
 * Any package with types can be used as a node type in workflows.
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
      if (pkg.startsWith('@types/')) continue;

      if (seenPackages.has(pkg)) continue;
      seenPackages.add(pkg);

      const typesPath = resolvePackageTypesPath(pkg, workdir, nodeModulesOverride);
      if (typesPath) {
        typed.push({ name: pkg, typesPath });
      }
    }
  }

  return { packages: typed };
}

const PRIMITIVE_TYPES = new Set(['string', 'number', 'boolean', 'any', 'unknown', 'never']);

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Infer node type from a function declaration in a .d.ts file.
 */
function inferNodeTypeFromDtsFunction(
  fn: FunctionLike,
  packageName: string,
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
    defaultOrder: 0,
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

  if (unwrappedText !== 'void' && unwrappedText !== 'undefined' && unwrappedText !== 'never') {
    const isPrimitive = PRIMITIVE_TYPES.has(unwrappedText);
    const isArray = unwrappedText.endsWith('[]') || unwrappedText.startsWith('Array<');

    const properties = returnType.getProperties();
    const isObjectLike =
      !isPrimitive && !isArray && returnType.isObject() && properties.length > 0;

    const dataProps = isObjectLike
      ? properties.filter(p => p.getName() !== 'onSuccess' && p.getName() !== 'onFailure')
      : [];

    let dataOutputOrder = 2; // after onSuccess(0) and onFailure(1)
    if (isObjectLike && dataProps.length <= 8) {
      for (const prop of dataProps) {
        const propName = prop.getName();
        const propType = prop.getTypeAtLocation(fn.getTypeResolutionNode());
        ports.push({
          name: propName,
          defaultLabel: capitalize(propName),
          reference: propName,
          type: inferDataTypeFromTS(propType.getText()),
          direction: 'OUTPUT',
          defaultOrder: dataOutputOrder++,
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
        defaultOrder: dataOutputOrder++,
      });
    }
  }

  // Add mandatory control flow output ports (before data outputs)
  ports.push({
    name: 'onSuccess',
    defaultLabel: 'On Success',
    reference: 'onSuccess',
    type: 'STEP',
    direction: 'OUTPUT',
    defaultOrder: 0,
  });

  ports.push({
    name: 'onFailure',
    defaultLabel: 'On Failure',
    reference: 'onFailure',
    type: 'STEP',
    direction: 'OUTPUT',
    defaultOrder: 1,
    failure: true,
  });

  return {
    name: fnName,
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
 * Get callable exports from a package's .d.ts file and return as TNodeType[].
 *
 * Uses ts-morph's symbol-based export enumeration to handle all export
 * patterns: declare function, declare const with function types,
 * re-exports from submodules, star exports, etc.
 *
 * @param packageName - The npm package name
 * @param workdir - Directory to start searching from
 * @param nodeModulesOverride - Optional explicit node_modules path (for testing)
 * @returns Array of node types for the package's callable exports
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

    // Add the .d.ts file and nearby declaration files to the project so
    // ts-morph can resolve re-exports (including `export * from './submodule'`).
    const pkgDir = path.dirname(typesPath);
    const addedFiles: string[] = [];
    try {
      const globPattern = path.join(pkgDir, '**/*.d.{ts,cts,mts}');
      for (const file of project.addSourceFilesAtPaths(globPattern)) {
        addedFiles.push(file.getFilePath());
      }
    } catch {
      // Glob may fail on some filesystems; fall back to single file
    }

    let dtsFile = project.getSourceFile(typesPath);
    if (!dtsFile) {
      dtsFile = project.addSourceFileAtPath(typesPath);
    }

    const nodeTypes: TNpmNodeType[] = [];
    const seenFunctionNames = new Set<string>();

    // First pass: try symbol-based enumeration (handles re-exports, declare const, etc.)
    // Maximum data output ports before collapsing to a single "result" port
    const MAX_DATA_OUTPUT_PORTS = 8;

    const fileSymbol = dtsFile.getSymbol();
    if (fileSymbol) {
      for (const exportSymbol of fileSymbol.getExports()) {
        let exportName = exportSymbol.getName();
        if (seenFunctionNames.has(exportName)) continue;

        // Check if this export is callable (has call signatures)
        const exportType = exportSymbol.getTypeAtLocation(dtsFile);
        const callSignatures = exportType.getCallSignatures();
        if (callSignatures.length === 0) continue;

        // Handle export= (CJS): skip namespaces, include single functions
        if (exportName === 'export=') {
          // If the type has many non-call properties, it's a namespace (lodash)
          const props = exportType.getProperties().filter(p => !p.getName().startsWith('__'));
          if (props.length > 5) continue; // Namespace with many methods — skip

          // Try to get the real name from the declaration
          const decl = exportSymbol.getValueDeclaration();
          const declName = decl && 'getName' in decl ? (decl as any).getName?.() : undefined;
          if (declName && declName !== 'export=') {
            exportName = declName;
          } else {
            // Try aliased declarations
            const aliased = exportSymbol.getAliasedSymbol?.();
            const aliasedName = aliased?.getName();
            if (aliasedName && aliasedName !== 'export=' && aliasedName !== '__type') {
              exportName = aliasedName;
            } else {
              continue; // Can't determine a useful name — skip
            }
          }
        }

        // Handle default exports: resolve to the actual function name
        if (exportName === 'default') {
          const decl = exportSymbol.getValueDeclaration();
          const declName = decl && 'getName' in decl ? (decl as any).getName?.() : undefined;
          if (declName && declName !== 'default') {
            exportName = declName;
          } else {
            const aliased = exportSymbol.getAliasedSymbol?.();
            const aliasedName = aliased?.getName();
            if (aliasedName && aliasedName !== 'default' && aliasedName !== '__type') {
              exportName = aliasedName;
            }
            // If still "default", keep it — some packages genuinely have unnamed default exports
          }
        }

        if (seenFunctionNames.has(exportName)) continue;
        seenFunctionNames.add(exportName);

        // Use the first call signature to infer ports
        const sig = callSignatures[0];
        const ports: TNpmPackagePort[] = [];

        // Execute input port
        ports.push({
          name: 'execute', defaultLabel: 'Execute', reference: 'execute',
          type: 'STEP', direction: 'INPUT', defaultOrder: 0,
        });

        // Input ports from parameters
        let inputOrder = 1;
        for (const param of sig.getParameters()) {
          const paramName = param.getName();
          const paramType = param.getTypeAtLocation(dtsFile);
          const dataType = inferDataTypeFromTS(paramType.getText());
          ports.push({
            name: paramName, defaultLabel: capitalize(paramName), reference: paramName,
            type: dataType, direction: 'INPUT', defaultOrder: inputOrder++,
          });
        }

        // Output ports from return type
        let returnType = sig.getReturnType();
        const returnText = returnType.getText();
        let isAsync = false;

        if (returnText.startsWith('Promise<')) {
          isAsync = true;
          const typeArgs = returnType.getTypeArguments();
          if (typeArgs.length > 0) returnType = typeArgs[0];
        }

        // Step output ports first (control flow), then data outputs
        ports.push({
          name: 'onSuccess', defaultLabel: 'On Success', reference: 'onSuccess',
          type: 'STEP', direction: 'OUTPUT', defaultOrder: 0,
        });
        ports.push({
          name: 'onFailure', defaultLabel: 'On Failure', reference: 'onFailure',
          type: 'STEP', direction: 'OUTPUT', defaultOrder: 1, failure: true,
        });

        let outputOrder = 2;
        const unwrapped = returnType.getText();
        if (unwrapped !== 'void' && unwrapped !== 'undefined' && unwrapped !== 'never') {
          const isPrimitive = PRIMITIVE_TYPES.has(unwrapped);
          const isArray = unwrapped.endsWith('[]') || unwrapped.startsWith('Array<');
          const properties = returnType.getProperties();
          const isObjectLike = !isPrimitive && !isArray && returnType.isObject() && properties.length > 0;

          const dataProps = isObjectLike
            ? properties.filter(p => p.getName() !== 'onSuccess' && p.getName() !== 'onFailure')
            : [];

          if (isObjectLike && dataProps.length <= MAX_DATA_OUTPUT_PORTS) {
            for (const prop of dataProps) {
              const propName = prop.getName();
              const propType = prop.getTypeAtLocation(dtsFile);
              ports.push({
                name: propName, defaultLabel: capitalize(propName), reference: propName,
                type: inferDataTypeFromTS(propType.getText()), direction: 'OUTPUT', defaultOrder: outputOrder++,
              });
            }
          } else {
            // Single result port: either primitive/array, or object with too many properties
            ports.push({
              name: 'result', defaultLabel: 'Result', reference: 'result',
              type: inferDataTypeFromTS(unwrapped), direction: 'OUTPUT', defaultOrder: outputOrder++,
            });
          }
        }

        nodeTypes.push({
          name: exportName,
          variant: 'FUNCTION',
          category: 'NPM Packages',
          function: exportName,
          label: exportName,
          importSource: packageName,
          ports,
          synchronicity: isAsync ? 'ASYNC' : 'SYNC',
          description: `${exportName} from ${packageName}`,
        });
      }
    }

    // Follow star re-exports (`export * from './submodule'`) which the symbol
    // API surfaces as a single __export pseudo-symbol instead of individual names.
    for (const exportDecl of dtsFile.getExportDeclarations()) {
      if (!exportDecl.isNamespaceExport()) continue;
      const targetFile = exportDecl.getModuleSpecifierSourceFile();
      if (!targetFile) continue;

      const targetSymbol = targetFile.getSymbol();
      if (!targetSymbol) continue;

      for (const exportSymbol of targetSymbol.getExports()) {
        const exportName = exportSymbol.getName();
        if (seenFunctionNames.has(exportName)) continue;

        const exportType = exportSymbol.getTypeAtLocation(targetFile);
        const callSignatures = exportType.getCallSignatures();
        if (callSignatures.length === 0) continue;

        seenFunctionNames.add(exportName);
        const sig = callSignatures[0];
        const ports: TNpmPackagePort[] = [];

        ports.push({ name: 'execute', defaultLabel: 'Execute', reference: 'execute', type: 'STEP', direction: 'INPUT', defaultOrder: 0 });

        let starInputOrder = 1;
        for (const param of sig.getParameters()) {
          const paramName = param.getName();
          const paramType = param.getTypeAtLocation(targetFile);
          ports.push({
            name: paramName, defaultLabel: capitalize(paramName), reference: paramName,
            type: inferDataTypeFromTS(paramType.getText()), direction: 'INPUT', defaultOrder: starInputOrder++,
          });
        }

        let returnType = sig.getReturnType();
        const returnText = returnType.getText();
        let isAsync = false;
        if (returnText.startsWith('Promise<')) {
          isAsync = true;
          const typeArgs = returnType.getTypeArguments();
          if (typeArgs.length > 0) returnType = typeArgs[0];
        }

        ports.push({ name: 'onSuccess', defaultLabel: 'On Success', reference: 'onSuccess', type: 'STEP', direction: 'OUTPUT', defaultOrder: 0 });
        ports.push({ name: 'onFailure', defaultLabel: 'On Failure', reference: 'onFailure', type: 'STEP', direction: 'OUTPUT', defaultOrder: 1, failure: true });

        const unwrapped = returnType.getText();
        if (unwrapped !== 'void' && unwrapped !== 'undefined' && unwrapped !== 'never') {
          ports.push({ name: 'result', defaultLabel: 'Result', reference: 'result', type: inferDataTypeFromTS(unwrapped), direction: 'OUTPUT', defaultOrder: 2 });
        }

        nodeTypes.push({
          name: exportName,
          variant: 'FUNCTION',
          category: 'NPM Packages',
          function: exportName,
          label: exportName,
          importSource: packageName,
          ports,
          synchronicity: isAsync ? 'ASYNC' : 'SYNC',
          description: `${exportName} from ${packageName}`,
        });
      }
    }

    // Fallback: if symbol-based enumeration found nothing, try extractFunctionLikes
    // (handles edge cases where symbols aren't available)
    if (nodeTypes.length === 0) {
      const functions = extractFunctionLikes(dtsFile);
      for (const fn of functions) {
        const fnName = fn.getName();
        if (!fnName || seenFunctionNames.has(fnName)) continue;
        seenFunctionNames.add(fnName);
        const nodeType = inferNodeTypeFromDtsFunction(fn, packageName);
        if (nodeType) nodeTypes.push(nodeType);
      }
    }

    // Clean up added source files to avoid project bloat
    for (const filePath of addedFiles) {
      const sf = project.getSourceFile(filePath);
      if (sf) project.removeSourceFile(sf);
    }

    return nodeTypes;
  } catch {
    return [];
  }
}
