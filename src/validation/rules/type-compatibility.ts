/**
 * Type compatibility of data connections, with coercion support.
 *
 * A connection carries a value from an output port to an input port, and the
 * generated code passes it through as is, or through the `as <type>` coercion
 * the author wrote. This rule says when that value may not be what the target
 * expects, so the author sees it before run time.
 *
 * Checks, in order, stopping at the first that settles the connection:
 * - STEP ports connect only to STEP ports (error)
 * - no `as <type>` on FUNCTION ports (error)
 * - same data type: a coercion is redundant; OBJECT ports compare their tsType
 * - ANY on either side is always compatible
 * - an explicit coercion must produce the target type
 * - safe coercions (NUMBER to STRING, BOOLEAN to STRING) pass silently
 * - lossy coercions (STRING to NUMBER, OBJECT to STRING, ...) warn
 * - unusual coercions (NUMBER to BOOLEAN, STRING to OBJECT, ...) warn
 * - every other pair is a TYPE_MISMATCH warning
 *
 * With `@strictTypes` on the workflow, or strict mode, the last four are
 * reported as TYPE_INCOMPATIBLE errors instead of warnings.
 */

import type {
  TConnectionAST,
  TNodeTypeAST,
  TPortDefinition,
  TSourceLocation,
  TValidationError,
  TWorkflowAST,
} from '../../ast/types';
import { isStartNode, isExitNode } from '../../constants';
import { checkTypeCompatibilityFromStrings, SAFE_COERCIONS } from '../type-checker.js';
import {
  getConnectionLocation,
  formatType,
  normalizeTypeString,
  COERCE_OUTPUT_TYPE,
  suggestCoerceType,
} from '../validator-helpers.js';
import type { ValidationContext } from './context.js';

/** Implicit coercions that may lose information: [source, target, what happens]. */
const LOSSY_COERCIONS: ReadonlyArray<readonly [string, string, string]> = [
  ['STRING', 'NUMBER', 'May result in NaN if string is not a valid number'],
  ['STRING', 'BOOLEAN', 'Will use JavaScript truthy/falsy conversion'],
  ['OBJECT', 'STRING', 'Will use JSON.stringify()'],
  ['ARRAY', 'STRING', 'Will use JSON.stringify()'],
];

/** Implicit coercions that work but are rarely intended: [source, target, what happens]. */
const UNUSUAL_COERCIONS: ReadonlyArray<readonly [string, string, string]> = [
  ['NUMBER', 'BOOLEAN', 'Will use JavaScript truthy/falsy conversion (0 = false, non-zero = true)'],
  ['BOOLEAN', 'NUMBER', 'Will convert false to 0, true to 1'],
  ['STRING', 'OBJECT', 'May fail if string is not valid JSON'],
  ['STRING', 'ARRAY', 'May fail if string is not valid JSON array'],
];

/** A connection whose two ends resolved to port definitions. */
interface TypedConnection {
  conn: TConnectionAST;
  fromNode: string;
  fromPort: string;
  toNode: string;
  toPort: string;
  source: TPortDefinition;
  target: TPortDefinition;
  location: TSourceLocation | undefined;
}

/**
 * The port definitions at both ends, or null when the connection is not
 * type-checked: derived from an expression (the expression transforms the
 * value), touching Start or Exit (typed dynamically), or with an end that
 * does not resolve (validateConnections reports that).
 */
function resolveTypedConnection(
  conn: TConnectionAST,
  instanceMap: Map<string, TNodeTypeAST>
): TypedConnection | null {
  const { node: fromNode, port: fromPort } = conn.from;
  const { node: toNode, port: toPort } = conn.to;
  const location = getConnectionLocation(conn);
  if (conn.derived) return null;
  if (isStartNode(fromNode) || isExitNode(toNode)) return null;
  const sourceNode = instanceMap.get(fromNode);
  const targetNode = instanceMap.get(toNode);
  if (!sourceNode || !targetNode) return null;
  const source = sourceNode.outputs[fromPort];
  const target = targetNode.inputs[toPort];
  if (!source || !target) return null;
  return { conn, fromNode, fromPort, toNode, toPort, source, target, location };
}

