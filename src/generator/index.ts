/**
 * Generator utilities — public barrel for export target packs.
 *
 * Exposes control-flow analysis and code generation helpers used by
 * compile targets (Inngest deep generator, CI/CD compile target, etc.).
 */

export {
  buildControlFlowGraph,
  detectBranchingChains,
  findAllBranchingNodes,
  findNodesInBranch,
  performKahnsTopologicalSort,
  isPerPortScopedChild,
  computeParallelLevels,
  determineExecutionOrder,
  type ControlFlowGraph,
} from './control-flow.js';

export {
  toValidIdentifier,
  getCoercionWrapper,
  buildMergeExpression,
  buildNodeArgumentsWithContext,
  generateNodeWithExecutionContext,
  buildExecutionContextReturnForBranch,
  type TBuildNodeArgsOptions,
} from './code-utils.js';

export {
  compileTargetRegistry,
  type CompileTarget,
} from './compile-target-registry.js';

export {
  devModeRegistry,
  type DevModeProvider,
  type DevModeOptions,
} from './dev-mode-registry.js';
