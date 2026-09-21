/**
 * In-Place Code Generation
 *
 * Generates executable code directly into the source file while preserving
 * user code (node functions). Updates:
 * - Runtime section (between markers)
 * - Workflow JSDoc annotations (when AST changes)
 * - Function body (between markers)
 */

import type {
  TWorkflowAST,
  TPortDefinition,
  TNodeTypeAST,
  TDataType,
  TModuleFormat,
  TConnectionAST,
  TWorkflowMacro,
} from '../ast/types';
import { bodyGenerator } from '../body-generator';
import { generateInlineRuntime } from './inline-runtime';
import { graphIdentity } from './graph-identity';
import type { GraphIdentityStamp } from '../generator/unified';
import { isExecutePort, isSuccessPort, isFailurePort, isControlFlowPort } from '../constants';
import {
  generateJSDocPortTag,
  assignPortOrders,
  generateNodeInstanceTag,
  formatJSDocDescription,
  planPortTags,
  httpRouteText,
} from '../annotation-generator';
import { shouldWorkflowBeAsync } from '../generator/async-detection';
import { detectSugarPatterns, filterStaleMacros } from '../sugar-optimizer';
import { isPathImpliedDataEdge } from '../parser/path-data-resolution';
import { serializePackDeployAnnotations } from '../parser/serialize-deploy-annotations';
import { validateDurableClosure } from './durable-validation';
import * as ts from 'typescript';
import * as path from 'path';

// Marker constants
export const MARKERS = {
  RUNTIME_START: '// @flow-weaver-runtime-start',
  RUNTIME_END: '// @flow-weaver-runtime-end',
  BODY_START: '// @flow-weaver-body-start',
  BODY_END: '// @flow-weaver-body-end',
  IMPORTS_START: '// @flow-weaver-imports-start',
  IMPORTS_END: '// @flow-weaver-imports-end',
};

export interface InPlaceGenerateOptions {
  /**
   * Whether to generate production-optimized code (no debug events)
   */
  production?: boolean;
  /**
   * All workflows in the file (needed to avoid orphaning node types
   * used by other workflows during multi-workflow compilation)
   */
  allWorkflows?: TWorkflowAST[];
  /**
   * Module format for generated code ('esm' or 'cjs')
   * @default 'esm'
   */
  moduleFormat?: TModuleFormat;
  /**
   * Absolute path to the source file being compiled.
   */
  sourceFile?: string;
  /**
   * When true, omit @param/@returns annotations from the workflow JSDoc.
   * The parser auto-infers Start/Exit ports from function signatures,
   * so these annotations are redundant for non-visual-editor users.
   */
  skipParamReturns?: boolean;
  /**
   * When true, only the JSDoc annotations (node types and the workflow) are
   * rewritten. No runtime section, generated body, inlined built-ins, or
   * signature edits are produced. Structural edits (`fw modify`, `fw_modify`)
   * use this on a file that has never been compiled in place, so an
   * uncompiled source stays an uncompiled source.
   */
  annotationsOnly?: boolean;
}

export interface InPlaceGenerateResult {
  code: string;
  hasChanges: boolean;
}

/**
 * Generate executable code in-place, preserving user code.
 *
 * @param sourceCode - The original source code
 * @param ast - The parsed workflow AST
 * @param options - Generation options
 * @returns The updated source code with generated sections
 */
export function generateInPlace(
  sourceCode: string,
  ast: TWorkflowAST,
  options: InPlaceGenerateOptions = {}
): InPlaceGenerateResult {
  const {
    production = false,
    allWorkflows,
    moduleFormat = 'esm',
    sourceFile,
    skipParamReturns = false,
    annotationsOnly = false,
  } = options;
  const durableSequential = validateDurableClosure(
    ast,
    allWorkflows ?? [],
  ).hasDurableGate;

  let result = sourceCode;
  let hasChanges = false;

  // Step 1: Update JSDoc annotations for node type functions
  // Skip sibling workflows (variant IMPORTED_WORKFLOW/WORKFLOW). Their JSDoc should not be rewritten.
  for (const nodeType of ast.nodeTypes) {
    if (nodeType.variant === 'IMPORTED_WORKFLOW' || nodeType.variant === 'WORKFLOW' || nodeType.variant === 'MAP_ITERATOR') {
      continue;
    }
    // Skip node types imported from other files. The import statement handles them.
    // Inlining would create duplicate declarations (TS2440) and duplicate node type names.
    // Compare basenames as a fallback: after a client roundtrip (JSON serialization),
    // sourceLocation.file may contain a virtual path ("/testing.ts") instead of the
    // real workspace path. Full-path comparison would incorrectly skip the node type.
    // Normalize separators for cross-platform (Windows backslash → forward slash).
    if (nodeType.sourceLocation?.file) {
      const ntFile = nodeType.sourceLocation.file.replace(/\\/g, '/');
      const astFile = ast.sourceFile.replace(/\\/g, '/');
      const ntBase = ntFile.split('/').filter(Boolean).pop() ?? '';
      const astBase = astFile.split('/').filter(Boolean).pop() ?? '';
      if (
        path.resolve(ntFile) !== path.resolve(astFile) &&
        ntBase !== astBase
      ) {
        continue;
      }
    }
    // Skip built-in auto-injected nodes. Step 1.2 handles their insertion.
    if (!nodeType.sourceLocation && nodeType.helperText != null) {
      continue;
    }
    const nodeTypeResult = replaceNodeTypeJSDoc(result, nodeType);
    if (nodeTypeResult.changed) {
      result = nodeTypeResult.code;
      hasChanges = true;
    }
  }

  // Step 1.2: Insert built-in node functions that are auto-injected (no source in the file).
  // Skipped in annotations-only mode: the parser injects built-ins on every parse, and
  // inlining them is only needed to make a compiled file self-contained.
  const usedNodeTypes = new Set(ast.instances.map((i) => i.nodeType));
  const builtInNodes = annotationsOnly
    ? []
    : ast.nodeTypes.filter(
        (nt) => !nt.sourceLocation && nt.functionText && nt.helperText != null && usedNodeTypes.has(nt.name)
      );
  if (builtInNodes.length > 0) {
    // Find insertion point: just before the workflow function's JSDoc. The
    // comment match must not cross a `*/`, or it would start at the first
    // doc comment in the file (there are many in the runtime section) and
    // the built-ins would land inside a section that is regenerated.
    const workflowFnPattern = new RegExp(
      `(/\\*\\*(?:(?!\\*/)[\\s\\S])*?@flowWeaver\\s+workflow(?:(?!\\*/)[\\s\\S])*?\\*/)\\s*\\n\\s*(?:export\\s+)?(?:async\\s+)?function\\s+${ast.functionName}\\b`
    );
    const match = result.match(workflowFnPattern);
    if (match && match.index !== undefined) {
      const insertionLines: string[] = [];

      // Emit shared helpers once: not twice for two built-ins of this
      // workflow, and not again when an earlier pass over another workflow
      // in the same file already put them there (a file with a `sleep` in
      // one workflow and a `waitForEvent` in another is compiled workflow
      // by workflow, and both need `__fw_getMockConfig`).
      const emittedHelpers = new Set<string>();
      for (const node of builtInNodes) {
        const helperText = production ? (node.helperTextProduction ?? null) : (node.helperText ?? null);
        if (helperText && !emittedHelpers.has(helperText) && !result.includes(helperText)) {
          emittedHelpers.add(helperText);
          insertionLines.push(helperText);
          insertionLines.push('');
        }
      }

      // Emit each built-in function with its JSDoc
      for (const node of builtInNodes) {
        const funcText = (production && node.functionTextProduction != null) ? node.functionTextProduction : node.functionText;
        if (funcText) {
          // Add JSDoc annotation so the function is recognized on re-parse.
          // The durable classification must travel with it: without it a
          // re-parse sees waitForAgent/waitForEvent as ordinary node types,
          // the gate boundary is not applied, and the inlined fallback body
          // throws at run time.
          const portAnnotations: string[] = [];
          portAnnotations.push('/**');
          portAnnotations.push(` * @flowWeaver nodeType`);
          portAnnotations.push(...durableClassificationLines(node));
          for (const [name, port] of Object.entries(node.inputs)) {
            if (name === 'execute') continue;
            const optPrefix = port.optional ? '[' : '';
            const optSuffix = port.optional ? ']' : '';
            portAnnotations.push(` * @input ${optPrefix}${name}${optSuffix} - ${port.label || name}`);
          }
          for (const [name, port] of Object.entries(node.outputs)) {
            if (name === 'onSuccess' || name === 'onFailure') continue;
            portAnnotations.push(` * @output ${name} - ${port.label || name}`);
          }
          portAnnotations.push(' */');
          insertionLines.push(portAnnotations.join('\n'));
          insertionLines.push(funcText);
          insertionLines.push('');
        }
      }

      const insertionCode = insertionLines.join('\n');
      result = result.slice(0, match.index) + insertionCode + '\n' + result.slice(match.index);
      hasChanges = true;
    }
  }

  // Step 1.5: Remove orphaned nodeType functions (functions that don't match any AST nodeType)
  // When multi-workflow, consider ALL workflows' node types to avoid deleting types used by siblings
  const cleanupResult = removeOrphanedNodeTypeFunctions(result, ast, allWorkflows);
  if (cleanupResult.changed) {
    result = cleanupResult.code;
    hasChanges = true;
  }

  // Step 2: Update JSDoc annotations for workflow function
  const jsdocResult = replaceWorkflowJSDoc(result, ast, { skipParamReturns });
  if (jsdocResult.changed) {
    result = jsdocResult.code;
    hasChanges = true;
  }

  // Annotations-only: stop here. Nothing below touches annotations; it all
  // produces generated code (imports, runtime, signature, body).
  if (annotationsOnly) {
    return { code: result, hasChanges: hasChanges && result !== sourceCode };
  }

  // Step 2.5: Emit executable `import { fn } from "pkg"` statements for
  // `@fwImport` node types. The `@fwImport` JSDoc declares intent + persists
  // across re-parses, but the generated body CALLS the imported function by
  // bare name (`await waitForApproval(...)`), so without a real import the
  // module throws `<fn> is not defined` at run time. Step 1 deliberately
  // does NOT inline imported node bodies ("the import statement handles
  // them") — this step is what actually emits that import. Idempotent via
  // the IMPORTS markers.
  const importsResult = ensureFwImportStatements(result, ast);
  if (importsResult.changed) {
    result = importsResult.code;
    hasChanges = true;
  }

  // Step 3: Generate and insert/replace runtime section (always inlined — zero runtime dependencies)
  const runtimeCode = generateRuntimeSection(ast.functionName, production, moduleFormat);
  const runtimeResult = replaceOrInsertSection(
    result,
    MARKERS.RUNTIME_START,
    MARKERS.RUNTIME_END,
    runtimeCode,
    'top'
  );
  if (runtimeResult.changed) {
    result = runtimeResult.code;
    hasChanges = true;
  }

  // Step 3.5: Ensure function signature includes the `params` parameter.
  // The generated body unconditionally references `params` (the recursion-
  // depth guard reads `params.__rd__`, and every Start data port reads
  // `params.<portName>`). A workflow whose author signature declares data
  // ports gets `params` for free, but one with NO Start data ports (e.g. a
  // single zero-input node, author signature `(execute)`) omits it, so the
  // generated body throws `ReferenceError: params is not defined` at
  // runtime. Inject `params` right after `execute` when absent. Runs BEFORE
  // the runtime step so the final order stays (execute, params, __runtime__).
  const paramsResult = ensureParamsParameter(result, ast.functionName);
  if (paramsResult.changed) {
    result = paramsResult.code;
    hasChanges = true;
  }

  // Step 4: replace the A1 signal/debug parameters with the one required,
  // execution-scoped A2 runtime parameter.
  const signatureResult = ensureRuntimeParameter(result, ast.functionName);
  if (signatureResult.changed) {
    result = signatureResult.code;
    hasChanges = true;
  }

  // Step 5: Detect async from node composition + source signature
  // If any node is async, force async (even if source isn't marked async)
  // In dev mode (!production), always force async so the debugger can pause execution
  // at breakpoints (sendStatusChangedEvent must be awaited).
  const nodesRequireAsync = shouldWorkflowBeAsync(ast, ast.nodeTypes);
  const sourceIsAsync = detectFunctionIsAsync(result, ast.functionName);
  const forceAsync = nodesRequireAsync || !production;
  const isAsync = forceAsync || sourceIsAsync;

  // Add async keyword to source if nodes or debug hooks require it
  const asyncSigResult = ensureAsyncKeyword(result, ast.functionName, forceAsync);
  if (asyncSigResult.changed) {
    result = asyncSigResult.code;
    hasChanges = true;
  }

  // Step 5b: Wrap return type in Promise<T> when async was added
  const returnTypeResult = ensurePromiseReturnType(result, ast.functionName, forceAsync);
  if (returnTypeResult.changed) {
    result = returnTypeResult.code;
    hasChanges = true;
  }

  // A gated body declares its graph identity to the engine; a body that can
  // never yield has no continuation to protect and stays as it was.
  const identity = durableSequential
    ? { graphFingerprint: graphIdentity(ast, allWorkflows ?? []).graphFingerprint }
    : undefined;
  const functionBody = generateFunctionBody(ast, production, isAsync, durableSequential, identity);
  const bodyResult = replaceWorkflowFunctionBody(result, ast.functionName, functionBody);
  if (bodyResult.changed) {
    result = bodyResult.code;
    hasChanges = true;
  }

  // Final check: if the output equals the input, there were no real changes
  // This catches cases where individual steps report changes but produce identical output
  if (hasChanges && result === sourceCode) {
    hasChanges = false;
  }

  return { code: result, hasChanges };
}

