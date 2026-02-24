/* eslint-disable no-console */
import { Project, type JSDoc, type SourceFile, type Type, type Symbol as TsSymbol } from 'ts-morph';
import { type FunctionLike, extractFunctionLikes } from './function-like';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { createHash } from 'node:crypto';
import { jsdocParser } from './jsdoc-parser';
import type {
  TDataType,
  TExecuteWhen,
  TNodeTypeAST,
  TNodeTypeDefaultConfig,
  TPortDefinition,
  TWorkflowAST,
  TConnectionAST,
  TNodeInstanceAST,
  TSerializableValue,
  TPatternAST,
  TWorkflowMacro,
} from './ast/types';
import { EXECUTION_STRATEGIES, RESERVED_PORT_NAMES, isControlFlowPort } from './constants';
import { getErrorMessage } from './utils/error-utils';
import { assignImplicitPortOrders } from './utils/port-ordering';
import { stripGeneratedSections, hasInPlaceMarkers } from './api/generate-in-place';
import { inferDataTypeFromTS } from './type-mappings';
import { generateJSDocPortTag } from './annotation-generator';
import { resolvePackageTypesPath } from './resolve-package-types';
import { getPackageExports } from './npm-packages';
import { getSharedProject } from './shared-project';
import { LRUCache } from './utils/lru-cache';
import { COERCION_NODE_TYPES, COERCE_TYPE_MAP } from './built-in-nodes/coercion-types';

export interface ParseResult {
  workflows: TWorkflowAST[];
  nodeTypes: TNodeTypeAST[];
  patterns: TPatternAST[];
  errors: string[];
  warnings: string[];
}

/**
 * Minimal external node type descriptor.
 * Carries just enough information for the parser to validate node references
 * and infer port directions. Passed with each request from the client layer.
 */
export type TExternalNodeType = {
  name: string;
  functionName?: string;
  ports?: Array<{ name: string; type?: string; direction?: string; defaultLabel?: string }>;
};

/**
 * Convert a TExternalNodeType to a TNodeTypeAST with sensible defaults.
 * Used to merge runtime-loaded node types into the parser's available types.
 */
function externalToAST(ext: TExternalNodeType): TNodeTypeAST {
  const inputs: Record<string, TPortDefinition> = {};
  const outputs: Record<string, TPortDefinition> = {};

  if (ext.ports) {
    for (const port of ext.ports) {
      const def: TPortDefinition = {
        dataType: (port.type as TDataType) || 'ANY',
        ...(port.defaultLabel && { label: port.defaultLabel }),
      };
      if (port.direction === 'OUTPUT') {
        outputs[port.name] = def;
      } else {
        inputs[port.name] = def;
      }
    }
  }

  // Ensure mandatory ports exist
  if (!inputs.execute) {
    inputs.execute = { dataType: 'STEP', label: 'Execute' };
  }
  if (!outputs.onSuccess) {
    outputs.onSuccess = { dataType: 'STEP', label: 'On Success', isControlFlow: true };
  }
  if (!outputs.onFailure) {
    outputs.onFailure = {
      dataType: 'STEP',
      label: 'On Failure',
      isControlFlow: true,
      failure: true,
    };
  }

  return {
    type: 'NodeType',
    name: ext.name,
    functionName: ext.functionName || ext.name,
    inputs,
    outputs,
    hasSuccessPort: 'onSuccess' in outputs,
    hasFailurePort: 'onFailure' in outputs,
    isAsync: false,
    executeWhen: EXECUTION_STRATEGIES.CONJUNCTION,
    variant: 'FUNCTION',
  };
}

// Port ordering functions imported from ./utils/port-ordering

/** Exposed for tests that need direct access to the shared ts-morph Project */
export function getParserProject(): Project {
  return getSharedProject();
}

export class AnnotationParser {
  private project: Project;
  private importCache = new LRUCache<string, TNodeTypeAST[]>(200);
  private importStack: Set<string> = new Set();
  private parseCache = new LRUCache<
    string,
    {
      mtime: number;
      contentHash: string;
      result: ParseResult;
    }
  >(100);

  constructor() {
    this.project = getSharedProject();
  }

  private computeHash(content: string): string {
    return createHash('sha256').update(content).digest('hex').slice(0, 16);
  }