/** Report a type issue: an error under strict types, otherwise the warning as given. */
function reportTypeIssue(ctx: ValidationContext, strictTypes: boolean, issue: TValidationError): void {
  if (strictTypes) {
    ctx.errors.push({ ...issue, type: 'error', code: 'TYPE_INCOMPATIBLE' });
  } else {
    ctx.warnings.push(issue);
  }
}

/** STEP carries control flow and connects only to STEP. True when either end is STEP. */
function checkStepPorts(ctx: ValidationContext, c: TypedConnection): boolean {
  const sourceType = c.source.dataType;
  const targetType = c.target.dataType;
  if (sourceType === 'STEP' && targetType !== 'STEP') {
    ctx.errors.push({
      type: 'error',
      code: 'STEP_PORT_TYPE_MISMATCH',
      message: `STEP port "${c.fromPort}" on node "${c.fromNode}" cannot connect to non-STEP port "${c.toPort}" (${formatType(targetType, c.target.tsType)}) on node "${c.toNode}"`,
      connection: c.conn,
      location: c.location,
    });
    return true;
  }
  if (targetType === 'STEP' && sourceType !== 'STEP') {
    ctx.errors.push({
      type: 'error',
      code: 'STEP_PORT_TYPE_MISMATCH',
      message: `Non-STEP port "${c.fromPort}" (${formatType(sourceType, c.source.tsType)}) on node "${c.fromNode}" cannot connect to STEP port "${c.toPort}" on node "${c.toNode}"`,
      connection: c.conn,
      location: c.location,
    });
    return true;
  }
  return sourceType === 'STEP' && targetType === 'STEP';
}

/** Coercing a function value is meaningless. True when it was reported. */
function checkCoerceOnFunction(ctx: ValidationContext, c: TypedConnection): boolean {
  const { coerce } = c.conn;
  if (!coerce || (c.source.dataType !== 'FUNCTION' && c.target.dataType !== 'FUNCTION')) return false;
  ctx.errors.push({
    type: 'error',
    code: 'COERCE_ON_FUNCTION_PORT',
    message: `Coercion \`as ${coerce}\` cannot be used on FUNCTION ports in connection "${c.fromNode}.${c.fromPort}" → "${c.toNode}.${c.toPort}". FUNCTION values cannot be meaningfully coerced.`,
    connection: c.conn,
    location: c.location,
  });
  return true;
}

/**
 * Same data type on both ends: a coercion is redundant, and two OBJECT ports
 * with different tsTypes may not share a shape. True when the types match.
 */
function checkSameType(ctx: ValidationContext, c: TypedConnection): boolean {
  const sourceType = c.source.dataType;
  if (sourceType !== c.target.dataType) return false;
  if (c.conn.coerce) {
    ctx.warnings.push({
      type: 'warning',
      code: 'REDUNDANT_COERCE',
      message: `Coercion \`as ${c.conn.coerce}\` on connection "${c.fromNode}.${c.fromPort}" → "${c.toNode}.${c.toPort}" is redundant because source and target are both ${sourceType}.`,
      connection: c.conn,
      location: c.location,
    });
    return true;
  }
  const sourceTs = c.source.tsType;
  const targetTs = c.target.tsType;
  if (sourceType === 'OBJECT' && sourceTs && targetTs && normalizeTypeString(sourceTs) !== normalizeTypeString(targetTs)) {
    // The string-based check suppresses false positives, as when one side is 'any'
    if (!checkTypeCompatibilityFromStrings(sourceTs, targetTs).isCompatible) {
      ctx.warnings.push({
        type: 'warning',
        code: 'OBJECT_TYPE_MISMATCH',
        message: `Structural type mismatch: ${c.fromNode}.${c.fromPort} outputs "${sourceTs}" but ${c.toNode}.${c.toPort} expects "${targetTs}". Verify the object shapes are compatible.`,
        connection: c.conn,
        location: c.location,
      });
    }
  }
  return true;
}

