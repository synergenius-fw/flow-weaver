/**
 * One child node's execution block inside a scope closure.
 *
 * Decides what surrounds the child's call: the debug hooks outside
 * production, the abort check and execution index, the shouldExecute guard,
 * the RUNNING / SUCCEEDED / FAILED-or-CANCELLED status events, the commit, and
 * the catch that lets a durable gate's yield pass through untouched. Also
 * decides how the child reads the scope's parameters (at the parameter's own
 * index, pre-handled before its other arguments) and how its outputs are
 * stored (an expression child's control-flow outputs are constants).
 */

import type { TNodeTypeAST, TWorkflowAST, TNodeInstanceAST } from '../ast';
import { isSuccessPort, isFailurePort } from '../constants';
import { toValidIdentifier, nodeResultVar } from './code-utils';
import { emitDurableNodeCall } from './node-invocation';
import { mapToTypeScript } from '../types/type-mappings';

/** What a scoped child asks the argument builder for. */
export interface ScopedChildArguments {
  node: TNodeTypeAST;
  workflow: TWorkflowAST;
  id: string;
  lines: string[];
  indent: string;
  getCall: string;
  isAsync: boolean;
  instanceParent: string | undefined;
  skipPorts: Set<string>;
  emitInputEvents: boolean;
  setCall: string;
  nodeTypeName: string;
  production: boolean;
  runtimeContextExpression: string;
}

/**
 * Builds a child's argument list (buildNodeArgumentsWithContext). Passed in
 * rather than imported: it is the caller of this module's closure generator.
 */
export type ScopedChildArgumentBuilder = (request: ScopedChildArguments) => string[];

/** The scope closure a child runs in. */
export interface ScopeFrame {
  scopeName: string;
  parentNodeId: string;
  parentNodeType: TNodeTypeAST;
  /** The whole workflow: node types and the parent's connections come from here. */
  workflow: TWorkflowAST;
  /** The children plus a virtual parent; the child's arguments are built against it. */
  scopeWorkflow: TWorkflowAST;
  isAsync: boolean;
  production: boolean;
}

/** Per-child names the pieces of its block share. */
interface ChildBlock {
  child: TNodeInstanceAST;
  childNodeType: TNodeTypeAST;
  safeChildId: string;
  awaitPrefix: string;
  /** The indentation inside `if (shouldExecute) {`. */
  childIndent: string;
  /** The indentation inside `try {`. */
  tryIndent: string;
  setCall: string;
}

/** Emits the execution block of one child of a scope closure. */
export function emitScopedChild(
  lines: string[],
  frame: ScopeFrame,
  child: TNodeInstanceAST,
  buildArgs: ScopedChildArgumentBuilder,
): void {
  const { workflow, isAsync, production } = frame;
  const childNodeType = workflow.nodeTypes?.find(
    (nt) => nt.name === child.nodeType || nt.functionName === child.nodeType,
  );
  if (!childNodeType) {
    lines.push(`    // WARNING: Node type '${child.nodeType}' not found for child '${child.id}'`);
    return;
  }

  const safeChildId = toValidIdentifier(child.id);
  const awaitPrefix = isAsync ? 'await ' : '';
  const emitDebugHooks = !production;
  const childIndent = '      ';
  const block: ChildBlock = {
    child,
    childNodeType,
    safeChildId,
    awaitPrefix,
    childIndent,
    tryIndent: `${childIndent}  `,
    setCall: isAsync ? `await scopedCtx.setVariable` : `scopedCtx.setVariable`,
  };

  lines.push(``);
  lines.push(`    // Execute: ${child.id} (${child.nodeType})`);
  // Live debugging may pause but cannot skip a durable boundary.
  if (emitDebugHooks) {
    lines.push(`    ${awaitPrefix}__ctrl__.beforeNode('${child.id}', scopedCtx);`);
  }
  lines.push(`    scopedCtx.checkAborted('${child.id}');`);
  lines.push(`    const ${safeChildId}Idx = scopedCtx.addExecution('${child.id}');`);
  lines.push(`    if (scopedCtx.shouldExecute('${child.id}', '${child.nodeType}', ${safeChildId}Idx)) {`);
  lines.push(...statusEvent(block, childIndent, `'RUNNING'`));
  lines.push(`${childIndent}try {`);

  const args = emitChildArguments(lines, frame, block, buildArgs);
  emitChildCallAndOutputs(lines, block, args);

  const { tryIndent } = block;
  lines.push(...statusEvent(block, tryIndent, `'SUCCEEDED'`));
  lines.push(`${tryIndent}scopedCtx.commitNode('${child.id}', '${child.nodeType}', ${safeChildId}Idx);`);
  // Debug controller: afterNode hook for scoped children
  if (emitDebugHooks) {
    lines.push(`${tryIndent}${awaitPrefix}__ctrl__.afterNode('${child.id}', scopedCtx);`);
  }
  emitChildCatch(lines, block);
  lines.push(`    }`);
}

