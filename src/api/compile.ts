import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { TCompileResult as ASTCompileResult } from '../ast/types';

import { VERSION as COMPILER_VERSION } from '../generated-version';
import { type GenerateOptions, generateCode } from './generate';
import { type InPlaceGenerateOptions, generateInPlace } from './generate-in-place';
import { type ParseOptions, parseWorkflow } from './parse';
import { validateDurableClosure } from './durable-validation';
import {
  applyDurableSourceProof,
  type DurableSourceProof,
} from '../compiler/durable-source-proof.js';

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
  /** Validation mode: 'draft' suppresses STUB_NODE errors */
  validationMode?: 'strict' | 'draft';
  /** @internal Compiler-issued typed-source proof for a flattened artifact. */
  durableSourceProof?: DurableSourceProof;
  /** @internal Flattened source bound by durableSourceProof. */
  durableFlattenedSource?: string;
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
  if (options.durableSourceProof !== undefined) {
    if (options.durableFlattenedSource === undefined) {
      throw new Error('durableFlattenedSource is required with durableSourceProof');
    }
    applyDurableSourceProof(
      options.durableSourceProof,
      parseResult,
      options.durableFlattenedSource,
    );
  }
  validateDurableClosure(parseResult.ast, parseResult.allWorkflows);

  const workflowsByName = new Map(
    parseResult.allWorkflows.map((workflow) => [workflow.functionName, workflow]),
  );
  const reachableWorkflows = new Set<string>();
  const collectReachable = (workflow: typeof parseResult.ast): void => {
    if (reachableWorkflows.has(workflow.functionName)) return;
    reachableWorkflows.add(workflow.functionName);
    for (const instance of workflow.instances) {
      if (instance.nodeType === 'invokeWorkflow') {
        for (const possibleTarget of parseResult.allWorkflows) {
          collectReachable(possibleTarget);
        }
      }
      const nested = workflowsByName.get(instance.nodeType);
      if (nested) collectReachable(nested);
    }
  };
  collectReachable(parseResult.ast);
  const reachable = parseResult.allWorkflows.filter((workflow) =>
    reachableWorkflows.has(workflow.functionName),
  );
  if (!reachable.some((workflow) => workflow.functionName === parseResult.ast.functionName)) {
    reachable.push(parseResult.ast);
  }
  const hasDurableGate = reachable.some((workflow) =>
    workflow.instances.some((instance) => {
      const nodeType = workflow.nodeTypes.find(
        (candidate) =>
          candidate.name === instance.nodeType ||
          candidate.functionName === instance.nodeType,
      );
      return nodeType?.durableGate !== undefined;
    }),
  );
  if (hasDurableGate) {
    const workflowHasDurableBoundary = (
      workflowName: string,
      visiting = new Set<string>(),
    ): boolean => {
      if (visiting.has(workflowName)) return false;
      visiting.add(workflowName);
      const workflow = workflowsByName.get(workflowName);
      if (workflow === undefined) return false;
      return workflow.instances.some((instance) => {
        const nodeType = workflow.nodeTypes.find(
          (candidate) =>
            candidate.name === instance.nodeType ||
            candidate.functionName === instance.nodeType,
        );
        if (nodeType?.durableGate !== undefined || nodeType?.durableEffect === true) {
          return true;
        }
        if (instance.nodeType === 'invokeWorkflow') {
          return parseResult.allWorkflows.some((candidate) =>
            workflowHasDurableBoundary(candidate.functionName, new Set(visiting)),
          );
        }
        return workflowHasDurableBoundary(instance.nodeType, new Set(visiting));
      });
    };
    const unsafeScopedBoundaries = reachable
      .flatMap((workflow) =>
        workflow.instances
          .filter((instance) => instance.parent !== undefined && instance.parent !== null)
          .filter((instance) => {
            const nodeType = workflow.nodeTypes.find(
              (candidate) =>
                candidate.name === instance.nodeType ||
                candidate.functionName === instance.nodeType,
            );
            return (
              nodeType?.durableGate !== undefined ||
              nodeType?.durableEffect === true ||
              instance.nodeType === 'invokeWorkflow' ||
              workflowHasDurableBoundary(instance.nodeType)
            );
          })
          .map(
            (instance) =>
              `${workflow.functionName}.${instance.id} (${instance.parent!.id}.${instance.parent!.scope})`,
          ),
      )
      .sort();
    if (unsafeScopedBoundaries.length > 0) {
      throw new Error(
        `Durable gates and effects are not supported inside scope callbacks because the scope owner may invoke callbacks concurrently. Invalid: ${unsafeScopedBoundaries.join(', ')}`,
      );
    }
    const invalid = reachable
      .flatMap((workflow) =>
        workflow.instances.map((instance) => {
          if (workflowsByName.has(instance.nodeType)) return undefined;
          const nodeType = workflow.nodeTypes.find(
            (candidate) =>
              candidate.name === instance.nodeType ||
              candidate.functionName === instance.nodeType,
          );
          const classifications = [
            nodeType?.durableGate !== undefined,
            nodeType?.durableEffect === true,
            nodeType?.durablePure === true,
          ].filter(Boolean).length;
          return classifications === 1
            ? undefined
            : `${workflow.functionName}.${instance.id} (${instance.nodeType}): ${classifications === 0 ? 'unclassified' : 'conflicting classifications'}`;
        }),
      )
      .filter((value): value is string => value !== undefined)
      .sort();
    if (invalid.length > 0) {
      throw new Error(
        `Durable classification errors:\nEvery reachable node in a workflow with a durable gate must have exactly one compiler classification: @durablePure, @durableGate, or @durableEffect. Invalid: ${invalid.join(', ')}`,
      );
    }
  }

  // Validate before generating
  const { validateWorkflow } = await import('./validate.js');
  const validationMode = options.validationMode;
  const validationResult = validateWorkflow(parseResult.ast, validationMode ? { mode: validationMode } : undefined);
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
    code = generateCode(parseResult.ast, {
      ...options.generate,
      allWorkflows: parseResult.allWorkflows,
    });
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
