/**
 * @module generator/node-invocation
 *
 * The emitted text that calls a node and stores what it returned. The regular
 * path, branching nodes, pull executors and scope children all run nodes, and
 * each of them used to spell these lines out on its own. Every function here
 * only pushes lines; the caller owns the surrounding `try` block and events.
 */

import type { TNodeTypeAST } from '../ast/types';
import { COERCE_EXPRESSIONS } from '../built-in-nodes/coercion-types';
import { isExecutePort, isFailurePort, isSuccessPort } from '../constants';

/**
 * Encode positional durable-gate inputs without admitting JavaScript
 * `undefined` into the wire payload. The tagged representation preserves the
 * distinction between an omitted optional argument and an explicit null.
 */
export function buildDurableGatePayload(arguments_: readonly string[]): string {
  return `{ arguments: [${arguments_.join(', ')}].map((value) => value === undefined ? { absent: true } : { value }) }`;
}

/** One node invocation as the emitters see it. */
export interface NodeInvocation {
  nodeType: TNodeTypeAST;
  instanceId: string;
  /** The instance id as an identifier; `${safeId}Idx` holds the execution index. */
  safeId: string;
  /** The function the call names, also recorded as `nodeTypeName`. */
  functionName: string;
  /** The local that receives the call's result. */
  resultVar: string;
  /** Argument expressions, as buildNodeArgumentsWithContext returned them. */
  args: string[];
  /** The execution context variable (`ctx`, `scopedCtx`, ...). */
  ctxVar: string;
  /** The full prefix of every emitted line. */
  indent: string;
  lines: string[];
}

/**
 * Emit the call for a durable gate or durable effect node and return true, or
 * return false without emitting anything for any other node.
 *
 * @param gateResultType - The type the gate's result is cast to.
 */
export function emitDurableNodeCall(call: NodeInvocation, gateResultType: string): boolean {
  const { nodeType, instanceId, safeId, functionName, resultVar, args, ctxVar, indent, lines } = call;
  if (nodeType.durableGate) {
    const trailingRuntimeArgs = (nodeType.receivesAbortSignal ? 1 : 0) + (nodeType.receivesRuntime ? 1 : 0);
    const gateArgs = args.slice(
      nodeType.expression ? 0 : 1,
      trailingRuntimeArgs > 0 ? -trailingRuntimeArgs : undefined,
    );
    lines.push(
      `${indent}const ${resultVar} = ${ctxVar}.resolveGate('${nodeType.durableGate}', '${instanceId}', '${functionName}', ${safeId}Idx, ${buildDurableGatePayload(gateArgs)} as unknown as WireValue) as ${gateResultType};`,
    );
    return true;
  }
  if (nodeType.durableEffect) {
    lines.push(
      `${indent}const ${resultVar} = await ${ctxVar}.executeEffect('${instanceId}', '${functionName}', ${safeId}Idx, async (__operationKey__) => ${functionName}(${[...args, '__operationKey__'].join(', ')}));`,
    );
    return true;
  }
  return false;
}

/**
 * Emit the call for a node that is neither durable nor handled as an
 * expression. A MAP_ITERATOR iterates inline with no user function; a workflow
 * takes `(execute, params)` with its data inputs in one params object plus the
 * recursion depth; anything else, scoped nodes included, takes positional
 * arguments (the `_impl` signature in bundle mode).
 *
 * @param isAsync - Whether the scope function is awaited inside a MAP_ITERATOR loop.
 * @param awaitKeyword - `await ` when the node function itself is async.
 */
export function emitPlainNodeCall(call: NodeInvocation, isAsync: boolean, awaitKeyword: string): void {
  const { nodeType, instanceId, safeId, functionName, resultVar, args, ctxVar, indent, lines } = call;
  if (nodeType.variant === 'MAP_ITERATOR') {
    // args: [execute, items, scopeFn]
    const executeArg = args[0];
    const itemsArg = args[1];
    const scopeFnArg = args[2];
    lines.push(`${indent}let ${resultVar}: { onSuccess: boolean; onFailure: boolean; results: unknown[] };`);
    lines.push(`${indent}if (!${executeArg}) {`);
    lines.push(`${indent}  ${resultVar} = { onSuccess: false, onFailure: false, results: [] };`);
    lines.push(`${indent}} else {`);
    lines.push(`${indent}  const __results: unknown[] = [];`);
    lines.push(`${indent}  for (const __item of ${itemsArg}) {`);
    lines.push(`${indent}    __results.push((${isAsync ? 'await ' : ''}${scopeFnArg}(true, __item)).processed);`);
    lines.push(`${indent}  }`);
    lines.push(`${indent}  ${resultVar} = { onSuccess: true, onFailure: false, results: __results };`);
    lines.push(`${indent}}`);
    return;
  }

  if (nodeType.variant === 'IMPORTED_WORKFLOW' || nodeType.variant === 'WORKFLOW') {
    const executeArg = args[0];
    const dataArgs = args.slice(1);
    const inputPortNames = Object.keys(nodeType.inputs).filter((p) => !isExecutePort(p));

    // { port1: value1, ..., __rd__: __rd__ + 1 }, assigned to a variable first
    // so TypeScript does not run excess property checks on the literal.
    const paramsEntries = inputPortNames.map((portName, i) => `${portName}: ${dataArgs[i]}`);
    paramsEntries.push('__rd__: __rd__ + 1');
    const paramsVar = `__${safeId}Params__`;
    lines.push(`${indent}const ${paramsVar} = { ${paramsEntries.join(', ')} };`);
    lines.push(
      `${indent}const ${resultVar} = ${awaitKeyword}${functionName}(${executeArg}, ${paramsVar}, ${ctxVar}.createNestedRuntime('${functionName}', '${instanceId}', ${safeId}Idx));`,
    );
    return;
  }

  lines.push(`${indent}const ${resultVar} = ${awaitKeyword}${functionName}(${args.join(', ')});`);
}

