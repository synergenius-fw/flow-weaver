/**
 * Scope topology: the inner graph of nodes with scoped ports.
 *
 * A node type with scoped ports (forEach and the like) runs its children as a
 * callback, once per scope invocation. Its scoped OUTPUT ports become the
 * callback's parameters (data flowing to the children) and its scoped INPUT
 * ports the callback's return value (data flowing back). The children run in
 * that callback's context and nowhere else, so the connections around them
 * must respect the boundary or the generated code has nothing to read.
 *
 * Checks, in order:
 * - an instance listed in two scopes of `workflow.scopes` (error)
 * then for each instance with scoped ports:
 * - a `:scope` qualifier naming a scope the node does not define (error)
 * - and for each of its scopes:
 *   - a scope with no children (warning, nothing more is checked for it)
 *   - scoped connections naming a parent port that does not exist, or that
 *     belongs to another scope or to none (error)
 *   - scoped connections leaving the scope (error)
 *   - data type mismatches between parent and child ports (warning)
 *   - children with unconnected required inputs (error)
 *   - scoped input ports nothing returns into (warning)
 *   - children with no scoped connection to or from the parent (warning)
 * and last, over all plain connections:
 * - connections that cross the boundary of a per-port scope (error). Flat
 *   grouping scopes, whose parent has no scoped ports, may be crossed.
 */

import type { TConnectionAST, TNodeTypeAST, TPortDefinition, TWorkflowAST } from '../../ast/types';
import { isExecutePort } from '../../constants';
import { getInstanceLocation, getConnectionLocation, formatType } from '../validator-helpers.js';
import type { ValidationContext } from './context.js';

/** One scope of one parent instance, with what the checks need to know about it. */
interface ScopeUnderCheck {
  workflow: TWorkflowAST;
  instanceMap: Map<string, TNodeTypeAST>;
  /** The parent instance's ID. */
  parentId: string;
  /** The parent instance's node type, which declares the scoped ports. */
  nodeType: TNodeTypeAST;
  scopeName: string;
  /** IDs of the instances whose parent is this scope. */
  childIds: string[];
  /** Connections tagged with this scope on the parent or on a child. */
  scopedConnections: TConnectionAST[];
}

/** An instance may be listed under one scope of `workflow.scopes` only. */
function checkScopeConsistency(ctx: ValidationContext, workflow: TWorkflowAST): void {
  if (!workflow.scopes) return;
  const instanceToScope = new Map<string, string>();
  for (const [scopeKey, childIds] of Object.entries(workflow.scopes)) {
    for (const childId of childIds) {
      const existing = instanceToScope.get(childId);
      if (existing && existing !== scopeKey) {
        ctx.errors.push({
          type: 'error',
          code: 'SCOPE_INCONSISTENT',
          message: `Instance "${childId}" appears in multiple scopes: "${existing}" and "${scopeKey}". A node can only belong to one scope.`,
          node: childId,
          location: getInstanceLocation(workflow, childId),
        });
      }
      instanceToScope.set(childId, scopeKey);
    }
  }
}

/** The scope names a node type's ports declare, outputs first. */
function collectScopeNames(nodeType: TNodeTypeAST): Set<string> {
  const scopeNames = new Set<string>();
  for (const portDef of Object.values(nodeType.outputs)) {
    if (portDef.scope) scopeNames.add(portDef.scope);
  }
  for (const portDef of Object.values(nodeType.inputs)) {
    if (portDef.scope) scopeNames.add(portDef.scope);
  }
  return scopeNames;
}