/** An explicit `as <type>` must produce the target's type. True when the connection has one. */
function checkExplicitCoerce(ctx: ValidationContext, strictTypes: boolean, c: TypedConnection): boolean {
  const { coerce } = c.conn;
  if (!coerce) return false;
  const producedType = COERCE_OUTPUT_TYPE[coerce];
  const targetType = c.target.dataType;
  if (producedType === targetType) return true;
  reportTypeIssue(ctx, strictTypes, {
    type: 'warning',
    code: 'COERCE_TYPE_MISMATCH',
    message: `Coercion \`as ${coerce}\` produces ${producedType} but target port "${c.toPort}" on "${c.toNode}" expects ${targetType}. Use \`as ${suggestCoerceType(targetType)}\` instead.`,
    connection: c.conn,
    location: c.location,
  });
  return true;
}

/** Classify an implicit conversion between two different, concrete types and report all but the safe ones. */
function checkImplicitCoercion(ctx: ValidationContext, strictTypes: boolean, c: TypedConnection): void {
  const sourceType = c.source.dataType;
  const targetType = c.target.dataType;
  const from = formatType(sourceType, c.source.tsType);
  const to = formatType(targetType, c.target.tsType);
  const route = `${c.fromNode}.${c.fromPort} → ${c.toNode}.${c.toPort}`;

  if (SAFE_COERCIONS.some(([s, t]) => sourceType === s && targetType === t)) return;

  const lossy = LOSSY_COERCIONS.find(([s, t]) => sourceType === s && targetType === t);
  if (lossy) {
    reportTypeIssue(ctx, strictTypes, {
      type: 'warning',
      code: 'LOSSY_TYPE_COERCION',
      message: `Lossy type coercion from ${from} to ${to} in connection ${route}. ${lossy[2]}. Add @strictTypes to your workflow annotation to enforce type safety.`,
      connection: c.conn,
      location: c.location,
    });
    return;
  }

  const unusual = UNUSUAL_COERCIONS.find(([s, t]) => sourceType === s && targetType === t);
  if (unusual) {
    reportTypeIssue(ctx, strictTypes, {
      type: 'warning',
      code: 'UNUSUAL_TYPE_COERCION',
      message: `Unusual type coercion from ${from} to ${to} in connection ${route}. ${unusual[2]}.`,
      connection: c.conn,
      location: c.location,
    });
    return;
  }

  reportTypeIssue(ctx, strictTypes, {
    type: 'warning',
    code: 'TYPE_MISMATCH',
    message: `Type mismatch in connection ${c.fromNode}.${c.fromPort} (${from}) → ${c.toNode}.${c.toPort} (${to}). Runtime coercion will be attempted.`,
    connection: c.conn,
    location: c.location,
  });
}

/**
 * Validate type compatibility for connections with coercion support.
 * See the module comment for the order of checks.
 */
export function validateTypeCompatibility(
  ctx: ValidationContext,
  workflow: TWorkflowAST,
  instanceMap: Map<string, TNodeTypeAST>
): void {
  const strictTypes = ctx.strictMode || workflow.options?.strictTypes === true;

  workflow.connections.forEach((conn) => {
    const c = resolveTypedConnection(conn, instanceMap);
    if (!c) return;
    if (checkStepPorts(ctx, c)) return;
    if (checkCoerceOnFunction(ctx, c)) return;
    if (checkSameType(ctx, c)) return;
    if (c.source.dataType === 'ANY' || c.target.dataType === 'ANY') return;
    if (checkExplicitCoerce(ctx, strictTypes, c)) return;
    checkImplicitCoercion(ctx, strictTypes, c);
  });
}
