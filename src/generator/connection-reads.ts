/**
 * Reads of values that other nodes produced, as a node's argument list emits
 * them.
 *
 * Decides, for one connected input, which execution index the read addresses
 * (Start's, the source node's own, `?? 0` for a pull source), whether that
 * index can still be undefined when the read runs and so needs a guard, how
 * the source is named in the context call, which coercion wraps the value,
 * and how several connections into one port are combined. The execute port's
 * signal is read here too; its fallbacks (no connection, expression node,
 * pre-handled) belong to buildNodeArgumentsWithContext.
 */

import type { TConnectionAST, TDataType, TNodeTypeAST, TPortDefinition, TWorkflowAST } from '../ast';
import { RESERVED_PORT_NAMES, isStartNode, isExitNode } from '../constants';
import { findAllBranchingNodes, findNodesInBranch } from './control-flow';
import { getCoercionWrapper, toValidIdentifier } from './code-utils';
import { mapToTypeScript } from '../types/type-mappings';

/**
 * Everything the reads of one node's inputs share. buildNodeArgumentsWithContext
 * resolves it once per node from its options.
 */
export interface ArgumentEmission {
  node: TNodeTypeAST;
  workflow: TWorkflowAST;
  /** The node instance id. */
  id: string;
  /** `id` as a valid identifier, the prefix of every local this node declares. */
  safeId: string;
  lines: string[];
  indent: string;
  /** The context read, e.g. `await ctx.getVariable`. */
  getCall: string;
  /** The context write input events use, e.g. `await ctx.setVariable`. */
  setCall: string;
  isAsync: boolean;
  /** The enclosing scoped parent, whose index is always assigned when a child reads it. */
  instanceParent: string | undefined;
  emitInputEvents: boolean;
  /** The node type name input events report. */
  eventNodeTypeName: string;
  /** Every connection into this node. */
  inputConnections: TConnectionAST[];
}

/**
 * The inline fallback for `resolveFunction`, declared before a FUNCTION
 * port's value is resolved so self-contained generated code has no
 * ReferenceError when the runtime helper is not in scope.
 */
const RESOLVE_FUNCTION_FALLBACK =
  `const __resolveFunction = typeof resolveFunction === 'function' ? resolveFunction : (p: unknown) => ({ fn: typeof p === 'function' ? p : () => { throw new Error('Cannot resolve function reference'); }, source: 'direct' as const });`;

const PRIMITIVE_TYPE = /^(string|number|boolean|void|unknown|any|never|null|undefined)(\[\])?$/;

/**
 * The type an argument value is cast to: the port's own type when it is a
 * primitive, otherwise `Parameters<typeof fn>[N]`. The node function is
 * always in scope in generated code, so naming the parameter through it never
 * references a type from a module that is not imported.
 */
export function argumentPortType(node: TNodeTypeAST, portConfig: TPortDefinition, paramIndex: number): string {
  const rawPortType = mapToTypeScript(portConfig.dataType, portConfig.tsType);
  return PRIMITIVE_TYPE.test(rawPortType) ? rawPortType : `Parameters<typeof ${node.functionName}>[${paramIndex}]`;
}

/**
 * Resolve the dataType of a source port by looking up the node instance -> node type -> outputs.
 */
function resolveSourcePortDataType(
  workflow: TWorkflowAST,
  sourceNodeId: string,
  sourcePort: string,
): TDataType | undefined {
  if (isStartNode(sourceNodeId)) {
    return workflow.startPorts?.[sourcePort]?.dataType;
  }
  if (isExitNode(sourceNodeId)) {
    return workflow.exitPorts?.[sourcePort]?.dataType;
  }
  const instance = workflow.instances.find((i) => i.id === sourceNodeId);
  if (!instance) return undefined;
  const nodeType = workflow.nodeTypes.find(
    (nt) => nt.name === instance.nodeType || nt.functionName === instance.nodeType,
  );
  if (!nodeType) return undefined;
  return nodeType.outputs?.[sourcePort]?.dataType;
}

/**
 * Resolve the TypeScript type of a value read out of an expression reference
 * (`node.port` inside an `[expr: ...]` annotation). Mirrors the
 * `Parameters<typeof fn>[N]` trick used for plain connections: a node
 * instance's function is always in scope in generated code, so its return
 * type is a safe way to name a non-primitive output type without risking a
 * bare type name from a module that isn't imported. Start has no function to
 * reference, so its declared `tsType` is used directly (same caveat the rest
 * of the generator already accepts for Start ports).
 */