/** A `:scope` qualifier on a connection end at `instanceId` must name one of its scopes. */
function checkScopeQualifiers(
  ctx: ValidationContext,
  workflow: TWorkflowAST,
  instanceId: string,
  scopeNames: Set<string>
): void {
  const available = () => [...scopeNames].join(', ');
  for (const conn of workflow.connections) {
    if (conn.from.scope && conn.from.node === instanceId && !scopeNames.has(conn.from.scope)) {
      ctx.errors.push({
        type: 'error',
        code: 'SCOPE_WRONG_SCOPE_NAME',
        message: `Connection from "${instanceId}.${conn.from.port}" uses scope qualifier ":${conn.from.scope}" but node "${instanceId}" does not define scope "${conn.from.scope}". Available scopes: ${available()}.`,
        connection: conn,
        location: getConnectionLocation(conn),
      });
    }
    if (conn.to.scope && conn.to.node === instanceId && !scopeNames.has(conn.to.scope)) {
      ctx.errors.push({
        type: 'error',
        code: 'SCOPE_WRONG_SCOPE_NAME',
        message: `Connection to "${instanceId}.${conn.to.port}" uses scope qualifier ":${conn.to.scope}" but node "${instanceId}" does not define scope "${conn.to.scope}". Available scopes: ${available()}.`,
        connection: conn,
        location: getConnectionLocation(conn),
      });
    }
  }
}

/** IDs of the instances whose parent is `parentId`'s scope `scopeName`, in instance order. */
function findScopeChildren(workflow: TWorkflowAST, parentId: string, scopeName: string): string[] {
  const childIds: string[] = [];
  for (const child of workflow.instances) {
    if (child.parent && child.parent.id === parentId && child.parent.scope === scopeName) {
      childIds.push(child.id);
    }
  }
  return childIds;
}

/** Connections tagged with the scope, at the parent or at one of its children. */
function collectScopedConnections(
  workflow: TWorkflowAST,
  parentId: string,
  scopeName: string,
  childIds: string[]
): TConnectionAST[] {
  return workflow.connections.filter(
    (conn) =>
      (conn.from.scope === scopeName && conn.from.node === parentId) ||
      (conn.to.scope === scopeName && conn.to.node === parentId) ||
      (conn.from.scope === scopeName && childIds.includes(conn.from.node)) ||
      (conn.to.scope === scopeName && childIds.includes(conn.to.node))
  );
}

/** Whether the connection's `side` end is the parent, qualified with this scope. */
function atParent(scope: ScopeUnderCheck, conn: TConnectionAST, side: 'from' | 'to'): boolean {
  return conn[side].node === scope.parentId && conn[side].scope === scope.scopeName;
}

/**
 * The parent port a scoped connection names must exist and belong to this
 * scope. `from` ends are the parent's scoped outputs, `to` ends its scoped inputs.
 */
function checkParentScopedPort(ctx: ValidationContext, scope: ScopeUnderCheck, conn: TConnectionAST, side: 'from' | 'to'): void {
  const { parentId, scopeName } = scope;
  const ports = side === 'from' ? scope.nodeType.outputs : scope.nodeType.inputs;
  const noun = side === 'from' ? 'output' : 'input';
  const portName = conn[side].port;
  const portDef = ports[portName];
  if (!portDef) {
    const availablePorts = Object.entries(ports)
      .filter(([, p]) => p.scope === scopeName)
      .map(([n]) => n);
    ctx.errors.push({
      type: 'error',
      code: 'SCOPE_UNKNOWN_PORT',
      message: `Scoped connection references non-existent ${noun} port "${portName}" on "${parentId}" in scope "${scopeName}". Available scoped ${noun}s: ${availablePorts.join(', ') || 'none'}.`,
      connection: conn,
      location: getConnectionLocation(conn),
    });
  } else if (portDef.scope !== scopeName) {
    const Noun = side === 'from' ? 'Output' : 'Input';
    ctx.errors.push({
      type: 'error',
      code: 'SCOPE_UNKNOWN_PORT',
      message: `${Noun} port "${portName}" on "${parentId}" is not a scoped port of scope "${scopeName}"${portDef.scope ? ` (it belongs to scope "${portDef.scope}")` : ' (it is an unscoped port)'}.`,
      connection: conn,
      location: getConnectionLocation(conn),
    });
  }
}

