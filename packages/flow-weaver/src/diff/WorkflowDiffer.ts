/**
 * WorkflowDiffer - Semantic diff for workflows.
 * Compares semantic fields, ignores visual/metadata fields.
 */

import type {
  TWorkflowAST,
  TNodeTypeAST,
  TNodeInstanceAST,
  TConnectionAST,
  TPortDefinition,
} from '../ast/types.js';
import type {
  TWorkflowDiff,
  TNodeTypeDiff,
  TInstanceDiff,
  TConnectionDiff,
  TWorkflowPortsDiff,
  TScopeDiff,
  TPortChange,
  TImpactLevel,
  TInstanceConfigChange,
  TInstanceUIChange,
} from './types.js';

/**
 * Create connection key for comparison (ignores metadata/sourceLocation)
 */
function connectionKey(conn: TConnectionAST): string {
  return `${conn.from.node}:${conn.from.port}:${conn.from.scope ?? ''}->${conn.to.node}:${conn.to.port}:${conn.to.scope ?? ''}`;
}

/**
 * Deep equality for port definitions (semantic fields only)
 */
function portDefinitionEquals(a: TPortDefinition, b: TPortDefinition): boolean {
  return (
    a.dataType === b.dataType &&
    a.tsType === b.tsType &&
    a.optional === b.optional &&
    JSON.stringify(a.default) === JSON.stringify(b.default) &&
    a.expression === b.expression &&
    a.scope === b.scope &&
    a.mergeStrategy === b.mergeStrategy
  );
}

/**
 * Compare port maps and return changes
 */
function comparePortMaps(
  beforePorts: Record<string, TPortDefinition>,
  afterPorts: Record<string, TPortDefinition>,
  direction: 'INPUT' | 'OUTPUT'
): TPortChange[] {
  const changes: TPortChange[] = [];
  const beforeKeys = new Set(Object.keys(beforePorts));
  const afterKeys = new Set(Object.keys(afterPorts));

  // Added ports
  for (const key of afterKeys) {
    if (!beforeKeys.has(key)) {
      changes.push({
        portName: key,
        direction,
        type: 'ADDED',
        after: afterPorts[key],
      });
    }
  }

  // Removed ports
  for (const key of beforeKeys) {
    if (!afterKeys.has(key)) {
      changes.push({
        portName: key,
        direction,
        type: 'REMOVED',
        before: beforePorts[key],
      });
    }
  }

  // Modified ports
  for (const key of beforeKeys) {
    if (afterKeys.has(key) && !portDefinitionEquals(beforePorts[key], afterPorts[key])) {
      changes.push({
        portName: key,
        direction,
        type: 'MODIFIED',
        before: beforePorts[key],
        after: afterPorts[key],
      });
    }
  }

  return changes;
}

/**
 * Compare node types semantically
 */
function compareNodeType(before: TNodeTypeAST, after: TNodeTypeAST): TNodeTypeDiff | null {
  const changes: TNodeTypeDiff['changes'] = {};
  let hasChanges = false;

  // Compare functionName
  if (before.functionName !== after.functionName) {
    changes.functionName = { type: 'MODIFIED', before: before.functionName, after: after.functionName };
    hasChanges = true;
  }

  // Compare executeWhen
  if (before.executeWhen !== after.executeWhen) {
    changes.executeWhen = { type: 'MODIFIED', before: before.executeWhen, after: after.executeWhen };
    hasChanges = true;
  }

  // Compare branchingStrategy
  if (before.branchingStrategy !== after.branchingStrategy) {
    changes.branchingStrategy = { type: 'MODIFIED', before: before.branchingStrategy, after: after.branchingStrategy };
    hasChanges = true;
  }

  // Compare isAsync
  if (before.isAsync !== after.isAsync) {
    changes.isAsync = { type: 'MODIFIED', before: before.isAsync, after: after.isAsync };
    hasChanges = true;
  }

  // Compare scope
  if (before.scope !== after.scope) {
    changes.scope = { type: 'MODIFIED', before: before.scope, after: after.scope };
    hasChanges = true;
  }

  // Compare variant
  if (before.variant !== after.variant) {
    changes.variant = { type: 'MODIFIED', before: before.variant, after: after.variant };
    hasChanges = true;
  }

  // Compare inputs
  const inputChanges = comparePortMaps(before.inputs, after.inputs, 'INPUT');
  if (inputChanges.length > 0) {
    changes.inputs = inputChanges;
    hasChanges = true;
  }

  // Compare outputs
  const outputChanges = comparePortMaps(before.outputs, after.outputs, 'OUTPUT');
  if (outputChanges.length > 0) {
    changes.outputs = outputChanges;
    hasChanges = true;
  }

  if (!hasChanges) return null;

  return {
    name: before.name,
    changeType: 'MODIFIED',
    changes,
  };
}

