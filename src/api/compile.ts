import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { TCompileResult as ASTCompileResult } from '../ast/types';

import { VERSION as COMPILER_VERSION } from '../generated-version';
import { type GenerateOptions, generateCode } from './generate';
import { type InPlaceGenerateOptions, generateInPlace } from './generate-in-place';
import { type ParseOptions, parseWorkflow } from './parse';

/**
 * Options for compiling a workflow file
 */
export interface CompileOptions {
  /** Options for parsing the source file */
  parse?: ParseOptions;
  /** Options for code generation */
  generate?: GenerateOptions & InPlaceGenerateOptions;
  /**
   * Compile in-place (modifies source file, default: true)
   * When false, generates to a separate file
   */
  inPlace?: boolean;
  /** Custom output file path (only used when inPlace=false) */
  outputFile?: string;
  /** Whether to write the compiled code to disk (default: true) */
  write?: boolean;
  /** Whether to save AST alongside the generated file (default: false) */
  saveAST?: boolean;
}

/**
 * Result of workflow compilation
 */
export type CompileResult = ASTCompileResult;

/**
 * Compile a workflow file from TypeScript annotations to executable code.
 *
 * By default, compiles in-place (updates the source file with generated code).
 * Set inPlace=false to generate to a separate file.
 *
 * @param filePath - Path to the workflow file
 * @param options - Compilation options
 * @returns CompileResult with code, AST, and metadata
 *
 * @example
 * ```typescript
 * // Compile in-place (default)
 * const result = await compileWorkflow('./workflow.ts');
 *
 * // Generate to separate file for production
 * const result = await compileWorkflow('./workflow.ts', {
 *   inPlace: false,
 *   outputFile: './dist/workflow.ts',
 *   generate: { production: true }
 * });
 * ```
 *
 * @throws {Error} If parsing fails or workflow contains errors
 */
export async function compileWorkflow(
  filePath: string,
  options: CompileOptions = {}
): Promise<CompileResult> {
  const startTime = Date.now();
  const { inPlace = true } = options;

  const parseResult = await parseWorkflow(filePath, options.parse);
  if (parseResult.errors.length > 0) {
    throw new Error(`Parse errors:\n${parseResult.errors.join('\n')}`);
  }

  // Validate before generating
  const { validateWorkflow } = await import('./validate.js');
  const validationResult = validateWorkflow(parseResult.ast);
  if (validationResult.errors.length > 0) {
    const errorMessages = validationResult.errors.map((e) =>
      typeof e === 'string' ? e : e.message
    );
    throw new Error(`Validation errors:\n${errorMessages.join('\n')}`);
  }

  let code: string;
  let outputFile: string;

  if (inPlace) {
    // In-place compilation: update source file
    const sourceCode = await fs.readFile(filePath, 'utf-8');
    const result = generateInPlace(sourceCode, parseResult.ast, {
      ...options.generate,
      allWorkflows: parseResult.allWorkflows,
      sourceFile: options.generate?.sourceFile || path.resolve(filePath),
    });
    code = result.code;
    outputFile = filePath;

    if (options.write !== false) {
      await fs.writeFile(filePath, code, 'utf-8');
    }
  } else {
    // Separate file compilation
    code = generateCode(parseResult.ast, options.generate);
    outputFile = options.outputFile || getDefaultOutputFile(filePath);

    if (options.write !== false) {
      await fs.writeFile(outputFile, code, 'utf-8');
    }
  }

  if (options.saveAST) {
    const { saveASTAlongside } = await import('../ast/serialization-node');
    await saveASTAlongside(parseResult.ast);
  }

  const result: CompileResult = {
    code,
    ast: parseResult.ast,
    analysis: {
      controlFlowGraph: { nodes: [], edges: [], inDegree: {}, outDegree: {} },
      executionOrder: [],
      branchingNodes: [],
      branchRegions: [],
      mergeNodes: [],
      errors: [],
      warnings: [],
      unusedNodes: [],
      inlineCandidates: [],
    },
    metadata: {
      sourceFile: filePath,
      outputFile,
      compiledAt: new Date().toISOString(),
      compilerVersion: COMPILER_VERSION,
      generationTime: Date.now() - startTime,
    },
  };
  return result;
}

function getDefaultOutputFile(sourceFile: string): string {
  const dir = path.dirname(sourceFile);
  // Remove .ts extension to get basename
  const basename = path.basename(sourceFile, '.ts');
  return path.join(dir, `${basename}.generated.ts`);
}

/**
 * Compile multiple workflow files in parallel
 *
 * @param filePaths - Array of workflow file paths to compile
 * @param options - Compilation options applied to all files
 * @returns Array of CompileResults for each file
 *
 * @example
 * ```typescript
 * const results = await compileWorkflows([
 *   './workflow-1.ts',
 *   './workflow-2.ts'
 * ]);
 * ```
 */
export async function compileWorkflows(
  filePaths: string[],
  options: CompileOptions = {}
): Promise<CompileResult[]> {
  return Promise.all(filePaths.map((filePath) => compileWorkflow(filePath, options)));
}

/**
 * Compile all workflow files matching a glob pattern
 *
 * Uses the glob library to find matching files and compiles them in parallel.
 *
 * @param pattern - Glob pattern (e.g., "src/**\/*.ts")
 * @param options - Compilation options applied to all files
 * @returns Array of CompileResults for each matched file
 *
 * @example
 * ```typescript
 * // Compile all workflow files in src directory
 * const results = await compilePattern('src/**\/*.ts');
 *
 * // Compile with custom options
 * const results = await compilePattern('workflows/**\/*.ts', {
 *   generate: { production: true }
 * });
 * ```
 */
export async function compilePattern(
  pattern: string,
  options: CompileOptions = {}
): Promise<CompileResult[]> {
  const glob = await import('glob');
  const files = await glob.glob(pattern);
  return compileWorkflows(files, options);
}