/**
 * Generate the runtime section with proper markers.
 * Runtime is always inlined — zero runtime dependencies.
 */
function generateRuntimeSection(
  functionName: string,
  production: boolean,
  moduleFormat: TModuleFormat = 'esm',
): string {
  const lines: string[] = [];

  lines.push('// ============================================================================');
  lines.push('// DO NOT EDIT - This section is auto-generated by Flow Weaver');
  lines.push('// ============================================================================');
  lines.push('');

  lines.push(generateInlineRuntime(production));

  return lines.join('\n');
}

/**
 * Emit executable `import { <fn> } from "<pkg>"` statements for every
 * `@fwImport` node type (those carrying `importSource`), so the generated
 * body's bare call (`await waitForApproval(...)`) resolves at run time.
 *
 * The block is delimited by IMPORTS markers and inserted at the very top of
 * the file (before any other content), so it's idempotent across re-runs
 * and survives alongside the user's own imports. When the workflow uses no
 * `@fwImport` node types the block is empty (markers only) — harmless.
 *
 * Default-export imports are written `import <fn> from "<pkg>"`; named ones
 * `import { <fn> } from "<pkg>"`. The function name is derived the same way
 * as the persisted `@fwImport` JSDoc (npm/<pkg>/<fn> convention or explicit
 * functionName).
 */
function ensureFwImportStatements(
  source: string,
  ast: TWorkflowAST,
): { code: string; changed: boolean } {
  const importNodeTypes = ast.nodeTypes.filter((nt) => nt.importSource);

  // Build one import per (functionName, importSource), de-duped.
  const seen = new Set<string>();
  const importLines: string[] = [];
  for (const nt of importNodeTypes) {
    let fnName = nt.functionName;
    if (nt.functionName === nt.name && nt.name.startsWith('npm/')) {
      const parts = nt.name.split('/');
      fnName = parts[parts.length - 1];
    }
    // Collision-proof dedup key: JSON.stringify a tuple so no separator char
    // can appear inside the operands (fnName is space-free today, but this
    // removes the assumption entirely). The key is internal-only, never emitted.
    const key = JSON.stringify([fnName, nt.importSource]);
    if (seen.has(key)) continue;
    seen.add(key);
    importLines.push(`import { ${fnName} } from '${nt.importSource}';`);
  }

  const block = [MARKERS.IMPORTS_START, ...importLines, MARKERS.IMPORTS_END].join('\n');

  // Replace an existing marker block if present (idempotent re-runs).
  const startIdx = source.indexOf(MARKERS.IMPORTS_START);
  const endIdx = source.indexOf(MARKERS.IMPORTS_END);
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const before = source.slice(0, startIdx);
    const after = source.slice(endIdx + MARKERS.IMPORTS_END.length);
    const next = `${before}${block}${after}`;
    return { code: next, changed: next !== source };
  }

  // No existing block. If there are no imports to emit, do nothing (avoid
  // littering files that don't use @fwImport with an empty marker block).
  if (importLines.length === 0) {
    return { code: source, changed: false };
  }

  // Insert at the very top so the imports precede every statement.
  const next = `${block}\n${source}`;
  return { code: next, changed: true };
}

/**
 * Detect if a workflow function is declared as async
 */