/** UI data shape from workflow.ui.instances */
interface TNodeUIData {
  name: string;
  label?: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  minimized?: boolean;
}

/**
 * Compare instance UI data
 */
function compareInstanceUI(
  beforeUI: TNodeUIData | undefined,
  afterUI: TNodeUIData | undefined
): TInstanceUIChange | null {
  if (!beforeUI && !afterUI) return null;

  const uiChanges: TInstanceUIChange = {};
  let hasUIChanges = false;

  const beforeLabel = beforeUI?.label ?? '';
  const afterLabel = afterUI?.label ?? '';
  if (beforeLabel !== afterLabel) {
    uiChanges.label = { type: 'MODIFIED', before: beforeLabel, after: afterLabel };
    hasUIChanges = true;
  }

  const beforeX = beforeUI?.x ?? 0;
  const beforeY = beforeUI?.y ?? 0;
  const afterX = afterUI?.x ?? 0;
  const afterY = afterUI?.y ?? 0;
  if (beforeX !== afterX || beforeY !== afterY) {
    uiChanges.position = {
      type: 'MODIFIED',
      before: { x: beforeX, y: beforeY },
      after: { x: afterX, y: afterY },
    };
    hasUIChanges = true;
  }

  const beforeWidth = beforeUI?.width ?? 0;
  const beforeHeight = beforeUI?.height ?? 0;
  const afterWidth = afterUI?.width ?? 0;
  const afterHeight = afterUI?.height ?? 0;
  if (beforeWidth !== afterWidth || beforeHeight !== afterHeight) {
    uiChanges.size = {
      type: 'MODIFIED',
      before: { width: beforeWidth, height: beforeHeight },
      after: { width: afterWidth, height: afterHeight },
    };
    hasUIChanges = true;
  }

  const beforeMinimized = beforeUI?.minimized ?? false;
  const afterMinimized = afterUI?.minimized ?? false;
  if (beforeMinimized !== afterMinimized) {
    uiChanges.minimized = { type: 'MODIFIED', before: beforeMinimized, after: afterMinimized };
    hasUIChanges = true;
  }

  return hasUIChanges ? uiChanges : null;
}

/**
 * Compare instances semantically
 */
function compareInstance(
  before: TNodeInstanceAST,
  after: TNodeInstanceAST,
  beforeUI?: TNodeUIData,
  afterUI?: TNodeUIData
): TInstanceDiff | null {
  const changes: TInstanceDiff['changes'] = {};
  let hasChanges = false;

  // Compare nodeType
  if (before.nodeType !== after.nodeType) {
    changes.nodeType = { type: 'MODIFIED', before: before.nodeType, after: after.nodeType };
    hasChanges = true;
  }

  // Compare parent
  const beforeParent = before.parent ?? null;
  const afterParent = after.parent ?? null;
  if (JSON.stringify(beforeParent) !== JSON.stringify(afterParent)) {
    changes.parent = { type: 'MODIFIED', before: beforeParent, after: afterParent };
    hasChanges = true;
  }

  // Compare config (only semantic fields: pullExecution, portConfigs)
  const beforeConfig = before.config;
  const afterConfig = after.config;
  const configChanges: TInstanceConfigChange = {};
  let hasConfigChanges = false;

  // pullExecution
  const beforePullExec = beforeConfig?.pullExecution;
  const afterPullExec = afterConfig?.pullExecution;
  if (JSON.stringify(beforePullExec) !== JSON.stringify(afterPullExec)) {
    configChanges.pullExecution = { type: 'MODIFIED', before: beforePullExec, after: afterPullExec };
    hasConfigChanges = true;
  }

  // portConfigs
  const beforePortConfigs = beforeConfig?.portConfigs;
  const afterPortConfigs = afterConfig?.portConfigs;
  if (JSON.stringify(beforePortConfigs) !== JSON.stringify(afterPortConfigs)) {
    configChanges.portConfigs = { type: 'MODIFIED', before: beforePortConfigs, after: afterPortConfigs };
    hasConfigChanges = true;
  }

  if (hasConfigChanges) {
    changes.config = configChanges;
    hasChanges = true;
  }

  // Compare UI data
  const uiChanges = compareInstanceUI(beforeUI, afterUI);
  if (uiChanges) {
    changes.ui = uiChanges;
    hasChanges = true;
  }

  if (!hasChanges) return null;

  return {
    id: before.id,
    changeType: 'MODIFIED',
    changes,
  };
}

