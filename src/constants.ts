/**
 * # Flow Weaver Constants
 *
 * This module defines reserved names and constants used throughout the Flow Weaver system.
 *
 * ## Scoped Port Architecture
 *
 * Scoped ports enable iteration patterns (forEach, map) WITHOUT graph cycles.
 * The key insight is that port directions are INVERTED for scoped ports:
 *
 * ```
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │                    SCOPED PORT DIRECTION MAPPING                    │
 * ├─────────────────┬──────────┬────────────────────────────────────────┤
 * │ Scoped OUTPUT   │ Parent→  │ Parameters TO children (start, item)   │
 * │ Scoped INPUT    │ →Parent  │ Returns FROM children (success, result)│
 * └─────────────────┴──────────┴────────────────────────────────────────┘
 * ```
 *
 * **Why this inversion?**
 * - Scoped OUTPUT ports (like `start`, `item`) are data the parent SENDS to nested nodes
 * - Scoped INPUT ports (like `success`, `result`) are data the parent RECEIVES from nested nodes
 * - The loop iteration happens in the parent's imperative code, not as graph cycles
 *
 * ## Mandatory Scoped Ports
 *
 * Every scoped node must have these ports for each scope it declares:
 * - `start` (OUTPUT) - Triggers scope execution, passed as first param
 * - `success` (INPUT) - Signals successful completion from child
 * - `failure` (INPUT) - Signals failure from child
 *
 * ## Example: forEach Node
 *
 * ```typescript
 * @scope processItem
 * @output start scope:processItem    // OUTPUT → function param (triggers iteration)
 * @output item scope:processItem     // OUTPUT → function param (current item)
 * @input success scope:processItem   // INPUT → return value (completion signal)
 * @input processed scope:processItem // INPUT → return value (processed data)
 *
 * function forEach(execute, items, processItem) {
 *   const results = [];
 *   for (const item of items) {
 *     const r = processItem(true, item); // Calls generated closure
 *     if (r.success) results.push(r.processed);
 *   }
 *   return { onSuccess: true, results };
 * }
 * ```
 */

export const RESERVED_NODE_NAMES = {
  START: "Start",
  EXIT: "Exit",
} as const;

export const RESERVED_PORT_NAMES = {
  EXECUTE: "execute",
  ON_SUCCESS: "onSuccess",
  ON_FAILURE: "onFailure",
} as const;

// Scoped mandatory ports (different from external)
export const SCOPED_PORT_NAMES = {
  START: "start",       // OUTPUT - starts scope iteration
  SUCCESS: "success",   // INPUT - success signal from scope
  FAILURE: "failure",   // INPUT - failure signal from scope
} as const;

export const EXECUTION_STRATEGIES = {
  CONJUNCTION: "CONJUNCTION",
  DISJUNCTION: "DISJUNCTION",
  CUSTOM: "CUSTOM",
} as const;

export const BRANCHING_STRATEGIES = {
  VALUE_BASED: "value-based",
  EXCEPTION_BASED: "exception-based",
  NONE: "none",
} as const;

export type ReservedNodeName =
  (typeof RESERVED_NODE_NAMES)[keyof typeof RESERVED_NODE_NAMES];
export type ReservedPortName =
  (typeof RESERVED_PORT_NAMES)[keyof typeof RESERVED_PORT_NAMES];
export type ExecutionStrategy =
  (typeof EXECUTION_STRATEGIES)[keyof typeof EXECUTION_STRATEGIES];
export type BranchingStrategyType =
  (typeof BRANCHING_STRATEGIES)[keyof typeof BRANCHING_STRATEGIES];

export function isReservedNodeName(name: string): name is ReservedNodeName {
  return (Object.values(RESERVED_NODE_NAMES) as string[]).includes(name);
}

export function isReservedPortName(name: string): name is ReservedPortName {
  return (Object.values(RESERVED_PORT_NAMES) as string[]).includes(name);
}

export function isStartNode(nodeName: string): boolean {
  return nodeName === RESERVED_NODE_NAMES.START;
}

export function isExitNode(nodeName: string): boolean {
  return nodeName === RESERVED_NODE_NAMES.EXIT;
}

export function isSpecialNode(nodeName: string): boolean {
  return isStartNode(nodeName) || isExitNode(nodeName);
}

export function isExecutePort(portName: string): boolean {
  return portName === RESERVED_PORT_NAMES.EXECUTE;
}

export function isSuccessPort(portName: string): boolean {
  return portName === RESERVED_PORT_NAMES.ON_SUCCESS;
}

export function isFailurePort(portName: string): boolean {
  return portName === RESERVED_PORT_NAMES.ON_FAILURE;
}

// Scoped port checks
export function isScopedStartPort(portName: string): boolean {
  return portName === SCOPED_PORT_NAMES.START;
}

export function isScopedSuccessPort(portName: string): boolean {
  return portName === SCOPED_PORT_NAMES.SUCCESS;
}

export function isScopedFailurePort(portName: string): boolean {
  return portName === SCOPED_PORT_NAMES.FAILURE;
}

export function isScopedMandatoryPort(portName: string): boolean {
  return isScopedStartPort(portName) || isScopedSuccessPort(portName) || isScopedFailurePort(portName);
}

export function isControlFlowPort(portName: string): boolean {
  return (
    isExecutePort(portName) ||
    isSuccessPort(portName) ||
    isFailurePort(portName)
  );
}

/**
 * Check if a port definition represents a scoped port
 * Scoped ports are FUNCTION type with a scope attribute
 */
export function isScopedPort(portDef: { dataType: string; scope?: string }): boolean {
  return portDef.dataType === "FUNCTION" && portDef.scope !== undefined;
}

// ── Valid annotation values ───────────────────────────────────────────

export const VALID_NODE_COLORS = [
  'blue', 'purple', 'cyan', 'orange', 'pink', 'green', 'red', 'yellow', 'teal',
] as const;

export type ValidNodeColor = (typeof VALID_NODE_COLORS)[number];

// ── Known annotation tags per block type ──────────────────────────────

export const KNOWN_NODETYPE_TAGS = new Set([
  'flowWeaver', 'name', 'label', 'description', 'color', 'icon', 'tag',
  'executeWhen', 'scope', 'expression', 'pullExecution', 'input', 'output', 'step',
]);

export const KNOWN_WORKFLOW_TAGS = new Set([
  'flowWeaver', 'name', 'fwImport', 'description', 'strictTypes', 'autoConnect',
  'node', 'position', 'connect', 'scope', 'map', 'path', 'fanOut', 'fanIn',
  'coerce', 'trigger', 'cancelOn', 'retries', 'timeout', 'throttle', 'param',
  'return', 'returns',
]);

export const KNOWN_PATTERN_TAGS = new Set([
  'flowWeaver', 'name', 'description', 'node', 'position', 'connect', 'port',
]);

export const STANDARD_JSDOC_TAGS = new Set([
  'example', 'see', 'deprecated', 'type', 'typedef', 'template',
  'link', 'since', 'version', 'author',
]);