function detectFunctionIsAsync(source: string, functionName: string): boolean {
  const sourceFile = ts.createSourceFile('temp.ts', source, ts.ScriptTarget.Latest, true);

  let isAsync = false;

  ts.forEachChild(sourceFile, (node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === functionName) {
      isAsync = !!node.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);
    }
  });

  return isAsync;
}

/**
 * Ensure the workflow function has the `params` parameter.
 *
 * The generated body always references `params`: the recursion-depth guard
 * reads `params.__rd__`, and every Start data port is read as
 * `params.<portName>`. A workflow whose author signature declares data ports
 * already has `params`, but one with NO Start data ports (a single zero-input
 * node, author signature `(execute)`) omits it, and the generated body then
 * throws `ReferenceError: params is not defined` at runtime.
 *
 * `params` must be the SECOND positional parameter (right after `execute`),
 * because the runtime invokes the workflow as `fn(execute, params, ...)`.
 * Insert it immediately after the first parameter. If the function somehow
 * has no parameters, insert it after the opening paren (the `execute` guard
 * param is always present in practice, so this is defensive).
 */
function ensureParamsParameter(
  source: string,
  functionName: string
): { code: string; changed: boolean } {
  const sourceFile = ts.createSourceFile('temp.ts', source, ts.ScriptTarget.Latest, true);

  let functionNode: ts.FunctionDeclaration | undefined;

  ts.forEachChild(sourceFile, (node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === functionName) {
      functionNode = node;
    }
  });

  if (!functionNode) {
    return { code: source, changed: false };
  }

  // Already has a `params` parameter: nothing to do.
  const hasParams = functionNode.parameters.some(
    (param) => ts.isIdentifier(param.name) && param.name.text === 'params'
  );
  if (hasParams) {
    return { code: source, changed: false };
  }

  const PARAMS_DECL = 'params: Record<string, unknown> = {}';

  const firstParam = functionNode.parameters[0];
  if (!firstParam) {
    // No parameters at all: insert right after the opening paren.
    const openParen = source.indexOf('(', functionNode.name?.end || 0);
    if (openParen === -1) {
      return { code: source, changed: false };
    }
    const before = source.slice(0, openParen + 1);
    const after = source.slice(openParen + 1);
    return { code: before + PARAMS_DECL + after, changed: true };
  }

  // Insert after the first parameter (execute) with a comma so `params`
  // lands in the second positional slot.
  const firstParamEnd = firstParam.end;
  const before = source.slice(0, firstParamEnd);
  const after = source.slice(firstParamEnd);
  return { code: before + ', ' + PARAMS_DECL + after, changed: true };
}

/**
 * Ensure the workflow function has exactly one __runtime__ parameter.
 * The A2 major cutover removes generated debugger and AbortSignal parameters.
 */
function ensureRuntimeParameter(
  source: string,
  functionName: string
): { code: string; changed: boolean } {
  const sourceFile = ts.createSourceFile('temp.ts', source, ts.ScriptTarget.Latest, true);

  let functionNode: ts.FunctionDeclaration | undefined;

  ts.forEachChild(sourceFile, (node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === functionName) {
      functionNode = node;
    }
  });

  if (!functionNode) {
    return { code: source, changed: false };
  }

  const parameters = functionNode.parameters
    .slice(0, 2)
    .map((parameter) => parameter.getText(sourceFile));
  parameters.push('__runtime__: WorkflowRuntime');

  const openParen = source.indexOf('(', functionNode.name?.end ?? 0);
  if (openParen === -1) return { code: source, changed: false };
  const closeParen = functionNode.parameters.end;
  const replacement = parameters.join(', ');
  const current = source.slice(openParen + 1, closeParen);
  if (current.trim() === replacement) return { code: source, changed: false };
  return {
    code: source.slice(0, openParen + 1) + replacement + source.slice(closeParen),
    changed: true,
  };
}

/**
 * Ensure the workflow function has the correct async/non-async modifier.
 * If shouldBeAsync is true and the function is not async, adds the `async` keyword.
 */
function ensureAsyncKeyword(
  source: string,
  functionName: string,
  shouldBeAsync: boolean
): { code: string; changed: boolean } {
  if (!shouldBeAsync) {
    return { code: source, changed: false };
  }

  const sourceFile = ts.createSourceFile('temp.ts', source, ts.ScriptTarget.Latest, true);

  let functionNode: ts.FunctionDeclaration | undefined;

  ts.forEachChild(sourceFile, (node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === functionName) {
      functionNode = node;
    }
  });

  if (!functionNode) {
    return { code: source, changed: false };
  }

  const alreadyAsync = !!functionNode.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);

  if (alreadyAsync) {
    return { code: source, changed: false };
  }

  // Find the 'function' keyword position and insert 'async ' before it
  const funcStart = functionNode.getStart();
  const textAfter = source.slice(funcStart);

  // The text at funcStart starts with optional 'export' then 'function'
  // Insert 'async ' right before 'function'
  const functionKeywordOffset = textAfter.indexOf('function');
  if (functionKeywordOffset === -1) {
    return { code: source, changed: false };
  }

  const insertPos = funcStart + functionKeywordOffset;
  const before = source.slice(0, insertPos);
  const after = source.slice(insertPos);

  return {
    code: before + 'async ' + after,
    changed: true,
  };
}

/**
 * Ensure the workflow function's return type is wrapped in Promise<T> when async is required.
 * If shouldBeAsync is true and the return type is not already Promise<...>, wraps it.
 */
function ensurePromiseReturnType(
  source: string,
  functionName: string,
  shouldBeAsync: boolean
): { code: string; changed: boolean } {
  if (!shouldBeAsync) {
    return { code: source, changed: false };
  }

  const sourceFile = ts.createSourceFile('temp.ts', source, ts.ScriptTarget.Latest, true);

  let functionNode: ts.FunctionDeclaration | undefined;

  ts.forEachChild(sourceFile, (node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === functionName) {
      functionNode = node;
    }
  });

  if (!functionNode || !functionNode.type) {
    return { code: source, changed: false };
  }

  const returnTypeText = source.slice(functionNode.type.pos, functionNode.type.end).trim();

  // Already wrapped in Promise<...>
  if (returnTypeText.startsWith('Promise<')) {
    return { code: source, changed: false };
  }

  const before = source.slice(0, functionNode.type.pos);
  const after = source.slice(functionNode.type.end);

  return {
    code: before + ' Promise<' + returnTypeText + '>' + after,
    changed: true,
  };
}

/**
 * Generate the workflow function body
 */
function generateFunctionBody(
  ast: TWorkflowAST,
  production: boolean,
  isAsync: boolean,
  durableSequential: boolean,
  identity?: GraphIdentityStamp,
): string {
  const lines: string[] = [];

  lines.push('  // ============================================================================');
  lines.push('  // DO NOT EDIT - This section is auto-generated by Flow Weaver');
  lines.push('  // Edit the @flowWeaver annotations above to modify workflow behavior');
  lines.push('  // ============================================================================');
  lines.push('');

  // Get the generated body from existing body generator
  const body = bodyGenerator.generateWithExecutionContext(
    ast,
    ast.nodeTypes,
    isAsync, // Respect original function's async/sync nature
    production,
    false,
    durableSequential,
    identity,
  );

  // Add proper indentation
  const indentedBody = body
    .split('\n')
    .map((line) => (line.trim() ? '  ' + line : line))
    .join('\n');

  lines.push(indentedBody);

  return lines.join('\n');
}

/**
 * Replace content between markers, or insert if markers don't exist
 */
function replaceOrInsertSection(
  source: string,
  startMarker: string,
  endMarker: string,
  newContent: string,
  insertPosition: 'top' | 'before-function'
): { code: string; changed: boolean } {
  const startIdx = source.indexOf(startMarker);
  const endIdx = source.indexOf(endMarker);

  // If both markers exist, replace content between them
  if (startIdx !== -1 && endIdx !== -1) {
    const before = source.slice(0, startIdx + startMarker.length);
    const after = source.slice(endIdx);
    const newCode = before + '\n' + newContent + '\n' + after;

    // Check if content actually changed
    const originalContent = source.slice(startIdx + startMarker.length, endIdx);
    const changed = originalContent.trim() !== newContent.trim();

    return { code: newCode, changed };
  }

  // Markers don't exist - insert them
  if (insertPosition === 'top') {
    // Insert after imports (if any)
    const insertIdx = findInsertPositionAfterImports(source);
    const before = source.slice(0, insertIdx);
    const after = source.slice(insertIdx);

    const newSection = ['', startMarker, newContent, endMarker, ''].join('\n');

    return {
      code: before + newSection + after,
      changed: true,
    };
  }

  return { code: source, changed: false };
}

/**
 * Find the position after all imports in the source code
 */