  private detectMinorEdit(
    original: string,
    updated: string
  ): { isMinor: boolean; affectedFunctions: string[] } {
    let start = 0;
    const minLen = Math.min(original.length, updated.length);
    while (start < minLen && original[start] === updated[start]) start++;

    let endOrig = original.length;
    let endNew = updated.length;
    while (endOrig > start && endNew > start && original[endOrig - 1] === updated[endNew - 1]) {
      endOrig--;
      endNew--;
    }

    const changedRegion = updated.slice(start, endNew);

    // Structural patterns require full re-parse
    const structural =
      /import\b|export\b|@flowWeaver|@input\b|@output\b|function\s+\w+\s*\(|const\s+\w+\s*=|let\s+\w+\s*=|var\s+\w+\s*=|@node\b|@connect\b/;
    if (structural.test(changedRegion)) {
      return { isMinor: false, affectedFunctions: [] };
    }

    // For now, return isMinor: true but no affected functions (conservative approach)
    // This means we'll still do a full parse but the infrastructure is in place
    return { isMinor: true, affectedFunctions: [] };
  }

  private patchAST(
    filePath: string,
    cached: { mtime: number; contentHash: string; result: ParseResult; sourceText: string },
    newContent: string,
    _affectedFunctions: string[]
  ): ParseResult | null {
    try {
      const sourceFile = this.project.getSourceFile(filePath);
      if (!sourceFile) return null;

      sourceFile.replaceWithText(newContent);

      // Re-extract all node types (conservative approach for now)
      const warnings: string[] = [];
      const nodeTypes = this.extractNodeTypes(sourceFile, warnings);

      const result = {
        ...cached.result,
        nodeTypes,
        warnings: [...cached.result.warnings, ...warnings],
      };

      this.parseCache.set(filePath, {
        mtime: fs.statSync(filePath).mtimeMs,
        contentHash: this.computeHash(newContent),
        result,
      });

      return result;
    } catch {
      return null;
    }
  }

  parse(filePath: string, externalNodeTypes?: TExternalNodeType[]): ParseResult {
    const stats = fs.statSync(filePath);
    const hasExternalTypes = externalNodeTypes && externalNodeTypes.length > 0;

    // Skip cache when external node types are provided — cache was built without them
    if (!hasExternalTypes) {
      const cached = this.parseCache.get(filePath);

      // FAST PATH 1: mtime unchanged
      if (cached && cached.mtime === stats.mtimeMs) {
        return cached.result;
      }

      const rawContent = fs.readFileSync(filePath, 'utf-8');
      const content = hasInPlaceMarkers(rawContent)
        ? stripGeneratedSections(rawContent)
        : rawContent;
      const hash = this.computeHash(content);

      // FAST PATH 2: content hash unchanged (save without edit)
      if (cached && cached.contentHash === hash) {
        cached.mtime = stats.mtimeMs;
        return cached.result;
      }

      // FAST PATH 3: Incremental patching disabled — re-enable when detectMinorEdit
      // returns affected functions. Infrastructure preserved in detectMinorEdit/patchAST.

      // FALLBACK: Full parse
      return this.fullParse(filePath, content, hash, stats.mtimeMs);
    }

    // External types provided — always do a full parse without caching the result
    const rawContent = fs.readFileSync(filePath, 'utf-8');
    const content = hasInPlaceMarkers(rawContent) ? stripGeneratedSections(rawContent) : rawContent;
    const hash = this.computeHash(content);
    return this.fullParse(filePath, content, hash, stats.mtimeMs, externalNodeTypes);
  }

  private fullParse(
    filePath: string,
    content: string,
    hash: string,
    mtimeMs: number,
    externalNodeTypes?: TExternalNodeType[]
  ): ParseResult {
    // Reset import tracking for new parse
    this.importStack.clear();

    const errors: string[] = [];
    const warnings: string[] = [];

    const sourceFile = this.project.createSourceFile(filePath, content, { overwrite: true });

    // Add current file to import stack BEFORE processing imports
    this.importStack.add(filePath);

    const localNodeTypes = this.extractNodeTypes(sourceFile, warnings);
    const importedNodeTypes = this.extractImportedNodeTypes(sourceFile, filePath);

    // First pass: extract workflow signatures to enable same-file workflow invocation
    const workflowSignatures = this.extractWorkflowSignatures(sourceFile, filePath, warnings);
    const sameFileWorkflowNodeTypes = workflowSignatures.map((wf) => this.workflowToNodeType(wf));

    const nodeTypes = [...localNodeTypes, ...importedNodeTypes, ...sameFileWorkflowNodeTypes];

    // Merge external (runtime-loaded) node types so the parser can validate references
    if (externalNodeTypes?.length) {
      for (const ext of externalNodeTypes) {
        const alreadyKnown = nodeTypes.some(
          (nt) => nt.name === ext.name || nt.functionName === ext.name
        );
        if (!alreadyKnown) {
          nodeTypes.push(externalToAST(ext));
        }
      }
    }

    // Auto-infer node types from unannotated functions referenced by @node
    const inferredNodeTypes = this.inferNodeTypesFromUnannotated(sourceFile, nodeTypes);
    nodeTypes.push(...inferredNodeTypes);

    const workflows = this.extractWorkflows(sourceFile, nodeTypes, filePath, errors, warnings);
    const patterns = this.extractPatterns(sourceFile, nodeTypes, filePath, errors, warnings);
    const result = { workflows, nodeTypes, patterns, errors, warnings };

    // Clean up source file to prevent ts-morph Project bloat
    // (results are captured in the returned AST, source file is no longer needed)
    this.project.removeSourceFile(sourceFile);

    // Only cache when no external types were used (cache should reflect file-only state)
    if (!externalNodeTypes?.length) {
      this.parseCache.set(filePath, {
        mtime: mtimeMs,
        contentHash: hash,
        result,
      });
    }

    return result;
  }

  /**
   * Parse workflow from a string instead of a file path.
   * Useful for testing and in-memory operations.
   *
   * Note: Imports from other workflow files are NOT supported in this mode
   * since there's no filesystem context. Use parse() for files with imports.
   *
   * @param code - TypeScript source code containing workflow definitions
   * @param virtualPath - Virtual file path for error messages (default: 'virtual.ts')
   * @returns ParseResult with workflows and nodeTypes
   */
  parseFromString(code: string, virtualPath: string = 'virtual.ts'): ParseResult {
    // Reset import tracking
    this.importStack.clear();

    // Remove existing virtual file if present
    const existingFile = this.project.getSourceFile(virtualPath);
    if (existingFile) {
      this.project.removeSourceFile(existingFile);
    }

    // Create source file from string
    const sourceFile = this.project.createSourceFile(virtualPath, code, { overwrite: true });

    const errors: string[] = [];
    const warnings: string[] = [];
    const localNodeTypes = this.extractNodeTypes(sourceFile, warnings);

    // First pass: extract workflow signatures to enable same-file workflow invocation
    const workflowSignatures = this.extractWorkflowSignatures(sourceFile, virtualPath, warnings);
    const sameFileWorkflowNodeTypes = workflowSignatures.map((wf) => this.workflowToNodeType(wf));

    const nodeTypes = [...localNodeTypes, ...sameFileWorkflowNodeTypes];

    // Auto-infer node types from unannotated functions referenced by @node
    const inferredNodeTypes = this.inferNodeTypesFromUnannotated(sourceFile, nodeTypes);
    nodeTypes.push(...inferredNodeTypes);

    // Note: imports not supported for virtual files - would need filesystem access
    const workflows = this.extractWorkflows(sourceFile, nodeTypes, virtualPath, errors, warnings);
    const patterns = this.extractPatterns(sourceFile, nodeTypes, virtualPath, errors, warnings);

    // Clean up virtual source file to prevent memory bloat
    // (tests create many unique virtual paths that accumulate)
    this.project.removeSourceFile(sourceFile);

    return {
      workflows,
      nodeTypes,
      patterns,
      errors,
      warnings,
    };
  }

  clearCache(): void {
    this.importCache.clear();
    this.parseCache.clear();
  }

  /** Clear only the parse result cache, keeping the import/node-type cache intact. */
  clearParseCache(): void {
    this.parseCache.clear();
  }

  private resolveModulePath(moduleSpecifier: string, currentDir: string): string | null {
    const extensions = ['.ts', '.tsx', '.js', '.jsx'];

    // If already has extension, check if exists
    const hasExtension = extensions.some((ext) => moduleSpecifier.endsWith(ext));
    if (hasExtension) {
      const fullPath = path.resolve(currentDir, moduleSpecifier);
      return fs.existsSync(fullPath) ? fullPath : null;
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
          console.warn(`Failed to parse package.json at ${pkgPath}: ${getErrorMessage(e)}`);
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

  private extractImportedNodeTypes(
    sourceFile: ReturnType<Project['addSourceFileAtPath']>,
    currentFilePath: string
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
        const packageNodeTypes = this.resolveNpmPackageTypes(
          importDecl,
          moduleSpecifier,
          currentFilePath
        );
        importedNodeTypes.push(...packageNodeTypes);
        continue;
      }

      const currentDir = path.dirname(currentFilePath);
      const importedFilePath = this.resolveModulePath(moduleSpecifier, currentDir);

      // Validate import path exists
      if (!importedFilePath) {
        throw new Error(
          `Import error: File not found for "${moduleSpecifier}"\n` +
            `  Imported from: ${currentFilePath}\n` +
            `  Searched extensions: .ts, .tsx, .js, .jsx`
        );
      }

      // Check for circular dependencies
      if (this.importStack.has(importedFilePath)) {
        const cycle = Array.from(this.importStack).concat(importedFilePath);
        throw new Error(`Circular dependency detected:\n  ${cycle.join('\n  -> ')}`);
      }

      try {
        // Check cache first
        let nodeTypes: TNodeTypeAST[];
        if (this.importCache.has(importedFilePath)) {
          nodeTypes = this.importCache.get(importedFilePath)!;
        } else {
          // Add to import stack for circular dependency detection
          this.importStack.add(importedFilePath);

          try {
            const importedRaw = fs.readFileSync(importedFilePath, 'utf-8');
            const importedContent = hasInPlaceMarkers(importedRaw)
              ? stripGeneratedSections(importedRaw)
              : importedRaw;
            const importedFile = this.project.createSourceFile(importedFilePath, importedContent, {
              overwrite: true,
            });
            const importWarnings: string[] = [];
            const localNodeTypes = this.extractNodeTypes(importedFile, importWarnings);
            // Recursively process imports (enables circular dependency detection)
            const importedFromFile = this.extractImportedNodeTypes(importedFile, importedFilePath);
            // Also extract workflows and convert them to node types
            const workflows = this.extractWorkflows(
              importedFile,
              [...localNodeTypes, ...importedFromFile],
              importedFilePath,
              [],
              importWarnings
            );
            const workflowAsNodeTypes = workflows.map((wf) => this.workflowToNodeType(wf));
            nodeTypes = [...localNodeTypes, ...importedFromFile, ...workflowAsNodeTypes];

            // Pre-infer all unannotated functions so the named-import filter can resolve them
            const inferredFromImport = this.inferAllUnannotatedFunctions(importedFile, nodeTypes);
            nodeTypes.push(...inferredFromImport);

            // Clean up imported source file to prevent Project bloat
            this.project.removeSourceFile(importedFile);

            // Cache the parsed node types
            this.importCache.set(importedFilePath, nodeTypes);
          } finally {
            // Remove from stack after processing
            this.importStack.delete(importedFilePath);
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
          throw new Error(`Failed to process import from ${importedFilePath}:\n  ${error.message}`);
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
  private resolveNpmPackageTypes(
    importDecl: ReturnType<SourceFile['getImportDeclarations']>[number],
    moduleSpecifier: string,
    currentFilePath: string
  ): TNodeTypeAST[] {
    // Only handle named imports
    const namedImports = importDecl.getNamedImports();
    if (namedImports.length === 0) return [];

    const importedNames = new Set<string>();
    namedImports.forEach((ni) => importedNames.add(ni.getName()));

    // Check cache
    const cacheKey = `npm:${moduleSpecifier}`;
    if (this.importCache.has(cacheKey)) {
      return this.importCache.get(cacheKey)!.filter((nt) => importedNames.has(nt.functionName));
    }

    // Resolve .d.ts path
    const currentDir = path.dirname(currentFilePath);
    const dtsPath = resolvePackageTypesPath(moduleSpecifier, currentDir);
    if (!dtsPath) return [];

    try {
      const dtsContent = fs.readFileSync(dtsPath, 'utf-8');
      const dtsFile = this.project.createSourceFile(
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

        const nodeType = this.inferNodeTypeFromFunction(fn, fnName, dtsPath);
        // Mark as npm package import and prevent inlining
        nodeType.importSource = moduleSpecifier;
        nodeType.functionText = undefined;
        allNodeTypes.push(nodeType);
      }

      // Clean up the temporary source file
      this.project.removeSourceFile(dtsFile);

      // Cache all node types from this package
      this.importCache.set(cacheKey, allNodeTypes);

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
  private resolveImportAnnotation(
    imp: { name: string; functionName: string; importSource: string },
    currentFilePath: string,
    warnings: string[]
  ): TNodeTypeAST {
    const currentDir = path.dirname(currentFilePath);

    // Determine if this is a relative path import or an npm package
    if (imp.importSource.startsWith('.')) {
      // Relative path import - resolve local file and infer
      return this.resolveLocalImportAnnotation(imp, currentDir, warnings);
    } else {
      // npm package import - use .d.ts inference
      return this.resolveNpmImportAnnotation(imp, currentDir);
    }
  }

  /**
   * Resolve a relative path @fwImport to a node type by reading the local file.
   * Includes circular dependency detection using importStack.
   */
  private resolveLocalImportAnnotation(
    imp: { name: string; functionName: string; importSource: string },
    currentDir: string,
    warnings: string[]
  ): TNodeTypeAST {
    const importedFilePath = this.resolveModulePath(imp.importSource, currentDir);
    if (!importedFilePath) {
      // Gap 3: Warn when relative path doesn't resolve
      warnings.push(`@fwImport: Could not resolve "${imp.importSource}" from ${currentDir}`);
      return this.createImportStub(imp);
    }

    // Gap 1: Circular dependency detection
    if (this.importStack.has(importedFilePath)) {
      const cycle = Array.from(this.importStack).concat(importedFilePath);
      warnings.push(`@fwImport: Circular dependency detected:\n  ${cycle.join('\n  -> ')}`);
      return this.createImportStub(imp);
    }

    // Add to import stack before processing
    this.importStack.add(importedFilePath);

    try {
      const importedContent = fs.readFileSync(importedFilePath, 'utf-8');
      const importedFile = this.project.createSourceFile(importedFilePath, importedContent, {
        overwrite: true,
      });

      const fns = extractFunctionLikes(importedFile);
      const fn = fns.find((f) => f.getName() === imp.functionName);

      if (!fn) {
        // Function not found in file - return stub
        this.project.removeSourceFile(importedFile);
        return this.createImportStub(imp);
      }

      // Infer BEFORE removing the source file (ts-morph needs it)
      const nodeType = this.inferNodeTypeFromFunction(fn, imp.name, importedFilePath);
      nodeType.importSource = imp.importSource;
      nodeType.functionText = undefined; // Don't inline external code

      // Clean up after inference is complete
      this.project.removeSourceFile(importedFile);
      return nodeType;
    } catch {
      // Graceful fallback on any error
      return this.createImportStub(imp);
    } finally {
      // Always remove from import stack
      this.importStack.delete(importedFilePath);
    }
  }

  /**
   * Resolve an npm package @fwImport to a node type by reading .d.ts declarations.
   */
  private resolveNpmImportAnnotation(
    imp: { name: string; functionName: string; importSource: string },
    currentDir: string
  ): TNodeTypeAST {
    // Check cache
    const cacheKey = `npm:${imp.importSource}`;
    if (this.importCache.has(cacheKey)) {
      const cached = this.importCache.get(cacheKey)!;
      const found = cached.find((nt) => nt.functionName === imp.functionName);
      if (found) {
        // Return a copy with the correct name from @fwImport
        return { ...found, name: imp.name, importSource: imp.importSource };
      }
    }

    // Resolve .d.ts path
    const dtsPath = resolvePackageTypesPath(imp.importSource, currentDir);
    if (!dtsPath) {
      return this.createImportStub(imp);
    }

    try {
      const dtsContent = fs.readFileSync(dtsPath, 'utf-8');
      const dtsFile = this.project.createSourceFile(
        `__npm_dts__/${imp.importSource}.d.ts`,
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

        const nodeType = this.inferNodeTypeFromFunction(fn, fnName, dtsPath);
        nodeType.importSource = imp.importSource;
        nodeType.functionText = undefined;
        allNodeTypes.push(nodeType);
      }

      this.project.removeSourceFile(dtsFile);

      // Cache all node types from this package
      this.importCache.set(cacheKey, allNodeTypes);

      // Find the specific function we need
      const found = allNodeTypes.find((nt) => nt.functionName === imp.functionName);
      if (found) {
        return { ...found, name: imp.name, importSource: imp.importSource };
      }
    } catch {
      // Silently skip packages whose .d.ts can't be parsed
    }

    return this.createImportStub(imp);
  }

  /**
   * Create a stub node type for @fwImport when proper inference fails.
   * This provides graceful degradation rather than failing completely.
   */
  private createImportStub(imp: {
    name: string;
    functionName: string;
    importSource: string;
  }): TNodeTypeAST {
    return {
      type: 'NodeType',
      name: imp.name,
      functionName: imp.functionName,
      importSource: imp.importSource,
      variant: 'FUNCTION',
      inputs: {},
      outputs: { result: { dataType: 'ANY' } },
      hasSuccessPort: true,
      hasFailurePort: true,
      executeWhen: 'CONJUNCTION',
      isAsync: false,
      // Mark as expression since most npm functions are pure
      // This is a reasonable default for stubs
      expression: true,
    };
  }

  private extractNodeTypes(sourceFile: SourceFile, warnings: string[]): TNodeTypeAST[] {
    const nodeTypes: TNodeTypeAST[] = [];
    extractFunctionLikes(sourceFile).forEach((fn: FunctionLike) => {
      // Parse JSDoc comments
      const config = jsdocParser.parseNodeType(fn, warnings);
      if (!config) {
        const jsdocText = fn.getJsDocs().map((d) => d.getFullText()).join('');
        if (jsdocText.includes('@flowWeaver nodeType')) {
          warnings.push(
            `Function "${fn.getName() || 'anonymous'}" has @flowWeaver annotation but could not be parsed. ` +
            `Check for special characters (---) or malformed JSDoc syntax.`
          );
        }
        return;
      }

      const functionName = fn.getName() || 'anonymous';
      const nodeTypeName = config.name || functionName;

      const inputs: Record<string, TPortDefinition> = {};
      if (config.inputs) {
        for (const [portName, portDef] of Object.entries(config.inputs)) {
          inputs[portName] = {
            dataType: portDef.type,
            default: portDef.defaultValue as TSerializableValue,
            optional: portDef.optional,
            label: portDef.label,
            expression: portDef.expression,
            ...(portDef.scope && { scope: portDef.scope }),
            ...(portDef.metadata && { metadata: portDef.metadata }),
            ...(portDef.tsType && { tsType: portDef.tsType }),
          };
        }
      }

      const outputs: Record<string, TPortDefinition> = {};
      if (config.outputs) {
        for (const [portName, portDef] of Object.entries(config.outputs)) {
          outputs[portName] = {
            dataType: portDef.type,
            label: portDef.label,
            ...(portDef.scope && { scope: portDef.scope }),
            ...(portDef.metadata && { metadata: portDef.metadata }),
            ...(portDef.tsType && { tsType: portDef.tsType }),
          };
        }
      }

      // Auto-infer ports for @expression nodes when @input/@output are missing.
      // If the function has @expression but no explicit port annotations, infer
      // data ports from the TypeScript function signature (same logic as unannotated functions).
      if (config.expression) {
        const hasExplicitDataInputs = Object.keys(inputs).some((k) => k !== 'execute');
        const hasExplicitDataOutputs = Object.keys(outputs).some(
          (k) => k !== 'onSuccess' && k !== 'onFailure'
        );

        if (!hasExplicitDataInputs || !hasExplicitDataOutputs) {
          const inferred = this.inferNodeTypeFromFunction(
            fn,
            nodeTypeName,
            fn.getSourceFile().getFilePath()
          );
          if (!hasExplicitDataInputs) {
            // Copy inferred data inputs (skip control flow ports)
            for (const [portName, portDef] of Object.entries(inferred.inputs)) {
              if (portName === 'execute') continue;
              inputs[portName] = portDef;
            }
          }
          if (!hasExplicitDataOutputs) {
            // Copy inferred data outputs (skip control flow ports)
            for (const [portName, portDef] of Object.entries(inferred.outputs)) {
              if (portName === 'onSuccess' || portName === 'onFailure') continue;
              outputs[portName] = portDef;
            }
          }
        }
      }

      // ALL nodes must have execute input and onSuccess/onFailure outputs
      // Execute port is visible by default so users can connect execution flow
      // Merge user-defined ports with mandatory defaults to preserve special properties
      inputs.execute = {
        label: 'Execute', // Default label
        ...inputs.execute, // User can override label
        dataType: 'STEP', // But dataType is mandatory
      };
      outputs.onSuccess = {
        label: 'On Success', // Default label
        ...outputs.onSuccess, // User can override label
        dataType: 'STEP', // But dataType is mandatory
        isControlFlow: true, // Always a control flow port
      };
      outputs.onFailure = {
        label: 'On Failure', // Default label
        ...outputs.onFailure, // User can override label
        dataType: 'STEP', // But dataType is mandatory
        failure: true, // Always a failure port
        isControlFlow: true, // Always a control flow port
      };

      // Assign implicit port orders with mandatory port precedence
      assignImplicitPortOrders(inputs);
      assignImplicitPortOrders(outputs);

      // Get function text (JSDoc comment + function)
      // getText() returns just the function, so we need to prepend the JSDoc
      const jsDocs = fn.getJsDocs();
      const jsDocText = jsDocs.map((doc: JSDoc) => doc.getText()).join('\n');
      const functionText = jsDocText ? `${jsDocText}\n${fn.getText()}` : fn.getText();

      // Detect async keyword on function declaration
      const isAsync = fn.isAsync();

      // Convert defaultConfig
      let defaultConfig: TNodeTypeDefaultConfig | undefined = undefined;
      if (config.defaultConfig) {
        defaultConfig = {
          label: config.defaultConfig.label,
          description: config.defaultConfig.description,
          pullExecution: config.defaultConfig.pullExecution,
        };
      }

      // Extract unique scope names from ports (per-port scoped architecture)
      const portScopes = new Set<string>();
      Object.values(inputs).forEach((port) => {
        if (port.scope) portScopes.add(port.scope);
      });
      Object.values(outputs).forEach((port) => {
        if (port.scope) portScopes.add(port.scope);
      });

      // Determine scopes array:
      // - If node has node-level scope: use that (old architecture)
      // - Otherwise if ports have scopes: use unique port scopes (per-port architecture)
      // - Otherwise: undefined (no scopes)
      const scopes = config.scope
        ? [config.scope]
        : portScopes.size > 0
          ? Array.from(portScopes)
          : undefined;

      nodeTypes.push({
        type: 'NodeType',
        name: nodeTypeName,
        functionName,
        variant: 'FUNCTION',
        inputs,
        outputs,
        hasSuccessPort: RESERVED_PORT_NAMES.ON_SUCCESS in outputs,
        hasFailurePort: RESERVED_PORT_NAMES.ON_FAILURE in outputs,
        isAsync,
        functionText,
        executeWhen: (config.executeWhen as TExecuteWhen) || EXECUTION_STRATEGIES.CONJUNCTION,
        defaultConfig,
        scope: config.scope,
        scopes,
        ...(config.expression && { expression: true }),
        ...(fn.getDeclarationKind?.() && { declarationKind: fn.getDeclarationKind!() }),
        label: config.label,
        description: config.description,
        visuals:
          config.color || config.icon || config.tags
            ? {
                color: config.color,
                icon: config.icon,
                tags: config.tags,
              }
            : undefined,
        sourceLocation: {
          file: sourceFile.getFilePath(),
          line: fn.getStartLineNumber(false),
          column: 0,
        },
      });
    });
    return nodeTypes;
  }

  /**
   * Extract workflow signatures (metadata only) without validating instances.
   * This enables same-file workflow invocation by making workflow ports available
   * before the full workflow extraction pass.
   */
  private extractWorkflowSignatures(
    sourceFile: SourceFile,
    filePath: string,
    warnings: string[]
  ): TWorkflowAST[] {
    const workflows: TWorkflowAST[] = [];
    extractFunctionLikes(sourceFile).forEach((fn: FunctionLike) => {
      const config = jsdocParser.parseWorkflow(fn, warnings);
      if (!config) return;

      const functionName = fn.getName() || 'anonymous';
      const startPorts = this.parseStartPorts(fn, config);
      const exitPorts = this.parseExitPorts(fn, config);
      const userSpecifiedAsync = fn.isAsync();

      workflows.push({
        type: 'Workflow',
        sourceFile: filePath,
        name: config.name || functionName,
        functionName,
        nodeTypes: [],
        instances: [],
        connections: [],
        startPorts,
        exitPorts,
        imports: [],
        description: config.description,
        userSpecifiedAsync,
      });
    });
    return workflows;
  }

  /**
   * Convert a workflow to a node type.
   * This allows workflows to be used as nodes in other workflows.
   */
  private workflowToNodeType(workflow: TWorkflowAST): TNodeTypeAST {
    return {
      type: 'NodeType',
      name: workflow.name,
      functionName: workflow.functionName,
      variant: 'IMPORTED_WORKFLOW',
      path: workflow.sourceFile,
      inputs: { ...workflow.startPorts },
      outputs: { ...workflow.exitPorts },
      hasSuccessPort: 'onSuccess' in workflow.exitPorts,
      hasFailurePort: 'onFailure' in workflow.exitPorts,
      isAsync: workflow.userSpecifiedAsync || false,
      executeWhen: EXECUTION_STRATEGIES.CONJUNCTION,
      description: workflow.description,
      sourceLocation: {
        file: workflow.sourceFile,
        line: 0,
        column: 0,
      },
    };
  }

  private extractWorkflows(
    sourceFile: SourceFile,
    availableNodeTypes: TNodeTypeAST[],
    filePath: string,
    errors: string[],
    warnings: string[]
  ): TWorkflowAST[] {
    const workflows: TWorkflowAST[] = [];
    const allFunctions = extractFunctionLikes(sourceFile);
    // Collect all function names in the file for unannotated-function hints in validator
    const allFunctionNames = allFunctions
      .map((fn: FunctionLike) => fn.getName())
      .filter((name): name is string => !!name);
    allFunctions.forEach((fn: FunctionLike) => {
      // Parse JSDoc comments
      const config = jsdocParser.parseWorkflow(fn, warnings);
      if (!config) {
        const jsdocText = fn.getJsDocs().map((d) => d.getFullText()).join('');
        if (jsdocText.includes('@flowWeaver workflow')) {
          warnings.push(
            `Function "${fn.getName() || 'anonymous'}" has @flowWeaver annotation but could not be parsed. ` +
            `Check for special characters (---) or malformed JSDoc syntax.`
          );
        }
        return;
      }

      const functionName = fn.getName() || 'anonymous';

      // Validate no IN/OUT pseudo-nodes in workflows (they're only for patterns)
      if (config.connections) {
        for (const conn of config.connections) {
          if (conn.from.node === 'IN' || conn.from.node === 'OUT') {
            errors.push(
              `Workflow "${functionName}" uses "${conn.from.node}" pseudo-node which is only valid in patterns. Use "Start" or "Exit" instead.`
            );
          }
          if (conn.to.node === 'IN' || conn.to.node === 'OUT') {
            errors.push(
              `Workflow "${functionName}" uses "${conn.to.node}" pseudo-node which is only valid in patterns. Use "Start" or "Exit" instead.`
            );
          }
        }
      }

      // Detect async keyword on workflow function declaration
      const userSpecifiedAsync = fn.isAsync();
      const startPorts = this.parseStartPorts(fn, config);
      const exitPorts = this.parseExitPorts(fn, config);

      // Convert @fwImport annotations to properly inferred node types
      // These are persisted in JSDoc so they survive file re-parsing
      // Uses the same inference logic as TS imports for consistency
      const importedNpmNodeTypes: TNodeTypeAST[] = (config.imports || []).map((imp) =>
        this.resolveImportAnnotation(imp, filePath, warnings)
      );

      // Combine available node types with imported npm types for validation
      const allAvailableNodeTypes = [...availableNodeTypes, ...importedNpmNodeTypes];

      // Convert instances to NodeInstanceAST
      const instances: TNodeInstanceAST[] = (config.instances || []).map((inst) => {
        // Validate node type exists — push error instead of throwing so that
        // partial parse results remain usable (defense-in-depth for race conditions)
        const nodeTypeExists = allAvailableNodeTypes.some(
          (nt) => nt.name === inst.type || nt.functionName === inst.type
        );
        if (!nodeTypeExists) {
          errors.push(
            `Node type "${inst.type}" not found in workflow "${functionName}". ` +
              `Available types: ${allAvailableNodeTypes.map((nt) => nt.functionName).join(', ') || '(none)'}`
          );
        }

        const position = config.positions?.[inst.id];
        // Convert parentScope string "nodeName.scope" to parent object
        let parent: { id: string; scope: string } | undefined;
        if (inst.parentScope) {
          const dotIndex = inst.parentScope.indexOf('.');
          if (dotIndex > 0) {
            parent = {
              id: inst.parentScope.substring(0, dotIndex),
              scope: inst.parentScope.substring(dotIndex + 1),
            };
          }
        }

        // portConfigs are direction-agnostic (annotations don't carry direction info).
        // Matching code handles undefined direction by matching any direction.
        const portConfigs = inst.portConfigs;

        return {
          type: 'NodeInstance',
          id: inst.id,
          nodeType: inst.type,
          ...(parent && { parent }),
          config: {
            ...(inst.label && { label: inst.label }),
            ...(inst.x !== undefined && inst.y !== undefined && { x: inst.x, y: inst.y }),
            ...(position && { x: position.x, y: position.y }),
            ...(portConfigs && portConfigs.length > 0 && { portConfigs }),
            ...(inst.pullExecution && { pullExecution: inst.pullExecution }),
            ...(inst.minimized && { minimized: inst.minimized }),
            ...(inst.color && { color: inst.color }),
            ...(inst.icon && { icon: inst.icon }),
            ...(inst.tags && inst.tags.length > 0 && { tags: inst.tags }),
            ...(inst.width && { width: inst.width }),
            ...(inst.height && { height: inst.height }),
          },
          ...(inst.sourceLocation && {
            sourceLocation: { file: filePath, ...inst.sourceLocation },
          }),
        };
      });

      // Convert connections to ConnectionAST
      const connections: TConnectionAST[] = (config.connections || []).map((conn) => ({
        type: 'Connection',
        from: conn.from,
        to: conn.to,
        ...(conn.sourceLocation && { sourceLocation: { file: filePath, ...conn.sourceLocation } }),
      }));

      // Auto-connect: when @autoConnect is set and no explicit @connect annotations exist,
      // auto-wire linear connections between nodes in declaration order
      if (config.autoConnect && connections.length === 0 && instances.length > 0) {
        const autoConnections = this.generateAutoConnections(
          instances,
          allAvailableNodeTypes,
          startPorts,
          exitPorts
        );
        connections.push(...autoConnections);
      }

      // Expand @map macros into synthetic node types, instances, connections, and scopes
      const scopes = config.scopes || {};
      const macros: TWorkflowMacro[] = [];
      if (config.maps && config.maps.length > 0) {
        for (const mapConfig of config.maps) {
          this.expandMapMacro(
            mapConfig,
            instances,
            connections,
            scopes,
            allAvailableNodeTypes,
            macros,
            errors,
            warnings
          );
        }
      }

      // Expand @path macros into multi-step execution routes with scope walking
      if (config.paths && config.paths.length > 0) {
        this.expandPathMacros(
          config.paths,
          instances,
          connections,
          allAvailableNodeTypes,
          startPorts,
          exitPorts,
          macros,
          errors,
          warnings,
        );
      }

      // Expand @fanOut macros into 1-to-N connections
      if (config.fanOuts && config.fanOuts.length > 0) {
        this.expandFanOutMacros(config.fanOuts, instances, connections, startPorts, exitPorts, macros, errors);
      }

      // Expand @fanIn macros into N-to-1 connections
      if (config.fanIns && config.fanIns.length > 0) {
        this.expandFanInMacros(config.fanIns, instances, connections, startPorts, exitPorts, macros, errors);
      }

      // Expand @coerce macros into synthetic coercion nodes + connections
      if (config.coercions && config.coercions.length > 0) {
        this.expandCoerceMacros(config.coercions, instances, connections, startPorts, exitPorts, macros, errors);
      }

      // Include ALL available nodeTypes in the workflow AST, plus imported npm types.
      // Previously this filtered to only nodeTypes used by instances, but that caused
      // a bug: when creating a new nodeType and then adding its first instance,
      // the second operation would re-parse the file, see no instances using the
      // nodeType yet, filter it out, and then removeOrphanedNodeTypeFunctions would
      // delete the nodeType function that was just written.
      // NPM types come from @import annotations in JSDoc (persisted to survive re-parsing).
      // Deduplicate: @fwImport types take precedence over external/runtime types with the same name.
      // Without this, each parse+generate cycle adds one more duplicate @fwImport entry.
      const importedNames = new Set(importedNpmNodeTypes.map((nt) => nt.name));
      // Use allAvailableNodeTypes (includes synthetic MAP_ITERATOR types from @map macros)
      const dedupedAvailableTypes = allAvailableNodeTypes.filter((nt) => !importedNames.has(nt.name));
      const workflowNodeTypes = [...dedupedAvailableTypes, ...importedNpmNodeTypes];

      // Inject synthetic coercion node types for any __fw_ instances
      for (const inst of instances) {
        if (inst.nodeType.startsWith('__fw_') && COERCION_NODE_TYPES[inst.nodeType]) {
          if (!workflowNodeTypes.some(nt => nt.functionName === inst.nodeType)) {
            workflowNodeTypes.push(COERCION_NODE_TYPES[inst.nodeType]);
          }
        }
      }

      // Extract Start/Exit positions from config.positions
      const ui: { startNode?: { x: number; y: number }; exitNode?: { x: number; y: number } } = {};
      const startPosition = config.positions?.['Start'];
      if (startPosition) {
        ui.startNode = { x: startPosition.x, y: startPosition.y };
      }
      const exitPosition = config.positions?.['Exit'];
      if (exitPosition) {
        ui.exitNode = { x: exitPosition.x, y: exitPosition.y };
      }

      workflows.push({
        type: 'Workflow',
        sourceFile: filePath,
        name: config.name || functionName,
        functionName: functionName,
        nodeTypes: workflowNodeTypes,
        instances,
        connections,
        scopes,
        startPorts,
        exitPorts,
        imports: [],
        description: config.description,
        userSpecifiedAsync,
        availableFunctionNames: allFunctionNames,
        ...(macros.length > 0 && { macros }),
        ...(Object.keys(ui).length > 0 && { ui }),
        ...((config.strictTypes !== undefined || config.autoConnect ||
             config.trigger || config.cancelOn || config.retries !== undefined ||
             config.timeout || config.throttle) && {
          options: {
            ...(config.strictTypes !== undefined && { strictTypes: config.strictTypes }),
            ...(config.autoConnect && { autoConnect: true }),
            ...(config.trigger && { trigger: config.trigger }),
            ...(config.cancelOn && { cancelOn: config.cancelOn }),
            ...(config.retries !== undefined && { retries: config.retries }),
            ...(config.timeout && { timeout: config.timeout }),
            ...(config.throttle && { throttle: config.throttle }),
          },
        }),
      });
    });
    return workflows;
  }

  /**
   * Extract patterns from a source file.
   * Patterns are defined with @flowWeaver pattern annotation.
   */
  private extractPatterns(
    sourceFile: SourceFile,
    availableNodeTypes: TNodeTypeAST[],
    filePath: string,
    errors: string[],
    warnings: string[]
  ): TPatternAST[] {
    const patterns: TPatternAST[] = [];
    const seenNames = new Set<string>();

    extractFunctionLikes(sourceFile).forEach((fn: FunctionLike) => {
      // Parse JSDoc comments for pattern
      const config = jsdocParser.parsePattern(fn, warnings);
      if (!config) {
        const jsdocText = fn.getJsDocs().map((d) => d.getFullText()).join('');
        if (jsdocText.includes('@flowWeaver pattern')) {
          warnings.push(
            `Function "${fn.getName() || 'anonymous'}" has @flowWeaver annotation but could not be parsed. ` +
            `Check for special characters (---) or malformed JSDoc syntax.`
          );
        }
        return;
      }

      // Validate required @name
      if (!config.name) {
        errors.push(`Pattern is missing required @name tag in function "${fn.getName()}"`);
        return;
      }

      // Check for duplicate names
      if (seenNames.has(config.name)) {
        errors.push(`Duplicate pattern name "${config.name}" in file`);
        return;
      }
      seenNames.add(config.name);

      // Extract node types used by this pattern
      const patternNodeTypes = availableNodeTypes.filter((nt) =>
        config.instances?.some((inst) => inst.nodeType === nt.name)
      );

      // Build connections from config
      const connections: TConnectionAST[] = (config.connections || []).map((conn) => ({
        type: 'Connection' as const,
        from: conn.from,
        to: conn.to,
      }));

      // Extract input/output ports from @port declarations
      const inputPorts: Record<string, { description?: string }> = {};
      const outputPorts: Record<string, { description?: string }> = {};

      if (config.ports) {
        for (const port of config.ports) {
          if (port.direction === 'IN') {
            inputPorts[port.name] = { description: port.description };
          } else if (port.direction === 'OUT') {
            outputPorts[port.name] = { description: port.description };
          }
        }
      }

      // Build instances from config
      const instances: TNodeInstanceAST[] = (config.instances || []).map((inst) => ({
        type: 'NodeInstance' as const,
        id: inst.id,
        nodeType: inst.nodeType,
        config: inst.config || {},
      }));

      patterns.push({
        type: 'Pattern',
        sourceFile: filePath,
        name: config.name,
        description: config.description,
        nodeTypes: patternNodeTypes,
        instances,
        connections,
        inputPorts,
        outputPorts,
      });
    });

    return patterns;
  }

  /**
   * Infer a TNodeTypeAST from a single function's TypeScript signature.
   * Shared helper used by both same-file and cross-file inference.
   */
  private inferNodeTypeFromFunction(
    fn: FunctionLike,
    name: string,
    filePath: string
  ): TNodeTypeAST {
    // Infer inputs from parameters
    const inputs: Record<string, TPortDefinition> = {};
    const params = fn.getParameters();
    const firstParamIsExecute = params.length > 0 && params[0].getName() === 'execute';
    for (const param of params) {
      const paramName = param.getName();
      const tsType = param.getType().getText(param);
      const dataType = inferDataTypeFromTS(tsType);
      const optional = param.isOptional() || param.hasInitializer();
      inputs[paramName] = {
        dataType,
        optional: optional || undefined,
        label: this.capitalize(paramName),
        tsType,
      };
    }

    // Infer outputs from return type
    const outputs: Record<string, TPortDefinition> = {};
    let returnType = fn.getReturnType();
    const returnTypeText = returnType.getText();

    // Unwrap Promise<T>
    if (returnTypeText.startsWith('Promise<')) {
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
        for (const prop of properties) {
          const propName = prop.getName();
          if (propName === 'onSuccess' || propName === 'onFailure') continue;
          const propType = prop.getTypeAtLocation(fn.getTypeResolutionNode());
          const propTypeText = propType.getText();
          const dataType = inferDataTypeFromTS(propTypeText);
          outputs[propName] = {
            dataType,
            label: this.capitalize(propName),
            tsType: propTypeText,
          };
        }
      } else {
        const dataType = inferDataTypeFromTS(unwrappedText);
        outputs.result = {
          dataType,
          label: 'Result',
          tsType: unwrappedText,
        };
      }
    }

    // Add mandatory ports
    inputs.execute = { dataType: 'STEP', label: 'Execute' };
    outputs.onSuccess = { dataType: 'STEP', label: 'On Success', isControlFlow: true };
    outputs.onFailure = {
      dataType: 'STEP',
      label: 'On Failure',
      failure: true,
      isControlFlow: true,
    };

    // Assign implicit port orders
    assignImplicitPortOrders(inputs);
    assignImplicitPortOrders(outputs);

    // Build TNodeTypeAST
    const jsDocs = fn.getJsDocs();
    const jsDocText = jsDocs.map((doc: JSDoc) => doc.getText()).join('\n');
    const functionText = jsDocText ? `${jsDocText}\n${fn.getText()}` : fn.getText();

    return {
      type: 'NodeType',
      name,
      functionName: name,
      variant: 'FUNCTION',
      inputs,
      outputs,
      hasSuccessPort: true,
      hasFailurePort: true,
      isAsync: fn.isAsync() || returnTypeText.startsWith('Promise<'),
      executeWhen: EXECUTION_STRATEGIES.CONJUNCTION as TExecuteWhen,
      expression: !firstParamIsExecute, // Expression only if original function lacks execute as first param
      inferred: true,
      functionText,
      ...(fn.getDeclarationKind?.() && {
        declarationKind: fn.getDeclarationKind!(),
      }),
      sourceLocation: {
        file: filePath,
        line: fn.getStartLineNumber(false),
        column: 0,
      },
    };
  }

  /**
   * Pre-infer ALL unannotated functions from a source file.
   * Used for imported files so the named-import filter can scope them.
   */
  private inferAllUnannotatedFunctions(
    sourceFile: SourceFile,
    existingNodeTypes: TNodeTypeAST[]
  ): TNodeTypeAST[] {
    const allFunctions = extractFunctionLikes(sourceFile);
    const existingNames = new Set<string>();
    for (const nt of existingNodeTypes) {
      existingNames.add(nt.name);
      existingNames.add(nt.functionName);
    }

    const inferred: TNodeTypeAST[] = [];
    for (const fn of allFunctions) {
      const fnName = fn.getName();
      if (!fnName) continue;

      // Skip if already known (annotated or from another source)
      if (existingNames.has(fnName)) continue;

      // Must NOT have a valid @flowWeaver annotation
      if (this.hasFlowWeaverAnnotation(fn)) continue;

      inferred.push(this.inferNodeTypeFromFunction(fn, fnName, sourceFile.getFilePath()));
      existingNames.add(fnName);
    }

    return inferred;
  }

  /**
   * Auto-infer node types from unannotated functions referenced by @node.
   *
   * When a workflow references a function via @node that has no @flowWeaver
   * nodeType annotation, we infer an expression node type from its TypeScript
   * signature. Phase 1: same-file functions only.
   */
  private inferNodeTypesFromUnannotated(
    sourceFile: SourceFile,
    existingNodeTypes: TNodeTypeAST[]
  ): TNodeTypeAST[] {
    const allFunctions = extractFunctionLikes(sourceFile);

    // 1. Pre-scan workflows for @node references to collect referenced type names
    const referencedTypes = new Set<string>();
    for (const fn of allFunctions) {
      const config = jsdocParser.parseWorkflow(fn, []);
      if (!config) continue;
      for (const inst of config.instances || []) {
        referencedTypes.add(inst.type);
      }
    }

    // 2. Find unresolved types: referenced but not in existingNodeTypes
    const existingNames = new Set<string>();
    for (const nt of existingNodeTypes) {
      existingNames.add(nt.name);
      existingNames.add(nt.functionName);
    }
    const unresolvedTypes = new Set<string>();
    for (const typeName of referencedTypes) {
      if (!existingNames.has(typeName)) {
        unresolvedTypes.add(typeName);
      }
    }

    if (unresolvedTypes.size === 0) return [];

    // 3. Match unresolved types to unannotated functions in the same file
    const inferredNodeTypes: TNodeTypeAST[] = [];
    const alreadyInferred = new Set<string>();

    for (const unresolvedType of unresolvedTypes) {
      if (alreadyInferred.has(unresolvedType)) continue;

      // Find matching function
      const matchedFn = allFunctions.find((fn) => {
        if (fn.getName() !== unresolvedType) return false;
        // Must NOT have a valid @flowWeaver annotation
        return !this.hasFlowWeaverAnnotation(fn);
      });

      if (!matchedFn) continue;

      inferredNodeTypes.push(
        this.inferNodeTypeFromFunction(matchedFn, unresolvedType, sourceFile.getFilePath())
      );
      alreadyInferred.add(unresolvedType);
    }

    return inferredNodeTypes;
  }

  /**
   * Expand a @map macro into synthetic node type, instances, connections, and scope.
   *
   * @map loop proc over scan.files
   *
   * Expands to:
   * - A synthetic MAP_ITERATOR node type for "loop" with scoped ports
   * - An instance "loop" of that synthetic type
   * - The child instance "proc" placed inside loop.iterate scope
   * - All scoped connections auto-generated
   * - Upstream connection from scan.files -> loop.items
   */
  private expandMapMacro(
    mapConfig: {
      instanceId: string;
      childId: string;
      sourceNode: string;
      sourcePort: string;
      inputPort?: string;
      outputPort?: string;
    },
    instances: TNodeInstanceAST[],
    connections: TConnectionAST[],
    scopes: Record<string, string[]>,
    availableNodeTypes: TNodeTypeAST[],
    macros: TWorkflowMacro[],
    errors: string[],
    _warnings: string[]
  ): void {
    const { instanceId, childId, sourceNode, sourcePort } = mapConfig;
    const scopeName = 'iterate';

    // Find the child node instance (must already be declared via @node)
    const childInstance = instances.find((inst) => inst.id === childId);
    if (!childInstance) {
      errors.push(
        `@map "${instanceId}": child node "${childId}" not found. Declare it with @node before using @map.`
      );
      return;
    }

    // Find the child's node type to determine ports
    const childNodeType = availableNodeTypes.find(
      (nt) => nt.name === childInstance.nodeType || nt.functionName === childInstance.nodeType
    );
    if (!childNodeType) {
      errors.push(
        `@map "${instanceId}": node type "${childInstance.nodeType}" for child "${childId}" not found.`
      );
      return;
    }

    // Determine input/output ports on the child
    // Auto-infer: first non-execute data input, first non-control-flow data output
    let inputPort = mapConfig.inputPort;
    let outputPort = mapConfig.outputPort;

    if (!inputPort) {
      const dataInputs = Object.entries(childNodeType.inputs).filter(
        ([name, def]) => name !== 'execute' && def.dataType !== 'STEP'
      );
      if (dataInputs.length === 0) {
        errors.push(
          `@map "${instanceId}": child node "${childId}" has no data input ports to receive items.`
        );
        return;
      }
      inputPort = dataInputs[0][0];
    }

    if (!outputPort) {
      const dataOutputs = Object.entries(childNodeType.outputs).filter(
        ([name, def]) =>
          name !== 'onSuccess' && name !== 'onFailure' && def.dataType !== 'STEP' && !def.isControlFlow && !def.failure
      );
      if (dataOutputs.length === 0) {
        errors.push(
          `@map "${instanceId}": child node "${childId}" has no data output ports for results.`
        );
        return;
      }
      outputPort = dataOutputs[0][0];
    }

    // Get type info from child ports for the synthetic type
    const childInputDef = childNodeType.inputs[inputPort];
    const childOutputDef = childNodeType.outputs[outputPort];

    // Create synthetic MAP_ITERATOR node type
    const syntheticTypeName = `__map_${instanceId}__`;
    const syntheticNodeType: TNodeTypeAST = {
      type: 'NodeType',
      name: syntheticTypeName,
      functionName: syntheticTypeName,
      variant: 'MAP_ITERATOR',
      isAsync: true,
      executeWhen: 'CONJUNCTION',
      hasSuccessPort: true,
      hasFailurePort: true,
      scope: scopeName,
      scopes: [scopeName],
      inputs: {
        execute: { dataType: 'STEP', label: 'Execute' },
        items: {
          dataType: 'ARRAY',
          label: 'Items',
          tsType: childInputDef?.tsType ? `(${childInputDef.tsType})[]` : 'unknown[]',
        },
        // Scoped INPUT ports (receive from children)
        success: { dataType: 'STEP', scope: scopeName },
        failure: { dataType: 'STEP', scope: scopeName },
        processed: {
          dataType: childOutputDef?.dataType || 'ANY',
          scope: scopeName,
          ...(childOutputDef?.tsType && { tsType: childOutputDef.tsType }),
        },
      },
      outputs: {
        onSuccess: { dataType: 'STEP', label: 'On Success', isControlFlow: true },
        onFailure: { dataType: 'STEP', label: 'On Failure', isControlFlow: true, failure: true },
        results: {
          dataType: 'ARRAY',
          label: 'Results',
          tsType: childOutputDef?.tsType ? `(${childOutputDef.tsType})[]` : 'unknown[]',
        },
        // Scoped OUTPUT ports (send to children)
        start: { dataType: 'STEP', scope: scopeName },
        item: {
          dataType: childInputDef?.dataType || 'ANY',
          scope: scopeName,
          ...(childInputDef?.tsType && { tsType: childInputDef.tsType }),
        },
      },
    };

    // Add synthetic type to available types
    availableNodeTypes.push(syntheticNodeType);

    // Create instance for the map iterator
    const mapInstance: TNodeInstanceAST = {
      type: 'NodeInstance',
      id: instanceId,
      nodeType: syntheticTypeName,
    };
    instances.push(mapInstance);

    // Move child instance into the scope
    childInstance.parent = { id: instanceId, scope: scopeName };

    // Generate scoped connections
    // loop.start:iterate -> proc.execute
    connections.push({
      type: 'Connection',
      from: { node: instanceId, port: 'start', scope: scopeName },
      to: { node: childId, port: 'execute', scope: scopeName },
    });

    // loop.item:iterate -> proc.<inputPort>
    connections.push({
      type: 'Connection',
      from: { node: instanceId, port: 'item', scope: scopeName },
      to: { node: childId, port: inputPort, scope: scopeName },
    });

    // proc.<outputPort> -> loop.processed:iterate
    connections.push({
      type: 'Connection',
      from: { node: childId, port: outputPort, scope: scopeName },
      to: { node: instanceId, port: 'processed', scope: scopeName },
    });

    // proc.onSuccess -> loop.success:iterate
    connections.push({
      type: 'Connection',
      from: { node: childId, port: 'onSuccess', scope: scopeName },
      to: { node: instanceId, port: 'success', scope: scopeName },
    });

    // proc.onFailure -> loop.failure:iterate
    connections.push({
      type: 'Connection',
      from: { node: childId, port: 'onFailure', scope: scopeName },
      to: { node: instanceId, port: 'failure', scope: scopeName },
    });

    // Generate upstream connection: source.port -> loop.items
    connections.push({
      type: 'Connection',
      from: { node: sourceNode, port: sourcePort },
      to: { node: instanceId, port: 'items' },
    });

    // Register scope
    scopes[`${instanceId}.${scopeName}`] = [childId];

    // Store macro for round-trip preservation
    macros.push({
      type: 'map',
      instanceId,
      childId,
      sourcePort: `${sourceNode}.${sourcePort}`,
      ...(mapConfig.inputPort && { inputPort: mapConfig.inputPort }),
      ...(mapConfig.outputPort && { outputPort: mapConfig.outputPort }),
    });
  }

  /**
   * Expand @path macros into multi-step execution routes with scope walking.
   * Processes all paths together for shared deduplication.
   */
  private expandPathMacros(
    pathConfigs: Array<{ steps: Array<{ node: string; route?: 'ok' | 'fail' }> }>,
    instances: TNodeInstanceAST[],
    connections: TConnectionAST[],
    availableNodeTypes: TNodeTypeAST[],
    startPorts: Record<string, TPortDefinition>,
    exitPorts: Record<string, TPortDefinition>,
    macros: TWorkflowMacro[],
    errors: string[],
    warnings: string[],
  ): void {
    // Helper to find a node type by name or functionName
    const findNodeType = (nodeTypeName: string): TNodeTypeAST | undefined =>
      availableNodeTypes.find(
        (nt) => nt.name === nodeTypeName || nt.functionName === nodeTypeName
      );

    // Helper to resolve instance → node type
    const getNodeType = (nodeId: string): TNodeTypeAST | undefined => {
      const instance = instances.find((inst) => inst.id === nodeId);
      if (!instance) return undefined;
      return findNodeType(instance.nodeType);
    };

    // Helper to get output ports for a node (handling Start/Exit)
    const getOutputPorts = (nodeId: string): Record<string, TPortDefinition> => {
      if (nodeId === 'Start') return startPorts;
      if (nodeId === 'Exit') return exitPorts;
      const nodeType = getNodeType(nodeId);
      return nodeType?.outputs || {};
    };

    // Helper to get input ports for a node (handling Start/Exit)
    const getInputPorts = (nodeId: string): Record<string, TPortDefinition> => {
      if (nodeId === 'Exit') return exitPorts;
      if (nodeId === 'Start') return startPorts;
      const nodeType = getNodeType(nodeId);
      return nodeType?.inputs || {};
    };

    // Build a set of existing connection keys for deduplication
    const existingKeys = new Set<string>();
    for (const conn of connections) {
      existingKeys.add(`${conn.from.node}.${conn.from.port}->${conn.to.node}.${conn.to.port}`);
    }

    const addConnection = (fromNode: string, fromPort: string, toNode: string, toPort: string) => {
      const key = `${fromNode}.${fromPort}->${toNode}.${toPort}`;
      if (existingKeys.has(key)) return;
      existingKeys.add(key);
      connections.push({
        type: 'Connection',
        from: { node: fromNode, port: fromPort },
        to: { node: toNode, port: toPort },
      });
    };

    for (const pathConfig of pathConfigs) {
      const { steps } = pathConfig;

      if (steps.length < 2) {
        errors.push(`@path requires at least 2 steps, got ${steps.length}.`);
        continue;
      }

      // Validate all node references exist
      let valid = true;
      for (const step of steps) {
        if (step.node === 'Start' || step.node === 'Exit') continue;
        const instance = instances.find((inst) => inst.id === step.node);
        if (!instance) {
          errors.push(
            `@path: node "${step.node}" not found. Declare it with @node before using @path.`
          );
          valid = false;
        }
      }
      if (!valid) continue;

      // Generate connections for each consecutive pair
      for (let i = 0; i < steps.length - 1; i++) {
        const current = steps[i];
        const next = steps[i + 1];
        const currentId = current.node;
        const nextId = next.node;
        const route = current.route || 'ok';

        // Control flow connection
        if (currentId === 'Start') {
          addConnection('Start', 'execute', nextId, 'execute');
        } else if (nextId === 'Exit') {
          if (route === 'fail') {
            addConnection(currentId, 'onFailure', 'Exit', 'onFailure');
          } else {
            addConnection(currentId, 'onSuccess', 'Exit', 'onSuccess');
          }
        } else {
          if (route === 'fail') {
            addConnection(currentId, 'onFailure', nextId, 'execute');
          } else {
            addConnection(currentId, 'onSuccess', nextId, 'execute');
          }
        }

        // Data port scope walking (skip Exit — no data inputs to wire)
        if (nextId === 'Exit') continue;

        const nextInputs = getInputPorts(nextId);
        for (const [inputName] of Object.entries(nextInputs)) {
          if (isControlFlowPort(inputName)) continue;

          // Walk backward through path steps to find nearest ancestor with same-name output
          for (let j = i; j >= 0; j--) {
            const ancestorId = steps[j].node;
            const ancestorOutputs = getOutputPorts(ancestorId);
            if (inputName in ancestorOutputs && !isControlFlowPort(inputName)) {
              addConnection(ancestorId, inputName, nextId, inputName);
              break;
            }
          }
        }
      }

      // Store macro for round-trip preservation
      macros.push({
        type: 'path',
        steps: steps.map(s => s.route ? { node: s.node, route: s.route } : { node: s.node }),
      });
    }
  }

  /**
   * Expand @fanOut macros into 1-to-N connections.
   */
  private expandFanOutMacros(
    fanOutConfigs: Array<{ source: { node: string; port: string }; targets: Array<{ node: string; port?: string }> }>,
    instances: TNodeInstanceAST[],
    connections: TConnectionAST[],
    startPorts: Record<string, TPortDefinition>,
    exitPorts: Record<string, TPortDefinition>,
    macros: TWorkflowMacro[],
    errors: string[],
  ): void {
    const instanceIds = new Set(instances.map(i => i.id));
    instanceIds.add('Start');
    instanceIds.add('Exit');

    for (const config of fanOutConfigs) {
      const { source, targets } = config;

      // Validate source node exists
      if (!instanceIds.has(source.node)) {
        errors.push(`@fanOut: source node "${source.node}" does not exist`);
        continue;
      }

      let valid = true;
      for (const target of targets) {
        if (!instanceIds.has(target.node)) {
          errors.push(`@fanOut: target node "${target.node}" does not exist`);
          valid = false;
        }
      }
      if (!valid) continue;

      // Create connections
      for (const target of targets) {
        const targetPort = target.port ?? source.port;
        const conn: TConnectionAST = {
          type: 'Connection',
          from: { node: source.node, port: source.port },
          to: { node: target.node, port: targetPort },
        };
        // Deduplicate
        const exists = connections.some(
          c => c.from.node === conn.from.node && c.from.port === conn.from.port &&
               c.to.node === conn.to.node && c.to.port === conn.to.port
        );
        if (!exists) {
          connections.push(conn);
        }
      }

      // Store macro for round-trip preservation
      macros.push({
        type: 'fanOut',
        source: { node: source.node, port: source.port },
        targets: targets.map(t => t.port ? { node: t.node, port: t.port } : { node: t.node }),
      });
    }
  }

  /**
   * Expand @fanIn macros into N-to-1 connections.
   */
  private expandFanInMacros(
    fanInConfigs: Array<{ sources: Array<{ node: string; port?: string }>; target: { node: string; port: string } }>,
    instances: TNodeInstanceAST[],
    connections: TConnectionAST[],
    startPorts: Record<string, TPortDefinition>,
    exitPorts: Record<string, TPortDefinition>,
    macros: TWorkflowMacro[],
    errors: string[],
  ): void {
    const instanceIds = new Set(instances.map(i => i.id));
    instanceIds.add('Start');
    instanceIds.add('Exit');

    for (const config of fanInConfigs) {
      const { sources, target } = config;

      // Validate target node exists
      if (!instanceIds.has(target.node)) {
        errors.push(`@fanIn: target node "${target.node}" does not exist`);
        continue;
      }

      let valid = true;
      for (const source of sources) {
        if (!instanceIds.has(source.node)) {
          errors.push(`@fanIn: source node "${source.node}" does not exist`);
          valid = false;
        }
      }
      if (!valid) continue;

      // Create connections
      for (const source of sources) {
        const sourcePort = source.port ?? target.port;
        const conn: TConnectionAST = {
          type: 'Connection',
          from: { node: source.node, port: sourcePort },
          to: { node: target.node, port: target.port },
        };
        // Deduplicate
        const exists = connections.some(
          c => c.from.node === conn.from.node && c.from.port === conn.from.port &&
               c.to.node === conn.to.node && c.to.port === conn.to.port
        );
        if (!exists) {
          connections.push(conn);
        }
      }

      // Store macro for round-trip preservation
      macros.push({
        type: 'fanIn',
        sources: sources.map(s => s.port ? { node: s.node, port: s.port } : { node: s.node }),
        target: { node: target.node, port: target.port },
      });
    }
  }

  /**
   * Expand @coerce macros into synthetic coercion node instances + connections.
   */
  private expandCoerceMacros(
    coerceConfigs: Array<{
      instanceId: string;
      source: { node: string; port: string };
      target: { node: string; port: string };
      targetType: 'string' | 'number' | 'boolean' | 'json' | 'object';
    }>,
    instances: TNodeInstanceAST[],
    connections: TConnectionAST[],
    startPorts: Record<string, TPortDefinition>,
    exitPorts: Record<string, TPortDefinition>,
    macros: TWorkflowMacro[],
    errors: string[],
  ): void {
    const instanceIds = new Set(instances.map(i => i.id));
    instanceIds.add('Start');
    instanceIds.add('Exit');

    for (const config of coerceConfigs) {
      const { instanceId, source, target, targetType } = config;

      // Validate source and target nodes exist
      if (!instanceIds.has(source.node)) {
        errors.push(`@coerce: source node "${source.node}" does not exist`);
        continue;
      }
      if (!instanceIds.has(target.node)) {
        errors.push(`@coerce: target node "${target.node}" does not exist`);
        continue;
      }

      // Check for duplicate instance ID
      if (instanceIds.has(instanceId)) {
        errors.push(`@coerce: instance ID "${instanceId}" already exists`);
        continue;
      }

      const nodeTypeName = COERCE_TYPE_MAP[targetType];
      if (!nodeTypeName) {
        errors.push(`@coerce: unknown target type "${targetType}"`);
        continue;
      }

      // Add synthetic instance
      instances.push({
        type: 'NodeInstance',
        id: instanceId,
        nodeType: nodeTypeName,
      });
      instanceIds.add(instanceId);

      // Add connections: source -> coercion.value, coercion.result -> target
      connections.push({
        type: 'Connection',
        from: { node: source.node, port: source.port },
        to: { node: instanceId, port: 'value' },
      });
      connections.push({
        type: 'Connection',
        from: { node: instanceId, port: 'result' },
        to: { node: target.node, port: target.port },
      });

      // Store macro for round-trip preservation
      macros.push({
        type: 'coerce',
        instanceId,
        source: { node: source.node, port: source.port },
        target: { node: target.node, port: target.port },
        targetType,
      });
    }
  }

  /**
   * Generate automatic connections for @autoConnect workflows.
   * Wires nodes in declaration order as a linear pipeline:
   * Start -> first node -> second node -> ... -> last node -> Exit
   *
   * For each consecutive pair:
   * - Connect execute flow: previous.onSuccess -> next.execute
   * - Connect data ports where output name matches input name
   * For first node: Start.execute -> first.execute + match Start data ports to first inputs
   * For last node: last.onSuccess -> Exit.execute + match last outputs to Exit ports
   */
  private generateAutoConnections(
    instances: TNodeInstanceAST[],
    availableNodeTypes: TNodeTypeAST[],
    startPorts: Record<string, TPortDefinition>,
    exitPorts: Record<string, TPortDefinition>
  ): TConnectionAST[] {
    const connections: TConnectionAST[] = [];

    // Helper to find a node type by name or functionName
    const findNodeType = (nodeTypeName: string): TNodeTypeAST | undefined =>
      availableNodeTypes.find(
        (nt) => nt.name === nodeTypeName || nt.functionName === nodeTypeName
      );

    // Connect Start -> first node
    if (instances.length > 0) {
      const firstInstance = instances[0];
      const firstNodeType = findNodeType(firstInstance.nodeType);

      // Start.execute -> first.execute (execution flow)
      connections.push({
        type: 'Connection',
        from: { node: 'Start', port: 'execute' },
        to: { node: firstInstance.id, port: 'execute' },
      });

      // Match Start data ports to first node's data inputs
      if (firstNodeType) {
        for (const [portName, portDef] of Object.entries(startPorts)) {
          if (portDef.dataType === 'STEP') continue; // Skip control flow
          if (portName in firstNodeType.inputs && !isControlFlowPort(portName)) {
            connections.push({
              type: 'Connection',
              from: { node: 'Start', port: portName },
              to: { node: firstInstance.id, port: portName },
            });
          }
        }
      }
    }

    // Connect consecutive nodes
    for (let i = 0; i < instances.length - 1; i++) {
      const current = instances[i];
      const next = instances[i + 1];
      const currentNodeType = findNodeType(current.nodeType);
      const nextNodeType = findNodeType(next.nodeType);

      // current.onSuccess -> next.execute (execution flow)
      connections.push({
        type: 'Connection',
        from: { node: current.id, port: 'onSuccess' },
        to: { node: next.id, port: 'execute' },
      });

      // Match data ports: current outputs -> next inputs (by matching port names)
      if (currentNodeType && nextNodeType) {
        for (const [outputName, outputDef] of Object.entries(currentNodeType.outputs)) {
          if (outputDef.dataType === 'STEP' || isControlFlowPort(outputName)) continue;
          if (outputName in nextNodeType.inputs && !isControlFlowPort(outputName)) {
            connections.push({
              type: 'Connection',
              from: { node: current.id, port: outputName },
              to: { node: next.id, port: outputName },
            });
          }
        }
      }
    }

    // Connect last node -> Exit
    if (instances.length > 0) {
      const lastInstance = instances[instances.length - 1];
      const lastNodeType = findNodeType(lastInstance.nodeType);

      // last.onSuccess -> Exit.onSuccess (execution flow)
      connections.push({
        type: 'Connection',
        from: { node: lastInstance.id, port: 'onSuccess' },
        to: { node: 'Exit', port: 'onSuccess' },
      });

      // Match last node's data outputs to Exit data ports
      if (lastNodeType) {
        for (const [portName, portDef] of Object.entries(exitPorts)) {
          if (portDef.dataType === 'STEP' || portDef.isControlFlow) continue;
          if (lastNodeType.outputs[portName] && !isControlFlowPort(portName)) {
            connections.push({
              type: 'Connection',
              from: { node: lastInstance.id, port: portName },
              to: { node: 'Exit', port: portName },
            });
          }
        }
      }
    }

    return connections;
  }

  private parseStartPorts(
    fn: FunctionLike,
    config?: ReturnType<typeof jsdocParser.parseWorkflow>
  ): Record<string, TPortDefinition> {
    const ports: Record<string, TPortDefinition> = {};
    const params = fn.getParameters();

    // New architecture: first parameter should be execute: boolean
    // Second parameter is the params object with data
    if (params.length === 0) {
      // No parameters - just return execute port
      ports.execute = { dataType: 'STEP', label: 'Execute' };
      return ports;
    }

    // Check if first parameter is execute: boolean
    const firstParam = params[0];
    const firstParamName = firstParam.getName();
    const firstParamType = firstParam.getType();
    const firstParamTypeText = firstParamType.getText();

    if (firstParamName === 'execute' && firstParamTypeText === 'boolean') {
      // Correct new format: first param is execute
      // Check if JSDoc has explicit metadata override for execute port (from @param annotation)
      if (config?.startPorts && config.startPorts['execute']) {
        ports.execute = {
          dataType: 'STEP',
          tsType: 'boolean',
          ...config.startPorts['execute'],
        };
      } else {
        ports.execute = { dataType: 'STEP', tsType: 'boolean', label: 'Execute' };
      }

      // Extract data ports from second parameter if it exists
      if (params.length > 1) {
        const dataParam = params[1];
        const dataParamType = dataParam.getType();
        const properties = dataParamType.getProperties();
        properties.forEach((prop: TsSymbol) => {
          const propName = prop.getName();
          const propType = prop.getTypeAtLocation(dataParam);
          const portType = this.inferPortType(propType);
          const propTypeText = propType.getText();
          // Extract schema for complex types (interfaces/objects)
          const tsSchema = portType === 'OBJECT' ? this.extractTypeSchema(propType) : undefined;

          // Check if JSDoc has explicit metadata override for this start port (from @param annotation)
          // Always prefer ts-morph inferred type over JSDoc regex-based inference
          // (JSDoc @param type inference uses regex which can fail for complex types)
          const startPortConfig = config?.startPorts?.[propName];
          ports[propName] = {
            dataType: portType,
            label: startPortConfig?.label || this.capitalize(propName),
            ...(startPortConfig?.metadata && { metadata: startPortConfig.metadata }),
            // Include original TS type for rich type display
            ...(propTypeText && { tsType: propTypeText }),
            // Include schema breakdown for complex types
            ...(tsSchema && Object.keys(tsSchema).length > 0 && { tsSchema }),
          };
        });
      }
    } else {
      // Old format detected - reject it
      throw new Error(
        `Invalid node type function signature for "${fn.getName()}". ` +
          `Expected first parameter to be "execute: boolean", but got "${firstParamName}: ${firstParamTypeText}". ` +
          `Correct format: function ${fn.getName()}(execute: boolean, data: {...}) { ... }`
      );
    }

    // Assign implicit port orders with mandatory port precedence
    assignImplicitPortOrders(ports);

    return ports;
  }
  private parseExitPorts(
    fn: FunctionLike,
    config: ReturnType<typeof jsdocParser.parseWorkflow>
  ): Record<string, TPortDefinition> {
    const ports: Record<string, TPortDefinition> = {};
    let returnType = fn.getReturnType();

    // If return type is a Promise, extract the type parameter
    const typeText = returnType?.getText();
    const sourceFile = fn.getSourceFile();
    const filePath = sourceFile?.getFilePath() || 'unknown file';
    const fileName = path.basename(filePath);

    if (!typeText || typeText === 'void') {
      console.warn(
        `[PARSER] Could not determine return type for function "${fn.getName()}" in ${fileName}.\n` +
          `  Add an explicit return type like: Promise<{ onSuccess: boolean; onFailure: boolean }>`
      );
      return ports;
    }

    if (typeText.startsWith('Promise<')) {
      const typeArgs = returnType.getTypeArguments();
      if (typeArgs && typeArgs.length > 0) {
        returnType = typeArgs[0];
      }
    }

    const properties = returnType.getProperties();
    properties.forEach((prop: TsSymbol) => {
      const propName = prop.getName();
      // Always infer from TypeScript signature, use @returns annotation only for metadata
      // onSuccess/onFailure are always STEP ports regardless of annotations
      if (propName === 'onSuccess' || propName === 'onFailure') {
        const returnPortConfig = config?.returnPorts?.[propName];
        ports[propName] = {
          dataType: 'STEP',
          label: returnPortConfig?.label || (propName === 'onSuccess' ? 'On Success' : 'On Failure'),
          isControlFlow: true,
          ...(returnPortConfig?.metadata && { metadata: returnPortConfig.metadata }),
        };
      } else {
        // Auto-infer type from TypeScript signature (more accurate than JSDoc regex)
        const propType = prop.getTypeAtLocation(fn.getTypeResolutionNode());
        const portType = this.inferPortType(propType);
        const propTypeText = propType.getText();
        // Extract schema for complex types (interfaces/objects)
        const tsSchema = portType === 'OBJECT' ? this.extractTypeSchema(propType) : undefined;
        const returnPortConfig = config?.returnPorts?.[propName];
        ports[propName] = {
          dataType: portType,
          label: returnPortConfig?.label || this.capitalize(propName),
          ...(returnPortConfig?.metadata && { metadata: returnPortConfig.metadata }),
          // Include original TS type for rich type display (e.g., "ResearchReport" instead of "object")
          ...(propTypeText && propTypeText !== portType.toLowerCase() && { tsType: propTypeText }),
          // Include schema breakdown for complex types
          ...(tsSchema && Object.keys(tsSchema).length > 0 && { tsSchema }),
        };
      }
    });

    // Assign implicit port orders with mandatory port precedence
    assignImplicitPortOrders(ports);

    return ports;
  }
  /**
   * Extract schema breakdown for complex types (interfaces/objects).
   * Returns a map of property names to their TypeScript type strings.
   */
  private extractTypeSchema(tsType: Type): Record<string, string> | undefined {
    const schema: Record<string, string> = {};
    const properties = tsType.getProperties();

    if (!properties || properties.length === 0) {
      return undefined;
    }

    for (const prop of properties) {
      const propName = prop.getName();
      // Skip internal/private properties
      if (propName.startsWith('_')) continue;

      const propType = prop.getValueDeclaration()?.getType();
      if (propType) {
        schema[propName] = propType.getText();
      } else {
        // Fallback: try to get type from declarations
        const declarations = prop.getDeclarations();
        if (declarations && declarations.length > 0) {
          const decl = declarations[0];
          schema[propName] = decl.getType().getText();
        }
      }
    }

    return Object.keys(schema).length > 0 ? schema : undefined;
  }

  private inferPortType(tsType: Type): TDataType {
    const typeText = tsType.getText();
    // Delegate to inferDataTypeFromTS for consistent type mapping
    // This handles all cases: primitives, any, unknown, never, arrays, functions, etc.
    return inferDataTypeFromTS(typeText);
  }
  /**
   * Check if a function has a valid @flowWeaver annotation (nodeType, workflow, or pattern).
   * Avoids false positives from file-level JSDoc that mentions @flowWeaver in description text.
   */
  private hasFlowWeaverAnnotation(fn: FunctionLike): boolean {
    const validTypes = new Set(['nodeType', 'workflow', 'pattern']);
    return fn.getJsDocs().some((doc) =>
      doc.getTags().some((t) => {
        if (t.getTagName() !== 'flowWeaver') return false;
        const comment = t.getCommentText?.()?.trim() || '';
        return validTypes.has(comment.split(/\s/)[0]);
      })
    );
  }

  /**
   * Generate an annotation suggestion for ghost-text autocomplete.
   * Analyzes the function nearest to cursorLine, diffs inferred ports against
   * any existing @flowWeaver annotation, and returns only the missing lines.
   */
  public generateAnnotationSuggestion(
    content: string,
    cursorLine: number,
    virtualPath: string = 'virtual.ts'
  ): { text: string; insertLine: number; replaceLinesCount: number } | null {
    // Create virtual SourceFile
    const existingFile = this.project.getSourceFile(virtualPath);
    if (existingFile) {
      this.project.removeSourceFile(existingFile);
    }
    const sourceFile = this.project.createSourceFile(virtualPath, content, { overwrite: true });

    try {
      const allFunctions = extractFunctionLikes(sourceFile);
      if (allFunctions.length === 0) return null;

      // Find the function nearest to cursorLine (below or containing the cursor)
      // cursorLine is 0-based; getStartLineNumber() is 1-based
      let targetFn: FunctionLike | null = null;
      let bestDistance = Infinity;

      for (const fn of allFunctions) {
        const fnLine = fn.getStartLineNumber(false) - 1; // 0-based
        // Prefer functions at or below the cursor
        const distance = fnLine >= cursorLine ? fnLine - cursorLine : (cursorLine - fnLine) + 1000;
        if (distance < bestDistance) {
          bestDistance = distance;
          targetFn = fn;
        }
      }

      if (!targetFn) return null;

      const fnName = targetFn.getName() || 'anonymous';
      const fnStartLine = targetFn.getStartLineNumber(false) - 1; // 0-based

      // Don't suggest if cursor is too far from the function (more than 30 lines above)
      if (cursorLine < fnStartLine - 30) return null;

      // Check existing JSDoc state
      const hasAnnotation = this.hasFlowWeaverAnnotation(targetFn);
      const hasAnyJsDoc = targetFn.getJsDocs().length > 0;

      // If function has a JSDoc but NOT a @flowWeaver annotation, don't suggest
      // a competing JSDoc block — the user has an intentional regular JSDoc
      if (hasAnyJsDoc && !hasAnnotation) return null;

      // Infer full node type from function signature
      const inferred = this.inferNodeTypeFromFunction(targetFn, fnName, virtualPath);

      // Extract @param descriptions from existing JSDoc (if any)
      const paramDescriptions = new Map<string, string>();
      for (const doc of targetFn.getJsDocs()) {
        for (const tag of doc.getTags()) {
          if (tag.getTagName() === 'param') {
            const comment = tag.getCommentText?.()?.trim() || '';
            // Extract param name and description: "{type} name - desc" or "name - desc" or "name desc"
            const paramMatch = comment.match(/^(?:\{[^}]*\}\s+)?(\w+)(?:\s*-\s*|\s+)(.+)/);
            if (paramMatch) {
              paramDescriptions.set(paramMatch[1], paramMatch[2]);
            }
          }
        }
      }

      // Merge @param descriptions into inferred port labels
      for (const [portName, portDef] of Object.entries(inferred.inputs)) {
        const desc = paramDescriptions.get(portName);
        if (desc) {
          portDef.label = desc;
        }
      }

      // Parse existing JSDoc to find what's already annotated
      const existingPorts = this.extractExistingAnnotatedPorts(targetFn);

      // Build missing port lines
      const missingLines: string[] = [];

      // Filter out mandatory ports (execute, onSuccess, onFailure) from suggestions
      for (const [portName, portDef] of Object.entries(inferred.inputs)) {
        if (isControlFlowPort(portName)) continue;
        if (existingPorts.inputs.has(portName)) continue;
        missingLines.push(` * ${generateJSDocPortTag(portName, portDef, 'input')}`);
      }

      for (const [portName, portDef] of Object.entries(inferred.outputs)) {
        if (isControlFlowPort(portName)) continue;
        if (existingPorts.outputs.has(portName)) continue;
        missingLines.push(` * ${generateJSDocPortTag(portName, portDef, 'output')}`);
      }

      if (hasAnnotation) {
        // Check if this is a workflow block — if so, suggest missing connections
        const isWorkflow = this.isWorkflowBlock(targetFn);
        if (isWorkflow) {
          const connectionLines = this.generateWorkflowStructureSuggestion(targetFn, sourceFile);
          missingLines.push(...connectionLines);
        }

        // Partial JSDoc: suggest only missing ports / connections
        if (missingLines.length === 0) return null;

        // Find the insertion point: just before the closing */
        const lines = content.split('\n');
        let jsDocEndLine = -1;
        for (let i = fnStartLine - 1; i >= 0; i--) {
          if (lines[i].includes('*/')) {
            jsDocEndLine = i;
            break;
          }
        }

        if (jsDocEndLine < 0) return null;

        const text = missingLines.join('\n') + '\n';
        return {
          text,
          insertLine: jsDocEndLine,
          replaceLinesCount: 0,
        };
      }

      // No @flowWeaver JSDoc — check if user just typed "/**" on the cursor line
      const lines = content.split('\n');
      const cursorLineText = lines[cursorLine] || '';
      if (/^\s*\/\*\*\s*$/.test(cursorLineText)) {
        // User typed "/**" — generate only the continuation lines after it
        const continuationLines = [
          ` * @flowWeaver nodeType ${fnName}`,
          ...(inferred.expression ? [' * @expression'] : []),
          ...missingLines,
          ' */',
        ];
        const text = continuationLines.join('\n') + '\n';
        return {
          text,
          insertLine: cursorLine + 1,
          replaceLinesCount: 0,
        };
      }

      // Generate full annotation block
      const allLines = [
        '/**',
        ` * @flowWeaver nodeType ${fnName}`,
        ...(inferred.expression ? [' * @expression'] : []),
        ...missingLines,
        ' */',
      ];
      const text = allLines.join('\n') + '\n';

      // Insert on the line above the function
      return {
        text,
        insertLine: fnStartLine,
        replaceLinesCount: 0,
      };
    } finally {
      // Clean up virtual source file
      const sf = this.project.getSourceFile(virtualPath);
      if (sf) this.project.removeSourceFile(sf);
    }
  }

  /**
   * Check if a function's JSDoc marks it as a workflow (vs nodeType).
   */
  private isWorkflowBlock(fn: FunctionLike): boolean {
    for (const doc of fn.getJsDocs()) {
      for (const tag of doc.getTags()) {
        if (tag.getTagName() !== 'flowWeaver') continue;
        const comment = tag.getCommentText?.()?.trim() || '';
        const firstWord = comment.split(/\s/)[0];
        // 'workflow' explicitly, or bare @flowWeaver (no qualifier), or named workflow
        if (firstWord === 'workflow' || firstWord === '' || (firstWord !== 'nodeType' && firstWord !== 'pattern')) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Generate missing @connect suggestions for a workflow block.
   * Finds @node declarations, resolves their types, and suggests connections
   * for matching port names that aren't already wired.
   */
  private generateWorkflowStructureSuggestion(fn: FunctionLike, sourceFile: SourceFile): string[] {
    // Extract @node declarations: { nodeId -> nodeTypeName }
    const nodeDecls = new Map<string, string>();
    // Extract existing @connect lines: set of "sourceNode.sourcePort->targetNode.targetPort"
    const existingConnections = new Set<string>();

    for (const doc of fn.getJsDocs()) {
      for (const tag of doc.getTags()) {
        const tagName = tag.getTagName();
        const comment = tag.getCommentText?.()?.trim() || '';

        if (tagName === 'node') {
          const nodeMatch = comment.match(/^(\w+)\s+(\w+)/);
          if (nodeMatch) {
            nodeDecls.set(nodeMatch[1], nodeMatch[2]);
          }
        } else if (tagName === 'connect') {
          const connMatch = comment.match(/^(\w+)\.(\w+)\s*->\s*(\w+)\.(\w+)/);
          if (connMatch) {
            existingConnections.add(`${connMatch[1]}.${connMatch[2]}->${connMatch[3]}.${connMatch[4]}`);
          }
        }
      }
    }

    if (nodeDecls.size < 2) return [];

    // Resolve node types from the same file
    const allFunctions = extractFunctionLikes(sourceFile);
    const resolvedTypes = new Map<string, TNodeTypeAST>();

    for (const [nodeId, typeName] of nodeDecls) {
      const matchedFn = allFunctions.find((f) => f.getName() === typeName);
      if (matchedFn) {
        resolvedTypes.set(nodeId, this.inferNodeTypeFromFunction(matchedFn, typeName, sourceFile.getFilePath()));
      }
    }

    // Find matching unconnected port pairs
    const suggestions: string[] = [];
    const nodeIds = [...nodeDecls.keys()];

    for (let i = 0; i < nodeIds.length; i++) {
      for (let j = 0; j < nodeIds.length; j++) {
        if (i === j) continue;
        const srcId = nodeIds[i];
        const tgtId = nodeIds[j];
        const srcType = resolvedTypes.get(srcId);
        const tgtType = resolvedTypes.get(tgtId);
        if (!srcType || !tgtType) continue;

        for (const [outputName, outputDef] of Object.entries(srcType.outputs)) {
          if (isControlFlowPort(outputName)) continue;
          if (outputDef.dataType === 'STEP') continue;

          // Check if target has a matching input with the same name
          if (outputName in tgtType.inputs && !isControlFlowPort(outputName)) {
            const connKey = `${srcId}.${outputName}->${tgtId}.${outputName}`;
            if (!existingConnections.has(connKey)) {
              suggestions.push(` * @connect ${srcId}.${outputName} -> ${tgtId}.${outputName}`);
              existingConnections.add(connKey); // prevent duplicates
            }
          }
        }
      }
    }

    return suggestions;
  }

  /**
   * Extract port names that are already annotated in a function's JSDoc.
   * Returns sets of input and output port names found in existing annotations.
   */
  private extractExistingAnnotatedPorts(fn: FunctionLike): {
    inputs: Set<string>;
    outputs: Set<string>;
  } {
    const inputs = new Set<string>();
    const outputs = new Set<string>();

    for (const doc of fn.getJsDocs()) {
      for (const tag of doc.getTags()) {
        const tagName = tag.getTagName();
        const comment = tag.getCommentText?.()?.trim() || '';
        // Extract port name: first word, possibly wrapped in brackets [name] or [name=default]
        const nameMatch = comment.match(/^\[?(\w+)/);
        if (!nameMatch) continue;
        const portName = nameMatch[1];

        if (tagName === 'input' || tagName === 'step') {
          inputs.add(portName);
        } else if (tagName === 'output') {
          outputs.add(portName);
        }
      }
    }

    return { inputs, outputs };
  }

  private capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
}

export const parser = new AnnotationParser();

/**
 * Resolve npm node types by re-reading their .d.ts files.
 * This fills in the full port information that isn't stored in @fwImport annotations.
 *
 * When workflows are parsed, npm node types from @fwImport annotations only contain
 * minimal stub information (name, functionName, importSource). This function re-resolves
 * the full port definitions from the actual .d.ts files of the npm packages.
 *
 * @param ast - The workflow AST with potentially stub npm node types
 * @param workdir - Directory to search for node_modules (typically the workflow file's directory)
 * @returns Updated AST with fully resolved npm node types
 */
export function resolveNpmNodeTypes(ast: TWorkflowAST, workdir: string): TWorkflowAST {
  if (!ast.nodeTypes || ast.nodeTypes.length === 0) {
    return ast;
  }

  const resolvedNodeTypes = ast.nodeTypes.map((nodeType) => {
    // Only resolve npm node types (those with importSource)
    if (!nodeType.importSource) {
      return nodeType;
    }

    // Get the full node type from the .d.ts file
    const packageExports = getPackageExports(nodeType.importSource, workdir);
    const matchingExport = packageExports.find(
      (exp) => exp.name === nodeType.name || exp.function === nodeType.functionName
    );

    if (!matchingExport) {
      // Can't resolve - keep stub (will show only result port)
      return nodeType;
    }

    // Convert TNpmNodeType ports to TNodeTypeAST inputs/outputs
    const inputs: Record<string, TPortDefinition> = {};
    const outputs: Record<string, TPortDefinition> = {};

    for (const port of matchingExport.ports) {
      if (port.direction === 'INPUT') {
        inputs[port.name] = {
          dataType: port.type,
          label: port.defaultLabel,
        };
      } else if (port.direction === 'OUTPUT') {
        outputs[port.name] = {
          dataType: port.type,
          label: port.defaultLabel,
        };
      }
    }

    return {
      ...nodeType,
      inputs,
      outputs,
      isAsync: matchingExport.synchronicity === 'ASYNC',
    };
  });

  return {
    ...ast,
    nodeTypes: resolvedNodeTypes,
  };
}