/** The `setVariable` line that stores one output port's value. */
function outputLine(call: NodeInvocation, setCall: string, portName: string, value: string): string {
  const { instanceId, safeId, functionName, indent } = call;
  return `${indent}${setCall}({ id: '${instanceId}', portName: '${portName}', executionIndex: ${safeId}Idx, nodeTypeName: '${functionName}' }, ${value});`;
}

/**
 * Store each output port from the result object, including onSuccess and
 * onFailure. Scoped output ports are skipped: they are parameters of the scope
 * function, not return values.
 *
 * @param skip - Further ports to leave out.
 */
export function emitResultOutputs(
  call: NodeInvocation,
  setCall: string,
  skip: (portName: string) => boolean = () => false,
): void {
  const { nodeType, resultVar, lines } = call;
  for (const portName of Object.keys(nodeType.outputs)) {
    if (skip(portName) || nodeType.outputs[portName].scope) continue;
    lines.push(outputLine(call, setCall, portName, `${resultVar}.${portName}`));
  }
}

/**
 * Call an expression node (no execute argument) and map its raw return value
 * to its data output ports, then set onSuccess and onFailure, which an
 * expression does not return.
 */
function emitExpressionCallAndOutputs(call: NodeInvocation, setCall: string, awaitKeyword: string): void {
  const { nodeType, functionName, resultVar, args, indent, lines } = call;
  lines.push(`${indent}const ${resultVar} = ${awaitKeyword}${functionName}(${args.join(', ')});`);

  const dataOutputPorts = Object.keys(nodeType.outputs).filter((portName) => {
    const portConfig = nodeType.outputs[portName];
    if (portConfig.scope) return false;
    if (isSuccessPort(portName) || isFailurePort(portName)) return false;
    if (portConfig.isControlFlow || portConfig.failure) return false;
    return true;
  });

  if (dataOutputPorts.length === 1) {
    // One data output: take the port key when the result is an object that
    // has it, else the raw value. The `unknown` local keeps TypeScript from
    // narrowing a specific return type (boolean, say) to `never` in the check.
    const portName = dataOutputPorts[0];
    const rawVar = `${resultVar}_raw`;
    lines.push(`${indent}const ${rawVar}: unknown = ${resultVar};`);
    lines.push(
      outputLine(
        call,
        setCall,
        portName,
        `typeof ${rawVar} === 'object' && ${rawVar} !== null && '${portName}' in ${rawVar} ? ${rawVar}.${portName} : ${rawVar}`,
      ),
    );
  } else {
    for (const portName of dataOutputPorts) {
      lines.push(outputLine(call, setCall, portName, `${resultVar}.${portName}`));
    }
  }

  lines.push(outputLine(call, setCall, 'onSuccess', 'true'));
  lines.push(outputLine(call, setCall, 'onFailure', 'false'));
}

export interface NodeInvocationOptions {
  setCall: string;
  /** Whether the scope function is awaited inside a MAP_ITERATOR loop. */
  isAsync: boolean;
  /** `await ` when the node function itself is async. */
  awaitKeyword: string;
  /** The type a durable gate's result is cast to. */
  gateResultType: string;
  /**
   * Emit a runtime throw for STUB nodes and an inline expression for
   * COERCION nodes. Without it they are called like any other node.
   */
  inlineStubAndCoercion: boolean;
}

/**
 * Emit a node's call and the storing of its outputs, for every node variant:
 * durable gate or effect, stub and coercion (when asked), expression,
 * MAP_ITERATOR, workflow, and positional calls.
 */
export function emitNodeInvocation(call: NodeInvocation, options: NodeInvocationOptions): void {
  const { setCall, isAsync, awaitKeyword, gateResultType, inlineStubAndCoercion } = options;
  const { nodeType, instanceId, functionName, resultVar, args, indent, lines } = call;

  if (emitDurableNodeCall(call, gateResultType)) {
    emitResultOutputs(call, setCall);
    return;
  }

  if (inlineStubAndCoercion && nodeType.variant === 'STUB') {
    // The workflow was generated with generateStubs: true.
    lines.push(
      `${indent}throw new Error('Node "${instanceId}" uses stub type "${functionName}" which has no implementation.');`,
    );
    return;
  }

  if (inlineStubAndCoercion && nodeType.variant === 'COERCION') {
    // An inline JS expression instead of a function call. args[0] is the
    // value input (an expression node has no execute argument).
    const coerceExpr = COERCE_EXPRESSIONS[functionName] || 'String';
    const valueArg = args[0] || 'undefined';
    lines.push(`${indent}const ${resultVar} = ${coerceExpr}(${valueArg});`);
    lines.push(outputLine(call, setCall, 'result', resultVar));
    lines.push(outputLine(call, setCall, 'onSuccess', 'true'));
    lines.push(outputLine(call, setCall, 'onFailure', 'false'));
    return;
  }

  if (nodeType.expression) {
    emitExpressionCallAndOutputs(call, setCall, awaitKeyword);
    return;
  }

  emitPlainNodeCall(call, isAsync, awaitKeyword);
  emitResultOutputs(call, setCall);
}