function findInsertPositionAfterImports(source: string): number {
  const sourceFile = ts.createSourceFile('temp.ts', source, ts.ScriptTarget.Latest, true);

  let lastImportEnd = 0;

  ts.forEachChild(sourceFile, (node) => {
    if (ts.isImportDeclaration(node)) {
      lastImportEnd = node.end;
    }
  });

  // Find the next line after the last import
  if (lastImportEnd > 0) {
    const nextNewline = source.indexOf('\n', lastImportEnd);
    return nextNewline !== -1 ? nextNewline + 1 : lastImportEnd;
  }

  // No imports - insert at the very beginning
  return 0;
}

/**
 * Replace the body of a workflow function with generated code
 */
function replaceWorkflowFunctionBody(
  source: string,
  functionName: string,
  newBody: string
): { code: string; changed: boolean } {
  const sourceFile = ts.createSourceFile('temp.ts', source, ts.ScriptTarget.Latest, true);

  let functionNode: ts.FunctionDeclaration | undefined;

  // Find the workflow function
  ts.forEachChild(sourceFile, (node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === functionName) {
      functionNode = node;
    }
  });

  if (!functionNode || !functionNode.body) {
    return { code: source, changed: false };
  }

  // Check if body already has markers
  const bodyText = source.slice(functionNode.body.pos, functionNode.body.end);

  const bodyStartMarkerIdx = bodyText.indexOf(MARKERS.BODY_START);
  const bodyEndMarkerIdx = bodyText.indexOf(MARKERS.BODY_END);

  if (bodyStartMarkerIdx !== -1 && bodyEndMarkerIdx !== -1) {
    // Replace content between body markers
    const absoluteBodyStart =
      functionNode.body.pos + bodyStartMarkerIdx + MARKERS.BODY_START.length;
    const absoluteBodyEnd = functionNode.body.pos + bodyEndMarkerIdx;

    const before = source.slice(0, absoluteBodyStart);
    const after = source.slice(absoluteBodyEnd);

    const newCode = before + '\n' + newBody + '\n  ' + after;

    // Check if content changed
    const originalBody = source.slice(absoluteBodyStart, absoluteBodyEnd);
    const changed = originalBody.trim() !== newBody.trim();

    return { code: newCode, changed };
  }

  // No markers in body - insert them
  // Find the opening brace of the function body
  const openBraceIdx = source.indexOf('{', functionNode.body.pos);
  if (openBraceIdx === -1) {
    return { code: source, changed: false };
  }

  // Find the closing brace
  const closeBraceIdx = functionNode.body.end - 1;
  if (closeBraceIdx <= openBraceIdx) {
    return { code: source, changed: false };
  }

  const before = source.slice(0, openBraceIdx + 1);
  const after = source.slice(closeBraceIdx);

  const newBodyWithMarkers = [
    '',
    '  ' + MARKERS.BODY_START,
    newBody,
    '  ' + MARKERS.BODY_END,
    '',
  ].join('\n');

  return {
    code: before + newBodyWithMarkers + after,
    changed: true,
  };
}

/**
 * Rename a function in the provided code to a new name.
 * Handles both regular functions and arrow functions.
 */
function renameFunctionInCode(code: string, newName: string): string {
  const codeSourceFile = ts.createSourceFile('temp.ts', code, ts.ScriptTarget.Latest, true);

  let functionName: string | undefined;
  let functionNameStart: number | undefined;
  let functionNameEnd: number | undefined;

  // Find the function declaration
  ts.forEachChild(codeSourceFile, (node) => {
    if (ts.isFunctionDeclaration(node) && node.name) {
      functionName = node.name.text;
      functionNameStart = node.name.getStart();
      functionNameEnd = node.name.getEnd();
    }
  });

  if (!functionName || functionNameStart === undefined || functionNameEnd === undefined) {
    // No function found - return as-is
    return code;
  }

  if (functionName === newName) {
    // Already has the correct name
    return code;
  }

  // Replace the function name
  const before = code.slice(0, functionNameStart);
  const after = code.slice(functionNameEnd);
  return before + newName + after;
}

/**
 * Insert a new node type function into the source code.
 * Inserts before the workflow function (exported function).
 * Renames the function to match nodeType.functionName if different.
 */
function insertNodeTypeFunction(
  source: string,
  nodeType: TNodeTypeAST,
  functionCode: string
): { code: string; changed: boolean } {
  const sourceFile = ts.createSourceFile('temp.ts', source, ts.ScriptTarget.Latest, true);

  // Find position AFTER the runtime section end marker to avoid being overwritten
  // when the runtime section is replaced
  const runtimeEndMarker = '// @flow-weaver-runtime-end';
  const runtimeEndPos = source.indexOf(runtimeEndMarker);

  let insertPosition = -1;

  if (runtimeEndPos !== -1) {
    // Insert after the runtime-end marker line
    const afterMarker = source.indexOf('\n', runtimeEndPos);
    insertPosition = afterMarker !== -1 ? afterMarker + 1 : runtimeEndPos + runtimeEndMarker.length;
  } else {
    // No runtime marker - find the first exported function to insert before it
    let foundExportedFunction = false;

    ts.forEachChild(sourceFile, (node) => {
      if (
        !foundExportedFunction &&
        ts.isFunctionDeclaration(node) &&
        node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
      ) {
        insertPosition = node.getFullStart();
        foundExportedFunction = true;
      }
    });

    if (insertPosition === -1) {
      insertPosition = source.length;
    }
  }

  // Rename the function in the code to match nodeType.functionName
  const renamedCode = renameFunctionInCode(functionCode, nodeType.functionName);

  // The functionCode should already have JSDoc, but ensure it does
  const hasJSDoc = renamedCode.trim().startsWith('/**');
  let finalCode = renamedCode;

  if (!hasJSDoc) {
    // Generate JSDoc for the function
    const jsdoc = generateNodeTypeJSDoc(nodeType);
    finalCode = jsdoc + '\n' + renamedCode;
  }

  // Insert the function with proper spacing
  const before = source.slice(0, insertPosition);
  const after = source.slice(insertPosition);

  // Ensure proper newlines
  const needsLeadingNewline = before.length > 0 && !before.endsWith('\n\n');
  const needsTrailingNewline = after.length > 0 && !after.startsWith('\n');

  const newCode =
    before +
    (needsLeadingNewline ? '\n\n' : '') +
    finalCode +
    (needsTrailingNewline ? '\n\n' : '') +
    after;

  return { code: newCode, changed: true };
}

/**
 * Remove nodeType functions that don't match any AST nodeType.
 * This cleans up orphaned functions left behind after renames.
 */
function removeOrphanedNodeTypeFunctions(
  source: string,
  ast: TWorkflowAST,
  allWorkflows?: TWorkflowAST[]
): { code: string; changed: boolean } {
  const sourceFile = ts.createSourceFile('temp.ts', source, ts.ScriptTarget.Latest, true);

  // Get all valid functionNames from AST — include ALL workflows' node types when available
  const validFunctionNames = new Set(ast.nodeTypes.map((nt) => nt.functionName));
  if (allWorkflows) {
    for (const workflow of allWorkflows) {
      for (const nt of workflow.nodeTypes) {
        validFunctionNames.add(nt.functionName);
      }
    }
  }

  // Find all nodeType functions to potentially remove
  const functionsToRemove: { start: number; end: number }[] = [];

  ts.forEachChild(sourceFile, (node) => {
    if (ts.isFunctionDeclaration(node) && node.name) {
      const functionName = node.name.text;

      // Check if this function has @flowWeaver nodeType JSDoc
      const functionStart = node.getFullStart();
      const leadingComments = ts.getLeadingCommentRanges(source, functionStart);

      if (!leadingComments) return;

      let isNodeTypeFunction = false;
      let jsdocStart = functionStart;

      for (const comment of leadingComments) {
        if (comment.kind === ts.SyntaxKind.MultiLineCommentTrivia) {
          const commentText = source.slice(comment.pos, comment.end);
          if (commentText.includes('@flowWeaver nodeType')) {
            isNodeTypeFunction = true;
            jsdocStart = comment.pos;
            break;
          }
        }
      }

      if (!isNodeTypeFunction) return;

      // If this nodeType function's name doesn't match any valid functionName, mark for removal
      if (!validFunctionNames.has(functionName)) {
        // Find the start (including JSDoc) and end of the function
        const fullStart = jsdocStart;
        const fullEnd = node.end;

        // Include any trailing newlines
        let endPos = fullEnd;
        while (endPos < source.length && (source[endPos] === '\n' || source[endPos] === '\r')) {
          endPos++;
        }

        functionsToRemove.push({ start: fullStart, end: endPos });
      }
    }
  });

  if (functionsToRemove.length === 0) {
    return { code: source, changed: false };
  }

  // Remove functions from end to start to preserve positions
  let result = source;
  for (const { start, end } of functionsToRemove.sort((a, b) => b.start - a.start)) {
    result = result.slice(0, start) + result.slice(end);
  }

  return { code: result, changed: true };
}

