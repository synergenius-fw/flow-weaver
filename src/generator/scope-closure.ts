/**
 * The closure a scoped port becomes (e.g. a forEach iteration callback).
 *
 * Decides the closure's frame: its parameters (the parent's scoped OUTPUT
 * ports) and return object (the parent's scoped INPUT ports), the isolated
 * scope context it runs its children in, the order the children run in, and
 * how their results are read back after the scope is merged. Each child's
 * execution block is emitted by scoped-child.
 *
 * The children's arguments are built by buildNodeArgumentsWithContext, which
 * itself calls back into this module for a child that declares scopes of its
 * own. That recursion goes through the `buildArgs` parameter, so this module
 * never imports node-arguments.
 */

import type { TNodeTypeAST, TWorkflowAST, TNodeInstanceAST } from '../ast';
import { performKahnsTopologicalSort, buildControlFlowGraph } from './control-flow';
import { toValidIdentifier } from './code-utils';
import { mapToTypeScript } from '../types/type-mappings';
import { emitScopedChild, type ScopeFrame, type ScopedChildArgumentBuilder } from './scoped-child';

/**
 * Generate a scope function closure for a scoped port. See
 * generateScopeFunctionClosure in node-arguments for the architecture; this is
 * its implementation with the child argument builder passed in.
 */
export function emitScopeClosure(
  scopeName: string,
  parentNodeId: string,
  parentNodeType: TNodeTypeAST,
  workflow: TWorkflowAST,
  childInstances: TNodeInstanceAST[],
  isAsync: boolean,
  production: boolean,
  buildArgs: ScopedChildArgumentBuilder,
): string {
  const lines: string[] = [];
  const { params, returns } = collectScopedPorts(parentNodeType, scopeName);

  emitClosureOpening(lines, scopeName, parentNodeId, parentNodeType, params, isAsync);

  if (childInstances.length > 0) {
    lines.push(`    // Execute child nodes in topologically sorted order`);
    const { scopeWorkflow, order } = orderScopeChildren(scopeName, parentNodeId, parentNodeType, workflow, childInstances);
    const frame: ScopeFrame = {
      scopeName,
      parentNodeId,
      parentNodeType,
      workflow,
      scopeWorkflow,
      isAsync,
      production,
    };
    order.forEach((childId) => {
      const child = childInstances.find((c) => c.id === childId);
      if (child) emitScopedChild(lines, frame, child, buildArgs);
    });
    lines.push(``);
  }

  emitScopeReturn(lines, scopeName, parentNodeId, parentNodeType, workflow, childInstances, returns, isAsync, production);
  lines.push(`  };`);
  lines.push(`})(ctx)`);

  return lines.join('\n    ');
}

/**
 * The parent's ports that belong to this scope. Scoped OUTPUT ports become the
 * closure's parameters (execute included, FUNCTION ports excluded); every
 * scoped INPUT port, success and failure included, becomes a field of its
 * return object, since the callback type expects
 * `{ success: boolean; failure: boolean; ...data }`.
 */
function collectScopedPorts(
  parentNodeType: TNodeTypeAST,
  scopeName: string,
): { params: string[]; returns: string[] } {
  const params = Object.entries(parentNodeType.outputs)
    .filter(([, portDef]) => portDef.scope === scopeName && portDef.dataType !== 'FUNCTION')
    .map(([portName]) => portName);
  const returns = Object.entries(parentNodeType.inputs)
    .filter(([, portDef]) => portDef.scope === scopeName)
    .map(([portName]) => portName);
  return { params, returns };
}

/**
 * Emits the closure's opening: `((ctx) => { return (params) => {`, the
 * isolated scope context, and one variable per parameter so a child can read
 * it as an output of the parent.
 *
 * The scope context is created with cleanScope=true, so each call gets fresh
 * variables. A sync closure overrides the context to sync, so context
 * operations return values directly.
 */
function emitClosureOpening(
  lines: string[],
  scopeName: string,
  parentNodeId: string,
  parentNodeType: TNodeTypeAST,
  params: string[],
  isAsync: boolean,
): void {
  const awaitKeyword = isAsync ? 'async ' : '';
  const signature = params
    .map((p) => {
      const portDef = parentNodeType.outputs[p];
      const portType = portDef ? mapToTypeScript(portDef.dataType, portDef.tsType) : 'unknown';
      return `${p}: ${portType}`;
    })
    .join(', ');

  lines.push(`((ctx) => {`);
  lines.push(`  return ${awaitKeyword}(${signature}) => {`);
  lines.push(`    // Scope function body for '${scopeName}'`);
  lines.push(``);

  const safeParentId = toValidIdentifier(parentNodeId);
  lines.push(`    // Create scoped context for child nodes`);
  const isAsyncOverrideArg = isAsync ? '' : ', false';
  lines.push(
    `    const scopedCtx = ctx.createScope('${parentNodeId}', ${safeParentId}Idx!, '${scopeName}', true${isAsyncOverrideArg});`,
  );
  lines.push(``);

  if (params.length > 0) {
    lines.push(`    // Set scope parameters as variables for child nodes`);
    const setCall = isAsync ? `await scopedCtx.setVariable` : `scopedCtx.setVariable`;
    params.forEach((portName) => {
      // Store using parent node ID so connections from parent.port work
      lines.push(`    const scopeParamIdx_${portName} = scopedCtx.addExecution('${parentNodeId}_param_${portName}');`);
      // Include scope and side for scoped OUTPUT ports (start side of scope)
      lines.push(
        `    ${setCall}({ id: '${parentNodeId}', portName: '${portName}', executionIndex: scopeParamIdx_${portName}, nodeTypeName: '${parentNodeType.functionName}', scope: '${scopeName}', side: 'start' }, ${portName});`,
      );
    });
    lines.push(``);
  }
}