/** Scoped connections at the parent must name its ports of this scope. */
function checkScopedPortReferences(ctx: ValidationContext, scope: ScopeUnderCheck): void {
  for (const conn of scope.scopedConnections) {
    if (atParent(scope, conn, 'from')) checkParentScopedPort(ctx, scope, conn, 'from');
    if (atParent(scope, conn, 'to')) checkParentScopedPort(ctx, scope, conn, 'to');
  }
}

/** A scoped connection at a child must stay inside the scope: its other end is the parent or a sibling. */
function checkScopeBoundary(ctx: ValidationContext, scope: ScopeUnderCheck): void {
  const { parentId, scopeName, childIds } = scope;
  const inside = (node: string) => node === parentId || childIds.includes(node);
  for (const conn of scope.scopedConnections) {
    if (conn.from.scope === scopeName && childIds.includes(conn.from.node) && !inside(conn.to.node)) {
      ctx.errors.push({
        type: 'error',
        code: 'SCOPE_CONNECTION_OUTSIDE',
        message: `Scoped connection from "${conn.from.node}.${conn.from.port}" targets "${conn.to.node}" which is not inside scope "${scopeName}" of "${parentId}".`,
        connection: conn,
        location: getConnectionLocation(conn),
      });
    }
    if (conn.to.scope === scopeName && childIds.includes(conn.to.node) && !inside(conn.from.node)) {
      ctx.errors.push({
        type: 'error',
        code: 'SCOPE_CONNECTION_OUTSIDE',
        message: `Scoped connection to "${conn.to.node}.${conn.to.port}" sources from "${conn.from.node}" which is not inside scope "${scopeName}" of "${parentId}".`,
        connection: conn,
        location: getConnectionLocation(conn),
      });
    }
  }
}

/** Warn when a scoped connection joins two data ports of different types, neither STEP nor ANY. */
function warnScopedTypeMismatch(
  ctx: ValidationContext,
  scopeName: string,
  conn: TConnectionAST,
  source: TPortDefinition | undefined,
  target: TPortDefinition | undefined
): void {
  if (!source || !target || source.dataType === 'STEP' || target.dataType === 'STEP') return;
  if (source.dataType === target.dataType || source.dataType === 'ANY' || target.dataType === 'ANY') return;
  ctx.warnings.push({
    type: 'warning',
    code: 'SCOPE_PORT_TYPE_MISMATCH',
    message: `Type mismatch in scope "${scopeName}": "${conn.from.node}.${conn.from.port}" outputs ${formatType(source.dataType, source.tsType)} but "${conn.to.node}.${conn.to.port}" expects ${formatType(target.dataType, target.tsType)}.`,
    connection: conn,
    location: getConnectionLocation(conn),
  });
}

/** Types must agree between parent scoped outputs and child inputs, and child outputs and parent scoped inputs. */
function checkScopedPortTypes(ctx: ValidationContext, scope: ScopeUnderCheck): void {
  const { nodeType, instanceMap, scopeName } = scope;
  for (const conn of scope.scopedConnections) {
    if (atParent(scope, conn, 'from')) {
      warnScopedTypeMismatch(ctx, scopeName, conn, nodeType.outputs[conn.from.port], instanceMap.get(conn.to.node)?.inputs[conn.to.port]);
    }
    if (atParent(scope, conn, 'to')) {
      warnScopedTypeMismatch(ctx, scopeName, conn, instanceMap.get(conn.from.node)?.outputs[conn.from.port], nodeType.inputs[conn.to.port]);
    }
  }
}

/**
 * Each child's required inputs must be connected (by any connection: scoped,
 * between siblings, or from outside) or have a default or an expression.
 * validateRequiredInputs skips scoped children and leaves them to this check.
 */
