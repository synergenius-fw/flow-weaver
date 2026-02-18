/**
 * Semantic diff module for workflow comparison.
 * @module diff
 */

export * from './types.js';
export { WorkflowDiffer } from './WorkflowDiffer.js';
export {
  IMPACT_DESCRIPTIONS,
  IMPACT_COLORS,
  getImpactReasons,
  hasBreakingChanges,
  getNodeTypeChanges,
  getCriticalConnections,
} from './impact.js';
export { formatDiff } from './formatDiff.js';
export type { TDiffFormat } from './formatDiff.js';
