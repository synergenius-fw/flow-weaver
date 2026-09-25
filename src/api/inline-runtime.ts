import { getGeneratedBranding } from '../generated-branding.js';
import { VERSION } from '../generated-version.js';
import { INLINE_ENGINE_SOURCE, INLINE_EXECUTION_CONTEXT_SOURCE } from './inline-engine.generated.js';
import type { TModuleFormat } from '../ast/types';

export type TOutputFormat = 'typescript' | 'javascript';

/**
 * What a compiled file exports from its runtime section besides the
 * workflows: the durable engine's public surface, under the same names the
 * package exports, so calling code can import them from either.
 */
export const INLINE_ENGINE_EXPORTS: readonly string[] = [
  'createWorkflowRuntime',
  'acceptContinuation',
  'createContinuationEnvelope',
  'isDurableGateYield',
  'isAmbiguousEffectError',
  'DurableGateYield',
  'AmbiguousEffectError',
  'CancellationError',
  'ENGINE_VERSION',
];

/** The types a host of a compiled file needs, exported beside the values. */
export const INLINE_ENGINE_TYPE_EXPORTS: readonly string[] = [
  'WorkflowRuntime',
  'WorkflowRuntimeServices',
  'CreateWorkflowRuntimeOptions',
  'ContinuationEnvelope',
  'DecodedContinuation',
  'DurableGate',
  'GateResolution',
  'EffectAdapter',
  'WireValue',
];

/**
 * The durable engine as it appears in a compiled file: the package's own
 * source (`continuation-core.ts`, `durable-execution.ts`) with its module
 * syntax removed, preceded by what its imports provided.
 */
function generateInlineEngine(production: boolean): string {
  const lines: string[] = [];
  lines.push('// ============================================================================');
  lines.push('// Durable Engine');
  lines.push("// The package's own engine, copied here so this file runs without it.");
  lines.push('// ============================================================================');
  lines.push('');
  lines.push(`const VERSION = ${JSON.stringify(VERSION)};`);
  if (!production) {
    lines.push('type DebugController = TDebugController;');
  }
  lines.push(
    'type FwMockConfig = { readonly events?: Readonly<Record<string, object>>, readonly invocations?: Readonly<Record<string, object>>, readonly agents?: Readonly<Record<string, object>>, readonly gates?: Readonly<Record<string, object>>, readonly fast?: boolean };',
  );
  lines.push('');
  // Production output carries no debugger types at all; the two the engine
  // names in its services type are erased to `unknown`, which is what the
  // production execution context declares for them anyway.
  const source = production
    ? INLINE_ENGINE_SOURCE.replace(/\bTDebugger\b/g, 'unknown').replace(/\bDebugController\b/g, 'unknown')
    : INLINE_ENGINE_SOURCE;
  lines.push(source);
  return lines.join('\n');
}

/**
 * A region of `src/runtime/ExecutionContext.ts` that only a development build
 * keeps: opened by `// inline: development only` (optionally followed by
 * `, a no-op stub in production`) and closed by `// inline: end`.
 */
const DEVELOPMENT_REGION =
  /^([ \t]*)\/\/ inline: development only(, a no-op stub in production)?\n([\s\S]*?)^[ \t]*\/\/ inline: end\n/gm;