/**
 * Compare workflow ports (startPorts or exitPorts)
 */
function compareWorkflowPorts(
  beforePorts: Record<string, TPortDefinition>,
  afterPorts: Record<string, TPortDefinition>
): TWorkflowPortsDiff {
  const result: TWorkflowPortsDiff = {
    added: [],
    removed: [],
    modified: [],
  };

  const beforeKeys = new Set(Object.keys(beforePorts));
  const afterKeys = new Set(Object.keys(afterPorts));

  // Added
  for (const key of afterKeys) {
    if (!beforeKeys.has(key)) {
      result.added.push({ name: key, definition: afterPorts[key] });
    }
  }

  // Removed
  for (const key of beforeKeys) {
    if (!afterKeys.has(key)) {
      result.removed.push({ name: key, definition: beforePorts[key] });
    }
  }

  // Modified
  for (const key of beforeKeys) {
    if (afterKeys.has(key) && !portDefinitionEquals(beforePorts[key], afterPorts[key])) {
      result.modified.push({
        name: key,
        before: beforePorts[key],
        after: afterPorts[key],
      });
    }
  }

  return result;
}

/**
 * Calculate overall impact level
 */
function calculateImpact(diff: Omit<TWorkflowDiff, 'impact'>): TImpactLevel {
  // CRITICAL: Removed connections to Exit or from Start
  const criticalConnections = diff.connections.some(
    c => c.changeType === 'REMOVED' && (c.from.node === 'Start' || c.to.node === 'Exit')
  );
  if (criticalConnections) return 'CRITICAL';

  // CRITICAL: Removed start/exit ports
  if (diff.startPorts.removed.length > 0 || diff.exitPorts.removed.length > 0) {
    return 'CRITICAL';
  }

  // BREAKING: Removed node types, instances, or connections
  if (
    diff.summary.nodeTypesRemoved > 0 ||
    diff.summary.instancesRemoved > 0 ||
    diff.summary.connectionsRemoved > 0
  ) {
    return 'BREAKING';
  }

  // BREAKING: Port dataType changes
  const hasBreakingPortChanges = diff.nodeTypes.some(nt => {
    const inputChanges = nt.changes.inputs?.some(p => p.type === 'REMOVED' || (p.type === 'MODIFIED' && p.before?.dataType !== p.after?.dataType));
    const outputChanges = nt.changes.outputs?.some(p => p.type === 'REMOVED' || (p.type === 'MODIFIED' && p.before?.dataType !== p.after?.dataType));
    return inputChanges || outputChanges;
  });
  if (hasBreakingPortChanges) return 'BREAKING';

  // MINOR: Added nodes, instances, connections, or ports
  if (
    diff.summary.nodeTypesAdded > 0 ||
    diff.summary.instancesAdded > 0 ||
    diff.summary.connectionsAdded > 0 ||
    diff.startPorts.added.length > 0 ||
    diff.exitPorts.added.length > 0
  ) {
    return 'MINOR';
  }

  // MINOR: Modified nodes or instances
  if (diff.summary.nodeTypesModified > 0 || diff.summary.instancesModified > 0) {
    return 'MINOR';
  }

  // COSMETIC: No semantic changes
  return 'COSMETIC';
}

