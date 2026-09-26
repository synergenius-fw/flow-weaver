/**
 * Whole-module code generation.
 *
 * generateCode decides what a generated workflow module contains and in which
 * order: the inlined runtime, the type declarations preserved from the
 * source, imports of node types from other files and packages, source
 * constants, the local node functions, the same-file workflows used as
 * nodes, the exported workflow function, and CJS exports. It also decides the
 * checks made before anything is emitted (stub nodes, async detection) and
 * how the text is finished (JavaScript output, source map). Each section
 * lives in `./generated-module/`:
 * - preamble: the inlined runtime and preserved type declarations
 * - node-type-imports: where each node type comes from, and its imports
 * - local-node-functions: source constants, shared helpers, inlined functions
 * - workflow-functions: the signature, the workflow and its local dependencies
 * - module-format: ESM/CJS import and export syntax
 * - module-writer: the text and the source map line tracking
 */

import type {
  TGenerateOptions as ASTGenerateOptions,
  TWorkflowAST,
  TModuleFormat,
} from '../ast/types';
import { bodyGenerator } from '../generator/body-generator';
import { stripTypeScript, INLINE_ENGINE_EXPORTS } from './inline-runtime';
import { graphIdentity } from './graph-identity';
import { validateWorkflowAsync } from '../generator/async-detection';
import { validateDurableClosure } from './durable-validation';
import { generateModuleExports } from './generated-module/module-format';
import { ModuleWriter } from './generated-module/module-writer';
import { emitInlineRuntime, emitPreservedTypeDeclarations } from './generated-module/preamble';
import { classifyNodeTypes, emitNodeTypeImports } from './generated-module/node-type-imports';
import { emitLocalNodeFunctions, emitSourceConstants } from './generated-module/local-node-functions';
import { emitLocalWorkflowDependencies, emitWorkflowFunction } from './generated-module/workflow-functions';
import * as fs from 'fs';

export {
  generateImportStatement,
  generateFunctionExportKeyword,
  generateModuleExports,
} from './generated-module/module-format';

export interface GenerateOptions extends Partial<ASTGenerateOptions> {
  /**
   * Whether to generate production-optimized code (no debug events)
   */
  production?: boolean;
  /**
   * Whether to generate source maps
   */
  sourceMap?: boolean;
  /**
   * All workflows in the source file (needed for local workflow dependencies)
   */
  allWorkflows?: TWorkflowAST[];
  /**
   * Module format for generated code ('esm' or 'cjs')
   * @default 'esm'
   */
  moduleFormat?: TModuleFormat;
  /**
   * Enable bundle mode for multi-workflow bundles.
   * When true, imports node types from node-types/ directory and workflows from sibling files.
   * Runtime is always inlined regardless of this setting.
   */
  bundleMode?: boolean;
  /**
   * Constants from source file(s) to include at the top of the generated file.
   * Used in bundle mode when local node functions are inlined and need their
   * referenced constants available.
   */
  constants?: string[];
  /**
   * Map of node type names to their import paths.
   * When set, generates imports instead of inlining the function text.
   * Used in bundle mode where node types are in separate files.
   * @example { 'add': '../node-types/add.js', 'greet': '../node-types/greet.js' }
   */
  externalNodeTypes?: Record<string, string>;
  /**
   * Allow generation even when stub nodes exist. Stub nodes will emit
   * a throw statement at runtime. Default: false (refuse to generate with stubs).
   */
  generateStubs?: boolean;
}

export interface GenerateResult {
  code: string;
  sourceMap?: string;
}

/**
 * Generate executable TypeScript code from a workflow AST
 *
 * @param ast - The workflow AST to generate code from
 * @param options - Generation options (production mode, source maps, etc.)
 * @returns Generated code as a string, or GenerateResult with source map
 *
 * @example
 * ```typescript
 * const result = generateCode(ast, {
 *   production: false,
 *   sourceMap: true
 * });
 *
 * fs.writeFileSync('workflow.generated.ts', result.code);
 * if (result.sourceMap) {
 *   fs.writeFileSync('workflow.generated.ts.map', result.sourceMap);
 * }
 * ```
 */