/** A method declared at class-member depth: `  name(` or `  async name(`. */
const CLASS_METHOD = /^ {2}(?:async\s+)?([A-Za-z_$][\w$]*)\(/gm;

/**
 * The execution context as it appears in a compiled file: the package's own
 * `src/runtime/ExecutionContext.ts` with its module syntax removed. A
 * development build keeps every region and drops the marker lines; a
 * production build removes the development-only regions and turns each
 * method of a stub region into a no-op, so it carries no debug
 * instrumentation while generated calls to those methods still resolve.
 */
export function inlineExecutionContext(production: boolean, exportClasses: boolean): string {
  let source = INLINE_EXECUTION_CONTEXT_SOURCE.replace(
    DEVELOPMENT_REGION,
    (_region, indent: string, stubbed: string | undefined, body: string) => {
      if (!production) return body;
      if (stubbed === undefined) return '';
      return Array.from(body.matchAll(CLASS_METHOD), ([, name]) =>
        [`${indent}${name}(_args: unknown): void {`, `${indent}  // No-op in production mode`, `${indent}}`, ''].join('\n'),
      ).join('\n');
    },
  );
  if (/\/\/ inline:/.test(source)) {
    throw new Error('src/runtime/ExecutionContext.ts has an unbalanced `// inline:` marker');
  }
  if (exportClasses) {
    source = source.replace(/^class GeneratedExecutionContext\b/m, 'export class GeneratedExecutionContext');
  }
  return source.trimEnd();
}

/**
 * Strip TypeScript type syntax from code using esbuild.
 * Removes type declarations, interfaces, declare statements, and type annotations
 * while preserving runtime JavaScript code.
 * Uses a lazy import so esbuild is only loaded when actually needed.
 */
export function stripTypeScript(code: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { transformSync } = require('esbuild') as typeof import('esbuild');
  const result = transformSync(code, {
    loader: 'ts',
    target: 'es2020',
    // Keep the code readable (no minification)
    minify: false,
    // Preserve formatting as much as possible
    keepNames: true,
  });
  return result.code;
}

/**
 * Generates inline runtime code for standalone execution
 *
 * This includes all types and the GeneratedExecutionContext class
 * so generated workflows have zero runtime dependencies.
 *
 * @param production - Whether to generate production-optimized code (no debug events)
 * @param exportClasses - Whether to add 'export' keyword to classes (for shared modules)
 * @param outputFormat - Output format: 'typescript' (default) or 'javascript' (strips types)
 * @param moduleFormat - 'esm' (default) exports the engine's helpers with an `export` statement;
 *   'cjs' leaves that to the caller's `module.exports` (see `INLINE_ENGINE_EXPORTS`)
 */
export function generateInlineRuntime(
  production: boolean,
  exportClasses: boolean = false,
  outputFormat: TOutputFormat = 'typescript',
  moduleFormat: TModuleFormat = 'esm',
): string {
  const exportKeyword = exportClasses ? 'export ' : '';
  const lines: string[] = [];

  // Type definitions
  lines.push('// ============================================================================');
  lines.push('// Runtime Types');
  lines.push('// ============================================================================');
  lines.push('');
  lines.push('type TStatusType =');
  lines.push('  | "RUNNING"');
  lines.push('  | "SCHEDULED"');
  lines.push('  | "SUCCEEDED"');
  lines.push('  | "FAILED"');
  lines.push('  | "CANCELLED"');
  lines.push('  | "PENDING";');
  lines.push('');
  lines.push('type TVariableIdentification = {');
  lines.push('  nodeTypeName: string;');
  lines.push('  id: string;');
  lines.push('  scope?: string | undefined;');
  lines.push('  side?: "start" | "exit" | undefined;');
  lines.push('  portName: string;');
  lines.push('  executionIndex: number;');
  lines.push('  key?: string | undefined;');
  lines.push('};');
  lines.push('');

  if (!production) {
    // Debug types only in development mode
    lines.push('type TStatusChangedEvent = {');
    lines.push('  type: "STATUS_CHANGED";');
    lines.push('  nodeTypeName: string;');
    lines.push('  id: string;');
    lines.push('  scope?: string;');
    lines.push('  side?: "start" | "exit";');
    lines.push('  executionIndex: number;');
    lines.push('  status: TStatusType;');
    lines.push('  innerFlowInvocation?: boolean;');
    lines.push('};');
    lines.push('');
    lines.push('type TVariableSetEvent = {');
    lines.push('  type: "VARIABLE_SET";');
    lines.push('  identifier: TVariableIdentification;');
    lines.push('  value?: unknown;');
    lines.push('  innerFlowInvocation?: boolean;');
    lines.push('};');
    lines.push('');
    lines.push('type TErrorLogEvent = {');
    lines.push('  type: "LOG_ERROR";');
    lines.push('  nodeTypeName: string;');
    lines.push('  id: string;');
    lines.push('  scope?: string;');
    lines.push('  side?: "start" | "exit";');
    lines.push('  executionIndex: number;');
    lines.push('  error: string;');
    lines.push('  code?: string;');
    lines.push('  innerFlowInvocation?: boolean;');
    lines.push('};');
    lines.push('');
    lines.push('type TWorkflowCompletedEvent = {');
    lines.push('  type: "WORKFLOW_COMPLETED";');
    lines.push('  executionIndex: number;');
    lines.push('  status: "SUCCEEDED" | "FAILED" | "CANCELLED";');
    lines.push('  result?: unknown;');
    lines.push('  innerFlowInvocation?: boolean;');
    lines.push('};');
    lines.push('');
    lines.push(`${exportKeyword}type TEvent =`);
    lines.push('  | TStatusChangedEvent');
    lines.push('  | TVariableSetEvent');
    lines.push('  | TErrorLogEvent');
    lines.push('  | TWorkflowCompletedEvent;');
    lines.push('');
    lines.push(`${exportKeyword}type TDebugger = {`);
    lines.push('  sendEvent: (event: TEvent) => void | Promise<void>;');
    lines.push('  innerFlowInvocation: boolean;');
    lines.push('  sessionId?: string;');
    lines.push('};');
    lines.push('');
    // Debug controller type for live step-through debugging only. The
    // context parameter is deliberately loose: the compiled file declares
    // its own GeneratedExecutionContext, and a caller hands in the package's
    // runtime, whose controller is typed against the package's class. Two
    // classes with private members are never assignable to each other, so
    // naming the class here would reject every runtime built with
    // createWorkflowRuntime().
    lines.push('type TDebugController = {');
    lines.push('  beforeNode(nodeId: string, ctx: unknown): Promise<void> | void;');
    lines.push('  afterNode(nodeId: string, ctx: unknown): Promise<void> | void;');
    lines.push('};');
    lines.push('');
  }

  // VariableAddress, ExecutionInfo and VariableValue come with the execution
  // context below; the address types, WireValue, DurableGateKind and the
  // WorkflowRuntime interface come from the inlined engine after it.

  // CancellationError class
  lines.push('// ============================================================================');
  lines.push('// Cancellation Error');
  lines.push('// ============================================================================');
  lines.push('');
  lines.push(`${exportKeyword}class CancellationError extends Error {`);
  lines.push('  public readonly executionIndex: number;');
  lines.push('  public readonly nodeId?: string;');
  lines.push('  public readonly timestamp: number;');
  lines.push('');
  lines.push('  constructor(');
  lines.push("    message: string = 'Workflow execution cancelled',");
  lines.push('    executionIndex: number = 0,');
  lines.push('    nodeId?: string,');
  lines.push('    timestamp: number = Date.now()');
  lines.push('  ) {');
  lines.push('    super(message);');
  lines.push("    this.name = 'CancellationError';");
  lines.push('    this.executionIndex = executionIndex;');
  lines.push('    this.nodeId = nodeId;');
  lines.push('    this.timestamp = timestamp;');
  lines.push('  }');
  lines.push('');
  lines.push('  static isCancellationError(error: unknown): error is CancellationError {');
  lines.push('    return (');
  lines.push('      error instanceof CancellationError ||');
  lines.push("      (error instanceof Error && error.name === 'CancellationError')");
  lines.push('    );');
  lines.push('  }');
  lines.push('}');
  lines.push('');

  // GeneratedExecutionContext class: src/runtime/ExecutionContext.ts, as text.
  lines.push('// ============================================================================');
  lines.push('// Execution Context');
  lines.push('// ============================================================================');
  lines.push('');
  lines.push(inlineExecutionContext(production, exportClasses));
  lines.push('');

  lines.push(generateInlineEngine(production));
  lines.push('');
  if (moduleFormat === 'esm') {
    // A shared runtime module already exports its classes by keyword.
    const values = INLINE_ENGINE_EXPORTS.filter((name) => !exportClasses || name !== 'CancellationError');
    lines.push(`export { ${values.join(', ')} };`);
    lines.push(`export type { ${INLINE_ENGINE_TYPE_EXPORTS.join(', ')} };`);
    lines.push('');
  }

  const output = lines.join('\n');
  if (outputFormat === 'javascript') {
    return stripTypeScript(output);
  }
  return output;
}

/**
 * Generates a standalone runtime module file for multi-workflow bundles.
 * This exports all runtime types and classes so individual workflow files can import them.
 *
 * @param production - Whether to generate production-optimized code (no debug events)
 * @param moduleFormat - The module format to use ('esm' or 'cjs')
 */
export function generateStandaloneRuntimeModule(
  production: boolean,
  moduleFormat: TModuleFormat = 'esm'
): string {
  const lines: string[] = [];

  lines.push('// ============================================================================');
  lines.push('// Shared Runtime Module');
  lines.push(getGeneratedBranding().header());
  lines.push('// ============================================================================');
  lines.push('');

  // Include the inline runtime (all types, GeneratedExecutionContext and the
  // durable engine). Pass exportClasses=true to add 'export' keywords for
  // module use.
  const inlineRuntime = generateInlineRuntime(production, true, 'typescript', moduleFormat);
  lines.push(inlineRuntime);
  lines.push('');


  if (moduleFormat === 'cjs') {
    // CommonJS exports
    lines.push('// ============================================================================');
    lines.push('// Exports');
    lines.push('// ============================================================================');
    lines.push('');
    const exports = ['GeneratedExecutionContext', ...INLINE_ENGINE_EXPORTS];
    lines.push(`module.exports = { ${exports.join(', ')} };`);
  }
  // For ESM, exports are added via 'export' keyword in the generated code

  lines.push('');

  return lines.join('\n');
}