/** The status-changed event for the child, at `indent`. */
function statusEvent(block: ChildBlock, indent: string, status: string): string[] {
  const { child, safeChildId, awaitPrefix } = block;
  return [
    `${indent}${awaitPrefix}scopedCtx.sendStatusChangedEvent({`,
    `${indent}  nodeTypeName: '${child.nodeType}',`,
    `${indent}  id: '${child.id}',`,
    `${indent}  executionIndex: ${safeChildId}Idx,`,
    `${indent}  status: ${status},`,
    `${indent}});`,
  ];
}

/**
 * Emits the child's argument locals and returns its argument list.
 *
 * A connection from one of this scope's OUTPUT ports is read first, at the
 * scope parameter's index (`scopeParamIdx_<port>`), and its target port is
 * then skipped by the argument builder. Its input event is `durable: false`,
 * like every input the argument builder sets: an input is not a graph-owned
 * output, and a durable resume authenticates outputs only. Committing it
 * would make a resumed loop iteration be refused over a scoped gate's
 * `execute`/`prompt` inputs.
 */
function emitChildArguments(
  lines: string[],
  frame: ScopeFrame,
  block: ChildBlock,
  buildArgs: ScopedChildArgumentBuilder,
): string[] {
  const { scopeName, parentNodeId, parentNodeType, workflow, isAsync, production } = frame;
  const { child, childNodeType, safeChildId, tryIndent, setCall } = block;
  const argLines: string[] = [];
  const getCall = isAsync ? 'await scopedCtx.getVariable' : 'scopedCtx.getVariable';
  const preHandledPorts = new Set<string>();

  const parentConnections = workflow.connections.filter(
    (conn) => conn.from.node === parentNodeId && conn.to.node === child.id,
  );
  parentConnections.forEach((conn) => {
    const sourcePort = parentNodeType.outputs[conn.from.port];
    if (!sourcePort || sourcePort.scope !== scopeName) return;
    const targetPort = conn.to.port;
    const varName = `${safeChildId}_${targetPort}`;
    const targetPortDef = childNodeType.inputs[targetPort];
    const portType = targetPortDef ? mapToTypeScript(targetPortDef.dataType, targetPortDef.tsType) : 'unknown';
    argLines.push(
      `${tryIndent}const ${varName} = ${getCall}({ id: '${parentNodeId}', portName: '${conn.from.port}', executionIndex: scopeParamIdx_${conn.from.port} }) as ${portType};`,
    );
    argLines.push(
      `${tryIndent}${setCall}({ id: '${child.id}', portName: '${targetPort}', executionIndex: ${safeChildId}Idx, nodeTypeName: '${child.nodeType}', durable: false }, ${varName});`,
    );
    preHandledPorts.add(targetPort);
  });

  const args = buildArgs({
    node: childNodeType,
    workflow: frame.scopeWorkflow,
    id: child.id,
    lines: argLines,
    indent: tryIndent,
    getCall,
    isAsync,
    instanceParent: child.parent ? `${child.parent.id}.${child.parent.scope}` : undefined,
    skipPorts: preHandledPorts,
    emitInputEvents: true,
    setCall,
    nodeTypeName: child.nodeType,
    production,
    runtimeContextExpression: 'scopedCtx',
  });

  lines.push(...argLines);
  return args;
}

