/* eslint-disable no-console */
import { Project, type JSDoc, type SourceFile, type Type, type Symbol as TsSymbol } from 'ts-morph';
import ts from 'typescript';
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
import { EXECUTION_STRATEGIES, isControlFlowPort } from './constants';
import { getErrorMessage } from './utils/error-utils';
import { stripGeneratedSections, hasInPlaceMarkers } from './api/generate-in-place';
import { generateJSDocPortTag } from './annotation-generator';
import { resolvePackageTypesPath } from './resolve-package-types';
import { getPackageExports } from './npm-packages';
import { getSharedProject } from './shared-project';
import { LRUCache } from './utils/lru-cache';
import { COERCION_NODE_TYPES } from './built-in-nodes/coercion-types';
import { tagHandlerRegistry, type TagHandlerRegistry } from './parser/tag-registry';
import {
  expandMapMacro,
  expandPathMacros,
  expandFanOutMacros,
  expandFanInMacros,
  expandCoerceMacros,
  generateAutoConnections,
} from './parser/macro-expansion';
import { expandExpressionReferences, collectModuleBindings } from './parser/expression-references';
import {
  parseStartPorts,
  parseExitPorts,
  capitalize,
} from './parser/port-inference';
import {
  extractNodeTypes,
  inferNodeTypeFromFunction,
  inferAllUnannotatedFunctions,
  inferNodeTypesFromUnannotated,
  hasFlowWeaverAnnotation,
} from './parser/node-inference';

/**
 * Core option keys that must never be shadowed by a pack deploy namespace when
 * promoting `deploy[namespace]` to a top-level `options.<namespace>` mirror.
 */
const RESERVED_OPTION_KEYS = new Set([
  'strictTypes', 'autoConnect', 'trigger', 'http', 'cancelOn', 'retries', 'timeout',
  'throttle', 'deploy',
]);

/**
 * Promote each pack deploy namespace to a top-level `options.<namespace>`
 * convenience mirror (e.g. `deploy['cicd']` → `options.cicd`). Packs type these
 * fields via module augmentation of TWorkflowOptions; core stays namespace-
 * agnostic. Returns a partial options object to spread; reserved core keys are
 * skipped so a namespace can never clobber a built-in option.
 */
function promoteDeployNamespaces(
  deploy: Record<string, Record<string, unknown>> | undefined,
): Record<string, unknown> {
  if (!deploy) return {};
  const promoted: Record<string, unknown> = {};
  for (const [namespace, data] of Object.entries(deploy)) {
    if (RESERVED_OPTION_KEYS.has(namespace)) continue;
    if (data && typeof data === 'object') promoted[namespace] = data;
  }
  return promoted;
}

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
  /**
   * Whether the node's implementation is async (returns a Promise). The
   * code generator emits `await` for the node's call ONLY when its
   * nodeType is async; a missing/false value generates a synchronous
   * call. Carrying it on the wire matters for runtime-provided foreign
   * nodes resolved from a pack manifest (the on-device case): e.g.
   * pack-core's `waitForApproval` is async, and without `isAsync` the
   * generated workflow calls it un-awaited, so its resolved
   * `{ approved, onSuccess, ... }` read back as `undefined` on a pending
   * Promise and every downstream gate silently takes its `!execute` /
   * failure path.
   */
  isAsync?: boolean;
  /**
   * Whether the node is an `@expression` node (data-in, data-out, no
   * `execute` step port; the generator calls it WITHOUT the leading
   * `execute` argument and auto-sets `onSuccess`/`onFailure`). Carrying
   * it on the wire matters for runtime-provided foreign nodes resolved
   * from a pack manifest (the on-device case): e.g. pack-core's
   * `resolveMonth(spec)` / `resolveFiscalYear(spec)` are expression
   * nodes, and without `expression` the generated workflow calls them
   * with the regular `(execute, ...args)` signature, so the boolean
   * `execute` lands in the first data parameter (`spec`) and the node
   * throws (`(spec ?? '').trim is not a function`) at run time.
   */
  expression?: boolean;
  /** Explicit compiler-known durable gate boundary. */
  durableGate?: 'approval' | 'input' | 'agent' | 'timer';
  /** Requires the durable idempotency/receipt effect contract. */
  durableEffect?: boolean;
  /** Explicitly safe to restore/skip without an effect receipt. */
  durablePure?: boolean;
  /** Retry/fallback behavior implemented inside the external adapter. */
  resilience?: { retries?: number; fallback?: string };
};