export function resolveReferencedPortType(workflow: TWorkflowAST, sourceNodeId: string, sourcePort: string): string {
  const dataType = resolveSourcePortDataType(workflow, sourceNodeId, sourcePort);
  if (!dataType) return 'any';
  if (isStartNode(sourceNodeId)) {
    return mapToTypeScript(dataType, workflow.startPorts?.[sourcePort]?.tsType);
  }
  const instance = workflow.instances.find((i) => i.id === sourceNodeId);
  const nodeType = instance
    ? workflow.nodeTypes.find((nt) => nt.name === instance.nodeType || nt.functionName === instance.nodeType)
    : undefined;
  const tsType = nodeType?.outputs?.[sourcePort]?.tsType;
  const rawPortType = mapToTypeScript(dataType, tsType);
  const isPrimitive = PRIMITIVE_TYPE.test(rawPortType);
  if (isPrimitive || !nodeType) return rawPortType;
  return `Awaited<ReturnType<typeof ${nodeType.functionName}>>['${sourcePort}']`;
}

function isPullExecutionSource(workflow: TWorkflowAST, sourceNodeId: string): boolean {
  const instance = workflow.instances.find((candidate) => candidate.id === sourceNodeId);
  if (!instance) return false;
  const nodeType = workflow.nodeTypes.find((candidate) => candidate.name === instance.nodeType);
  return Boolean(instance.config?.pullExecution ?? nodeType?.defaultConfig?.pullExecution);
}

/**
 * Whether a source node may not have run by the time a reader reads it.
 *
 * A node inside a branch region runs only on the arm that was taken, so a
 * reader reachable from more than one arm -- a convergence node -- can be
 * asked for a port belonging to a node that never ran. Its execution index is
 * then `undefined`, and addressing it at that index is not a wire value: the
 * continuation validator refuses the whole run over a read the reader was
 * prepared to find empty.
 *
 * This mirrors the condition the Exit path already applies to the same
 * question. It is deliberately about the SOURCE's reachability rather than the
 * reading port's optionality: a required port can be fed by a node that did
 * not run, which is exactly the case that used to slip through.
 */
function sourceMayNotHaveExecuted(
  workflow: TWorkflowAST,
  nodeTypes: TNodeTypeAST[],
  sourceNodeId: string,
): boolean {
  if (isStartNode(sourceNodeId) || isExitNode(sourceNodeId)) return false;

  const branchingNodes = findAllBranchingNodes(workflow, nodeTypes);
  if (branchingNodes.has(sourceNodeId)) return true;

  const allInstanceIds = new Set(workflow.instances.map((instance) => instance.id));
  for (const branchInstanceId of branchingNodes) {
    for (const port of [RESERVED_PORT_NAMES.ON_SUCCESS, RESERVED_PORT_NAMES.ON_FAILURE]) {
      const inBranch = findNodesInBranch(
        branchInstanceId,
        port,
        workflow,
        allInstanceIds,
        branchingNodes,
      );
      if (inBranch.has(sourceNodeId)) return true;
    }
  }
  return false;
}

/** The local holding a source's execution index: `startIdx` for Start, `<id>Idx` otherwise. */
function sourceIndexVar(sourceNode: string): string {
  return isStartNode(sourceNode) ? 'startIdx' : `${toValidIdentifier(sourceNode)}Idx`;
}

/**
 * Whether a source's index is always assigned when this node reads it: Start,
 * and the scoped parent a child runs inside. Any other source may have been
 * skipped (a cancelled branch), so its index is `number | undefined`.
 */
function isConstSource(em: ArgumentEmission, sourceNode: string): boolean {
  return isStartNode(sourceNode) || sourceNode === em.instanceParent;
}

/**
 * The index an unguarded read addresses: `?? 0` for a pull source (it runs
 * lazily, on first read), a non-null assertion for a source that is not
 * const, the plain index otherwise.
 */
export function unguardedSourceIndex(em: ArgumentEmission, sourceNode: string): string {
  const sourceIdx = sourceIndexVar(sourceNode);
  return isPullExecutionSource(em.workflow, sourceNode)
    ? `${sourceIdx} ?? 0`
    : `${sourceIdx}${isConstSource(em, sourceNode) ? '' : '!'}`;
}

/** The node type name a read reports for its source. */
function sourceNodeTypeName(workflow: TWorkflowAST, sourceNode: string): string {
  if (isStartNode(sourceNode)) return 'Start';
  const sourceInstance = workflow.instances.find((candidate) => candidate.id === sourceNode);
  const sourceNodeType = workflow.nodeTypes.find(
    (candidate) => candidate.name === sourceInstance?.nodeType || candidate.functionName === sourceInstance?.nodeType,
  );
  return sourceNodeType?.functionName ?? sourceInstance?.nodeType ?? sourceNode;
}