function checkChildRequiredInputs(ctx: ValidationContext, scope: ScopeUnderCheck): void {
  const { workflow, instanceMap, parentId, scopeName } = scope;
  for (const childId of scope.childIds) {
    const childType = instanceMap.get(childId);
    if (!childType) continue;
    const childInstance = workflow.instances.find((i) => i.id === childId);

    for (const [portName, portConfig] of Object.entries(childType.inputs)) {
      if (isExecutePort(portName)) continue;
      if (portConfig.scope) continue;
      if (portConfig.optional || portConfig.default !== undefined) continue;

      const instancePortConfig = childInstance?.config?.portConfigs?.find(
        (pc) => pc.portName === portName && (pc.direction == null || pc.direction === 'INPUT')
      );
      if (portConfig.expression || instancePortConfig?.expression !== undefined) continue;

      const isConnected = workflow.connections.some((conn) => conn.to.node === childId && conn.to.port === portName);
      if (!isConnected) {
        ctx.errors.push({
          type: 'error',
          code: 'SCOPE_MISSING_REQUIRED_INPUT',
          message: `Scoped child "${childId}" has unconnected required input "${portName}" within scope "${scopeName}" of "${parentId}".`,
          node: childId,
          location: childInstance?.sourceLocation,
        });
      }
    }
  }
}

/** A scoped input port nothing connects to returns nothing from the scope. */
function warnUnusedScopedInputs(ctx: ValidationContext, scope: ScopeUnderCheck): void {
  const { workflow, parentId, scopeName } = scope;
  const scopedInputPorts = Object.entries(scope.nodeType.inputs).filter(([_, portDef]) => portDef.scope === scopeName);
  for (const [portName] of scopedInputPorts) {
    const hasConnection = scope.scopedConnections.some((conn) => atParent(scope, conn, 'to') && conn.to.port === portName);
    if (!hasConnection) {
      ctx.warnings.push({
        type: 'warning',
        code: 'SCOPE_UNUSED_INPUT',
        message: `Scoped input port "${portName}" of "${parentId}" (scope "${scopeName}") has no connection from inner nodes. Data will not flow back from the scope.`,
        node: parentId,
        location: getInstanceLocation(workflow, parentId),
      });
    }
  }
}

/** A child with no scoped connection to or from the parent is cut off from the scope's data. */
function warnOrphanedChildren(ctx: ValidationContext, scope: ScopeUnderCheck): void {
  const { workflow, parentId, scopeName } = scope;
  for (const childId of scope.childIds) {
    const connectedToParent = scope.scopedConnections.some(
      (conn) =>
        (atParent(scope, conn, 'from') && conn.to.node === childId) ||
        (atParent(scope, conn, 'to') && conn.from.node === childId)
    );
    if (!connectedToParent) {
      ctx.warnings.push({
        type: 'warning',
        code: 'SCOPE_ORPHANED_CHILD',
        message: `Child node "${childId}" is declared inside scope "${scopeName}" of "${parentId}" but has no scoped connections to or from the parent. It is disconnected from the scope's data flow.`,
        node: childId,
        location: getInstanceLocation(workflow, childId),
      });
    }
  }
}

/** Run the per-scope checks for one parent instance with scoped ports. */
function checkScopedInstance(
  ctx: ValidationContext,
  workflow: TWorkflowAST,
  instanceMap: Map<string, TNodeTypeAST>,
  parentId: string,
  nodeType: TNodeTypeAST
): void {
  const scopeNames = collectScopeNames(nodeType);
  if (scopeNames.size === 0) return;

  checkScopeQualifiers(ctx, workflow, parentId, scopeNames);

  for (const scopeName of scopeNames) {
    const childIds = findScopeChildren(workflow, parentId, scopeName);
    if (childIds.length === 0) {
      ctx.warnings.push({
        type: 'warning',
        code: 'SCOPE_EMPTY',
        message: `Scope "${scopeName}" on node "${parentId}" has no child nodes.`,
        node: parentId,
        location: getInstanceLocation(workflow, parentId),
      });
      continue;
    }
    const scope: ScopeUnderCheck = {
      workflow,
      instanceMap,
      parentId,
      nodeType,
      scopeName,
      childIds,
      scopedConnections: collectScopedConnections(workflow, parentId, scopeName, childIds),
    };
    checkScopedPortReferences(ctx, scope);
    checkScopeBoundary(ctx, scope);
    checkScopedPortTypes(ctx, scope);
    checkChildRequiredInputs(ctx, scope);
    warnUnusedScopedInputs(ctx, scope);
    warnOrphanedChildren(ctx, scope);
  }
}