export type SourceImportResolver = (
  specifier: string,
  importer: string,
) => string | undefined;
export type SourceOverrideLoader = (filePath: string) => string | undefined;

/**
 * Convert a TExternalNodeType to a TNodeTypeAST with sensible defaults.
 * Used to merge runtime-loaded node types into the parser's available types.
 */
function externalToAST(ext: TExternalNodeType): TNodeTypeAST {
  const inputs: Record<string, TPortDefinition> = {};
  const outputs: Record<string, TPortDefinition> = {};
  const isExpression = ext.expression === true;

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

  // Ensure mandatory ports exist. EVERY node -- expression nodes included --
  // gets the `execute` STEP input and onSuccess/onFailure STEP outputs, exactly
  // as source-parsed node types do (see the mandatory-port merge in
  // `extractNodeTypes`). These STEP ports are what `@path` / `@connect` wire
  // and what the validator checks; dropping `execute` for expression nodes
  // breaks `@path Start -> ... -> <exprNode> -> ...` with "does not have input
  // port execute". The `expression` flag below only changes CODEGEN (the call
  // omits the leading `execute` arg), never the port set.
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
    // Honor the supplied async flag so codegen emits `await` for an async
    // foreign node (e.g. pack-core `waitForApproval`). Defaults to sync
    // when the caller doesn't say, preserving prior behavior.
    isAsync: ext.isAsync === true || ext.durableEffect === true,
    executeWhen: EXECUTION_STRATEGIES.CONJUNCTION,
    variant: 'FUNCTION',
    // Honor the expression flag so codegen calls the node WITHOUT the
    // leading `execute` arg (e.g. pack-core `resolveMonth(spec)`).
    ...(isExpression && { expression: true }),
    ...(ext.durableGate && { durableGate: ext.durableGate }),
    ...(ext.durableEffect === true && { durableEffect: true }),
    ...(ext.durablePure === true && { durablePure: true }),
    ...(ext.resilience && { resilience: ext.resilience }),
  };
}

// Port ordering functions imported from ./utils/port-ordering

/**
 * Is `nt` the generic import stub `createImportStub` emits when an
 * `@fwImport` package cannot be resolved on disk? Such a stub carries an
 * `importSource`, no inputs, and a single `{ result }` output. We detect
 * it structurally (rather than tagging the AST) so a caller-supplied
 * `externalNodeType` with the real port shape can replace it during the
 * `fullParse` merge. A real imported type (resolved from a readable
 * `.d.ts`) has its actual ports and is left untouched.
 */
function isImportStub(nt: TNodeTypeAST): boolean {
  if (!(nt as { importSource?: string }).importSource) return false;
  const inputKeys = Object.keys(nt.inputs ?? {});
  const outputKeys = Object.keys(nt.outputs ?? {});
  return inputKeys.length === 0 && outputKeys.length === 1 && outputKeys[0] === 'result';
}

/** Exposed for tests that need direct access to the shared ts-morph Project */
export function getParserProject(): Project {
  return getSharedProject();
}

export class AnnotationParser {
  private project: Project;
  private importCache = new LRUCache<string, { mtime: number; nodeTypes: TNodeTypeAST[] }>(200);
  private importStack: Set<string> = new Set();
  private parseCache = new LRUCache<
    string,
    {
      mtime: number;
      contentHash: string;
      result: ParseResult;
    }
  >(100);

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

    const { discoverTagHandlers, discoverValidationRuleSets } = await import('./marketplace/registry.js');
    const { pathToFileURL } = await import('node:url');

