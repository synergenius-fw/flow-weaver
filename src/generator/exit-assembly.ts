import type { TConnectionAST, TNodeTypeAST, TWorkflowAST } from '../ast/types';
import { mapToTypeScript } from '../types/type-mappings';
import { toValidIdentifier } from './code-utils';
import { getPullExecutionConfig, type ControlFlowPlan } from './control-flow-plan';
import { RESERVED_NODE_NAMES, isStartNode, isExitNode } from '../constants';

/**
 * Emits the end of a workflow body: the Exit execution, one value per
 * declared exit port, the onSuccess/onFailure defaults, and the result that
 * is reported and returned.
 *
 * @param isAsync - The effective async mode (dev bodies are always async).
 */
export function emitExitAssembly(
  lines: string[],
  workflow: TWorkflowAST,
  nodeTypes: TNodeTypeAST[],
  plan: ControlFlowPlan,
  isAsync: boolean,
  production: boolean,
): void {
  lines.push(`  ctx.checkAborted('${RESERVED_NODE_NAMES.EXIT}');`);
  lines.push(`  const exitIdx = ctx.addExecution('${RESERVED_NODE_NAMES.EXIT}');`);
  const returnProps = emitConnectedExitPorts(lines, workflow, nodeTypes, plan, isAsync, production);
  emitUnconnectedExitPortDefaults(lines, workflow, returnProps);
  lines.push('');
  emitFinalResult(lines, returnProps, isAsync, production);
}

/**
 * Emits a `const exit_<port>` for each exit port that has connections.
 * Several connections to one port are coalesced: `||` for a control-flow
 * port, `??` for a data port. A connection to an undeclared port, or from an
 * undeclared or untyped node, is skipped with a comment.
 *
 * @returns One `port: value as Type` property per declared connected port.
 */
function emitConnectedExitPorts(
  lines: string[],
  workflow: TWorkflowAST,
  nodeTypes: TNodeTypeAST[],
  plan: ControlFlowPlan,
  isAsync: boolean,
  production: boolean,
): string[] {
  const exitConnections = workflow.connections.filter((conn) => isExitNode(conn.to.node));
  // Group exit connections by port (multiple connections to the same port are coalesced)
  const exitConnectionsByPort = new Map<string, TConnectionAST[]>();
  exitConnections.forEach((conn) => {
    const existing = exitConnectionsByPort.get(conn.to.port) || [];
    existing.push(conn);
    exitConnectionsByPort.set(conn.to.port, existing);
  });
  const returnProps: string[] = [];
  const setCall = isAsync ? 'await ctx.setVariable' : 'ctx.setVariable';

  exitConnectionsByPort.forEach((conns, exitPort) => {
    // Get exit port type for type casting - check if exit port is declared
    const exitPortDef = workflow.exitPorts[exitPort];

    // Skip connections to undeclared exit ports (typos like Exit.resultx when only @returns result exists)
    if (!exitPortDef) {
      lines.push(`  // Exit connection skipped: '${exitPort}' is not a declared @returns port`);
      return;
    }

    const varName = `exit_${exitPort}`;
    const exitPortType = exitPortDef?.tsType || (exitPortDef ? mapToTypeScript(exitPortDef.dataType) : 'unknown');

    // Filter to valid connections (skip undeclared nodes, missing types)
    const validConns = conns.filter((conn) => {
      const sourceNode = conn.from.node;
      const sourceInstance = workflow.instances.find((i) => i.id === sourceNode);
      const sourceNodeType = nodeTypes.find(
        (n) => n.name === sourceInstance?.nodeType || n.functionName === sourceInstance?.nodeType,
      );

      if (!isStartNode(sourceNode) && !sourceInstance) {
        lines.push(`  // Exit connection skipped: source node '${sourceNode}' is not declared`);
        return false;
      }
      if (!isStartNode(sourceNode) && sourceInstance && !sourceNodeType) {
        lines.push(
          `  // Exit connection skipped: source node '${sourceNode}' has missing type '${sourceInstance.nodeType}'`,
        );
        return false;
      }
      return true;
    });

    if (validConns.length === 0) {
      lines.push(`  const ${varName} = undefined as unknown;`);
      returnProps.push(`${exitPort}: ${varName} as ${exitPortType}`);
      return;
    }

    const isControlFlowPort = exitPort === 'onSuccess' || exitPort === 'onFailure';
    const defaultValue = isControlFlowPort ? 'false' : 'undefined';

    if (validConns.length === 1) {
      // Single connection - straightforward assignment
      lines.push(
        `  const ${varName} = ${exitSourceExpression(validConns[0], defaultValue, workflow, nodeTypes, plan, isAsync)};`,
      );
    } else {
      // Multiple connections - coalesce with || (STEP ports) or ?? (data ports)
      const operator = isControlFlowPort ? ' || ' : ' ?? ';
      const parts = validConns.map(
        (conn) => `(${exitSourceExpression(conn, defaultValue, workflow, nodeTypes, plan, isAsync)})`,
      );
      lines.push(`  const ${varName} = ${parts.join(operator)};`);
    }

    // Emit VARIABLE_SET for Exit node INPUT ports
    if (!production) {
      lines.push(
        `  ${setCall}({ id: '${RESERVED_NODE_NAMES.EXIT}', portName: '${exitPort}', executionIndex: exitIdx, nodeTypeName: '${RESERVED_NODE_NAMES.EXIT}' }, ${varName});`,
      );
    }
    // Cast to the exit port's declared type for type safety
    returnProps.push(`${exitPort}: ${varName} as ${exitPortType}`);
  });
  return returnProps;
}

