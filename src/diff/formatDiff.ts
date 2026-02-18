/**
 * Human-readable diff formatter for workflow diffs.
 */

import type { TWorkflowDiff, TNodeTypeDiff, TInstanceDiff, TConnectionDiff } from './types.js';
import { IMPACT_DESCRIPTIONS, getImpactReasons } from './impact.js';

export type TDiffFormat = 'text' | 'json' | 'compact';

/**
 * Format a workflow diff for display
 */
export function formatDiff(diff: TWorkflowDiff, format: TDiffFormat = 'text'): string {
  switch (format) {
    case 'json':
      return JSON.stringify(diff, null, 2);
    case 'compact':
      return formatCompact(diff);
    case 'text':
    default:
      return formatText(diff);
  }
}

/**
 * Compact single-line format
 */
function formatCompact(diff: TWorkflowDiff): string {
  if (diff.identical) {
    return 'No changes';
  }

  const parts: string[] = [];
  const { summary } = diff;

  if (summary.nodeTypesAdded > 0) parts.push(`+${summary.nodeTypesAdded} types`);
  if (summary.nodeTypesRemoved > 0) parts.push(`-${summary.nodeTypesRemoved} types`);
  if (summary.nodeTypesModified > 0) parts.push(`~${summary.nodeTypesModified} types`);
  if (summary.instancesAdded > 0) parts.push(`+${summary.instancesAdded} nodes`);
  if (summary.instancesRemoved > 0) parts.push(`-${summary.instancesRemoved} nodes`);
  if (summary.instancesModified > 0) parts.push(`~${summary.instancesModified} nodes`);
  if (summary.connectionsAdded > 0) parts.push(`+${summary.connectionsAdded} conns`);
  if (summary.connectionsRemoved > 0) parts.push(`-${summary.connectionsRemoved} conns`);

  return `[${diff.impact}] ${parts.join(', ')}`;
}

/**
 * Full text format
 */
