/**
 * How a workflow file's imports become node types.
 *
 * Decides which relative imports are followed (annotated sources only, data
 * files skipped), how an imported file's node types, workflows and inferable
 * functions are exposed through its named imports, how npm packages and
 * `@fwImport` annotations are inferred from their `.d.ts` declarations
 * (following re-export barrels), when a circular import is an error or a
 * warning, and when a cached import result is still valid (the mtime of the
 * file and of every file it read). The caches and the import stack are owned
 * by the caller and passed in as an `ImportContext`.
 */
import type { Project, SourceFile } from 'ts-morph';
import * as path from 'node:path';
import * as fs from 'node:fs';
import type { TNodeTypeAST } from '../ast/types';
import { extractFunctionLikes } from './function-like';
import { stripGeneratedSections, hasInPlaceMarkers } from './generated-sections';
import { resolvePackageTypesPath } from './resolve-package-types';
import type { LRUCache } from '../utils/lru-cache';
import type { TagHandlerRegistry } from './tag-registry';
import {
  extractNodeTypes,
  inferNodeTypeFromFunction,
  inferAllUnannotatedFunctions,
} from './node-inference';
import {
  SOURCE_EXTENSIONS,
  resolveModulePath,
  resolveReExportedDts,
  type SourceImportResolver,
  type SourceOverrideLoader,
} from './module-resolution';
import { extractWorkflows, workflowToNodeType } from './workflow-extraction';
import { createImportStub } from './import-stub';

/** A file the parse read, with the mtime it had. Cache entries are valid only while every one is unchanged. */
export type FileDependency = { path: string; mtime: number };

