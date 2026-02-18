/**
 * Impact assessment utilities for workflow diffs.
 */

import type { TWorkflowDiff, TImpactLevel, TNodeTypeDiff, TConnectionDiff } from './types.js';

/** Impact level descriptions */
export const IMPACT_DESCRIPTIONS: Record<TImpactLevel, string> = {
  CRITICAL: 'Workflow API changed - consumers must update',
  BREAKING: 'Internal structure changed - may break dependent workflows',
  MINOR: 'Additions or non-breaking modifications',
  COSMETIC: 'No semantic changes',
};

/** Impact level colors for CLI/UI */
export const IMPACT_COLORS: Record<TImpactLevel, string> = {
  CRITICAL: 'red',
  BREAKING: 'yellow',
  MINOR: 'blue',
  COSMETIC: 'gray',
};

/**
 * Get detailed impact reasons from a diff
 */
export function getImpactReasons(diff: TWorkflowDiff): string[] {
  const reasons: string[] = [];

  if (diff.identical) {
    reasons.push('Workflows are semantically identical');
    return reasons;
  }

  // CRITICAL reasons
  if (diff.startPorts.removed.length > 0) {
    reasons.push(`Removed ${diff.startPorts.removed.length} workflow input port(s): ${diff.startPorts.removed.map(p => p.name).join(', ')}`);
  }
  if (diff.exitPorts.removed.length > 0) {
    reasons.push(`Removed ${diff.exitPorts.removed.length} workflow output port(s): ${diff.exitPorts.removed.map(p => p.name).join(', ')}`);
  }

  // BREAKING reasons
  if (diff.summary.nodeTypesRemoved > 0) {
    const removed = diff.nodeTypes.filter(nt => nt.changeType === 'REMOVED');
    reasons.push(`Removed ${removed.length} node type(s): ${removed.map(nt => nt.name).join(', ')}`);
  }
  if (diff.summary.instancesRemoved > 0) {
    const removed = diff.instances.filter(i => i.changeType === 'REMOVED');
    reasons.push(`Removed ${removed.length} instance(s): ${removed.map(i => i.id).join(', ')}`);
  }
  if (diff.summary.connectionsRemoved > 0) {
    reasons.push(`Removed ${diff.summary.connectionsRemoved} connection(s)`);
  }

  // Check for breaking port changes
  for (const nt of diff.nodeTypes) {
    const removedInputs = nt.changes.inputs?.filter(p => p.type === 'REMOVED') ?? [];
    const removedOutputs = nt.changes.outputs?.filter(p => p.type === 'REMOVED') ?? [];
    if (removedInputs.length > 0) {
      reasons.push(`Node type '${nt.name}' removed input port(s): ${removedInputs.map(p => p.portName).join(', ')}`);
    }
    if (removedOutputs.length > 0) {
      reasons.push(`Node type '${nt.name}' removed output port(s): ${removedOutputs.map(p => p.portName).join(', ')}`);
    }
  }

  // MINOR reasons
  if (diff.summary.nodeTypesAdded > 0) {
    const added = diff.nodeTypes.filter(nt => nt.changeType === 'ADDED');
    reasons.push(`Added ${added.length} node type(s): ${added.map(nt => nt.name).join(', ')}`);
  }
  if (diff.summary.instancesAdded > 0) {
    const added = diff.instances.filter(i => i.changeType === 'ADDED');
    reasons.push(`Added ${added.length} instance(s): ${added.map(i => i.id).join(', ')}`);
  }
  if (diff.summary.connectionsAdded > 0) {
    reasons.push(`Added ${diff.summary.connectionsAdded} connection(s)`);
  }
  if (diff.startPorts.added.length > 0) {
    reasons.push(`Added workflow input port(s): ${diff.startPorts.added.map(p => p.name).join(', ')}`);
  }
  if (diff.exitPorts.added.length > 0) {
    reasons.push(`Added workflow output port(s): ${diff.exitPorts.added.map(p => p.name).join(', ')}`);
  }

  // Modified reasons
  if (diff.summary.nodeTypesModified > 0) {
    const modified = diff.nodeTypes.filter(nt => nt.changeType === 'MODIFIED');
    reasons.push(`Modified ${modified.length} node type(s): ${modified.map(nt => nt.name).join(', ')}`);
  }
  if (diff.summary.instancesModified > 0) {
    const modified = diff.instances.filter(i => i.changeType === 'MODIFIED');
    reasons.push(`Modified ${modified.length} instance(s): ${modified.map(i => i.id).join(', ')}`);
  }

  if (diff.scopes.length > 0) {
    const added = diff.scopes.filter(s => s.changeType === 'ADDED').map(s => s.name);
    const removed = diff.scopes.filter(s => s.changeType === 'REMOVED').map(s => s.name);
    const modified = diff.scopes.filter(s => s.changeType === 'MODIFIED').map(s => s.name);
    if (added.length > 0) reasons.push(`Added scope(s): ${added.join(', ')}`);
    if (removed.length > 0) reasons.push(`Removed scope(s): ${removed.join(', ')}`);
    if (modified.length > 0) reasons.push(`Modified scope(s): ${modified.join(', ')}`);
  }

  return reasons;
}

/**
 * Check if a diff has breaking changes
 */
export function hasBreakingChanges(diff: TWorkflowDiff): boolean {
  return diff.impact === 'CRITICAL' || diff.impact === 'BREAKING';
}

/**
 * Get changed node types grouped by change type
 */
export function getNodeTypeChanges(diff: TWorkflowDiff): {
  added: TNodeTypeDiff[];
  removed: TNodeTypeDiff[];
  modified: TNodeTypeDiff[];
} {
  return {
    added: diff.nodeTypes.filter(nt => nt.changeType === 'ADDED'),
    removed: diff.nodeTypes.filter(nt => nt.changeType === 'REMOVED'),
    modified: diff.nodeTypes.filter(nt => nt.changeType === 'MODIFIED'),
  };
}

/**
 * Get critical connections (to/from Start/Exit)
 */
export function getCriticalConnections(diff: TWorkflowDiff): TConnectionDiff[] {
  return diff.connections.filter(
    c => c.from.node === 'Start' || c.to.node === 'Exit'
  );
}
