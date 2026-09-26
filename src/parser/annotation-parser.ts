/**
 * The parser's entry points and the state they share.
 *
 * Decides what one parse of a file is: which cache answers it (the parse cache
 * by mtime, then by content hash, both only while every file the parse read is
 * unchanged), the order its node types are gathered in (local, imported,
 * same-file workflows, caller-supplied externals, then inferred from
 * unannotated functions), and when source files are added to and removed from
 * the ts-morph Project. The work itself lives in the modules this one imports:
 * `import-resolution` (imports and `@fwImport`), `workflow-extraction`
 * (workflow ASTs and macros), `external-node-types`, `module-resolution`,
 * `annotation-suggestion` (the editor suggestion) and `pack-handlers`.
 */
import type { Project } from 'ts-morph';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import type { TNodeTypeAST, TWorkflowAST } from '../ast/types';
import { stripGeneratedSections, hasInPlaceMarkers } from './generated-sections';
import { getSharedProject } from './shared-project';
import { LRUCache } from '../utils/lru-cache';
import { tagHandlerRegistry, type TagHandlerRegistry } from './tag-registry';
import { extractNodeTypes, inferNodeTypesFromUnannotated } from './node-inference';
import {
  preloadSourceOverrides,
  type SourceImportResolver,
  type SourceOverrideLoader,
} from './module-resolution';
import {
  dependenciesUnchanged,
  extractImportedNodeTypes,
  resolveImportAnnotation,
  type FileDependency,
  type ImportCacheEntry,
  type ImportContext,
} from './import-resolution';
import {
  extractWorkflowSignatures,
  extractWorkflows,
  workflowToNodeType,
} from './workflow-extraction';
import { mergeExternalNodeTypes, type TExternalNodeType } from './external-node-types';
import { generateAnnotationSuggestion } from './annotation-suggestion';
import { registerPackHandlers } from './pack-handlers';

export type { TExternalNodeType } from './external-node-types';
export type { SourceImportResolver, SourceOverrideLoader } from './module-resolution';
export { resolveNpmNodeTypes } from './npm-node-types';

export interface ParseResult {
  workflows: TWorkflowAST[];
  nodeTypes: TNodeTypeAST[];
  errors: string[];
  warnings: string[];
}

export class AnnotationParser {
  private project: Project;
  private importCache = new LRUCache<string, ImportCacheEntry>(200);
  private importStack: Set<string> = new Set();
  private parseCache = new LRUCache<
    string,
    {
      mtime: number;
      contentHash: string;
      result: ParseResult;
      /** Every other file the parse read (imported node-type sources, package .d.ts files). */
      deps: FileDependency[];
    }
  >(100);
  /**
   * Dependency recorders for the parses in progress: the outer entry belongs to
   * the workflow file, and each imported file being processed pushes its own so
   * its importCache entry can list what it read. A file read while any recorder
   * is active is added to all of them.
   */
  private dependencyRecorders: Map<string, number>[] = [];

  /** Tag handler registry. Defaults to the global singleton (pre-populated by extensions). */
  tagRegistry: TagHandlerRegistry = tagHandlerRegistry;

  /** Tracks which projectDirs have already had their pack handlers loaded. */
  private loadedPackDirs = new Set<string>();

  constructor(project: Project = getSharedProject()) {
    this.project = project;
  }

  /**
   * Discover and register tag handlers from installed marketplace packs.
   * Results are cached per projectDir so repeated parse calls skip the scan.
   */
  async loadPackHandlers(projectDir: string): Promise<void> {
    if (this.loadedPackDirs.has(projectDir)) return;
    this.loadedPackDirs.add(projectDir);
    await registerPackHandlers(this.tagRegistry, projectDir);
  }

  private computeHash(content: string): string {
    return createHash('sha256').update(content).digest('hex').slice(0, 16);
  }

  /** The import state this parser shares with the import resolution functions. */
  private importContext(): ImportContext {
    return {
      project: this.project,
      tagRegistry: this.tagRegistry,
      importCache: this.importCache,
      importStack: this.importStack,
      dependencyRecorders: this.dependencyRecorders,
    };
  }