/**
 * The value one exit connection supplies. A pull node's value is read
 * directly (reading it runs the node); a node that may not have run is read
 * behind an undefined check that falls back to `defaultValue`.
 */
function exitSourceExpression(
  conn: TConnectionAST,
  defaultValue: string,
  workflow: TWorkflowAST,
  nodeTypes: TNodeTypeAST[],
  plan: ControlFlowPlan,
  isAsync: boolean,
): string {
  const awaitKeyword = isAsync ? 'await ' : '';
  const sourceNode = conn.from.node;
  const sourcePort = conn.from.port;
  const sourceIdx = isStartNode(sourceNode) ? 'startIdx' : `${toValidIdentifier(sourceNode)}Idx`;
  const sourceInstance = workflow.instances.find((i) => i.id === sourceNode);
  const sourceNodeType = nodeTypes.find(
    (n) => n.name === sourceInstance?.nodeType || n.functionName === sourceInstance?.nodeType,
  );
  const sourceNodeTypeName = isStartNode(sourceNode)
    ? RESERVED_NODE_NAMES.START
    : (sourceNodeType?.functionName ?? sourceInstance?.nodeType ?? sourceNode);
  const pullConfig =
    sourceInstance && sourceNodeType
      ? getPullExecutionConfig(sourceInstance, sourceNodeType)
      : { enabled: false, triggerPort: 'execute' };
  const isPullNode = pullConfig.enabled;

  // Parallel group nodes are NOT included here because they always execute —
  // they sit outside branches, aren't lazy (pull), and aren't scoped children.
  // The await Promise.all(...) guarantees their Idx variables are assigned
  // before any downstream node reads them, so no undefined check is needed.
  const needsUndefinedCheck = !isStartNode(sourceNode) && plan.conditionalNodes.has(sourceNode);

  if (isPullNode) {
    return `${awaitKeyword}ctx.getVariable({ id: '${sourceNode}', portName: '${sourcePort}', executionIndex: ${sourceIdx} ?? 0, nodeTypeName: '${sourceNodeTypeName}' })`;
  } else if (needsUndefinedCheck) {
    return `${sourceIdx} !== undefined ? ${awaitKeyword}ctx.getVariable({ id: '${sourceNode}', portName: '${sourcePort}', executionIndex: ${sourceIdx}, nodeTypeName: '${sourceNodeTypeName}' }) : ${defaultValue}`;
  } else {
    return `${awaitKeyword}ctx.getVariable({ id: '${sourceNode}', portName: '${sourcePort}', executionIndex: ${sourceIdx}, nodeTypeName: '${sourceNodeTypeName}' })`;
  }
}

/**
 * Adds an `undefined` property for every declared data exit port with no
 * valid connection (for example a connection typo like Exit.resultx), so the
 * result still carries every declared port.
 */
