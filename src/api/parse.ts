import type { TParseOptions as ASTParseOptions, TWorkflowAST } from '../ast/types';
import { Project } from 'ts-morph';
import ts from 'typescript';
import {
  AnnotationParser,
  parser,
  type SourceImportResolver,
  type SourceOverrideLoader,
  type TExternalNodeType,
} from '../parser/annotation-parser';
import { getErrorMessage } from '../utils/error-utils';

/** Prefix of the parse error raised when a file declares several workflows and none was named. */
export const MULTIPLE_WORKFLOWS_MARKER = '[MULTIPLE_WORKFLOWS_FOUND]';

/** The parse failed only because the file declares several workflows and none was picked. */
export function isMultipleWorkflows(errors: readonly unknown[]): boolean {
  return errors.length > 0 && errors.every((e) => typeof e === 'string' && e.startsWith(MULTIPLE_WORKFLOWS_MARKER));
}

export interface ParseOptions extends Partial<ASTParseOptions> {
  /**
   * Name of the workflow to parse from the file.
   * Required if the file contains multiple workflows.
   */
  workflowName?: string;
  /**
   * When true, returns node types even if no workflows are found.
   * Useful for files that only contain node type definitions.
   */
  nodeTypesOnly?: boolean;
  /**
   * Project root directory. When set, tag handlers from installed
   * marketplace packs are discovered and registered before parsing.
   */
  projectDir?: string;
  /**
   * Definitions of foreign nodeTypes the workflow references by name
   * (an `@node <id> <foreignType>` from another pack). Forwarded to the
   * underlying `parser.parse(filePath, externalNodeTypes)` so the
   * reference resolves without the foreign pack's source on the parse
   * path. Callers that resolve these from a wire manifest (rather than
   * from `node_modules`) pass them here. Omit when the file declares
   * every nodeType it uses.
   */
  externalNodeTypes?: TExternalNodeType[];
  /** @internal Resolver for a virtual pre-bundle TypeScript module graph. */
  sourceImportResolver?: SourceImportResolver;
  /** @internal Source overlays for a virtual pre-bundle TypeScript graph. */
  sourceOverrideLoader?: SourceOverrideLoader;
}

export interface ParseResult {
  ast: TWorkflowAST;
  errors: string[];
  warnings: string[];
  /**
   * All workflows found in the file (names only)
   */
  availableWorkflows: string[];
  /**
   * All workflow ASTs found in the file (for local dependency generation)
   */
  allWorkflows: TWorkflowAST[];
}

/**
 * Parse a workflow file and convert it to AST
 *
 * @param filePath - Path to the workflow file
 * @param options - Parse options including workflow name
 * @returns ParseResult with AST, errors, and warnings
 *
 * @example
 * ```typescript
 * const result = await parseWorkflow('./my-workflow.ts', {
 *   workflowName: 'myWorkflow'
 * });
 *
 * if (result.errors.length > 0) {
 *   console.error('Parse errors:', result.errors);
 * } else {
 *   console.log('Parsed workflow:', result.ast.functionName);
 * }
 * ```
 */
