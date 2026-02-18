import type { TParseOptions as ASTParseOptions, TWorkflowAST } from '../ast/types';
import { parser } from '../parser';
import { getErrorMessage } from '../utils/error-utils';

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
    // Parse the file to extract nodes and workflows
    const parsed = parser.parse(filePath);
    warnings.push(...parsed.warnings);

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
            } as TWorkflowAST,
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
          `[MULTIPLE_WORKFLOWS_FOUND] Multiple workflows found: ${availableWorkflows.join(', ')}. Please specify workflowName in options.`
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
      errors: [],
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