/**
 * The order the children run in, and the workflow their arguments are built
 * against: the children plus a virtual parent instance (so reads of the
 * parent's scoped ports resolve), with only child-to-child connections and
 * connections from this scope's OUTPUT ports.
 */
function orderScopeChildren(
  scopeName: string,
  parentNodeId: string,
  parentNodeType: TNodeTypeAST,
  workflow: TWorkflowAST,
  childInstances: TNodeInstanceAST[],
): { scopeWorkflow: TWorkflowAST; order: string[] } {
  const childIds = childInstances.map((c) => c.id);
  const childConnections = workflow.connections.filter((conn) => {
    if (childIds.includes(conn.from.node) && childIds.includes(conn.to.node)) {
      return true;
    }
    if (conn.from.node === parentNodeId && childIds.includes(conn.to.node)) {
      const sourcePort = parentNodeType.outputs[conn.from.port];
      if (sourcePort && sourcePort.scope === scopeName) {
        return true;
      }
    }
    return false;
  });

  const parentVirtualInstance: TNodeInstanceAST = {
    type: 'NodeInstance',
    id: parentNodeId,
    nodeType: parentNodeType.functionName,
    parent: undefined,
  };
  const scopeWorkflow = {
    ...workflow,
    instances: [parentVirtualInstance, ...childInstances],
    connections: childConnections,
  };

  const childNodeTypes = childInstances
    .map((c) => {
      return workflow.nodeTypes?.find((nt) => nt.name === c.nodeType || nt.functionName === c.nodeType);
    })
    .filter((nt): nt is TNodeTypeAST => nt !== undefined);

  const cfg = buildControlFlowGraph(scopeWorkflow, childNodeTypes);
  return { scopeWorkflow, order: performKahnsTopologicalSort(cfg) };
}

/**
 * Emits the end of the closure body: the scope merged back into the parent
 * context, one value per scoped INPUT port, and the return statement.
 *
 * Values are read from scopedCtx, not ctx: it still holds every variable after
 * the merge (a merge copies), and its sync/async mode matches the closure's,
 * so a sync closure gets values rather than Promises. A port no child feeds
 * returns true for success, false for failure and undefined otherwise; so does
 * a connected success/failure port whose source never set it (an expression
 * child). Outside production the parent's port is also set on ctx, at a
 * per-call exit index so each iteration shows separately.
 */
function emitScopeReturn(
  lines: string[],
  scopeName: string,
  parentNodeId: string,
  parentNodeType: TNodeTypeAST,
  workflow: TWorkflowAST,
  childInstances: TNodeInstanceAST[],
  returns: string[],
  isAsync: boolean,
  production: boolean,
): void {
  lines.push(`    // Merge scoped execution back to parent context`);
  lines.push(`    ctx.mergeScope(scopedCtx);`);
  lines.push(``);

  lines.push(`    // Extract return values from child outputs`);
  const returnObj: string[] = [];
  const getCallAfterMerge = isAsync ? 'await scopedCtx.getVariable' : 'scopedCtx.getVariable';
  const setCallAfterMerge = isAsync ? 'await ctx.setVariable' : 'ctx.setVariable';
  const emitExitEvent = (portName: string, value: string): void => {
    if (!production) {
      lines.push(
        `    ${setCallAfterMerge}({ id: '${parentNodeId}', portName: '${portName}', executionIndex: scopeExitIdx, scope: '${scopeName}', side: 'exit', nodeTypeName: '${parentNodeType.functionName}' }, ${value});`,
      );
    }
  };

  lines.push(`    const scopeExitIdx = ctx.addExecution('${parentNodeId}_scope_exit');`);

  returns.forEach((portName) => {
    const connection = workflow.connections.find((conn) => {
      return conn.to.port === portName && childInstances.some((c) => c.id === conn.from.node);
    });
    const portDef = parentNodeType.inputs[portName];
    const portType = portDef ? mapToTypeScript(portDef.dataType, portDef.tsType) : 'unknown';
    const defaultValue = portName === 'success' ? 'true' : portName === 'failure' ? 'false' : 'undefined';

    if (!connection) {
      emitExitEvent(portName, defaultValue);
      returnObj.push(`${portName}: ${defaultValue}`);
      return;
    }

    const sourceNode = connection.from.node;
    const varName = `scopeReturn_${portName}`;
    const sourceNodeTypeName = childInstances.find((c) => c.id === sourceNode)?.nodeType ?? '';
    const varAddr = `{ id: '${sourceNode}', portName: '${connection.from.port}', executionIndex: ${toValidIdentifier(sourceNode)}Idx, nodeTypeName: '${sourceNodeTypeName}' }`;
    if (portName === 'success' || portName === 'failure') {
      lines.push(
        `    const ${varName} = scopedCtx.hasVariable(${varAddr}) ? ${getCallAfterMerge}(${varAddr}) as ${portType} : ${defaultValue};`,
      );
    } else {
      lines.push(`    const ${varName} = ${getCallAfterMerge}(${varAddr}) as ${portType};`);
    }
    emitExitEvent(portName, varName);
    returnObj.push(`${portName}: ${varName}`);
  });

  lines.push(`    return { ${returnObj.join(', ')} };`);
}
