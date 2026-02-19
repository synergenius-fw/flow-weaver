import type { TNodeTypeAST, TWorkflowAST } from "./ast";
import { generateControlFlowWithExecutionContext } from "./generator/unified";

/**
 * Generates executable function body code from workflow ASTs.
 * Delegates to the unified control-flow generator for code emission.
 */
export class BodyGenerator {
  /**
   * Generates a workflow function body that uses an execution context for
   * tracing, error handling, and runtime state management.
   *
   * @param workflow - The workflow AST defining the graph structure.
   * @param nodeTypes - The node type definitions referenced by the workflow.
   * @param isAsync - Whether to generate async code. Defaults to true.
   * @param production - If true, omits debug event emissions. Defaults to false.
   * @param bundleMode - If true, generates code suitable for bundled deployment. Defaults to false.
   * @returns The generated function body as a string.
   */
  generateWithExecutionContext(
    workflow: TWorkflowAST,
    nodeTypes: TNodeTypeAST[],
    isAsync: boolean = true,
    production: boolean = false,
    bundleMode: boolean = false,
  ): string {
    return generateControlFlowWithExecutionContext(workflow, nodeTypes, isAsync, production, bundleMode);
  }
  /**
   * Generates a workflow function body using default settings (async, non-production, non-bundled).
   * Convenience method that wraps {@link generateWithExecutionContext}.
   *
   * @param workflow - The workflow AST defining the graph structure.
   * @param nodeTypes - The node type definitions referenced by the workflow.
   * @returns The generated function body as a string.
   */
  generateDirectCode(workflow: TWorkflowAST, nodeTypes: TNodeTypeAST[]): string {
    return generateControlFlowWithExecutionContext(workflow, nodeTypes, true, false, false);
  }
}

/** Pre-instantiated singleton of {@link BodyGenerator} for convenient use. */
export const bodyGenerator = new BodyGenerator();