/** The context call that reads `sourceNode.sourcePort` at `executionIndex`. */
export function contextRead(
  em: ArgumentEmission,
  sourceNode: string,
  sourcePort: string,
  executionIndex: string,
): string {
  return `${em.getCall}({ id: '${sourceNode}', portName: '${sourcePort}', executionIndex: ${executionIndex}, nodeTypeName: '${sourceNodeTypeName(em.workflow, sourceNode)}' })`;
}

/** Whether a connection's source node exists (Start always does). */
function sourceExists(workflow: TWorkflowAST, sourceNode: string): boolean {
  return isStartNode(sourceNode) || workflow.instances.some((i) => i.id === sourceNode);
}

/**
 * Emits `const <id>_execute` from the execute port's connections and returns
 * that local. One connection is read directly; several are coalesced with
 * `||`. A source that may not have run reads as `false`.
 */
export function emitExecuteSignal(em: ArgumentEmission, executeConnections: TConnectionAST[]): string {
  const varName = `${em.safeId}_execute`;
  const signal = (conn: TConnectionAST): string => {
    const sourceNode = conn.from.node;
    const sourceIdx = sourceIndexVar(sourceNode);
    const read = `${contextRead(em, sourceNode, conn.from.port, sourceIdx)} as boolean`;
    return isConstSource(em, sourceNode) ? read : `${sourceIdx} !== undefined ? ${read} : false`;
  };
  if (executeConnections.length === 1) {
    em.lines.push(`${em.indent}const ${varName} = ${signal(executeConnections[0])};`);
  } else {
    // Multiple execute connections — coalesce with ||, each guarded
    const parts = executeConnections.map((conn) => `(${signal(conn)})`);
    em.lines.push(`${em.indent}const ${varName} = ${parts.join(' || ')};`);
  }
  return varName;
}

/**
 * Emits `const <varName>` for a data port with exactly one connection.
 *
 * Guards against an undefined execution index whenever the source may not
 * have run: an optional port on a non-const source (DISJUNCTION nodes), or any
 * source inside a branch region, whose index is unset on the arm that was not
 * taken. The second case applies even to a required port -- a convergence
 * node reachable from several arms has to read ports from all of them, and
 * the ones belonging to arms that did not run are legitimately absent.
 *
 * A FUNCTION port's value is resolved through `__resolveFunction`, so a
 * registry id works as well as a function; any other value gets the
 * connection's coercion.
 */
export function emitSingleConnectionValue(
  em: ArgumentEmission,
  portConfig: TPortDefinition,
  connection: TConnectionAST,
  varName: string,
  paramIndex: number,
): void {
  const { indent, lines, workflow } = em;
  const sourceNode = connection.from.node;
  const sourcePort = connection.from.port;
  if (!sourceExists(workflow, sourceNode)) {
    lines.push(`${indent}const ${varName} = undefined; // Source node '${sourceNode}' not found`);
    return;
  }
  const sourceIdx = sourceIndexVar(sourceNode);
  const sourceExecutionIndex = unguardedSourceIndex(em, sourceNode);
  const portType = argumentPortType(em.node, portConfig, paramIndex);
  const needsGuard =
    !isConstSource(em, sourceNode) &&
    (portConfig.optional || sourceMayNotHaveExecuted(workflow, workflow.nodeTypes, sourceNode));

  if (portConfig.dataType === 'FUNCTION') {
    lines.push(`${indent}${RESOLVE_FUNCTION_FALLBACK}`);
    const rawVarName = `${varName}_raw`;
    if (needsGuard) {
      lines.push(
        `${indent}const ${rawVarName} = ${sourceIdx} !== undefined ? ${contextRead(em, sourceNode, sourcePort, sourceIdx)} : undefined;`,
      );
      lines.push(
        `${indent}const ${varName}_resolved = ${rawVarName} !== undefined ? __resolveFunction(${rawVarName}) : undefined;`,
      );
      lines.push(`${indent}const ${varName} = ${varName}_resolved?.fn as ${portType};`);
    } else {
      lines.push(
        `${indent}const ${rawVarName} = ${contextRead(em, sourceNode, sourcePort, sourceExecutionIndex)};`,
      );
      lines.push(`${indent}const ${varName}_resolved = __resolveFunction(${rawVarName});`);
      lines.push(`${indent}const ${varName} = ${varName}_resolved.fn as ${portType};`);
    }
    return;
  }

  const sourceDataType = resolveSourcePortDataType(workflow, sourceNode, sourcePort);
  const coerceExpr = getCoercionWrapper(connection, sourceDataType, portConfig.dataType);
  if (needsGuard) {
    const getExpr = contextRead(em, sourceNode, sourcePort, sourceIdx);
    const wrappedExpr = coerceExpr ? `${coerceExpr}(${getExpr})` : getExpr;
    // An optional port really is `T | undefined`. A required port gets
    // the type its node declares, like the unguarded read below: the
    // guard only covers an arm that did not run, and typing the value
    // `T | undefined` made compiled files fail `tsc --strict`.
    lines.push(
      portConfig.optional
        ? `${indent}const ${varName} = ${sourceIdx} !== undefined ? ${wrappedExpr} as ${portType} : undefined;`
        : `${indent}const ${varName} = (${sourceIdx} !== undefined ? ${wrappedExpr} : undefined) as ${portType};`,
    );
  } else {
    const getExpr = contextRead(em, sourceNode, sourcePort, sourceExecutionIndex);
    if (coerceExpr) {
      lines.push(`${indent}const ${varName} = ${coerceExpr}(${getExpr}) as ${portType};`);
    } else {
      lines.push(`${indent}const ${varName} = ${getExpr} as ${portType};`);
    }
  }
}