function formatText(diff: TWorkflowDiff): string {
  const lines: string[] = [];

  // Header
  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push(`  WORKFLOW DIFF - Impact: ${diff.impact}`);
  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push('');

  if (diff.identical) {
    lines.push('  ✓ Workflows are semantically identical');
    lines.push('');
    return lines.join('\n');
  }

  // Impact description
  lines.push(`  ${IMPACT_DESCRIPTIONS[diff.impact]}`);
  lines.push('');

  // Summary
  lines.push('  SUMMARY');
  lines.push('  ───────────────────────────────────────────────────────────');
  lines.push(`  Node Types:   +${diff.summary.nodeTypesAdded} added, -${diff.summary.nodeTypesRemoved} removed, ~${diff.summary.nodeTypesModified} modified`);
  lines.push(`  Instances:    +${diff.summary.instancesAdded} added, -${diff.summary.instancesRemoved} removed, ~${diff.summary.instancesModified} modified`);
  lines.push(`  Connections:  +${diff.summary.connectionsAdded} added, -${diff.summary.connectionsRemoved} removed`);
  lines.push('');

  // Node Types
  if (diff.nodeTypes.length > 0) {
    lines.push('  NODE TYPES');
    lines.push('  ───────────────────────────────────────────────────────────');
    for (const nt of diff.nodeTypes) {
      lines.push(formatNodeType(nt));
    }
    lines.push('');
  }

  // Instances
  if (diff.instances.length > 0) {
    lines.push('  INSTANCES');
    lines.push('  ───────────────────────────────────────────────────────────');
    for (const inst of diff.instances) {
      lines.push(formatInstance(inst));
    }
    lines.push('');
  }

  // Connections
  if (diff.connections.length > 0) {
    lines.push('  CONNECTIONS');
    lines.push('  ───────────────────────────────────────────────────────────');
    for (const conn of diff.connections) {
      lines.push(formatConnection(conn));
    }
    lines.push('');
  }

  // Start/Exit Ports
  const hasPortChanges =
    diff.startPorts.added.length > 0 ||
    diff.startPorts.removed.length > 0 ||
    diff.startPorts.modified.length > 0 ||
    diff.exitPorts.added.length > 0 ||
    diff.exitPorts.removed.length > 0 ||
    diff.exitPorts.modified.length > 0;

  if (hasPortChanges) {
    lines.push('  WORKFLOW PORTS');
    lines.push('  ───────────────────────────────────────────────────────────');

    if (diff.startPorts.added.length > 0) {
      lines.push(`  + Start ports added: ${diff.startPorts.added.map(p => p.name).join(', ')}`);
    }
    if (diff.startPorts.removed.length > 0) {
      lines.push(`  - Start ports removed: ${diff.startPorts.removed.map(p => p.name).join(', ')}`);
    }
    if (diff.startPorts.modified.length > 0) {
      lines.push(`  ~ Start ports modified: ${diff.startPorts.modified.map(p => p.name).join(', ')}`);
    }
    if (diff.exitPorts.added.length > 0) {
      lines.push(`  + Exit ports added: ${diff.exitPorts.added.map(p => p.name).join(', ')}`);
    }
    if (diff.exitPorts.removed.length > 0) {
      lines.push(`  - Exit ports removed: ${diff.exitPorts.removed.map(p => p.name).join(', ')}`);
    }
    if (diff.exitPorts.modified.length > 0) {
      lines.push(`  ~ Exit ports modified: ${diff.exitPorts.modified.map(p => p.name).join(', ')}`);
    }
    lines.push('');
  }

  // Scopes
  if (diff.scopes.length > 0) {
    lines.push('  SCOPES');
    lines.push('  ───────────────────────────────────────────────────────────');
    for (const scope of diff.scopes) {
      const symbol = scope.changeType === 'ADDED' ? '+' : scope.changeType === 'REMOVED' ? '-' : '~';
      lines.push(`  ${symbol} ${scope.name}`);
    }
    lines.push('');
  }

  // Reasons
  const reasons = getImpactReasons(diff);
  if (reasons.length > 0) {
    lines.push('  CHANGE DETAILS');
    lines.push('  ───────────────────────────────────────────────────────────');
    for (const reason of reasons) {
      lines.push(`  • ${reason}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function formatNodeType(nt: TNodeTypeDiff): string {
  const symbol = nt.changeType === 'ADDED' ? '+' : nt.changeType === 'REMOVED' ? '-' : '~';
  let line = `  ${symbol} ${nt.name}`;

  if (nt.changeType === 'MODIFIED') {
    const details: string[] = [];
    if (nt.changes.functionName) details.push(`functionName: ${nt.changes.functionName.before} → ${nt.changes.functionName.after}`);
    if (nt.changes.isAsync) details.push(`async: ${nt.changes.isAsync.before} → ${nt.changes.isAsync.after}`);
    if (nt.changes.executeWhen) details.push(`executeWhen: ${nt.changes.executeWhen.before} → ${nt.changes.executeWhen.after}`);
    if (nt.changes.inputs) {
      const added = nt.changes.inputs.filter(p => p.type === 'ADDED').map(p => p.portName);
      const removed = nt.changes.inputs.filter(p => p.type === 'REMOVED').map(p => p.portName);
      const modified = nt.changes.inputs.filter(p => p.type === 'MODIFIED').map(p => p.portName);
      if (added.length > 0) details.push(`+inputs: ${added.join(', ')}`);
      if (removed.length > 0) details.push(`-inputs: ${removed.join(', ')}`);
      if (modified.length > 0) details.push(`~inputs: ${modified.join(', ')}`);
    }
    if (nt.changes.outputs) {
      const added = nt.changes.outputs.filter(p => p.type === 'ADDED').map(p => p.portName);
      const removed = nt.changes.outputs.filter(p => p.type === 'REMOVED').map(p => p.portName);
      const modified = nt.changes.outputs.filter(p => p.type === 'MODIFIED').map(p => p.portName);
      if (added.length > 0) details.push(`+outputs: ${added.join(', ')}`);
      if (removed.length > 0) details.push(`-outputs: ${removed.join(', ')}`);
      if (modified.length > 0) details.push(`~outputs: ${modified.join(', ')}`);
    }
    if (details.length > 0) {
      line += ` (${details.join('; ')})`;
    }
  }

  return line;
}

function formatInstance(inst: TInstanceDiff): string {
  const symbol = inst.changeType === 'ADDED' ? '+' : inst.changeType === 'REMOVED' ? '-' : '~';
  let line = `  ${symbol} ${inst.id}`;

  if (inst.changeType === 'MODIFIED') {
    const details: string[] = [];
    if (inst.changes.nodeType) {
      details.push(`type: ${inst.changes.nodeType.before} → ${inst.changes.nodeType.after}`);
    }
    if (inst.changes.parent) {
      const before = inst.changes.parent.before ? `${inst.changes.parent.before.id}.${inst.changes.parent.before.scope}` : 'none';
      const after = inst.changes.parent.after ? `${inst.changes.parent.after.id}.${inst.changes.parent.after.scope}` : 'none';
      details.push(`parent: ${before} → ${after}`);
    }
    if (inst.changes.config?.pullExecution) {
      details.push(`pullExecution changed`);
    }
    if (inst.changes.config?.portConfigs) {
      details.push(`portConfigs changed`);
    }
    if (details.length > 0) {
      line += ` (${details.join('; ')})`;
    }
  }

  return line;
}

function formatConnection(conn: TConnectionDiff): string {
  const symbol = conn.changeType === 'ADDED' ? '+' : '-';
  const fromScope = conn.from.scope ? `:${conn.from.scope}` : '';
  const toScope = conn.to.scope ? `:${conn.to.scope}` : '';
  return `  ${symbol} ${conn.from.node}.${conn.from.port}${fromScope} → ${conn.to.node}.${conn.to.port}${toScope}`;
}
