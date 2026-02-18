/* eslint-disable no-console */
import { parseWorkflow, type ParseResult } from "./api/parse";
import { validateWorkflow, type ValidationResult } from "./api/validate";
import { generateCode, type GenerateResult } from "./api/generate";
import type { TWorkflowAST } from "./ast";

export interface GeneratorOptions {
  production?: boolean;
  sourceMap?: boolean;
}

export type GeneratorResult = GenerateResult;

/**
 * Workflow Generator - Convenience wrapper with verbose logging
 *
 * This class provides a high-level interface for generating workflows
 * with detailed console output. It orchestrates parsing, validation,
 * and code generation while providing progress feedback.
 *
 * For programmatic use without console output, use the api/* modules directly:
 * - parseWorkflow() - Parse workflow files to AST
 * - validateWorkflow() - Validate workflow AST
 * - generateCode() - Generate executable TypeScript
 */
export class WorkflowGenerator {
  /**
   * Generate executable TypeScript code from a workflow file
   *
   * This method performs three steps with verbose console output:
   * 1. Parse the workflow file to extract node types and workflows
   * 2. Validate the workflow structure and connections
   * 3. Generate executable TypeScript code
   *
   * @param filePath - Path to the workflow file
   * @param workflowName - Name of the workflow to generate
   * @param options - Generation options (production mode, source maps)
   * @returns Promise resolving to generated code string, or GeneratorResult with source map
   *
   * @throws Error if validation fails or workflow not found
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

    // Step 1: Parse
    const parseResult = await this.parseWithLogging(filePath, workflowName);

    // Step 2: Validate
    this.validateWithLogging(parseResult.ast);

    // Step 3: Generate
    console.log("\\nGenerating workflow function body...");

    // Call generateCode with the correct overload based on sourceMap
    // Pass allWorkflows for local dependency generation
    if (sourceMap) {
      return generateCode(parseResult.ast, { production, sourceMap: true, allWorkflows: parseResult.allWorkflows });
    }

    return generateCode(parseResult.ast, { production, allWorkflows: parseResult.allWorkflows });
  }

  /**
   * Parse workflow file with detailed console logging
   * @private
   */
  private async parseWithLogging(filePath: string, workflowName: string): Promise<ParseResult> {
    console.log("Parsing annotations...");

    const parseResult = await parseWorkflow(filePath, { workflowName });

    if (parseResult.errors.length > 0) {
      console.error(`\\n❌ ${parseResult.errors.length} parse error(s):`);
      parseResult.errors.forEach((error) => {
        console.error(`  - ${error}`);
      });
      throw new Error(
        `Workflow parsing failed with ${parseResult.errors.length} error(s)`,
      );
    }

    // Log discovered node types
    const nodeTypes = parseResult.ast.nodeTypes;
    console.log(`Found ${nodeTypes.length} node types:`);
    nodeTypes.forEach((nodeType) => {
      console.log(`  - ${nodeType.functionName}`);
    });

    // Log available workflows
    console.log(`Found ${parseResult.availableWorkflows.length} workflows:`);
    parseResult.availableWorkflows.forEach((wf) => {
      console.log(`  - ${wf}`);
    });

    return parseResult;
  }

  /**
   * Validate workflow AST with detailed console logging
   * @private
   */
  private validateWithLogging(ast: TWorkflowAST): ValidationResult {
    console.log("Validating workflow...");

    const validation = validateWorkflow(ast);

    // Log warnings
    if (validation.warnings.length > 0) {
      console.log(`\\n⚠️  ${validation.warnings.length} warning(s):`);
      validation.warnings.forEach((warning) => {
        console.log(`  - ${warning.message}`);
        if (warning.node) {
          console.log(`    at node: ${warning.node}`);
        }
      });
      console.log("");
    }

    // Handle validation errors
    if (!validation.valid) {
      console.error(`\\n❌ ${validation.errors.length} validation error(s):`);
      validation.errors.forEach((error) => {
        console.error(`  - ${error.message}`);
        if (error.node) {
          console.error(`    at node: ${error.node}`);
        }
        if (error.connection) {
          console.error(`    at connection: ${JSON.stringify(error.connection)}`);
        }
      });
      throw new Error(
        `Workflow validation failed with ${validation.errors.length} error(s)`,
      );
    }

    console.log("✓ Validation passed\\n");

    return validation;
  }
}

/**
 * Default generator instance for convenience
 */
export const generator = new WorkflowGenerator();