    // Load tag handlers
    const handlers = await discoverTagHandlers(projectDir);
    for (const discovered of handlers) {
      // Handler may already be registered (e.g. by side-effect imports), but we
      // still need to load the module to pick up the serializer, so don't skip
      // the whole entry — guard the handler registration itself instead.
      const handlerAlreadyRegistered = discovered.tags.every((t) => this.tagRegistry.has(t));

      try {
        const mod = await import(pathToFileURL(discovered.absoluteFile).href);
        if (!handlerAlreadyRegistered) {
          const handlerFn = discovered.exportName ? mod[discovered.exportName] : mod.default;
          if (typeof handlerFn === 'function') {
            this.tagRegistry.register(
              discovered.tags,
              discovered.namespace,
              discovered.scope,
              handlerFn,
            );
          }
        }
        // Symmetric emission: register the namespace's serializer (inverse of
        // the handler) so JSDoc regeneration re-emits every tag the pack parses.
        if (discovered.serializerExport) {
          const serializerFn = mod[discovered.serializerExport];
          if (typeof serializerFn === 'function') {
            this.tagRegistry.registerSerializer(discovered.namespace, serializerFn);
          }
        }
      } catch {
        // Skip handlers that fail to load (pack may not be built)
      }
    }

    // Load validation rule sets
    const { validationRuleRegistry } = await import('./api/validation-registry.js');
    const ruleSets = await discoverValidationRuleSets(projectDir);
    for (const ruleSet of ruleSets) {
      try {
        const mod = await import(pathToFileURL(ruleSet.absoluteFile).href);
        const detectFn = mod[ruleSet.detectExport ?? 'detect'];
        const getRulesFn = mod[ruleSet.rulesExport ?? 'getRules'];
        if (typeof detectFn === 'function' && typeof getRulesFn === 'function') {
          validationRuleRegistry.register({
            name: ruleSet.name,
            namespace: ruleSet.namespace,
            detect: detectFn,
            getRules: getRulesFn,
          });
        }
      } catch {
        // Skip rule sets that fail to load
      }
    }
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
      const nodeTypes = extractNodeTypes(sourceFile, warnings, this.tagRegistry);

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

    const errors: string[] = [];
    const warnings: string[] = [];