/**
 * Find a function by @name tag in its JSDoc comment.
 * Returns the function node and the @name value if found.
 */
function findFunctionByNameTag(
  source: string,
  sourceFile: ts.SourceFile,
  targetName: string
): ts.FunctionDeclaration | undefined {
  let result: ts.FunctionDeclaration | undefined;

  ts.forEachChild(sourceFile, (node) => {
    if (ts.isFunctionDeclaration(node) && node.name) {
      // Check if this function has a @name tag matching targetName
      const functionStart = node.getFullStart();
      const leadingComments = ts.getLeadingCommentRanges(source, functionStart);

      if (leadingComments) {
        for (const comment of leadingComments) {
          if (comment.kind === ts.SyntaxKind.MultiLineCommentTrivia) {
            const commentText = source.slice(comment.pos, comment.end);
            // Look for @name tag
            const nameMatch = commentText.match(/@name\s+(\S+)/);
            if (nameMatch && nameMatch[1] === targetName) {
              result = node;
              return;
            }
          }
        }
      }
    }
  });

  return result;
}

/**
 * Replace a node type function's JSDoc comment with updated annotations.
 * If the function doesn't exist but nodeType has code/functionText, INSERT the function.
 * Handles function renames by looking up @name tag when functionName doesn't match.
 */
function replaceNodeTypeJSDoc(
  source: string,
  nodeType: TNodeTypeAST
): { code: string; changed: boolean } {
  const sourceFile = ts.createSourceFile('temp.ts', source, ts.ScriptTarget.Latest, true);

  let functionNode: ts.FunctionDeclaration | undefined;
  let needsRename = false;

  // First, try to find the function by its functionName
  ts.forEachChild(sourceFile, (node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === nodeType.functionName) {
      functionNode = node;
    }
  });

  // If not found by functionName, try to find by @name tag (handles renames)
  if (!functionNode && nodeType.name) {
    functionNode = findFunctionByNameTag(source, sourceFile, nodeType.name);
    if (functionNode && functionNode.name?.text !== nodeType.functionName) {
      needsRename = true;
    }
  }

  // If still not found and name !== functionName, try finding by name as function name
  // This handles the case where no @name tag exists yet (first rename after creation)
  if (!functionNode && nodeType.name && nodeType.name !== nodeType.functionName) {
    ts.forEachChild(sourceFile, (node) => {
      if (
        ts.isFunctionDeclaration(node) &&
        node.name?.text === nodeType.name // Find by stable identifier as function name
      ) {
        functionNode = node;
        needsRename = true;
      }
    });
  }

  if (!functionNode) {
    // Function doesn't exist - try to INSERT it if we have the code
    // Check for code property (dynamically added in some contexts) or functionText
    const nodeTypeWithCode = nodeType as TNodeTypeAST & { code?: string };
    const functionCode = nodeTypeWithCode.code || nodeType.functionText;
    if (functionCode) {
      return insertNodeTypeFunction(source, nodeType, functionCode);
    }
    return { code: source, changed: false };
  }

  let result = source;
  let hasChanges = false;

  // If function needs to be renamed (found by @name but has old functionName)
  if (needsRename && functionNode.name) {
    const nameStart = functionNode.name.getStart();
    const nameEnd = functionNode.name.getEnd();

    result = result.slice(0, nameStart) + nodeType.functionName + result.slice(nameEnd);
    hasChanges = true;

    // Re-parse to get updated positions after rename
    const updatedSourceFile = ts.createSourceFile('temp.ts', result, ts.ScriptTarget.Latest, true);

    // Find the renamed function
    ts.forEachChild(updatedSourceFile, (node) => {
      if (ts.isFunctionDeclaration(node) && node.name?.text === nodeType.functionName) {
        functionNode = node;
      }
    });

    if (!functionNode) {
      return { code: result, changed: hasChanges };
    }
  }

  // Find the JSDoc comment before the function
  const functionStart = functionNode.getFullStart();
  const leadingComments = ts.getLeadingCommentRanges(result, functionStart);

  if (!leadingComments || leadingComments.length === 0) {
    return { code: result, changed: hasChanges };
  }

  // Find ALL /** JSDoc comments in the leading trivia and separate them:
  // - flowWeaverJSDocs: contain @flowWeaver (these are node type annotations)
  // - The LAST one is the primary JSDoc to replace
  // - Any earlier @flowWeaver JSDoc blocks are stale duplicates to remove
  const jsdocComments: ts.CommentRange[] = [];
  for (const c of leadingComments) {
    if (
      c.kind === ts.SyntaxKind.MultiLineCommentTrivia &&
      result.slice(c.pos, c.pos + 3) === '/**'
    ) {
      jsdocComments.push(c);
    }
  }

  if (jsdocComments.length === 0) {
    return { code: result, changed: hasChanges };
  }

  // Use the LAST /** comment as the primary JSDoc (closest to the function).
  // This avoids picking up file headers that also start with /**.
  const jsdocComment = jsdocComments[jsdocComments.length - 1];

  // Detect stale duplicate @flowWeaver JSDoc blocks from previous buggy compilations.
  // Any earlier /** that contains @flowWeaver is a stale duplicate to remove.
  const staleDuplicates: ts.CommentRange[] = [];
  for (let i = 0; i < jsdocComments.length - 1; i++) {
    const text = result.slice(jsdocComments[i].pos, jsdocComments[i].end);
    if (text.includes('@flowWeaver')) {
      staleDuplicates.push(jsdocComments[i]);
    }
  }

  // Generate new JSDoc using AnnotationGenerator
  const newJSDoc = generateNodeTypeJSDoc(nodeType);

  // Remove stale duplicates first (process from end to start to preserve positions)
  if (staleDuplicates.length > 0) {
    for (let i = staleDuplicates.length - 1; i >= 0; i--) {
      const dupe = staleDuplicates[i];
      // Remove the duplicate and any trailing whitespace/newline
      let removeEnd = dupe.end;
      while (
        removeEnd < result.length &&
        (result[removeEnd] === '\n' || result[removeEnd] === '\r')
      ) {
        removeEnd++;
      }
      result = result.slice(0, dupe.pos) + result.slice(removeEnd);
      hasChanges = true;
    }

    // Re-parse to get updated positions after removal
    const updatedSourceFile = ts.createSourceFile('temp.ts', result, ts.ScriptTarget.Latest, true);
    let updatedFunctionNode: ts.FunctionDeclaration | undefined;
    ts.forEachChild(updatedSourceFile, (node) => {
      if (ts.isFunctionDeclaration(node) && node.name?.text === nodeType.functionName) {
        updatedFunctionNode = node as ts.FunctionDeclaration;
      }
    });

    if (!updatedFunctionNode) {
      return { code: result, changed: hasChanges };
    }

    // Re-find the JSDoc comment with updated positions
    const updatedStart = updatedFunctionNode.getFullStart();
    const updatedComments = ts.getLeadingCommentRanges(result, updatedStart);
    if (!updatedComments) {
      return { code: result, changed: hasChanges };
    }

    let updatedJsdoc: ts.CommentRange | undefined;
    for (const c of updatedComments) {
      if (
        c.kind === ts.SyntaxKind.MultiLineCommentTrivia &&
        result.slice(c.pos, c.pos + 3) === '/**'
      ) {
        updatedJsdoc = c;
      }
    }

    if (!updatedJsdoc) {
      return { code: result, changed: hasChanges };
    }

    // Continue with the updated positions
    return replaceJSDocContent(
      result,
      updatedJsdoc,
      updatedFunctionNode,
      nodeType,
      newJSDoc,
      hasChanges
    );
  }

  return replaceJSDocContent(result, jsdocComment, functionNode, nodeType, newJSDoc, hasChanges);
}