export function generateCode(
  ast: TWorkflowAST,
  options: GenerateOptions & { sourceMap: true }
): GenerateResult;
export function generateCode(ast: TWorkflowAST, options?: GenerateOptions): string;
export function generateCode(
  ast: TWorkflowAST,
  options?: GenerateOptions
): string | GenerateResult {
  const {
    production = false,
    sourceMap = false,
    allWorkflows = [],
    moduleFormat = 'esm',
    bundleMode = false,
    constants = [],
    externalNodeTypes = {},
    generateStubs = false,
    outputFormat = 'typescript',
  } = options || {};
  const durableSequential = validateDurableClosure(
    ast,
    allWorkflows,
  ).hasDurableGate;
  const identity = durableSequential
    ? { graphFingerprint: graphIdentity(ast, allWorkflows).graphFingerprint }
    : undefined;

  assertNoStubNodes(ast, generateStubs);

  // Determine if workflow should be async based on node composition
  const { shouldBeAsync, warning } = validateWorkflowAsync(ast, ast.nodeTypes);
  if (warning && !production) {
    console.warn(warning);
  }

  const functionBody = bodyGenerator.generateWithExecutionContext(
    ast,
    ast.nodeTypes,
    shouldBeAsync,
    production,
    bundleMode,
    durableSequential,
    identity,
  );

  const writer = new ModuleWriter(ast.functionName, ast.sourceFile, sourceMap);
  writer.push('');
  writer.push('');
  emitInlineRuntime(writer, production, moduleFormat);
  emitPreservedTypeDeclarations(writer, ast.sourceFile);

  const origins = classifyNodeTypes(ast);
  emitNodeTypeImports(writer, origins, bundleMode, moduleFormat);
  // In bundle mode local node functions are still inlined, not imported from
  // node-types/: they may not be in the bundled node types list, and scoped
  // nodes need their scope function closure generated inline.
  emitSourceConstants(writer, constants, origins.localFunctions);
  emitLocalNodeFunctions(writer, origins.localFunctions, externalNodeTypes, moduleFormat, production);
  emitLocalWorkflowDependencies(writer, ast, origins.localWorkflowNodes, allWorkflows, production, durableSequential);

  emitWorkflowFunction(writer, ast, functionBody, shouldBeAsync, production, moduleFormat);

  // For CJS format, add module.exports at the end: the workflow, and the
  // engine helpers an ESM file exports from its runtime section.
  if (moduleFormat === 'cjs') {
    writer.push('');
    writer.push(generateModuleExports([ast.functionName, ...INLINE_ENGINE_EXPORTS]));
  }

  let code = writer.text();
  if (outputFormat === 'javascript') {
    code = stripTypeScript(code);
  }

  const map = writer.finishSourceMap((file) => fs.readFileSync(file, 'utf8'));
  if (sourceMap && map !== undefined) {
    return { code, sourceMap: map };
  }
  return code;
}

/**
 * Refuses a workflow with stub nodes unless the caller asked for stubs to be
 * generated (each then throws when it runs).
 */
function assertNoStubNodes(ast: TWorkflowAST, generateStubs: boolean): void {
  const stubNodeTypes = ast.nodeTypes.filter((nt) => nt.variant === 'STUB');
  if (stubNodeTypes.length > 0 && !generateStubs) {
    const stubNames = stubNodeTypes.map((nt) => nt.functionName).join(', ');
    throw new Error(
      `Cannot generate code: workflow has ${stubNodeTypes.length} stub node(s) without implementation: ${stubNames}. ` +
      `Implement them or pass { generateStubs: true } to emit placeholder throws.`
    );
  }
}