/**
 * The expression that combines several guarded reads as the port's
 * mergeStrategy asks. Each attempt yields undefined when its source did not
 * run (a fan-in usually joins arms of a branch), so the strategies that keep
 * several values first drop the arms that never arrived. Without a strategy
 * the first value wins.
 */
function mergeAttempts(attempts: string[], strategy: TPortDefinition['mergeStrategy']): string {
  const arrived = `[${attempts.join(', ')}].filter((v) => v !== undefined)`;
  switch (strategy) {
    case 'LAST':
      return `${arrived}.pop()`;
    case 'COLLECT':
      return arrived;
    case 'CONCAT':
      return `${arrived}.flat()`;
    case 'MERGE':
      return `Object.assign({}, ...${arrived})`;
    case 'FIRST':
    case undefined:
    default:
      return attempts.join(' ?? ');
  }
}

/**
 * Emits `const <varName>` for a data port with several connections (a
 * fan-in). Connections from nodes that do not exist are dropped; each
 * remaining one is read behind its own guard with its own coercion, and the
 * reads are merged by mergeAttempts.
 */
export function emitFanInValue(
  em: ArgumentEmission,
  portConfig: TPortDefinition,
  connections: TConnectionAST[],
  varName: string,
  paramIndex: number,
): void {
  const { indent, lines, workflow } = em;
  const validConnections = connections.filter((conn) => sourceExists(workflow, conn.from.node));
  if (validConnections.length === 0) {
    // All source nodes are orphaned
    lines.push(`${indent}const ${varName} = undefined; // All source nodes not found`);
    return;
  }
  const attempts = validConnections.map((conn) => {
    const sourceNode = conn.from.node;
    const sourcePort = conn.from.port;
    const sourceIdx = sourceIndexVar(sourceNode);
    const getExpr = contextRead(em, sourceNode, sourcePort, sourceIdx);
    if (portConfig.dataType === 'FUNCTION') {
      return `(${sourceIdx} !== undefined ? ${getExpr} : undefined)`;
    }
    // Per-connection coercion: each source gets its own coercion wrapper
    const sourceDataType = resolveSourcePortDataType(workflow, sourceNode, sourcePort);
    const coerceExpr = getCoercionWrapper(conn, sourceDataType, portConfig.dataType);
    const wrapped = coerceExpr ? `${coerceExpr}(${getExpr})` : getExpr;
    return `(${sourceIdx} !== undefined ? ${wrapped} : undefined)`;
  });
  const merged = mergeAttempts(attempts, portConfig.mergeStrategy);
  const portType = argumentPortType(em.node, portConfig, paramIndex);

  if (portConfig.dataType === 'FUNCTION') {
    lines.push(`${indent}${RESOLVE_FUNCTION_FALLBACK}`);
    const rawVarName = `${varName}_raw`;
    lines.push(`${indent}const ${rawVarName} = ${merged};`);
    lines.push(
      `${indent}const ${varName}_resolved = ${rawVarName} !== undefined ? __resolveFunction(${rawVarName}) : undefined;`,
    );
    lines.push(`${indent}const ${varName} = ${varName}_resolved?.fn as ${portType};`);
  } else {
    lines.push(`${indent}const ${varName} = (${merged}) as ${portType};`);
  }
}
