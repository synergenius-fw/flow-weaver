/**
 * @module jsdoc-port-sync/scoped-ports
 *
 * Decides which scopes a node type declares and makes sure each one has its
 * mandatory STEP ports: a `start` output and `success` / `failure` inputs.
 */

import type { TPortDefinition } from "../ast/types";
import { SCOPED_PORT_NAMES } from "../constants";
import { JSDOC_BLOCK_REGEX, SCOPE_TAG_REGEX } from "./constants";

type PortRecord = Record<string, TPortDefinition>;

/**
 * The scopes a node declares: every `@scope` tag in its JSDoc, plus any
 * per-port `scope:name` whose name matches a callback parameter (confirming it
 * is a real scope, not just a labeled port).
 */
export function collectDeclaredScopes(
  functionText: string,
  inputs: PortRecord,
  outputs: PortRecord,
  callbackNames: ReadonlyMap<string, unknown>
): Set<string> {
  const declaredScopes = new Set<string>();

  const jsdocMatch = functionText.match(JSDOC_BLOCK_REGEX);
  if (jsdocMatch) {
    const jsdoc = jsdocMatch[0];
    SCOPE_TAG_REGEX.lastIndex = 0;
    let scopeMatch;
    while ((scopeMatch = SCOPE_TAG_REGEX.exec(jsdoc)) != null) {
      declaredScopes.add(scopeMatch[1]);
    }
  }

  for (const port of Object.values(inputs)) {
    if (port.scope && callbackNames.has(port.scope)) declaredScopes.add(port.scope);
  }
  for (const port of Object.values(outputs)) {
    if (port.scope && callbackNames.has(port.scope)) declaredScopes.add(port.scope);
  }

  return declaredScopes;
}

/** Whether a port with this (real) name already exists for this scope. */
function hasPortForScope(ports: PortRecord, portName: string, scope: string): boolean {
  return Object.entries(ports).some(
    ([name, port]) => (name === portName || port._realName === portName) && port.scope === scope
  );
}

/**
 * Add one mandatory STEP port for a scope unless it exists. Port records are
 * keyed by name, so when another scope already holds the base key the port is
 * stored under `name\0scope` and carries its real name in `_realName`, which
 * generateJSDocPortTag uses.
 */
function addMandatoryPort(
  ports: PortRecord,
  portName: string,
  scope: string,
  extra?: Partial<TPortDefinition>
): void {
  if (hasPortForScope(ports, portName, scope)) return;
  const key = !ports[portName] || ports[portName].scope === scope
    ? portName
    : `${portName}\0${scope}`;
  ports[key] = {
    dataType: "STEP",
    scope,
    ...(key !== portName && { _realName: portName }),
    ...extra,
  };
}

/**
 * Add the mandatory ports of every scope to the given records, in place:
 * `start` to the outputs, `success` and `failure` (marked as failure) to the inputs.
 */
export function addMandatoryScopedPorts(inputs: PortRecord, outputs: PortRecord, scopes: Iterable<string>): void {
  for (const scopeName of scopes) {
    addMandatoryPort(outputs, SCOPED_PORT_NAMES.START, scopeName);
    addMandatoryPort(inputs, SCOPED_PORT_NAMES.SUCCESS, scopeName);
    addMandatoryPort(inputs, SCOPED_PORT_NAMES.FAILURE, scopeName, { failure: true });
  }
}