  parse(filePath: string, externalNodeTypes?: TExternalNodeType[]): ParseResult {
    const stats = fs.statSync(filePath);
    const hasExternalTypes = externalNodeTypes && externalNodeTypes.length > 0;

    // Skip cache when external node types are provided (cache was built without them)
    if (!hasExternalTypes) {
      const cached = this.parseCache.get(filePath);
      // A cached result is only reusable while the files it was built from
      // (imported node-type sources included) are unchanged.
      const reusable = cached !== undefined && dependenciesUnchanged(cached.deps);

      // FAST PATH 1: mtime unchanged
      if (cached && reusable && cached.mtime === stats.mtimeMs) {
        return cached.result;
      }

      const rawContent = fs.readFileSync(filePath, 'utf-8');
      const content = hasInPlaceMarkers(rawContent)
        ? stripGeneratedSections(rawContent)
        : rawContent;
      const hash = this.computeHash(content);

      // FAST PATH 2: content hash unchanged (save without edit)
      if (cached && reusable && cached.contentHash === hash) {
        cached.mtime = stats.mtimeMs;
        return cached.result;
      }

      // FALLBACK: Full parse
      return this.fullParse(filePath, content, hash, stats.mtimeMs);
    }

    // External types provided: always do a full parse without caching the result
    const rawContent = fs.readFileSync(filePath, 'utf-8');
    const content = hasInPlaceMarkers(rawContent) ? stripGeneratedSections(rawContent) : rawContent;
    const hash = this.computeHash(content);
    return this.fullParse(filePath, content, hash, stats.mtimeMs, externalNodeTypes);
  }

  /**
   * Parse an in-memory source override at its real filesystem path. Relative
   * imports resolve exactly as they do for parse(), but the override is never
   * written to disk or stored in the parse cache.
   */
  parseSourceAtPath(
    filePath: string,
    content: string,
    externalNodeTypes?: TExternalNodeType[],
    importResolver?: SourceImportResolver,
    sourceLoader?: SourceOverrideLoader,
  ): ParseResult {
    return this.fullParse(
      filePath,
      content,
      this.computeHash(content),
      0,
      externalNodeTypes,
      false,
      importResolver,
      sourceLoader,
    );
  }

