import * as path from 'node:path';
import { parseWorkflow, type ParseResult } from '../api/parse';
import { validateWorkflow, type ValidationResult } from '../api/validate';
import { generateCode, type GenerateResult } from '../api/generate';
import type { TWorkflowAST } from '../ast';

export interface GeneratorOptions {
  production?: boolean;
  sourceMap?: boolean;
}

export type GeneratorResult = GenerateResult;

/**
 * Parse, validate and generate one workflow in a single call.
 *
 * A convenience over the api/* modules for callers that want the whole
 * pipeline and an exception on the first problem: parse errors and
 * validation errors both throw, with every message in the error text. It
 * prints nothing; a caller that wants progress output uses the api modules
 * directly (parseWorkflow, validateWorkflow, generateCode).
 */
export class WorkflowGenerator {
  /**
   * Generate executable TypeScript code from a workflow file.
   *
   * @param filePath - Path to the workflow file
   * @param workflowName - Name of the workflow to generate
   * @param options - Generation options (production mode, source maps)
   * @returns The generated code, or with `sourceMap: true` the code and its map
   * @throws Error when the file does not parse, the workflow is not found, or validation fails
   */
  async generate(
    filePath: string,
    workflowName: string,
    options: GeneratorOptions & { sourceMap: true }
  ): Promise<GeneratorResult>;
  async generate(
    filePath: string,
    workflowName: string,
    options?: GeneratorOptions
  ): Promise<string>;
  async generate(
    filePath: string,
    workflowName: string,
    options: GeneratorOptions = {},
  ): Promise<string | GeneratorResult> {
    const { production = false, sourceMap = false } = options;

    const parseResult = await this.parse(filePath, workflowName);
    this.validate(parseResult.ast);

    if (sourceMap) {
      return generateCode(parseResult.ast, { production, sourceMap: true, allWorkflows: parseResult.allWorkflows });
    }
    return generateCode(parseResult.ast, { production, allWorkflows: parseResult.allWorkflows });
  }

  private async parse(filePath: string, workflowName: string): Promise<ParseResult> {
    const parseResult = await parseWorkflow(filePath, { workflowName, projectDir: path.dirname(filePath) });
    if (parseResult.errors.length > 0) {
      throw new Error(
        `Workflow parsing failed with ${parseResult.errors.length} error(s):\n${parseResult.errors.map((e) => `  - ${e}`).join('\n')}`,
      );
    }
    return parseResult;
  }

  private validate(ast: TWorkflowAST): ValidationResult {
    const validation = validateWorkflow(ast);
    if (!validation.valid) {
      const lines = validation.errors.map((error) => `  - ${error.message}${error.node ? ` (node: ${error.node})` : ''}`);
      throw new Error(`Workflow validation failed with ${validation.errors.length} error(s):\n${lines.join('\n')}`);
    }
    return validation;
  }
}

/**
 * Default generator instance for convenience
 */
export const generator = new WorkflowGenerator();