    if (sourceLoader !== undefined) {
      this.preloadSourceOverrides(
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
    // inspected; otherwise TypeScript sees its not-yet-materialized aliases as
    // `any`. Normal filesystem parsing keeps the historical order.
    const importedNodeTypes = sourceLoader === undefined
      ? []
      : this.extractImportedNodeTypes(sourceFile, filePath, importResolver, sourceLoader);
    const localNodeTypes = extractNodeTypes(sourceFile, warnings, this.tagRegistry);
    if (sourceLoader === undefined) {
      importedNodeTypes.push(...this.extractImportedNodeTypes(
        sourceFile,
        filePath,
        importResolver,
        sourceLoader,
      ));
    }

    // First pass: extract workflow signatures to enable same-file workflow invocation
    const workflowSignatures = this.extractWorkflowSignatures(sourceFile, filePath, warnings);
    const sameFileWorkflowNodeTypes = workflowSignatures.map((wf) => this.workflowToNodeType(wf));

    const nodeTypes = [...localNodeTypes, ...importedNodeTypes, ...sameFileWorkflowNodeTypes];

    // Merge external (runtime-loaded) node types so the parser can validate references
    if (externalNodeTypes?.length) {
      for (const ext of externalNodeTypes) {
        const existingIdx = nodeTypes.findIndex(
          (nt) => nt.name === ext.name || nt.functionName === ext.name
        );
        if (existingIdx === -1) {
          nodeTypes.push(externalToAST(ext));
          continue;
        }
        // A same-named type already exists. If it is a port-less import
        // STUB (the fallback `extractImportedNodeTypes` produces when an
        // `@fwImport` package cannot be resolved on disk -- the on-device
        // case: a Console install dir has no `node_modules` to read the
        // package `.d.ts` from), the caller-supplied external type carries
        // the REAL port shape (resolved from the install's wire manifest)
        // and must win. Without this, the stub's `{ result }` output + empty
        // inputs would shadow the real ports and every `@connect` to the
        // node fails validation with "does not have port ...".
        if (isImportStub(nodeTypes[existingIdx])) {
          // Preserve the stub's `importSource` so downstream `@fwImport`
          // re-emission (generate-in-place) still writes the import line;
          // only the ports come from the external type.
          const replacement = externalToAST(ext);
          const stubImportSource = (nodeTypes[existingIdx] as { importSource?: string })
            .importSource;
          if (stubImportSource) {
            (replacement as { importSource?: string }).importSource = stubImportSource;
          }
          nodeTypes[existingIdx] = replacement;
        }
      }
    }

    // Auto-infer node types from unannotated functions referenced by @node,
    // and lazily inject built-in nodes (delay, waitForEvent, etc.) when referenced
    const inferredNodeTypes = inferNodeTypesFromUnannotated(sourceFile, nodeTypes, localNodeTypes, warnings);
    nodeTypes.push(...inferredNodeTypes);

    const workflows = this.extractWorkflows(sourceFile, nodeTypes, filePath, errors, warnings);
    const patterns = this.extractPatterns(sourceFile, nodeTypes, filePath, errors, warnings);
    // Deduplicate warnings (extractWorkflowSignatures + extractWorkflows both parse JSDoc)
    const dedupedWarnings = [...new Set(warnings)];
    const result = { workflows, nodeTypes, patterns, errors, warnings: dedupedWarnings };

    // Clean up source file to prevent ts-morph Project bloat
    // (results are captured in the returned AST, source file is no longer needed)
    this.project.removeSourceFile(sourceFile);

    // Only cache when no external types were used (cache should reflect file-only state)
    if (cacheResult && !externalNodeTypes?.length) {
      this.parseCache.set(filePath, {
        mtime: mtimeMs,
        contentHash: hash,
        result,
      });
    }

    return result;
  }

  private preloadSourceOverrides(
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
        ?? this.resolveModulePath(specifier, path.dirname(importer));
      if (resolved === undefined || resolved === null || seen.has(resolved)) continue;
      const override = sourceLoader(resolved);
      if (override === undefined) continue;
      seen.add(resolved);
      this.preloadSourceOverrides(resolved, override, importResolver, sourceLoader, seen);
      this.project.createSourceFile(resolved, override, { overwrite: true });
    }
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
    const workflowSignatures = this.extractWorkflowSignatures(sourceFile, virtualPath, warnings);
    const sameFileWorkflowNodeTypes = workflowSignatures.map((wf) => this.workflowToNodeType(wf));

    const nodeTypes = [...localNodeTypes, ...sameFileWorkflowNodeTypes];

    // Auto-infer node types from unannotated functions referenced by @node,
    // and lazily inject built-in nodes (delay, waitForEvent, etc.) when referenced
    const inferredNodeTypes = inferNodeTypesFromUnannotated(sourceFile, nodeTypes, localNodeTypes, warnings);
    nodeTypes.push(...inferredNodeTypes);

    // Note: imports not supported for virtual files - would need filesystem access
    const workflows = this.extractWorkflows(sourceFile, nodeTypes, virtualPath, errors, warnings);
    const patterns = this.extractPatterns(sourceFile, nodeTypes, virtualPath, errors, warnings);

    // Clean up virtual source file to prevent memory bloat
    // (tests create many unique virtual paths that accumulate)
    this.project.removeSourceFile(sourceFile);

    // Deduplicate warnings (extractWorkflowSignatures + extractWorkflows both parse JSDoc)
    const dedupedWarnings = [...new Set(warnings)];
    return {
      workflows,
      nodeTypes,
      patterns,
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

  private resolveModulePath(moduleSpecifier: string, currentDir: string): string | null {
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
    currentFilePath: string,
    importResolver?: SourceImportResolver,
    sourceLoader?: SourceOverrideLoader,
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
      const importedFilePath = importResolver?.(moduleSpecifier, currentFilePath)
        ?? this.resolveModulePath(moduleSpecifier, currentDir);

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
        // Check cache first — validate mtime to detect file changes
        let nodeTypes: TNodeTypeAST[];
        const overriddenSource = sourceLoader?.(importedFilePath);
        const importStats = overriddenSource === undefined
          ? fs.statSync(importedFilePath)
          : { mtimeMs: 0 };
        const cached = overriddenSource === undefined
          ? this.importCache.get(importedFilePath)
          : undefined;
        if (cached && cached.mtime === importStats.mtimeMs) {
          nodeTypes = cached.nodeTypes;
        } else {
          // Add to import stack for circular dependency detection
          this.importStack.add(importedFilePath);

          try {
            const importedRaw = overriddenSource
              ?? fs.readFileSync(importedFilePath, 'utf-8');
            const importedContent = hasInPlaceMarkers(importedRaw)
              ? stripGeneratedSections(importedRaw)
              : importedRaw;
            const importedFile = this.project.createSourceFile(importedFilePath, importedContent, {
              overwrite: true,
            });
            const importWarnings: string[] = [];
            const localNodeTypes = extractNodeTypes(importedFile, importWarnings, this.tagRegistry);
            // Recursively process imports (enables circular dependency detection)
            const importedFromFile = this.extractImportedNodeTypes(
              importedFile,
              importedFilePath,
              importResolver,
              sourceLoader,
            );
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
            const inferredFromImport = inferAllUnannotatedFunctions(importedFile, nodeTypes);
            nodeTypes.push(...inferredFromImport);

            // Clean up imported source file to prevent Project bloat
            if (overriddenSource === undefined) {
              this.project.removeSourceFile(importedFile);
            }

            // Cache the parsed node types with mtime for invalidation
            this.importCache.set(importedFilePath, { mtime: importStats.mtimeMs, nodeTypes });
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

    // Check cache (npm imports use package path mtime for invalidation)
    const cacheKey = `npm:${moduleSpecifier}`;
    const npmCached = this.importCache.get(cacheKey);
    if (npmCached) {
      // For npm packages, check mtime of the resolved .d.ts file
      const currentDir = path.dirname(currentFilePath);
      const resolvedDts = resolvePackageTypesPath(moduleSpecifier, currentDir);
      if (resolvedDts) {
        try {
          const dtsStats = fs.statSync(resolvedDts);
          if (npmCached.mtime === dtsStats.mtimeMs) {
            return npmCached.nodeTypes.filter((nt) => importedNames.has(nt.functionName));
          }
        } catch { /* file gone — re-parse */ }
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

        const nodeType = inferNodeTypeFromFunction(fn, fnName, dtsPath);
        // Mark as npm package import and prevent inlining
        nodeType.importSource = moduleSpecifier;
        nodeType.functionText = undefined;
        allNodeTypes.push(nodeType);
      }

      // Clean up the temporary source file
      this.project.removeSourceFile(dtsFile);

      // Cache all node types from this package (with mtime of the .d.ts file)
      const dtsMtime = fs.statSync(dtsPath).mtimeMs;
      this.importCache.set(cacheKey, { mtime: dtsMtime, nodeTypes: allNodeTypes });

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
      return this.resolveNpmImportAnnotation(imp, currentDir, warnings);
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
      const nodeType = inferNodeTypeFromFunction(fn, imp.name, importedFilePath);
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
    currentDir: string,
    warnings: string[]
  ): TNodeTypeAST {
    // Check cache (with mtime validation — same pattern as resolveNpmImports)
    const cacheKey = `npm:${imp.importSource}`;
    if (this.importCache.has(cacheKey)) {
      const cached = this.importCache.get(cacheKey)!;
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
      return this.createImportStub(imp);
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
      const allNodeTypes = this.inferNodeTypesDeep(
        dtsPath,
        imp.importSource,
        new Set<string>(),
        new Set<string>(),
        0
      );

      // Cache all node types from this package (with mtime of the .d.ts file)
      const dtsMtime2 = fs.statSync(dtsPath).mtimeMs;
      this.importCache.set(cacheKey, { mtime: dtsMtime2, nodeTypes: allNodeTypes });

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

    return this.createImportStub(imp);
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
  private inferNodeTypesDeep(
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

    const sf = this.project.createSourceFile(
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
        const target = this.resolveReExportedDts(baseDir, spec);
        if (!target) continue;
        out.push(
          ...this.inferNodeTypesDeep(target, importSource, visitedFiles, seenNames, depth + 1)
        );
      }
    } finally {
      this.project.removeSourceFile(sf);
    }
    return out;
  }

  /**
   * Resolve a relative re-export specifier (as written in a `.d.ts`, which
   * commonly points at the compiled `.js`, e.g. `./node-types/index.js`) to
   * the matching `.d.ts` on disk. Tries the literal `.d.ts`, the `.js`->`.d.ts`
   * swap, and the `<dir>/index.d.ts` directory form.
   */
  private resolveReExportedDts(baseDir: string, spec: string): string | null {
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

  private extractWorkflowSignatures(
    sourceFile: SourceFile,
    filePath: string,
    warnings: string[]
  ): TWorkflowAST[] {
    const workflows: TWorkflowAST[] = [];
    extractFunctionLikes(sourceFile).forEach((fn: FunctionLike) => {
      const config = jsdocParser.parseWorkflow(fn, warnings, this.tagRegistry);
      if (!config) return;

      const functionName = fn.getName() || 'anonymous';
      const startPorts = parseStartPorts(fn, config);
      const exitPorts = parseExitPorts(fn, config);
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
      const config = jsdocParser.parseWorkflow(fn, warnings, this.tagRegistry);
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
      const startPorts = parseStartPorts(fn, config);
      const exitPorts = parseExitPorts(fn, config);

      // Convert @fwImport annotations to properly inferred node types
      // These are persisted in JSDoc so they survive file re-parsing
      // Uses the same inference logic as TS imports for consistency
      const importedNpmNodeTypes: TNodeTypeAST[] = (config.imports || []).map((imp) =>
        this.resolveImportAnnotation(imp, filePath, warnings)
      );

      // Post-resolution check: warn when inferred node type has zero data ports
      // (excluding control-flow ports). This usually means the .d.ts inference
      // couldn't extract meaningful port info and a local wrapper is needed.
      for (const nt of importedNpmNodeTypes) {
        const dataInputs = Object.keys(nt.inputs).filter((p) => p !== 'execute');
        const nonControlOutputs = Object.keys(nt.outputs).filter(
          (p) => p !== 'onSuccess' && p !== 'onFailure'
        );
        // Stub fallback has only result: ANY — if that's all we have with zero
        // data inputs, inference likely failed
        const isStubOnly =
          nonControlOutputs.length === 1 &&
          nonControlOutputs[0] === 'result' &&
          nt.outputs.result?.dataType === 'ANY';

        if (dataInputs.length === 0 && isStubOnly) {
          warnings.push(
            `Could not infer ports for "${nt.functionName}" from "${nt.importSource}". ` +
            `Wrap it in a local function with @flowWeaver nodeType annotations instead.`
          );
        }
      }

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
            ...(portConfigs && portConfigs.length > 0 && { portConfigs }),
            ...(inst.pullExecution && { pullExecution: inst.pullExecution }),
            ...(inst.minimized && { minimized: inst.minimized }),
            ...(inst.color && { color: inst.color }),
            ...(inst.icon && { icon: inst.icon }),
            ...(inst.tags && inst.tags.length > 0 && { tags: inst.tags }),
            ...(inst.width && { width: inst.width }),
            ...(inst.height && { height: inst.height }),
            ...(inst.suppressWarnings?.length && { suppressWarnings: inst.suppressWarnings }),
          },
          ...(inst.sourceLocation && {
            sourceLocation: { file: filePath, ...inst.sourceLocation },
          }),
          ...(inst.job && { job: inst.job }),
          ...(inst.environment && { environment: inst.environment }),
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
        const autoConnections = generateAutoConnections(
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
          expandMapMacro(
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
        expandPathMacros(
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
        expandFanOutMacros(config.fanOuts, instances, connections, startPorts, exitPorts, macros, errors);
      }

      // Expand @fanIn macros into N-to-1 connections
      if (config.fanIns && config.fanIns.length > 0) {
        expandFanInMacros(config.fanIns, instances, connections, startPorts, exitPorts, macros, errors);
      }

      // Expand @coerce macros into synthetic coercion nodes + connections
      if (config.coercions && config.coercions.length > 0) {
        expandCoerceMacros(config.coercions, instances, connections, startPorts, exitPorts, macros, errors);
      }

      // Upstream references inside [expr: ...] bindings become derived data
      // connections. Runs after every macro expansion so synthetic instances
      // are referenceable, and before validation so ordering, cycle detection
      // and the durable graph all see the edges.
      if (instances.some((inst) => inst.config?.portConfigs?.some((pc) => pc.expression !== undefined))) {
        expandExpressionReferences({
          instances,
          connections,
          findNodeType: (name) =>
            allAvailableNodeTypes.find((nt) => nt.name === name || nt.functionName === name),
          startPorts,
          moduleBindings: collectModuleBindings(
            sourceFile,
            new Set(allAvailableNodeTypes.map((nt) => nt.functionName)),
          ),
          errors,
        });
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
      //
      // EXCEPTION (offline-device): when an `@fwImport` package cannot be
      // resolved on disk (a Console install dir has no `node_modules` to
      // read the package `.d.ts` from), `resolveImportAnnotation` returns a
      // port-less STUB (`inputs: {}`, `outputs: { result }`). A stub must
      // NOT shadow a real same-named type the caller supplied via
      // `externalNodeTypes` (resolved from the install's wire manifest):
      // that real type carries the actual ports, and letting the stub win
      // makes every `@connect` to the node fail validation with "does not
      // have port ...". So for a stub import, if a real same-named type is
      // available, drop the stub and keep the real type (preserving its
      // `importSource` so `@fwImport` re-emission still writes the import).
      const realNameToType = new Map<string, TNodeTypeAST>();
      for (const nt of allAvailableNodeTypes) {
        if (!isImportStub(nt) && !importedNpmNodeTypes.includes(nt)) {
          realNameToType.set(nt.name, nt);
        }
      }
      const resolvedImportedTypes: TNodeTypeAST[] = importedNpmNodeTypes.map((imp) => {
        if (isImportStub(imp)) {
          const real = realNameToType.get(imp.name);
          if (real) {
            const merged: TNodeTypeAST = { ...real };
            const impSource = (imp as { importSource?: string }).importSource;
            if (impSource) (merged as { importSource?: string }).importSource = impSource;
            return merged;
          }
        }
        return imp;
      });
      const importedNames = new Set(resolvedImportedTypes.map((nt) => nt.name));
      // Use allAvailableNodeTypes (includes synthetic MAP_ITERATOR types from @map macros)
      const dedupedAvailableTypes = allAvailableNodeTypes.filter((nt) => !importedNames.has(nt.name));
      const workflowNodeTypes = [...dedupedAvailableTypes, ...resolvedImportedTypes];

      // Inject synthetic coercion node types for any __fw_ instances
      for (const inst of instances) {
        if (inst.nodeType.startsWith('__fw_') && COERCION_NODE_TYPES[inst.nodeType]) {
          if (!workflowNodeTypes.some(nt => nt.functionName === inst.nodeType)) {
            workflowNodeTypes.push(COERCION_NODE_TYPES[inst.nodeType]);
          }
        }
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
        ...((config.strictTypes !== undefined || config.autoConnect ||
             config.trigger || config.http || config.cancelOn || config.retries !== undefined ||
             config.timeout || config.throttle || config.deploy) && {
          options: {
            ...(config.strictTypes !== undefined && { strictTypes: config.strictTypes }),
            ...(config.autoConnect && { autoConnect: true }),
            ...(config.trigger && { trigger: config.trigger }),
            ...(config.http && config.http.length > 0 && { http: config.http }),
            ...(config.cancelOn && { cancelOn: config.cancelOn }),
            ...(config.retries !== undefined && { retries: config.retries }),
            ...(config.timeout && { timeout: config.timeout }),
            ...(config.throttle && { throttle: config.throttle }),
            // Surface each pack deploy namespace as a top-level options.<namespace>
            // convenience mirror (e.g. options.cicd from deploy['cicd']). Packs
            // type these fields via module augmentation of TWorkflowOptions; core
            // stays namespace-agnostic and keeps no vendor vocabulary.
            ...promoteDeployNamespaces(config.deploy),
            // Per-target deployment config
            ...(config.deploy && { deploy: config.deploy }),
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
        config: {},
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
      const hasAnnotation = hasFlowWeaverAnnotation(targetFn);
      const hasAnyJsDoc = targetFn.getJsDocs().length > 0;

      // If function has a JSDoc but NOT a @flowWeaver annotation, don't suggest
      // a competing JSDoc block — the user has an intentional regular JSDoc
      if (hasAnyJsDoc && !hasAnnotation) return null;

      // Infer full node type from function signature
      const inferred = inferNodeTypeFromFunction(targetFn, fnName, virtualPath);

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
        const lines = content.split(/\r?\n/);
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
      const lines = content.split(/\r?\n/);
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
        resolvedTypes.set(nodeId, inferNodeTypeFromFunction(matchedFn, typeName, sourceFile.getFilePath()));
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