/**
 * Emits the child's call and stores its outputs. Expression and regular
 * children alike take positional arguments (an expression has no execute
 * argument). An expression child returns no onSuccess/onFailure, so its
 * failure ports are stored as false and its other control-flow ports as true.
 */
function emitChildCallAndOutputs(lines: string[], block: ChildBlock, args: string[]): void {
  const { child, childNodeType, safeChildId, tryIndent, setCall, awaitPrefix } = block;
  // Never let the result local shadow the node type it calls.
  const childResultVar = nodeResultVar(safeChildId, child.nodeType);
  const childCall = {
    nodeType: childNodeType,
    instanceId: child.id,
    safeId: safeChildId,
    functionName: child.nodeType,
    resultVar: childResultVar,
    args,
    ctxVar: 'scopedCtx',
    indent: tryIndent,
    lines,
  };
  if (!emitDurableNodeCall(childCall, 'any')) {
    lines.push(`${tryIndent}const ${childResultVar} = ${awaitPrefix}${child.nodeType}(${args.join(', ')});`);
  }

  const storeOutput = (outPort: string, value: string): void => {
    lines.push(
      `${tryIndent}${setCall}({ id: '${child.id}', portName: '${outPort}', executionIndex: ${safeChildId}Idx, nodeTypeName: '${child.nodeType}' }, ${value});`,
    );
  };
  Object.keys(childNodeType.outputs || {}).forEach((outPort) => {
    if (!childNodeType.expression) {
      storeOutput(outPort, `${childResultVar}.${outPort}`);
      return;
    }
    const portDef = childNodeType.outputs[outPort];
    if (portDef.failure || isFailurePort(outPort)) {
      storeOutput(outPort, 'false');
    } else if (portDef.isControlFlow || isSuccessPort(outPort)) {
      storeOutput(outPort, 'true');
    } else {
      storeOutput(outPort, `${childResultVar}.${outPort}`);
    }
  });
}

/**
 * Emits the child's catch block: a durable gate's yield is rethrown as is;
 * any other error reports CANCELLED or FAILED (and, when not a cancellation,
 * a log error event) before it is rethrown.
 */
function emitChildCatch(lines: string[], block: ChildBlock): void {
  const { child, safeChildId, childIndent, tryIndent } = block;
  lines.push(`${childIndent}} catch (error: unknown) {`);
  lines.push(
    `${tryIndent}if ((error as { code?: unknown })?.code === 'FLOW_WEAVER_DURABLE_GATE_YIELD') throw error;`,
  );
  lines.push(`${tryIndent}const isCancellation = CancellationError.isCancellationError(error);`);
  lines.push(...statusEvent(block, tryIndent, `isCancellation ? 'CANCELLED' : 'FAILED'`));
  lines.push(`${tryIndent}if (!isCancellation) {`);
  lines.push(`${tryIndent}  scopedCtx.sendLogErrorEvent({`);
  lines.push(`${tryIndent}    nodeTypeName: '${child.nodeType}',`);
  lines.push(`${tryIndent}    id: '${child.id}',`);
  lines.push(`${tryIndent}    executionIndex: ${safeChildId}Idx,`);
  lines.push(`${tryIndent}    error: error instanceof Error ? error.message : String(error),`);
  lines.push(
    `${tryIndent}    code: typeof (error as { code?: unknown }).code === 'string' ? ((error as { code?: unknown }).code as string) : undefined,`,
  );
  lines.push(`${tryIndent}  });`);
  lines.push(`${tryIndent}}`);
  lines.push(`${tryIndent}throw error;`);
  lines.push(`${childIndent}}`);
}
