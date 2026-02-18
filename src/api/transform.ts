import type { TASTTransformer, TWorkflowAST } from "../ast/types";

/**
 * Applies a single transformer to a workflow AST.
 * The AST is deep-cloned before transformation to avoid mutating the original.
 *
 * @param ast - The workflow AST to transform.
 * @param transformer - The transformer to apply.
 * @returns A new, transformed workflow AST.
 */
export function transformWorkflow(
  ast: TWorkflowAST,
  transformer: TASTTransformer,
): TWorkflowAST {
  const cloned = JSON.parse(JSON.stringify(ast));
  return transformer.transform(cloned);
}

/**
 * Applies an ordered sequence of transformers to a workflow AST.
 * Each transformer receives the output of the previous one, and each step
 * deep-clones its input via {@link transformWorkflow}.
 *
 * @param ast - The initial workflow AST.
 * @param transformers - An ordered array of transformers to apply sequentially.
 * @returns The final transformed workflow AST.
 */
export function applyTransformations(
  ast: TWorkflowAST,
  transformers: TASTTransformer[],
): TWorkflowAST {
  return transformers.reduce(
    (currentAST, transformer) => transformWorkflow(currentAST, transformer),
    ast,
  );
}

/**
 * Composes multiple transformers into a single transformer.
 * The resulting transformer's name is a comma-separated list of the constituent names
 * wrapped in "composed(...)". When invoked, it applies all transformers in order
 * via {@link applyTransformations}.
 *
 * @param transformers - The transformers to compose.
 * @returns A single composite transformer.
 */
export function composeTransformers(
  transformers: TASTTransformer[],
): TASTTransformer {
  return {
    name: `composed(${transformers.map((t) => t.name).join(", ")})`,
    transform: (ast: TWorkflowAST) => applyTransformations(ast, transformers),
  };
}
