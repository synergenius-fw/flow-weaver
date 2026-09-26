/**
 * The value of one data input port in a node's argument list.
 *
 * Decides where the value comes from, in priority order: an instance-level
 * expression, the port's connections, the node type's expression, the port's
 * default, `undefined` for an optional port, and a typed `undefined` for a
 * required port nothing feeds. Also emits the input event that makes the
 * value visible to breakpoints and inspection.
 */

import type { TPortDefinition } from '../ast';
import { isStartNode, isExecutePort, isSuccessPort, isFailurePort } from '../constants';
import { toValidIdentifier } from './code-utils';
import { findExpressionReferences, rewriteExpressionReferences } from '../parser/expression-references';
import {
  type ArgumentEmission,
  argumentPortType,
  contextRead,
  emitFanInValue,
  emitSingleConnectionValue,
  resolveReferencedPortType,
  unguardedSourceIndex,
} from './connection-reads';

/**
 * Emits the VARIABLE_SET event for an input port (execute included) when the
 * caller asked for input events. `durable: false`: an input is visible to
 * live debugging but is not a graph-owned output a continuation records.
 */
export function emitInputEvent(em: ArgumentEmission, portName: string, value: string): void {
  if (em.emitInputEvents) {
    em.lines.push(
      `${em.indent}${em.setCall}({ id: '${em.id}', portName: '${portName}', executionIndex: ${em.safeId}Idx, nodeTypeName: '${em.eventNodeTypeName}', durable: false }, ${value});`,
    );
  }
}

/**
 * Emits `const <id>_<port>` holding a data input port's value and returns
 * that local. The caller pushes it as the next argument, at `paramIndex`.
 */
export function emitInputPortValue(em: ArgumentEmission, portName: string, paramIndex: number): string {
  const { node, indent, lines } = em;
  const portConfig = node.inputs[portName];
  const varName = `${em.safeId}_${portName}`;
  const instancePortConfig = em.workflow.instances
    .find((i) => i.id === em.id)
    ?.config?.portConfigs?.find(
      (pc) => pc.portName === portName && (pc.direction == null || pc.direction === 'INPUT'),
    );
  const connections = em.inputConnections.filter((conn) => conn.to.port === portName);

  if (instancePortConfig?.expression !== undefined) {
    // Instance-level expression takes priority
    emitInstanceExpressionValue(em, portConfig, String(instancePortConfig.expression), varName, paramIndex);
  } else if (connections.length === 1) {
    emitSingleConnectionValue(em, portConfig, connections[0], varName, paramIndex);
  } else if (connections.length > 1) {
    emitFanInValue(em, portConfig, connections, varName, paramIndex);
  } else if (portConfig.expression) {
    const expression = portConfig.expression;
    const portType = argumentPortType(node, portConfig, paramIndex);
    if (isFunctionExpression(expression)) {
      lines.push(`${indent}const ${varName} = ${em.isAsync ? 'await ' : ''}(${expression})(ctx) as ${portType};`);
    } else {
      lines.push(`${indent}const ${varName} = ${expression} as ${portType};`);
    }
  } else if (portConfig.default !== undefined) {
    lines.push(`${indent}const ${varName} = ${JSON.stringify(portConfig.default)};`);
  } else if (portConfig.optional) {
    lines.push(`${indent}const ${varName} = undefined;`);
  } else {
    // Required port has no connection, expression, or default - use typed undefined fallback
    const portType = argumentPortType(node, portConfig, paramIndex);
    lines.push(
      `${indent}let ${varName}: ${portType} = undefined as unknown as ${portType}; // Required port '${portName}' has no connection`,
    );
  }
  return varName;
}

/** An arrow or regular function expression is called with the context; anything else is the value. */
function isFunctionExpression(expression: string): boolean {
  return expression.includes('=>') || expression.trim().startsWith('function');
}

/**
 * Emits the value of an instance-level expression (`[expr: ...]`).
 *
 * Upstream references (`Start.x`, `node.port`) inside the expression are data
 * dependencies of this port. The parser has already validated them and,
 * unless a same-name @path edge covered the pair, flagged them `derived`.
 * Either way the reference names a node whose value lives in the context, not
 * a JavaScript variable in scope, so it must be fetched and substituted.
 * Keying the substitution off the expression text (what is actually
 * referenced) rather than off the `derived` flag is what makes a same-name
 * reference like factor="cfg.factor" work: @path creates that connection as a
 * plain edge, so it is never flagged derived, but the identifier still has to
 * be fetched.
 */
function emitInstanceExpressionValue(
  em: ArgumentEmission,
  portConfig: TPortDefinition,
  source: string,
  varName: string,
  paramIndex: number,
): void {
  const { indent, lines } = em;
  const expr = substituteExpressionReferences(em, source, varName);
  // Type the value as the node declares the port, as the other input
  // paths do; a referenced upstream port can be typed more loosely (e.g.
  // `object` where the port wants `Record<string, unknown>`).
  const exprPortType = argumentPortType(em.node, portConfig, paramIndex);
  if (isFunctionExpression(expr)) {
    lines.push(`${indent}const ${varName} = ${em.isAsync ? 'await ' : ''}(${expr})(ctx) as ${exprPortType};`);
  } else {
    // Simple expression - evaluate directly
    lines.push(`${indent}const ${varName} = (${expr}) as ${exprPortType};`);
  }
}

/**
 * Fetches each upstream port an expression references into a local
 * (`<id>_<port>_ref_<node>_<port>`, once per distinct reference) and returns
 * the expression rewritten to use those locals. A reference to the node
 * itself, or to a name that is not a real data port, is left alone.
 */
function substituteExpressionReferences(em: ArgumentEmission, expr: string, varName: string): string {
  const { workflow } = em;
  const referenceableRoots = new Set<string>(['Start', ...workflow.instances.map((inst) => inst.id)]);
  const isRealPort = (root: string, port: string): boolean => {
    if (isExecutePort(port) || isSuccessPort(port) || isFailurePort(port)) return false;
    if (isStartNode(root)) return port in (workflow.startPorts ?? {});
    const sourceInstance = workflow.instances.find((inst) => inst.id === root);
    const sourceType = sourceInstance
      ? workflow.nodeTypes.find((nt) => nt.name === sourceInstance.nodeType || nt.functionName === sourceInstance.nodeType)
      : undefined;
    return !!sourceType && port in sourceType.outputs;
  };
  const refs = findExpressionReferences(expr, referenceableRoots).filter(
    (ref) => ref.root !== em.id && isRealPort(ref.root, ref.port),
  );
  if (refs.length === 0) return expr;

  const fetched = new Map<string, string>();
  for (const ref of refs) {
    const key = `${ref.root}.${ref.port}`;
    if (fetched.has(key)) continue;
    const refVar = `${varName}_ref_${toValidIdentifier(ref.root)}_${toValidIdentifier(ref.port)}`;
    const refType = resolveReferencedPortType(workflow, ref.root, ref.port);
    em.lines.push(
      `${em.indent}const ${refVar} = ${contextRead(em, ref.root, ref.port, unguardedSourceIndex(em, ref.root))} as ${refType};`,
    );
    fetched.set(key, refVar);
  }
  return rewriteExpressionReferences(expr, refs, (ref) => fetched.get(`${ref.root}.${ref.port}`)!);
}