function replaceJSDocContent(
  source: string,
  jsdocComment: ts.CommentRange,
  functionNode: ts.FunctionDeclaration,
  nodeType: TNodeTypeAST,
  newJSDoc: string,
  hasChanges: boolean
): { code: string; changed: boolean } {
  const originalJSDoc = source.slice(jsdocComment.pos, jsdocComment.end);

  // Check if JSDoc changed
  const jsdocChanged = originalJSDoc.trim() !== newJSDoc.trim();

  // Check if function body needs updating (when functionText is provided)
  const nodeTypeWithCode = nodeType as TNodeTypeAST & { code?: string };
  const newFunctionText = nodeTypeWithCode.code || nodeType.functionText;
  let functionBodyChanged = false;
  let newFunctionDeclaration = '';

  if (newFunctionText) {
    // Extract function declaration from functionText (strip ALL leading JSDoc blocks).
    // The parser's functionText may include multiple JSDoc blocks (e.g. file header + nodeType JSDoc).
    // We must strip ALL of them, not just the first one.
    let strippedFunctionText = newFunctionText.trim();
    while (strippedFunctionText.startsWith('/**')) {
      strippedFunctionText = strippedFunctionText.replace(/^\/\*\*[\s\S]*?\*\/\s*/, '').trim();
    }
    newFunctionDeclaration = strippedFunctionText;

    // Get current function declaration (without JSDoc)
    const currentFunctionDeclaration = source
      .slice(functionNode.getStart(), functionNode.getEnd())
      .trim();

    // Normalize for comparison (strip whitespace differences)
    const normalizedNew = newFunctionDeclaration.replace(/\s+/g, ' ');
    const normalizedCurrent = currentFunctionDeclaration.replace(/\s+/g, ' ');

    functionBodyChanged = normalizedNew !== normalizedCurrent;
  }

  // If nothing changed, return early
  if (!jsdocChanged && !functionBodyChanged) {
    return { code: source, changed: hasChanges };
  }

  // Replace the JSDoc and optionally the function body
  if (functionBodyChanged && newFunctionDeclaration) {
    // Replace entire function (JSDoc + body)
    const before = source.slice(0, jsdocComment.pos);
    const after = source.slice(functionNode.getEnd());

    return {
      code: before + newJSDoc + '\n' + newFunctionDeclaration + after,
      changed: true,
    };
  } else if (jsdocChanged) {
    // Only replace JSDoc
    const before = source.slice(0, jsdocComment.pos);
    const after = source.slice(jsdocComment.end);

    return {
      code: before + newJSDoc + after,
      changed: true,
    };
  }

  return { code: source, changed: hasChanges };
}

/**
 * Generate JSDoc comment for node type function
 */
function generateNodeTypeJSDoc(nodeType: TNodeTypeAST): string {
  const lines: string[] = [];

  lines.push('/**');

  // Add description
  if (nodeType.description) {
    lines.push(...formatJSDocDescription(nodeType.description));
    lines.push(` *`);
  }

  // @flowWeaver marker
  lines.push(' * @flowWeaver nodeType');

  // Add @expression tag for expression nodes
  if (nodeType.expression) {
    lines.push(' * @expression');
  }

  // Add @name tag when name differs from functionName (preserves stable identity across renames)
  if (nodeType.name && nodeType.name !== nodeType.functionName) {
    lines.push(` * @name ${nodeType.name}`);
  }

  // Add label if present
  if (nodeType.label) {
    lines.push(` * @label ${nodeType.label}`);
  }

  // Add scope if present
  if (nodeType.scope) {
    lines.push(` * @scope ${nodeType.scope}`);
  }

  // Add pullExecution if present
  if (nodeType.defaultConfig?.pullExecution) {
    lines.push(` * @pullExecution ${nodeType.defaultConfig.pullExecution.triggerPort}`);
  }

  if (nodeType.resilience) {
    const retries = nodeType.resilience.retries
      ? ` retries=${nodeType.resilience.retries}`
      : '';
    const fallback = nodeType.resilience.fallback
      ? ` fallback="${nodeType.resilience.fallback.replace(/"/g, '\\"')}"`
      : '';
    lines.push(` * @resilience${retries}${fallback}`);
  }

  // Durable classification round-trips like any other authored tag.
  lines.push(...durableClassificationLines(nodeType));

  // Add visual annotations
  if (nodeType.visuals) {
    if (nodeType.visuals.color) {
      lines.push(` * @color ${nodeType.visuals.color}`);
    }
    if (nodeType.visuals.icon) {
      lines.push(` * @icon ${nodeType.visuals.icon}`);
    }
    if (nodeType.visuals.tags && nodeType.visuals.tags.length > 0) {
      for (const tag of nodeType.visuals.tags) {
        if (tag.tooltip) {
          lines.push(` * @tag ${tag.label} "${tag.tooltip}"`);
        } else {
          lines.push(` * @tag ${tag.label}`);
        }
      }
    }
  }

  // Handle both formats: inputs/outputs dictionaries OR ports array
  let inputEntries: [string, TPortDefinition][] = [];
  let outputEntries: [string, TPortDefinition][] = [];

  if (nodeType.inputs && Object.keys(nodeType.inputs).length > 0) {
    // Use native inputs/outputs format. Mandatory control-flow ports at their
    // defaults and implicit orders are left to planPortTags below: the parser
    // adds them back on re-parse, so writing them only lengthens the file.
    inputEntries = assignPortOrders(Object.entries(nodeType.inputs), 'input');
    outputEntries = assignPortOrders(Object.entries(nodeType.outputs || {}), 'output');
  } else if (nodeType.ports && nodeType.ports.length > 0) {
    // Convert from ports array format (UI format)
    const inputs: [string, TPortDefinition][] = [];
    const outputs: [string, TPortDefinition][] = [];

    for (const port of nodeType.ports) {
      // Skip mandatory control flow ports - they're implicit
      if (isExecutePort(port.name) || isSuccessPort(port.name) || isFailurePort(port.name)) {
        continue;
      }

      const portDef: TPortDefinition = {
        dataType: (port.type || port.dataType || 'ANY') as TDataType,
        label: port.defaultLabel || port.name,
        scope: port.scope,
        metadata: { order: port.defaultOrder },
      };

      if (port.direction === 'INPUT') {
        inputs.push([port.name, portDef]);
      } else {
        outputs.push([port.name, portDef]);
      }
    }

    inputEntries = assignPortOrders(inputs, 'input');
    outputEntries = assignPortOrders(outputs, 'output');
  }

  // Add input ports: only what a re-parse would not infer on its own
  for (const { name, port, writeOrder } of planPortTags(inputEntries)) {
    lines.push(` * ${generateJSDocPortTag(name, port, 'input', undefined, { writeOrder })}`);
  }

  // Add output ports
  for (const { name, port, writeOrder } of planPortTags(outputEntries)) {
    lines.push(` * ${generateJSDocPortTag(name, port, 'output', undefined, { writeOrder })}`);
  }

  lines.push(' */');

  return lines.join('\n');
}

/**
 * JSDoc lines for a node type's durable classification (`@durableGate <kind>`,
 * `@durableEffect`, `@durablePure`). Each flag is emitted independently so the
 * authored state round-trips exactly; a doubled classification is a validation
 * error, not something the generator silently repairs.
 */
function durableClassificationLines(
  nodeType: Pick<TNodeTypeAST, 'durableGate' | 'durableEffect' | 'durablePure'>
): string[] {
  const lines: string[] = [];
  if (nodeType.durableGate) {
    lines.push(` * @durableGate ${nodeType.durableGate}`);
  }
  if (nodeType.durableEffect) {
    lines.push(' * @durableEffect');
  }
  if (nodeType.durablePure) {
    lines.push(' * @durablePure');
  }
  return lines;
}

// Note: generateJSDocPortTag and assignPortOrders are now imported from annotation-generator
// to maintain DRY principle and ensure consistent behavior across all code generation

/**
 * Replace the workflow function's JSDoc comment with updated annotations
 */
function replaceWorkflowJSDoc(
  source: string,
  ast: TWorkflowAST,
  options: { skipParamReturns?: boolean } = {}
): { code: string; changed: boolean } {
  const sourceFile = ts.createSourceFile('temp.ts', source, ts.ScriptTarget.Latest, true);

  let functionNode: ts.FunctionDeclaration | undefined;

  // Find the FIRST workflow function with the matching name.
  // ts.forEachChild visits all children — we break on first match to avoid
  // targeting a later duplicate (which corrupts the wrong function's JSDoc).
  ts.forEachChild(sourceFile, (node) => {
    if (functionNode) return; // already found — skip
    if (ts.isFunctionDeclaration(node) && node.name?.text === ast.functionName) {
      functionNode = node;
    }
  });

  if (!functionNode) {
    return { code: source, changed: false };
  }

  // Find the JSDoc comment before the function
  const functionStart = functionNode.getFullStart();
  const leadingComments = ts.getLeadingCommentRanges(source, functionStart);

  if (!leadingComments || leadingComments.length === 0) {
    return { code: source, changed: false };
  }

  // Find the JSDoc comment (starts with /**)
  const jsdocComment = leadingComments.find(
    (c) =>
      c.kind === ts.SyntaxKind.MultiLineCommentTrivia && source.slice(c.pos, c.pos + 3) === '/**'
  );

  if (!jsdocComment) {
    return { code: source, changed: false };
  }

  // Generate new JSDoc
  const newJSDoc = generateWorkflowJSDoc(ast, { skipParamReturns: options.skipParamReturns });

  // Get the original JSDoc
  const originalJSDoc = source.slice(jsdocComment.pos, jsdocComment.end);

  // Check if changed
  if (originalJSDoc.trim() === newJSDoc.trim()) {
    return { code: source, changed: false };
  }

  // Replace the JSDoc
  const before = source.slice(0, jsdocComment.pos);
  const after = source.slice(jsdocComment.end);

  return {
    code: before + newJSDoc + after,
    changed: true,
  };
}