/** True when every recorded dependency still has the mtime it had when the entry was cached. */
export function dependenciesUnchanged(deps: FileDependency[]): boolean {
  for (const dep of deps) {
    try {
      if (fs.statSync(dep.path).mtimeMs !== dep.mtime) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/** A cached import: the node types a file (or an npm package, keyed `npm:<name>`) provides. */
export type ImportCacheEntry = { mtime: number; nodeTypes: TNodeTypeAST[]; deps: FileDependency[] };

/** The import state of one parser, shared by every import resolved during a parse. */
export interface ImportContext {
  project: Project;
  tagRegistry: TagHandlerRegistry;
  importCache: LRUCache<string, ImportCacheEntry>;
  /** Files being processed, outermost first, for circular import detection. */
  importStack: Set<string>;
  /**
   * Dependency recorders for the parses in progress: the outer entry belongs to
   * the workflow file, and each imported file being processed pushes its own so
   * its importCache entry can list what it read. A file read while any recorder
   * is active is added to all of them.
   */
  dependencyRecorders: Map<string, number>[];
}

/** Note that the parse in progress read `filePath`, so cache entries built from it can be invalidated when it changes. */
function recordDependency(ctx: ImportContext, filePath: string, mtime: number): void {
  for (const recorder of ctx.dependencyRecorders) {
    recorder.set(filePath, mtime);
  }
}

/**
 * The node types `sourceFile` imports: named imports of npm packages (from
 * their `.d.ts`) and of relative annotated sources (their node types,
 * workflows and inferable functions). A missing relative source or a
 * circular import throws.
 */
export function extractImportedNodeTypes(
  ctx: ImportContext,
  sourceFile: ReturnType<Project['addSourceFileAtPath']>,
  currentFilePath: string,
  importResolver?: SourceImportResolver,
  sourceLoader?: SourceOverrideLoader,
  warnings?: string[],
): TNodeTypeAST[] {
  const importedNodeTypes: TNodeTypeAST[] = [];
  const imports = sourceFile.getImportDeclarations();

  for (const importDecl of imports) {
    const moduleSpecifier = importDecl.getModuleSpecifierValue();

    // Skip if module specifier is undefined or not a relative import
    // Any .ts file with @flowWeaver annotations can be imported.
    if (!moduleSpecifier) {
      continue;
    }

    if (!moduleSpecifier.startsWith('.')) {
      const packageNodeTypes = resolveNpmPackageTypes(
        ctx,
        importDecl,
        moduleSpecifier,
        currentFilePath
      );
      importedNodeTypes.push(...packageNodeTypes);
      continue;
    }

    const currentDir = path.dirname(currentFilePath);
    const importedFilePath = importResolver?.(moduleSpecifier, currentFilePath)
      ?? resolveModulePath(moduleSpecifier, currentDir, warnings);

    // Validate import path exists
    if (!importedFilePath) {
      // `./data.json`, `./styles.css`: data the workflow uses, never a node-type source.
      const ext = path.extname(moduleSpecifier);
      if (ext && !SOURCE_EXTENSIONS.has(ext)) {
        continue;
      }
      throw new Error(
        `Import error: File not found for "${moduleSpecifier}"\n` +
          `  Imported from: ${currentFilePath}\n` +
          `  Searched extensions: .ts, .tsx, .js, .jsx`
      );
    }

    // Check for circular dependencies
    if (ctx.importStack.has(importedFilePath)) {
      const cycle = Array.from(ctx.importStack).concat(importedFilePath);
      throw new Error(`Circular dependency detected:\n  ${cycle.join('\n  -> ')}`);
    }

    try {
      // Check cache first, validating the mtime of the file and of everything it imported
      let nodeTypes: TNodeTypeAST[];
      const overriddenSource = sourceLoader?.(importedFilePath);
      const importStats = overriddenSource === undefined
        ? fs.statSync(importedFilePath)
        : { mtimeMs: 0 };
      if (overriddenSource === undefined) {
        recordDependency(ctx, importedFilePath, importStats.mtimeMs);
      }
      const cached = overriddenSource === undefined
        ? ctx.importCache.get(importedFilePath)
        : undefined;
      if (cached && cached.mtime === importStats.mtimeMs && dependenciesUnchanged(cached.deps)) {
        nodeTypes = cached.nodeTypes;
        for (const dep of cached.deps) recordDependency(ctx, dep.path, dep.mtime);
      } else {
        // Add to import stack for circular dependency detection
        ctx.importStack.add(importedFilePath);
        const importDeps = new Map<string, number>();
        ctx.dependencyRecorders.push(importDeps);

        try {
          const importedRaw = overriddenSource
            ?? fs.readFileSync(importedFilePath, 'utf-8');
          const importedContent = hasInPlaceMarkers(importedRaw)
            ? stripGeneratedSections(importedRaw)
            : importedRaw;
          const importedFile = ctx.project.createSourceFile(importedFilePath, importedContent, {
            overwrite: true,
          });
          const importWarnings: string[] = [];
          const localNodeTypes = extractNodeTypes(importedFile, importWarnings, ctx.tagRegistry);
          // Recursively process imports (enables circular dependency detection)
          const importedFromFile = extractImportedNodeTypes(
            ctx,
            importedFile,
            importedFilePath,
            importResolver,
            sourceLoader,
            warnings,
          );
          // Also extract workflows and convert them to node types
          const workflows = extractWorkflows(
            importedFile,
            [...localNodeTypes, ...importedFromFile],
            importedFilePath,
            [],
            importWarnings,
            ctx.tagRegistry,
            (imp, filePath, importAnnotationWarnings) =>
              resolveImportAnnotation(ctx, imp, filePath, importAnnotationWarnings),
          );
          const workflowAsNodeTypes = workflows.map((wf) => workflowToNodeType(wf));
          nodeTypes = [...localNodeTypes, ...importedFromFile, ...workflowAsNodeTypes];

          // Pre-infer all unannotated functions so the named-import filter can resolve them
          const inferredFromImport = inferAllUnannotatedFunctions(importedFile, nodeTypes);
          nodeTypes.push(...inferredFromImport);

          // Clean up imported source file to prevent Project bloat
          if (overriddenSource === undefined) {
            ctx.project.removeSourceFile(importedFile);
          }

          // Cache the parsed node types with mtime for invalidation
          ctx.importCache.set(importedFilePath, {
            mtime: importStats.mtimeMs,
            nodeTypes,
            deps: [...importDeps].map(([path, mtime]) => ({ path, mtime })),
          });
        } finally {
          // Remove from stack after processing
          ctx.importStack.delete(importedFilePath);
          ctx.dependencyRecorders.pop();
        }
      }

      // Extract only the named imports
      const importedNames = new Set<string>();
      importDecl.getNamedImports().forEach((namedImport) => {
        importedNames.add(namedImport.getName());
      });

      // Only include imports that are actually node types
      // (other imports may be regular TypeScript exports like types, constants, etc.)
      nodeTypes.forEach((nodeType) => {
        if (importedNames.has(nodeType.functionName)) {
          importedNodeTypes.push({
            ...nodeType,
            sourceLocation: {
              file: importedFilePath,
              line: nodeType.sourceLocation?.line || 0,
              column: nodeType.sourceLocation?.column || 0,
            },
          });
        }
      });
    } catch (error) {
      // Re-throw with better context
      if (error instanceof Error) {
        throw new Error(`Failed to process import from ${importedFilePath}:\n  ${error.message}`, { cause: error });
      }
      throw error;
    }
  }
  return importedNodeTypes;
}

/**
 * Resolve npm package imports to node types by reading `.d.ts` declarations.
 * Only named imports of exported functions are resolved.
 */
function resolveNpmPackageTypes(
  ctx: ImportContext,
  importDecl: ReturnType<SourceFile['getImportDeclarations']>[number],
  moduleSpecifier: string,
  currentFilePath: string
): TNodeTypeAST[] {
  // Only handle named imports
  const namedImports = importDecl.getNamedImports();
  if (namedImports.length === 0) return [];

  const importedNames = new Set<string>();
  namedImports.forEach((ni) => importedNames.add(ni.getName()));

  // Check cache (npm imports use package path mtime for invalidation)
  const cacheKey = `npm:${moduleSpecifier}`;
  const npmCached = ctx.importCache.get(cacheKey);
  if (npmCached) {
    // For npm packages, check mtime of the resolved .d.ts file
    const currentDir = path.dirname(currentFilePath);
    const resolvedDts = resolvePackageTypesPath(moduleSpecifier, currentDir);
    if (resolvedDts) {
      try {
        const dtsStats = fs.statSync(resolvedDts);
        if (npmCached.mtime === dtsStats.mtimeMs) {
          recordDependency(ctx, resolvedDts, dtsStats.mtimeMs);
          return npmCached.nodeTypes.filter((nt) => importedNames.has(nt.functionName));
        }
      } catch { /* file gone: re-parse */ }
    } else {
      return npmCached.nodeTypes.filter((nt) => importedNames.has(nt.functionName));
    }
  }

  // Resolve .d.ts path
  const currentDir = path.dirname(currentFilePath);
  const dtsPath = resolvePackageTypesPath(moduleSpecifier, currentDir);
  if (!dtsPath) return [];

  try {
    const dtsContent = fs.readFileSync(dtsPath, 'utf-8');
    recordDependency(ctx, dtsPath, fs.statSync(dtsPath).mtimeMs);
    const dtsFile = ctx.project.createSourceFile(
      `__npm_dts__/${moduleSpecifier}.d.ts`,
      dtsContent,
      { overwrite: true }
    );

    const fns = extractFunctionLikes(dtsFile);
    const allNodeTypes: TNodeTypeAST[] = [];
    const seenNames = new Set<string>();

    for (const fn of fns) {
      const fnName = fn.getName();
      if (!fnName) continue;
      // Skip duplicate function names (overloaded declarations in .d.ts)
      if (seenNames.has(fnName)) continue;
      seenNames.add(fnName);

      const nodeType = inferNodeTypeFromFunction(fn, fnName, dtsPath);
      // Mark as npm package import and prevent inlining
      nodeType.importSource = moduleSpecifier;
      nodeType.functionText = undefined;
      allNodeTypes.push(nodeType);
    }

    // Clean up the temporary source file
    ctx.project.removeSourceFile(dtsFile);

    // Cache all node types from this package (with mtime of the .d.ts file)
    const dtsMtime = fs.statSync(dtsPath).mtimeMs;
    ctx.importCache.set(cacheKey, { mtime: dtsMtime, nodeTypes: allNodeTypes, deps: [] });

    // Return only the ones in the import statement
    return allNodeTypes.filter((nt) => importedNames.has(nt.functionName));
  } catch {
    // Silently skip packages whose .d.ts can't be parsed
    return [];
  }
}

/**
 * Resolve an @fwImport annotation to a properly inferred node type.
 * Supports both npm packages (e.g., "lodash") and relative paths (e.g., "./utils").
 *
 * @param imp - The import annotation from JSDoc
 * @param currentFilePath - Path of the workflow file containing the @fwImport
 * @param warnings - Array to collect warnings
 * @returns Inferred TNodeTypeAST, or a stub if inference fails
 */
export function resolveImportAnnotation(
  ctx: ImportContext,
  imp: { name: string; functionName: string; importSource: string },
  currentFilePath: string,
  warnings: string[]
): TNodeTypeAST {
  const currentDir = path.dirname(currentFilePath);

  // Determine if this is a relative path import or an npm package
  if (imp.importSource.startsWith('.')) {
    // Relative path import - resolve local file and infer
    return resolveLocalImportAnnotation(ctx, imp, currentDir, warnings);
  } else {
    // npm package import - use .d.ts inference
    return resolveNpmImportAnnotation(ctx, imp, currentDir, warnings);
  }
}

/**
 * Resolve a relative path @fwImport to a node type by reading the local file.
 * Includes circular dependency detection using importStack.
 */
function resolveLocalImportAnnotation(
  ctx: ImportContext,
  imp: { name: string; functionName: string; importSource: string },
  currentDir: string,
  warnings: string[]
): TNodeTypeAST {
  const importedFilePath = resolveModulePath(imp.importSource, currentDir, warnings);
  if (!importedFilePath) {
    // A relative path that does not resolve is a warning plus a stub, not a failed parse
    warnings.push(`@fwImport: Could not resolve "${imp.importSource}" from ${currentDir}`);
    return createImportStub(imp);
  }

  // Circular dependency detection
  if (ctx.importStack.has(importedFilePath)) {
    const cycle = Array.from(ctx.importStack).concat(importedFilePath);
    warnings.push(`@fwImport: Circular dependency detected:\n  ${cycle.join('\n  -> ')}`);
    return createImportStub(imp);
  }

  // Add to import stack before processing
  ctx.importStack.add(importedFilePath);

  try {
    const importedContent = fs.readFileSync(importedFilePath, 'utf-8');
    recordDependency(ctx, importedFilePath, fs.statSync(importedFilePath).mtimeMs);
    const importedFile = ctx.project.createSourceFile(importedFilePath, importedContent, {
      overwrite: true,
    });

    const fns = extractFunctionLikes(importedFile);
    const fn = fns.find((f) => f.getName() === imp.functionName);

    if (!fn) {
      // Function not found in file - return stub
      ctx.project.removeSourceFile(importedFile);
      return createImportStub(imp);
    }

    // Infer BEFORE removing the source file (ts-morph needs it)
    const nodeType = inferNodeTypeFromFunction(fn, imp.name, importedFilePath);
    nodeType.importSource = imp.importSource;
    nodeType.functionText = undefined; // Don't inline external code

    // Clean up after inference is complete
    ctx.project.removeSourceFile(importedFile);
    return nodeType;
  } catch {
    // Graceful fallback on any error
    return createImportStub(imp);
  } finally {
    // Always remove from import stack
    ctx.importStack.delete(importedFilePath);
  }
}

/**
 * Resolve an npm package @fwImport to a node type by reading .d.ts declarations.
 */
function resolveNpmImportAnnotation(
  ctx: ImportContext,
  imp: { name: string; functionName: string; importSource: string },
  currentDir: string,
  warnings: string[]
): TNodeTypeAST {
  // Check cache (with mtime validation — same pattern as resolveNpmImports)
  const cacheKey = `npm:${imp.importSource}`;
  if (ctx.importCache.has(cacheKey)) {
    const cached = ctx.importCache.get(cacheKey)!;
    const resolvedDts = resolvePackageTypesPath(imp.importSource, currentDir);
    let cacheValid = false;
    if (resolvedDts) {
      try {
        const dtsStats = fs.statSync(resolvedDts);
        cacheValid = cached.mtime === dtsStats.mtimeMs;
      } catch { /* file gone — re-parse */ }
    } else {
      // No .d.ts found — trust cache (package may have been removed)
      cacheValid = true;
    }
    if (cacheValid) {
      const found = cached.nodeTypes.find((nt) => nt.functionName === imp.functionName);
      if (found) {
        return { ...found, name: imp.name, importSource: imp.importSource };
      }
    }
  }

  // Resolve .d.ts path
  const dtsPath = resolvePackageTypesPath(imp.importSource, currentDir);
  if (!dtsPath) {
    warnings.push(
      `@fwImport: Package "${imp.importSource}" has no type declarations (.d.ts). ` +
      `Install @types/${imp.importSource} or add a local wrapper with @flowWeaver nodeType annotations.`
    );
    return createImportStub(imp);
  }

  try {
    // Infer node types from the resolved `.d.ts` AND from any files it
    // re-exports (`export * from './x'`, `export { y } from './x'`).
    // Modern packages ship a barrel `index.d.ts` that only re-exports its
    // real declarations from sub-files (e.g. pack-core's
    // `export * from './node-types/index.js'`); reading the barrel alone
    // finds zero functions and the import falls back to a `{ result }`
    // stub, dropping every real port. Inference happens inside the walk
    // while each sub-file's ts-morph SourceFile is still alive.
    const allNodeTypes = inferNodeTypesDeep(
      ctx.project,
      dtsPath,
      imp.importSource,
      new Set<string>(),
      new Set<string>(),
      0
    );

    // Cache all node types from this package (with mtime of the .d.ts file)
    const dtsMtime2 = fs.statSync(dtsPath).mtimeMs;
    recordDependency(ctx, dtsPath, dtsMtime2);
    ctx.importCache.set(cacheKey, { mtime: dtsMtime2, nodeTypes: allNodeTypes, deps: [] });

    // Find the specific function we need
    const found = allNodeTypes.find((nt) => nt.functionName === imp.functionName);
    if (found) {
      return { ...found, name: imp.name, importSource: imp.importSource };
    }

    // Function not found in .d.ts
    warnings.push(
      `@fwImport: Function "${imp.functionName}" not found in type declarations for "${imp.importSource}". ` +
      `Available exports: ${allNodeTypes.map((nt) => nt.functionName).join(', ') || '(none)'}.`
    );
  } catch (err) {
    warnings.push(
      `@fwImport: Failed to parse type declarations for "${imp.importSource}": ${(err as Error).message}. Node "${imp.name}" will use a generic stub.`
    );
  }

  return createImportStub(imp);
}

/**
 * Read a `.d.ts`, infer node types from its function declarations, and
 * follow re-export barrels (`export * from './x'`,
 * `export { y } from './x'`) to the files that actually declare the
 * functions. Inference runs here (not in the caller) so each function's
 * ts-morph node is read while its SourceFile is still alive. Removing the
 * SourceFile before inference would detach the node and throw
 * "Attempted to get information from a node that was removed".
 *
 * Why: modern packages ship a barrel `index.d.ts` that only re-exports
 * from sub-files. Reading the barrel alone yields zero functions, so an
 * `@fwImport` of such a package fell back to a `{ result }` stub. Walking
 * the re-exports resolves the real declarations (and their `@input` /
 * `@output` JSDoc), so the node's true ports are recovered.
 *
 * `visitedFiles` guards re-export cycles; `seenNames` de-dupes a function
 * re-exported through multiple paths (first declaration wins); `depth`
 * bounds the walk so a pathological barrel graph can't run away.
 */
function inferNodeTypesDeep(
  project: Project,
  dtsPath: string,
  importSource: string,
  visitedFiles: Set<string>,
  seenNames: Set<string>,
  depth: number
): TNodeTypeAST[] {
  const MAX_DEPTH = 8;
  const resolved = path.resolve(dtsPath);
  if (visitedFiles.has(resolved) || depth > MAX_DEPTH) return [];
  visitedFiles.add(resolved);

  let dtsContent: string;
  try {
    dtsContent = fs.readFileSync(resolved, 'utf-8');
  } catch (err) {
    // The entry `.d.ts` (depth 0) failing to read is a hard error the
    // caller surfaces as a "Failed to parse ... generic stub" warning.
    // A re-exported sub-file (depth > 0) failing is best-effort: skip it
    // and keep whatever the other files resolved.
    if (depth === 0) throw err;
    return [];
  }

  const sf = project.createSourceFile(
    `__npm_dts__/${resolved.replace(/[^A-Za-z0-9._-]/g, '_')}.d.ts`,
    dtsContent,
    { overwrite: true }
  );

  const out: TNodeTypeAST[] = [];
  try {
    for (const fn of extractFunctionLikes(sf)) {
      const fnName = fn.getName();
      if (!fnName) continue;
      // Skip duplicate function names (overloads, or re-exported via
      // multiple barrels). First declaration encountered wins.
      if (seenNames.has(fnName)) continue;
      seenNames.add(fnName);

      const nodeType = inferNodeTypeFromFunction(fn, fnName, resolved);
      nodeType.importSource = importSource;
      nodeType.functionText = undefined;
      out.push(nodeType);
    }

    // Follow `export ... from '<relative>'` declarations to sibling files.
    const baseDir = path.dirname(resolved);
    for (const exp of sf.getExportDeclarations()) {
      const spec = exp.getModuleSpecifierValue();
      if (!spec || !spec.startsWith('.')) continue;
      const target = resolveReExportedDts(baseDir, spec);
      if (!target) continue;
      out.push(
        ...inferNodeTypesDeep(project, target, importSource, visitedFiles, seenNames, depth + 1)
      );
    }
  } finally {
    project.removeSourceFile(sf);
  }
  return out;
}