export async function parseWorkflow(
  filePath: string,
  options?: ParseOptions
): Promise<ParseResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  let availableWorkflows: string[] = [];

  try {
    // Load marketplace pack tag handlers before parsing
    if (options?.projectDir) {
      await parser.loadPackHandlers(options.projectDir);
    }

    // Parse the file to extract nodes and workflows. Foreign nodeTypes
    // the caller supplied (e.g. resolved from a pack's wire manifest)
    // are threaded through so `@node <id> <foreignType>` references
    // resolve on this path the same way the low-level parser supports.
    const parsed = parser.parse(filePath, options?.externalNodeTypes);
    warnings.push(...parsed.warnings);
    errors.push(...parsed.errors);

    // Get available workflow names
    availableWorkflows = parsed.workflows.map((w) => w.functionName);

    // Determine which workflow to use
    let workflowName = options?.workflowName;

    if (!workflowName) {
      if (parsed.workflows.length === 0) {
        // If nodeTypesOnly mode is enabled and we have node types, return them
        if (options?.nodeTypesOnly && parsed.nodeTypes.length > 0) {
          return {
            ast: {
              type: 'Workflow',
              functionName: '',
              name: '',
              sourceFile: filePath,
              nodeTypes: parsed.nodeTypes,
              instances: [],
              connections: [],
              scopes: {},
              startPorts: {},
              exitPorts: {},
              imports: [],
            },
            errors: [],
            warnings,
            availableWorkflows: [],
            allWorkflows: [],
          };
        }

        const nodeTypeCount = parsed.nodeTypes.length;
        const nodeTypeHint =
          nodeTypeCount > 0
            ? ` (found ${nodeTypeCount} node type${nodeTypeCount === 1 ? '' : 's'}, but no workflow function)`
            : '';
        errors.push(
          `No workflows found in file${nodeTypeHint}. Add a /** @flowWeaver workflow */ annotation above an exported function to define a workflow. Ensure node type functions are annotated with /** @flowWeaver nodeType */ first.`
        );
        throw new Error('No workflows found in file');
      }

      if (parsed.workflows.length > 1) {
        errors.push(
          `${MULTIPLE_WORKFLOWS_MARKER} Multiple workflows found: ${availableWorkflows.join(', ')}. Please specify workflowName in options.`
        );
        throw new Error('Multiple workflows found, workflowName required');
      }

      // Single workflow found, use it
      workflowName = parsed.workflows[0].functionName;
    }

    // Find the workflow
    const workflow = parsed.workflows.find((w) => w.functionName === workflowName);
    if (!workflow) {
      errors.push(
        `Workflow "${workflowName}" not found. Available: ${availableWorkflows.join(', ')}`
      );
      throw new Error(`Workflow "${workflowName}" not found`);
    }

    return {
      ast: workflow,
      errors,
      warnings,
      availableWorkflows,
      allWorkflows: parsed.workflows,
    };
  } catch (error) {
    // If we already added errors, return with availableWorkflows
    if (errors.length > 0) {
      return {
        ast: {} as TWorkflowAST, // Return empty AST on error
        errors,
        warnings,
        availableWorkflows, // Include available workflows even on error
        allWorkflows: [],
      };
    }

    // Handle unexpected errors
    const errorMessage = getErrorMessage(error);
    errors.push(`Failed to parse workflow: ${errorMessage}`);

    return {
      ast: {} as TWorkflowAST,
      errors,
      warnings,
      availableWorkflows,
      allWorkflows: [],
    };
  }
}

/** @internal Parse a source override without erasing its real import base. */
export async function parseWorkflowSourceAtPath(
  filePath: string,
  source: string,
  options?: ParseOptions,
): Promise<ParseResult> {
  const sourceParser = options?.sourceOverrideLoader === undefined
    ? parser
    : new AnnotationParser(new Project({
        skipFileDependencyResolution: false,
        compilerOptions: {
          target: ts.ScriptTarget.ESNext,
          module: ts.ModuleKind.NodeNext,
          moduleResolution: ts.ModuleResolutionKind.NodeNext,
          allowImportingTsExtensions: true,
          allowJs: true,
          skipLibCheck: true,
          types: [],
        },
      }));
  const parsed = sourceParser.parseSourceAtPath(
    filePath,
    source,
    options?.externalNodeTypes,
    options?.sourceImportResolver,
    options?.sourceOverrideLoader,
  );
  const errors = [...parsed.errors];
  const warnings = [...parsed.warnings];
  const availableWorkflows = parsed.workflows.map((workflow) => workflow.functionName);
  const workflowName = options?.workflowName;
  const ast = workflowName === undefined
    ? parsed.workflows.length === 1 ? parsed.workflows[0] : undefined
    : parsed.workflows.find((workflow) => workflow.functionName === workflowName);
  if (ast === undefined) {
    errors.push(workflowName === undefined
      ? 'A source override must contain exactly one workflow or name it explicitly'
      : `Workflow '${workflowName}' not found`);
    throw new Error(errors.join('\n'));
  }
  return {
    ast,
    errors,
    warnings,
    availableWorkflows,
    allWorkflows: parsed.workflows,
  };
}