/**
 * Check if a connection is covered by a macro (and should not be written as @connect).
 * Handles @map and @path macros.
 */
function isConnectionCoveredByMacro(conn: TConnectionAST, macros: TWorkflowMacro[]): boolean {
  for (const macro of macros) {
    if (macro.type === 'map') {
      const [sourceNode, sourcePort] = macro.sourcePort.split('.');

      // Scoped connections between the map instance and its child
      if (
        (conn.from.node === macro.instanceId || conn.from.node === macro.childId) &&
        (conn.to.node === macro.instanceId || conn.to.node === macro.childId) &&
        (conn.from.scope === 'iterate' || conn.to.scope === 'iterate')
      ) {
        return true;
      }

      // Upstream connection: source.port -> mapInstance.items
      if (
        conn.from.node === sourceNode &&
        conn.from.port === sourcePort &&
        !conn.from.scope &&
        conn.to.node === macro.instanceId &&
        conn.to.port === 'items' &&
        !conn.to.scope
      ) {
        return true;
      }
    } else if (macro.type === 'path') {
      if (conn.from.scope || conn.to.scope) continue;
      const steps = macro.steps;
      const fromIdx = steps.findIndex(s => s.node === conn.from.node);
      const toIdx = steps.findIndex(s => s.node === conn.to.node);
      if (fromIdx === -1 || toIdx === -1 || fromIdx >= toIdx) continue;

      // Control flow: check consecutive pairs
      if (toIdx === fromIdx + 1) {
        const route = steps[fromIdx].route || 'ok';
        if (conn.from.node === 'Start' && conn.from.port === 'execute' && conn.to.port === 'execute') return true;
        if (conn.to.node === 'Exit') {
          if (route === 'fail' && conn.from.port === 'onFailure' && conn.to.port === 'onFailure') return true;
          if (route === 'ok' && conn.from.port === 'onSuccess' && conn.to.port === 'onSuccess') return true;
        }
        if (route === 'fail' && conn.from.port === 'onFailure' && conn.to.port === 'execute') return true;
        if (route === 'ok' && conn.from.port === 'onSuccess' && conn.to.port === 'execute') return true;
      }
      // Data: the shape a path implies between two of its steps (Exit included)
      if (isPathImpliedDataEdge(conn.from.node, conn.from.port, conn.to.node, conn.to.port)) {
        return true;
      }
    } else if (macro.type === 'fanOut') {
      if (conn.from.scope || conn.to.scope) continue;
      if (conn.from.node === macro.source.node && conn.from.port === macro.source.port) {
        for (const target of macro.targets) {
          const targetPort = target.port ?? macro.source.port;
          if (conn.to.node === target.node && conn.to.port === targetPort) {
            return true;
          }
        }
      }
    } else if (macro.type === 'fanIn') {
      if (conn.from.scope || conn.to.scope) continue;
      if (conn.to.node === macro.target.node && conn.to.port === macro.target.port) {
        for (const source of macro.sources) {
          const sourcePort = source.port ?? macro.target.port;
          if (conn.from.node === source.node && conn.from.port === sourcePort) {
            return true;
          }
        }
      }
    }
  }
  return false;
}

/**
 * Generate JSDoc comment for workflow function
 */