function emitUnconnectedExitPortDefaults(lines: string[], workflow: TWorkflowAST, returnProps: string[]): void {
  const connectedExitPorts = new Set(returnProps.map((prop) => prop.split(':')[0]));
  Object.entries(workflow.exitPorts).forEach(([portName, portDef]) => {
    if (!connectedExitPorts.has(portName) && portName !== 'onSuccess' && portName !== 'onFailure') {
      const portType = portDef?.tsType || (portDef ? mapToTypeScript(portDef.dataType) : 'unknown');
      lines.push(`  // Exit port '${portName}' has no valid connection - using undefined`);
      returnProps.push(`${portName}: undefined as unknown as ${portType}`);
    }
  });
}

/**
 * Defaults onSuccess to true and onFailure to false when neither is
 * connected, then builds the result with onSuccess first, onFailure second
 * and data ports after, reports Exit and the completed workflow, and
 * returns it.
 */
function emitFinalResult(lines: string[], returnProps: string[], isAsync: boolean, production: boolean): void {
  // Check if onSuccess/onFailure are explicitly connected
  const hasOnSuccess = returnProps.some((prop) => prop.startsWith('onSuccess:'));
  const hasOnFailure = returnProps.some((prop) => prop.startsWith('onFailure:'));

  // Only add defaults if not explicitly connected
  const defaults = [];
  const setCallForDefaults = isAsync ? 'await ctx.setVariable' : 'ctx.setVariable';
  if (!hasOnSuccess) {
    defaults.push('onSuccess: true');
    // Emit VARIABLE_SET for default onSuccess
    if (!production) {
      lines.push(
        `  ${setCallForDefaults}({ id: '${RESERVED_NODE_NAMES.EXIT}', portName: 'onSuccess', executionIndex: exitIdx, nodeTypeName: '${RESERVED_NODE_NAMES.EXIT}' }, true);`,
      );
    }
  }
  if (!hasOnFailure) {
    defaults.push('onFailure: false');
    // Emit VARIABLE_SET for default onFailure
    if (!production) {
      lines.push(
        `  ${setCallForDefaults}({ id: '${RESERVED_NODE_NAMES.EXIT}', portName: 'onFailure', executionIndex: exitIdx, nodeTypeName: '${RESERVED_NODE_NAMES.EXIT}' }, false);`,
      );
    }
  }

  // Assemble final result with onSuccess first, onFailure second, then data ports.
  // This ensures JSON.stringify output is readable and predictable.
  const allPropsUnsorted = [...defaults, ...returnProps];
  const onSuccessProp = allPropsUnsorted.find((p) => p.trimStart().startsWith('onSuccess'));
  const onFailureProp = allPropsUnsorted.find((p) => p.trimStart().startsWith('onFailure'));
  const dataProps = allPropsUnsorted.filter((p) => {
    const key = p.trimStart().split(':')[0].trim();
    return key !== 'onSuccess' && key !== 'onFailure';
  });

  const orderedProps: string[] = [];
  if (onSuccessProp) orderedProps.push(onSuccessProp);
  if (onFailureProp) orderedProps.push(onFailureProp);
  orderedProps.push(...dataProps);
  const allProps = orderedProps.join(', ');

  const awaitPrefix = isAsync ? 'await ' : '';
  lines.push(`  const finalResult = { ${allProps} };`);
  lines.push('');
  lines.push(`  ${awaitPrefix}ctx.sendStatusChangedEvent({`);
  lines.push(`    nodeTypeName: '${RESERVED_NODE_NAMES.EXIT}',`);
  lines.push(`    id: '${RESERVED_NODE_NAMES.EXIT}',`);
  lines.push(`    executionIndex: exitIdx,`);
  lines.push(`    status: 'SUCCEEDED',`);
  lines.push(`  });`);
  lines.push(`  ctx.sendWorkflowCompletedEvent({`);
  lines.push(`    executionIndex: exitIdx,`);
  lines.push(`    status: 'SUCCEEDED',`);
  lines.push(`    result: finalResult,`);
  lines.push(`  });`);
  lines.push('');
  lines.push(`  return finalResult;`);
}