/** IDs of the instances whose node type has scoped ports (per-port scope parents). */
function findScopedParentIds(workflow: TWorkflowAST, instanceMap: Map<string, TNodeTypeAST>): Set<string> {
  const scopedParentIds = new Set<string>();
  for (const inst of workflow.instances) {
    const nt = instanceMap.get(inst.id);
    if (!nt) continue;
    const hasScopedPorts = [...Object.values(nt.inputs ?? {}), ...Object.values(nt.outputs ?? {})].some((p) => p.scope);
    if (hasScopedPorts) scopedParentIds.add(inst.id);
  }
  return scopedParentIds;
}

/**
 * A plain (unqualified) connection must not cross the boundary of a per-port
 * scope: a child in scope "a" cannot connect to a child in scope "b" or at the
 * root, because they execute in separate callback contexts. Connections to or
 * from the scoped parent itself are allowed, and so is crossing a flat
 * grouping scope, whose parent has no scoped ports.
 */
function checkCrossScopeConnections(
  ctx: ValidationContext,
  workflow: TWorkflowAST,
  instanceMap: Map<string, TNodeTypeAST>
): void {
  const parentOf = new Map<string, { id: string; scope: string } | undefined>();
  for (const inst of workflow.instances) {
    parentOf.set(inst.id, inst.parent ?? undefined);
  }
  const scopedParentIds = findScopedParentIds(workflow, instanceMap);

  for (const conn of workflow.connections) {
    if (conn.from.scope || conn.to.scope) continue;
    if (!parentOf.has(conn.from.node) || !parentOf.has(conn.to.node)) continue;

    const fromParent = parentOf.get(conn.from.node);
    const toParent = parentOf.get(conn.to.node);
    if (!fromParent && !toParent) continue;

    const fromInScopedParent = fromParent && scopedParentIds.has(fromParent.id);
    const toInScopedParent = toParent && scopedParentIds.has(toParent.id);
    if (!fromInScopedParent && !toInScopedParent) continue;

    const fromIsParentOfTo = toParent && toParent.id === conn.from.node;
    const toIsParentOfFrom = fromParent && fromParent.id === conn.to.node;
    if (fromIsParentOfTo || toIsParentOfFrom) continue;

    const sameScope =
      fromParent && toParent && fromParent.id === toParent.id && fromParent.scope === toParent.scope;
    if (!sameScope) {
      const fromCtx = fromParent ? `${fromParent.id}.${fromParent.scope}` : 'root';
      const toCtx = toParent ? `${toParent.id}.${toParent.scope}` : 'root';
      ctx.errors.push({
        type: 'error',
        code: 'CROSS_SCOPE_CONNECTION',
        message: `Connection from "${conn.from.node}.${conn.from.port}" (in ${fromCtx}) to "${conn.to.node}.${conn.to.port}" (in ${toCtx}) crosses scope boundaries. Nodes in different scopes cannot connect directly.`,
        connection: conn,
        location: getConnectionLocation(conn),
      });
    }
  }
}

/**
 * Validate the inner graph topology of nodes that have scoped ports. See the
 * module comment for the checks and their order.
 */
export function validateScopeTopology(
  ctx: ValidationContext,
  workflow: TWorkflowAST,
  instanceMap: Map<string, TNodeTypeAST>
): void {
  checkScopeConsistency(ctx, workflow);
  for (const instance of workflow.instances) {
    const nodeType = instanceMap.get(instance.id);
    if (!nodeType) continue;
    checkScopedInstance(ctx, workflow, instanceMap, instance.id, nodeType);
  }
  checkCrossScopeConnections(ctx, workflow, instanceMap);
}