function generateWorkflowJSDoc(ast: TWorkflowAST, options: { skipParamReturns?: boolean } = {}): string {
  const lines: string[] = [];

  // Build macro coverage sets for filtering (@map and @coerce)
  const macroInstanceIds = new Set<string>();
  const macroChildIds = new Set<string>();
  const macroScopeNames = new Set<string>();
  const allCoerceInstanceIds = new Set<string>();
  if (ast.macros && ast.macros.length > 0) {
    for (const macro of ast.macros) {
      if (macro.type === 'map') {
        macroInstanceIds.add(macro.instanceId);
        macroChildIds.add(macro.childId);
        macroScopeNames.add(`${macro.instanceId}.iterate`);
      } else if (macro.type === 'coerce') {
        allCoerceInstanceIds.add(macro.instanceId);
      }
    }
  }

  lines.push('/**');

  // Add description
  if (ast.description) {
    lines.push(...formatJSDocDescription(ast.description));
    lines.push(` *`);
  }

  // @flowWeaver marker
  lines.push(' * @flowWeaver workflow');

  // Add workflow options
  if (ast.options?.strictTypes) {
    lines.push(' * @strictTypes');
  }
  if (ast.options?.autoConnect) {
    lines.push(' * @autoConnect');
  }
  // @trigger round-trip
  if (ast.options?.trigger) {
    const t = ast.options.trigger;
    const parts: string[] = [];
    if (t.event) parts.push(`event="${t.event}"`);
    if (t.cron) parts.push(`cron="${t.cron}"`);
    if (parts.length > 0) lines.push(` * @trigger ${parts.join(' ')}`);
  }
  // @http round-trip
  for (const r of ast.options?.http ?? []) lines.push(` * @http ${httpRouteText(r)}`);
  // @cancelOn round-trip
  if (ast.options?.cancelOn) {
    const c = ast.options.cancelOn;
    let line = ` * @cancelOn event="${c.event}"`;
    if (c.match) line += ` match="${c.match}"`;
    if (c.timeout) line += ` timeout="${c.timeout}"`;
    lines.push(line);
  }
  // @retries round-trip
  if (ast.options?.retries !== undefined) {
    lines.push(` * @retries ${ast.options.retries}`);
  }
  // @timeout round-trip
  if (ast.options?.timeout) {
    lines.push(` * @timeout "${ast.options.timeout}"`);
  }
  // @throttle round-trip
  if (ast.options?.throttle) {
    const t = ast.options.throttle;
    let line = ` * @throttle limit=${t.limit}`;
    if (t.period) line += ` period="${t.period}"`;
    lines.push(line);
  }
  // Pack-namespace annotations round-trip. Emission is symmetric
  // with parsing: each pack registers a serializer for its deploy namespace,
  // so whatever tags it learns to parse it also re-emits — no core changes.
  lines.push(...serializePackDeployAnnotations(ast.options?.deploy));
  // Add name if different from function name
  if (ast.name && ast.name !== ast.functionName) {
    lines.push(` * @name ${ast.name}`);
  }

  // Add npm package imports (external node types with importSource)
  // Format: @fwImport nodeName functionName from "packageName"
  // This persists npm node types so they survive file re-parsing
  const npmNodeTypes = ast.nodeTypes.filter((nt) => nt.importSource);
  const seenImportNames = new Set<string>();
  for (const npmType of npmNodeTypes) {
    if (seenImportNames.has(npmType.name)) continue;
    seenImportNames.add(npmType.name);
    // Derive the actual function name:
    // - If functionName differs from name, use functionName (explicitly set)
    // - Otherwise, extract from npm path: "npm/package/funcName" -> "funcName"
    let actualFunctionName = npmType.functionName;
    if (npmType.functionName === npmType.name && npmType.name.startsWith('npm/')) {
      // Extract function name from npm path: npm/package/funcName -> funcName
      const parts = npmType.name.split('/');
      actualFunctionName = parts[parts.length - 1];
    }
    lines.push(` * @fwImport ${npmType.name} ${actualFunctionName} from "${npmType.importSource}"`);
  }

  // Add node instances — skip synthetic MAP_ITERATOR/COERCION instances, strip parent from macro children.
  for (const instance of ast.instances) {
    if (macroInstanceIds.has(instance.id)) continue;
    if (allCoerceInstanceIds.has(instance.id)) continue;

    const inst = instance;

    if (macroChildIds.has(inst.id) && inst.parent) {
      // Write child @node without parent scope — @map handles it
      const stripped = { ...inst, parent: undefined };
      lines.push(generateNodeInstanceTag(stripped));
    } else {
      lines.push(generateNodeInstanceTag(inst));
    }
  }

  // Connections derived from [expr:] references are implied by the expression
  // on the @node line: never written as @connect, no part in @path detection.
  const authoredConnections = ast.connections.filter((conn) => !conn.derived);

  // Filter stale macros (e.g. paths whose connections were deleted)
  const existingMacros = filterStaleMacros(
    ast.macros || [],
    authoredConnections,
    ast.instances,
    ast.nodeTypes,
    ast.startPorts,
    ast.exitPorts,
  );

  // Compute dropped coerce instance IDs — their synthetic instances and connections must be excluded
  const survivingCoerceIds = new Set<string>();
  for (const macro of existingMacros) {
    if (macro.type === 'coerce') survivingCoerceIds.add(macro.instanceId);
  }
  const droppedCoerceIds = new Set<string>();
  for (const id of allCoerceInstanceIds) {
    if (!survivingCoerceIds.has(id)) droppedCoerceIds.add(id);
  }

  // Auto-detect @path sugar patterns from connections
  const detected = detectSugarPatterns(
    authoredConnections,
    ast.instances,
    existingMacros,
    ast.nodeTypes,
    ast.startPorts,
    ast.exitPorts,
  );

  // Merge detected macros with existing ones
  const allMacros: TWorkflowMacro[] = [
    ...existingMacros,
    ...detected.paths,
  ];

  // Add @map and @path macros
  if (allMacros.length > 0) {
    for (const macro of allMacros) {
      if (macro.type === 'map') {
        let mapLine = ` * @map ${macro.instanceId} ${macro.childId}`;
        if (macro.inputPort || macro.outputPort) {
          mapLine += `(${macro.inputPort} -> ${macro.outputPort})`;
        }
        mapLine += ` over ${macro.sourcePort}`;
        lines.push(mapLine);
      } else if (macro.type === 'path') {
        const stepsStr = macro.steps.map(s => s.route ? `${s.node}:${s.route}` : s.node).join(' -> ');
        lines.push(` * @path ${stepsStr}`);
      } else if (macro.type === 'fanOut') {
        const src = `${macro.source.node}.${macro.source.port}`;
        const tgts = macro.targets.map(t => t.port ? `${t.node}.${t.port}` : t.node).join(', ');
        lines.push(` * @fanOut ${src} -> ${tgts}`);
      } else if (macro.type === 'fanIn') {
        const srcs = macro.sources.map(s => s.port ? `${s.node}.${s.port}` : s.node).join(', ');
        const tgt = `${macro.target.node}.${macro.target.port}`;
        lines.push(` * @fanIn ${srcs} -> ${tgt}`);
      }
    }
  }

  // Add connections (with scope suffix when present)
  // Skip connections covered by macros, autoConnect-generated connections, and dropped coerce connections
  if (!ast.options?.autoConnect) {
    for (const conn of authoredConnections) {
      if (allMacros.length > 0 && isConnectionCoveredByMacro(conn, allMacros)) continue;
      if (droppedCoerceIds.has(conn.from.node) || droppedCoerceIds.has(conn.to.node)) continue;
      const fromScope = conn.from.scope ? `:${conn.from.scope}` : '';
      const toScope = conn.to.scope ? `:${conn.to.scope}` : '';
      lines.push(
        ` * @connect ${conn.from.node}.${conn.from.port}${fromScope} -> ${conn.to.node}.${conn.to.port}${toScope}`
      );
    }
  }

  // Add @param annotations for start ports (workflow inputs)
  if (!options.skipParamReturns && ast.startPorts && Object.keys(ast.startPorts).length > 0) {
    for (const { name, port, writeOrder } of planPortTags(Object.entries(ast.startPorts))) {
      const paramTag = generateJSDocPortTag(name, port, 'input', undefined, { writeOrder });
      // Replace @input with @param for workflow-level JSDoc
      lines.push(` * ${paramTag.replace('@input', '@param')}`);
    }
  }

  // Add @returns annotations for exit ports (workflow outputs)
  if (!options.skipParamReturns && ast.exitPorts && Object.keys(ast.exitPorts).length > 0) {
    for (const { name, port, writeOrder } of planPortTags(Object.entries(ast.exitPorts))) {
      const returnTag = generateJSDocPortTag(name, port, 'output', undefined, { writeOrder });
      // Replace @output with @returns for workflow-level JSDoc
      lines.push(` * ${returnTag.replace('@output', '@returns')}`);
    }
  }

  // Add scopes — skip scopes covered by @map macros
  if (ast.scopes) {
    for (const [scopeName, children] of Object.entries(ast.scopes)) {
      if (macroScopeNames.has(scopeName)) continue;
      lines.push(` * @scope ${scopeName} [${children.join(', ')}]`);
    }
  }

  lines.push(' */');

  return lines.join('\n');
}

/**
 * Compute topological order for workflow instances using connections.
 * Falls back to declaration order when connections don't provide a clear ordering.
 */
function computeTopologicalOrder(ast: TWorkflowAST): string[] {
  const instanceIds = ast.instances.map((inst) => inst.id);

  // If no connections, use declaration order
  if (!ast.connections || ast.connections.length === 0) {
    return instanceIds;
  }

  // Build adjacency list from execution flow connections only
  // (control flow connections determine order, data connections don't)
  const graph = new Map<string, Set<string>>();
  const inDegree = new Map<string, number>();

  for (const id of instanceIds) {
    graph.set(id, new Set());
    inDegree.set(id, 0);
  }

  for (const conn of ast.connections) {
    const fromNode = conn.from.node;
    const toNode = conn.to.node;

    // Only consider connections between instances (skip Start/Exit)
    if (!graph.has(fromNode) || !graph.has(toNode)) continue;

    // Only use execution flow (onSuccess/onFailure -> execute) for ordering
    const isExecutionFlow =
      (conn.from.port === 'onSuccess' || conn.from.port === 'onFailure') &&
      conn.to.port === 'execute';

    if (isExecutionFlow && !graph.get(fromNode)!.has(toNode)) {
      graph.get(fromNode)!.add(toNode);
      inDegree.set(toNode, (inDegree.get(toNode) || 0) + 1);
    }
  }

  // Kahn's algorithm for topological sort
  const queue: string[] = [];
  for (const id of instanceIds) {
    if ((inDegree.get(id) || 0) === 0) {
      queue.push(id);
    }
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    const node = queue.shift()!;
    sorted.push(node);

    for (const neighbor of graph.get(node) || []) {
      const newDegree = (inDegree.get(neighbor) || 1) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) {
        queue.push(neighbor);
      }
    }
  }

  // If topological sort didn't include all nodes (cycles or disconnected),
  // append remaining nodes in declaration order
  if (sorted.length < instanceIds.length) {
    const sortedSet = new Set(sorted);
    for (const id of instanceIds) {
      if (!sortedSet.has(id)) {
        sorted.push(id);
      }
    }
  }

  return sorted;
}

/**
 * Check if source code has in-place generation markers
 */
export function hasInPlaceMarkers(source: string): boolean {
  return (
    source.includes(MARKERS.RUNTIME_START) &&
    source.includes(MARKERS.RUNTIME_END) &&
    source.includes(MARKERS.BODY_START) &&
    source.includes(MARKERS.BODY_END)
  );
}

/**
 * Remove all generated sections from source code
 */
export function stripGeneratedSections(source: string): string {
  let result = source;

  // Remove runtime section
  const runtimeStartIdx = result.indexOf(MARKERS.RUNTIME_START);
  const runtimeEndIdx = result.indexOf(MARKERS.RUNTIME_END);
  if (runtimeStartIdx !== -1 && runtimeEndIdx !== -1) {
    const lineStart = result.lastIndexOf('\n', runtimeStartIdx);
    const lineEnd = result.indexOf('\n', runtimeEndIdx + MARKERS.RUNTIME_END.length);
    result =
      result.slice(0, lineStart === -1 ? 0 : lineStart) +
      result.slice(lineEnd === -1 ? result.length : lineEnd);
  }

  // Remove ALL body sections (multi-workflow files have multiple)
  while (true) {
    const bodyStartIdx = result.indexOf(MARKERS.BODY_START);
    const bodyEndIdx = result.indexOf(MARKERS.BODY_END);
    if (bodyStartIdx === -1 || bodyEndIdx === -1 || bodyEndIdx < bodyStartIdx) break;
    const before = result.slice(0, bodyStartIdx);
    const after = result.slice(bodyEndIdx + MARKERS.BODY_END.length);
    result = before + `throw new Error('Not implemented');` + after;
  }

  return result;
}
