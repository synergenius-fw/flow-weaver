import type { TMergeStrategy, TConnectionAST, TDataType } from '../ast';
import { COERCE_EXPRESSIONS, COERCE_TYPE_MAP } from '../built-in-nodes/coercion-types';

/**
 * Get the coercion expression to wrap a value, if coercion is needed.
 * Returns null if no coercion needed.
 *
 * Priority:
 * 1. Explicit coerce on the connection (from `as <type>` annotation)
 * 2. Auto-coercion for safe pairs:
 *    - anything -> STRING (String() never fails)
 *    - BOOLEAN -> NUMBER (well-defined: false->0, true->1)
 */
export function getCoercionWrapper(
  connection: TConnectionAST,
  sourceDataType: TDataType | undefined,
  targetDataType: TDataType | undefined,
): string | null {
  // Explicit coerce on connection: the same expression the coercion node type
  // for that target emits, so `as string` and `@coerce string` agree.
  if (connection.coerce) {
    return COERCE_EXPRESSIONS[COERCE_TYPE_MAP[connection.coerce]];
  }

  // No auto-coercion if types are unknown or same
  if (!sourceDataType || !targetDataType || sourceDataType === targetDataType) return null;

  // Skip STEP and ANY ports — no coercion needed
  if (sourceDataType === 'STEP' || targetDataType === 'STEP') return null;
  if (sourceDataType === 'ANY' || targetDataType === 'ANY') return null;

  // Auto-coerce: anything -> STRING
  if (targetDataType === 'STRING' && sourceDataType !== 'STRING') {
    return 'String';
  }

  // Auto-coerce: BOOLEAN -> NUMBER
  if (sourceDataType === 'BOOLEAN' && targetDataType === 'NUMBER') {
    return 'Number';
  }

  return null;
}

/**
 * Sanitize a node ID to be a valid JavaScript identifier.
 * Replaces non-alphanumeric characters (except _ and $) with underscores.
 *
 * @param nodeId - The node ID (may contain slashes, etc.)
 * @returns A valid JavaScript identifier
 */
export function toValidIdentifier(nodeId: string): string {
  // Replace any character that's not alphanumeric, underscore, or dollar sign
  let sanitized = nodeId.replace(/[^a-zA-Z0-9_$]/g, '_');
  // Ensure it doesn't start with a digit
  if (/^[0-9]/.test(sanitized)) {
    sanitized = '_' + sanitized;
  }
  return sanitized;
}

/**
 * Name the local that holds a node's call result.
 *
 * Normally `<nodeId>Result`, but that collides when a node's id plus "Result"
 * happens to equal the node type it calls -- e.g. `@node rec recResult` emits
 * `const recResult = recResult(...)`, whose `const` puts the function in the
 * temporal dead zone and throws "Cannot access 'recResult' before
 * initialization" at run time. Suffix the local in that case so it can never
 * shadow the callee.
 *
 * @param safeNodeName - The node id, already a valid identifier
 * @param functionName - The node type function this local's initializer calls
 */
export function nodeResultVar(safeNodeName: string, functionName: string): string {
  const candidate = `${safeNodeName}Result`;
  return candidate === functionName ? `${candidate}_` : candidate;
}

/**
 * Build a JavaScript expression that merges multiple source values based on strategy.
 *
 * @param sources - Array of source variable names
 * @param strategy - Merge strategy to apply
 * @returns JavaScript expression string
 */
export function buildMergeExpression(sources: string[], strategy: TMergeStrategy): string {
  switch (strategy) {
    case 'FIRST':
      return `[${sources.join(', ')}].find(v => v !== undefined)`;
    case 'LAST':
      return `[${sources.join(', ')}].filter(v => v !== undefined).pop()`;
    case 'COLLECT':
      return `[${sources.join(', ')}]`;
    case 'MERGE':
      return `Object.assign({}, ${sources.join(', ')})`;
    case 'CONCAT':
      return `[${sources.join(', ')}].flat()`;
    default:
      return sources[0] ?? 'undefined';
  }
}