export class WorkflowDiffer {
  /**
   * Compare two workflows and return semantic diff
   */
  static compare(before: TWorkflowAST, after: TWorkflowAST): TWorkflowDiff {
    const nodeTypes: TNodeTypeDiff[] = [];
    const instances: TInstanceDiff[] = [];
    const connections: TConnectionDiff[] = [];
    const scopes: TScopeDiff[] = [];

    // Build lookup maps
    const beforeNodeTypes = new Map(before.nodeTypes.map(nt => [nt.name, nt]));
    const afterNodeTypes = new Map(after.nodeTypes.map(nt => [nt.name, nt]));

    const beforeInstances = new Map(before.instances.map(i => [i.id, i]));
    const afterInstances = new Map(after.instances.map(i => [i.id, i]));

    const beforeConnections = new Map(before.connections.map(c => [connectionKey(c), c]));
    const afterConnections = new Map(after.connections.map(c => [connectionKey(c), c]));

    const beforeScopes = before.scopes ?? {};
    const afterScopes = after.scopes ?? {};

    // Build UI lookup maps
    const beforeUIInstances = new Map(
      (before.ui?.instances ?? []).map(ui => [ui.name, ui as TNodeUIData])
    );
    const afterUIInstances = new Map(
      (after.ui?.instances ?? []).map(ui => [ui.name, ui as TNodeUIData])
    );

    // Compare node types
    for (const [name, nt] of afterNodeTypes) {
      if (!beforeNodeTypes.has(name)) {
        nodeTypes.push({ name, changeType: 'ADDED', changes: {} });
      } else {
        const diff = compareNodeType(beforeNodeTypes.get(name)!, nt);
        if (diff) nodeTypes.push(diff);
      }
    }
    for (const [name] of beforeNodeTypes) {
      if (!afterNodeTypes.has(name)) {
        nodeTypes.push({ name, changeType: 'REMOVED', changes: {} });
      }
    }

    // Compare instances
    for (const [id, inst] of afterInstances) {
      if (!beforeInstances.has(id)) {
        instances.push({ id, changeType: 'ADDED', changes: {} });
      } else {
        const diff = compareInstance(
          beforeInstances.get(id)!,
          inst,
          beforeUIInstances.get(id),
          afterUIInstances.get(id)
        );
        if (diff) instances.push(diff);
      }
    }
    for (const [id] of beforeInstances) {
      if (!afterInstances.has(id)) {
        instances.push({ id, changeType: 'REMOVED', changes: {} });
      }
    }

    // Compare connections
    for (const [key, conn] of afterConnections) {
      if (!beforeConnections.has(key)) {
        connections.push({
          changeType: 'ADDED',
          from: { node: conn.from.node, port: conn.from.port, scope: conn.from.scope },
          to: { node: conn.to.node, port: conn.to.port, scope: conn.to.scope },
        });
      }
    }
    for (const [key, conn] of beforeConnections) {
      if (!afterConnections.has(key)) {
        connections.push({
          changeType: 'REMOVED',
          from: { node: conn.from.node, port: conn.from.port, scope: conn.from.scope },
          to: { node: conn.to.node, port: conn.to.port, scope: conn.to.scope },
        });
      }
    }

    // Compare scopes
    const allScopeNames = new Set([...Object.keys(beforeScopes), ...Object.keys(afterScopes)]);
    for (const name of allScopeNames) {
      const beforeMembers = beforeScopes[name];
      const afterMembers = afterScopes[name];

      if (!beforeMembers) {
        scopes.push({ name, changeType: 'ADDED', after: afterMembers });
      } else if (!afterMembers) {
        scopes.push({ name, changeType: 'REMOVED', before: beforeMembers });
      } else if (JSON.stringify(beforeMembers.sort()) !== JSON.stringify(afterMembers.sort())) {
        scopes.push({ name, changeType: 'MODIFIED', before: beforeMembers, after: afterMembers });
      }
    }

    // Compare start/exit ports
    const startPorts = compareWorkflowPorts(before.startPorts, after.startPorts);
    const exitPorts = compareWorkflowPorts(before.exitPorts, after.exitPorts);

    // Calculate summary
    const modifiedInstances = instances.filter(i => i.changeType === 'MODIFIED');
    const summary = {
      nodeTypesAdded: nodeTypes.filter(nt => nt.changeType === 'ADDED').length,
      nodeTypesRemoved: nodeTypes.filter(nt => nt.changeType === 'REMOVED').length,
      nodeTypesModified: nodeTypes.filter(nt => nt.changeType === 'MODIFIED').length,
      instancesAdded: instances.filter(i => i.changeType === 'ADDED').length,
      instancesRemoved: instances.filter(i => i.changeType === 'REMOVED').length,
      instancesModified: modifiedInstances.filter(i =>
        i.changes.nodeType || i.changes.config || i.changes.parent
      ).length,
      instancesUIModified: modifiedInstances.filter(i => i.changes.ui).length,
      connectionsAdded: connections.filter(c => c.changeType === 'ADDED').length,
      connectionsRemoved: connections.filter(c => c.changeType === 'REMOVED').length,
    };

    // Check if identical
    const identical =
      nodeTypes.length === 0 &&
      instances.length === 0 &&
      connections.length === 0 &&
      scopes.length === 0 &&
      startPorts.added.length === 0 &&
      startPorts.removed.length === 0 &&
      startPorts.modified.length === 0 &&
      exitPorts.added.length === 0 &&
      exitPorts.removed.length === 0 &&
      exitPorts.modified.length === 0;

    const partialDiff = {
      identical,
      summary,
      nodeTypes,
      instances,
      connections,
      startPorts,
      exitPorts,
      scopes,
    };

    return {
      ...partialDiff,
      impact: identical ? 'COSMETIC' : calculateImpact(partialDiff),
    };
  }
}
