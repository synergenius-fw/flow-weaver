/**
 * Generator utilities: the public barrel for export target packs.
 *
 * Exposes control-flow analysis and code generation helpers used by
 * compile targets (e.g. the Inngest deep generator and other pack targets).
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
  type TBuildNodeArgsOptions,
} from './code-utils.js';