  private fullParse(
    filePath: string,
    content: string,
    hash: string,
    mtimeMs: number,
    externalNodeTypes?: TExternalNodeType[],
    cacheResult = true,
    importResolver?: SourceImportResolver,
    sourceLoader?: SourceOverrideLoader,
  ): ParseResult {
    // Reset import tracking for new parse
    this.importStack.clear();
    const deps = new Map<string, number>();
    this.dependencyRecorders = [deps];
    const ctx = this.importContext();

    const errors: string[] = [];
    const warnings: string[] = [];

    if (sourceLoader !== undefined) {
      preloadSourceOverrides(
        this.project,
        filePath,
        content,
        importResolver,
        sourceLoader,
        new Set([filePath]),
      );
    }
    const sourceFile = this.project.createSourceFile(filePath, content, { overwrite: true });

    // Add current file to import stack BEFORE processing imports
    this.importStack.add(filePath);

    // A virtual typed graph must be loaded before local function types are
    // inspected. Otherwise TypeScript sees its not-yet-materialized aliases as
    // `any`. Normal filesystem parsing keeps the historical order.
    const importedNodeTypes = sourceLoader === undefined
      ? []
      : extractImportedNodeTypes(ctx, sourceFile, filePath, importResolver, sourceLoader, warnings);
    const localNodeTypes = extractNodeTypes(sourceFile, warnings, this.tagRegistry);
    if (sourceLoader === undefined) {
      importedNodeTypes.push(...extractImportedNodeTypes(
        ctx,
        sourceFile,
        filePath,
        importResolver,
        sourceLoader,
        warnings,
      ));
    }

    // First pass: extract workflow signatures to enable same-file workflow invocation
    const workflowSignatures = extractWorkflowSignatures(sourceFile, filePath, warnings, this.tagRegistry);
    const sameFileWorkflowNodeTypes = workflowSignatures.map((wf) => workflowToNodeType(wf));

    const nodeTypes = [...localNodeTypes, ...importedNodeTypes, ...sameFileWorkflowNodeTypes];

    // Merge external (runtime-loaded) node types so the parser can validate references
    if (externalNodeTypes?.length) {
      mergeExternalNodeTypes(nodeTypes, externalNodeTypes);
    }

    // Auto-infer node types from unannotated functions referenced by @node,
    // and lazily inject built-in nodes (delay, waitForEvent, etc.) when referenced
    const inferredNodeTypes = inferNodeTypesFromUnannotated(sourceFile, nodeTypes, localNodeTypes, warnings);
    nodeTypes.push(...inferredNodeTypes);

    const workflows = extractWorkflows(
      sourceFile,
      nodeTypes,
      filePath,
      errors,
      warnings,
      this.tagRegistry,
      (imp, currentFilePath, importWarnings) =>
        resolveImportAnnotation(ctx, imp, currentFilePath, importWarnings),
    );
    // Deduplicate warnings (extractWorkflowSignatures + extractWorkflows both parse JSDoc)
    const dedupedWarnings = [...new Set(warnings)];
    const result = { workflows, nodeTypes, errors, warnings: dedupedWarnings };

    // Clean up source file to prevent ts-morph Project bloat
    // (results are captured in the returned AST, source file is no longer needed)
    this.project.removeSourceFile(sourceFile);
    this.dependencyRecorders = [];

    // Only cache when no external types were used (cache should reflect file-only state)
    if (cacheResult && !externalNodeTypes?.length) {
      this.parseCache.set(filePath, {
        mtime: mtimeMs,
        contentHash: hash,
        result,
        deps: [...deps].map(([path, mtime]) => ({ path, mtime })),
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
    const localNodeTypes = extractNodeTypes(sourceFile, warnings, this.tagRegistry);

    // First pass: extract workflow signatures to enable same-file workflow invocation
    const workflowSignatures = extractWorkflowSignatures(sourceFile, virtualPath, warnings, this.tagRegistry);
    const sameFileWorkflowNodeTypes = workflowSignatures.map((wf) => workflowToNodeType(wf));

    const nodeTypes = [...localNodeTypes, ...sameFileWorkflowNodeTypes];

    // Auto-infer node types from unannotated functions referenced by @node,
    // and lazily inject built-in nodes (delay, waitForEvent, etc.) when referenced
    const inferredNodeTypes = inferNodeTypesFromUnannotated(sourceFile, nodeTypes, localNodeTypes, warnings);
    nodeTypes.push(...inferredNodeTypes);

    // Note: imports not supported for virtual files - would need filesystem access
    const ctx = this.importContext();
    const workflows = extractWorkflows(
      sourceFile,
      nodeTypes,
      virtualPath,
      errors,
      warnings,
      this.tagRegistry,
      (imp, currentFilePath, importWarnings) =>
        resolveImportAnnotation(ctx, imp, currentFilePath, importWarnings),
    );

    // Clean up virtual source file to prevent memory bloat
    // (tests create many unique virtual paths that accumulate)
    this.project.removeSourceFile(sourceFile);

    // Deduplicate warnings (extractWorkflowSignatures + extractWorkflows both parse JSDoc)
    const dedupedWarnings = [...new Set(warnings)];
    return {
      workflows,
      nodeTypes,
      errors,
      warnings: dedupedWarnings,
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

  /**
   * Suggest the `@flowWeaver` JSDoc for the function at or below `cursorLine`
   * (0-based) in `content`. Returns the text to insert and where, or null when
   * there is nothing to suggest.
   */
  public generateAnnotationSuggestion(
    content: string,
    cursorLine: number,
    virtualPath: string = 'virtual.ts'
  ): { text: string; insertLine: number; replaceLinesCount: number } | null {
    return generateAnnotationSuggestion(this.project, content, cursorLine, virtualPath);
  }
}

export const parser = new AnnotationParser();
