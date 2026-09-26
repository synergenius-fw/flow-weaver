/**
 * In-Place Code Generation
 *
 * Generates executable code directly into the source file while preserving
 * user code (node functions). This module decides the order of the rewrite
 * steps and what `annotationsOnly` stops short of; each step lives in
 * `./in-place/`:
 * - node-type-functions: JSDoc (and text) of node types the file owns
 * - built-in-nodes: built-in node functions the workflow uses, inlined
 * - orphaned-node-types: node type functions no workflow uses any more
 * - workflow-jsdoc: the workflow function's JSDoc
 * - fw-imports: import statements for `@fwImport` node types
 * - runtime-section: the inlined runtime between its markers
 * - signature: `params`, `__runtime__`, `async` and `Promise<T>`
 * - function-body: the generated body between its markers
 */

import type { TModuleFormat, TWorkflowAST } from '../ast/types';
import { graphIdentity } from './graph-identity';
import { shouldWorkflowBeAsync } from '../generator/async-detection';
import { validateDurableClosure } from './durable-validation';
import { inlineBuiltInNodes } from './in-place/built-in-nodes';
import { generateFunctionBody, replaceWorkflowFunctionBody } from './in-place/function-body';
import { ensureFwImportStatements } from './in-place/fw-imports';
import { syncNodeTypeFunctions } from './in-place/node-type-functions';
import { removeOrphanedNodeTypeFunctions } from './in-place/orphaned-node-types';
import { replaceOrInsertRuntimeSection } from './in-place/runtime-section';
import {
  detectFunctionIsAsync,
  ensureAsyncKeyword,
  ensureParamsParameter,
  ensurePromiseReturnType,
  ensureRuntimeParameter,
} from './in-place/signature';
import type { SourceEdit } from './in-place/source-file';
import { replaceWorkflowJSDoc } from './in-place/workflow-jsdoc';

// The markers and their helpers live with the parser, which strips them before
// reading annotations; they stay exported from here for existing importers.
export { MARKERS, hasInPlaceMarkers, stripGeneratedSections } from '../parser/generated-sections';

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
    skipParamReturns = false,
    annotationsOnly = false,
  } = options;
  const durableSequential = validateDurableClosure(
    ast,
    allWorkflows ?? [],
  ).hasDurableGate;

  let result = sourceCode;
  let hasChanges = false;
  const apply = (edit: SourceEdit): void => {
    if (edit.changed) {
      result = edit.code;
      hasChanges = true;
    }
  };

  // Step 1: Update JSDoc annotations for node type functions the file owns.
  apply(syncNodeTypeFunctions(result, ast));

  // Step 1.2: Insert built-in node functions that are auto-injected (no source in the file).
  // Skipped in annotations-only mode: the parser injects built-ins on every parse, and
  // inlining them is only needed to make a compiled file self-contained.
  if (!annotationsOnly) {
    apply(inlineBuiltInNodes(result, ast, production));
  }

  // Step 1.5: Remove orphaned nodeType functions (functions that don't match any AST nodeType)
  // When multi-workflow, consider ALL workflows' node types to avoid deleting types used by siblings
  apply(removeOrphanedNodeTypeFunctions(result, ast, allWorkflows));

  // Step 2: Update JSDoc annotations for workflow function
  apply(replaceWorkflowJSDoc(result, ast, { skipParamReturns }));

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
  apply(ensureFwImportStatements(result, ast));

  // Step 3: Generate and insert/replace runtime section (always inlined — zero
  // runtime dependencies, so the module format does not change it)
  apply(replaceOrInsertRuntimeSection(result, production));

  // Step 3.5: Ensure function signature includes the `params` parameter.
  // The generated body unconditionally references `params` (the recursion-
  // depth guard reads `params.__rd__`, and every Start data port reads
  // `params.<portName>`). A workflow whose author signature declares data
  // ports gets `params` for free, but one with NO Start data ports (e.g. a
  // single zero-input node, author signature `(execute)`) omits it, so the
  // generated body throws `ReferenceError: params is not defined` at
  // runtime. Inject `params` right after `execute` when absent. Runs BEFORE
  // the `__runtime__` step so the final order stays (execute, params, __runtime__).
  apply(ensureParamsParameter(result, ast.functionName));

  // Step 4: replace the A1 signal/debug parameters with the one required,
  // execution-scoped A2 runtime parameter.
  apply(ensureRuntimeParameter(result, ast.functionName));

  // Step 5: Detect async from node composition + source signature
  // If any node is async, force async (even if source isn't marked async)
  // In dev mode (!production), always force async so the debugger can pause execution
  // at breakpoints (sendStatusChangedEvent must be awaited).
  const nodesRequireAsync = shouldWorkflowBeAsync(ast, ast.nodeTypes);
  const sourceIsAsync = detectFunctionIsAsync(result, ast.functionName);
  const forceAsync = nodesRequireAsync || !production;
  const isAsync = forceAsync || sourceIsAsync;

  // Add async keyword to source if nodes or debug hooks require it
  apply(ensureAsyncKeyword(result, ast.functionName, forceAsync));

  // Step 5b: Wrap return type in Promise<T> when async was added
  apply(ensurePromiseReturnType(result, ast.functionName, forceAsync));

  // A gated body declares its graph identity to the engine; a body that can
  // never yield has no continuation to protect and stays as it was.
  const identity = durableSequential
    ? { graphFingerprint: graphIdentity(ast, allWorkflows ?? []).graphFingerprint }
    : undefined;
  const functionBody = generateFunctionBody(ast, production, isAsync, durableSequential, identity);
  apply(replaceWorkflowFunctionBody(result, ast.functionName, functionBody));

  // Final check: if the output equals the input, there were no real changes
  // This catches cases where individual steps report changes but produce identical output
  if (hasChanges && result === sourceCode) {
    hasChanges = false;
  }

  return { code: result, hasChanges };
}
