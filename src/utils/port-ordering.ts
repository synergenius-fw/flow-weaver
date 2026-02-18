/**
 * Shared port ordering utilities
 * Extracted from parser.ts for reuse across the codebase
 */

import type { TPortDefinition } from "../ast/types";
import { isExecutePort, isSuccessPort, isFailurePort, isScopedMandatoryPort } from "../constants";

/**
 * Check if a port is mandatory.
 * External ports: execute, onSuccess, onFailure
 * Scoped ports: start, success, failure
 */
export function isMandatoryPort(portName: string, isScoped: boolean): boolean {
  if (isScoped) {
    return isScopedMandatoryPort(portName);
  }
  return isExecutePort(portName) || isSuccessPort(portName) || isFailurePort(portName);
}

/**
 * Assign implicit port orders with mandatory port precedence.
 *
 * Rules:
 * 1. Ports are grouped by scope (undefined = external, string = scoped)
 * 2. Within each scope group:
 *    - Mandatory ports (execute, onSuccess, onFailure) get lower order values
 *    - Regular ports get higher order values
 * 3. Explicit order metadata is always preserved
 * 4. If a regular port has explicit order 0, mandatory ports are pushed to order >= 1
 *
 * @param ports - Record of port definitions to process (mutated in place)
 */
export function assignImplicitPortOrders(ports: Record<string, TPortDefinition>): void {
  // Group ports by scope
  const scopeGroups = new Map<string | undefined, Array<[string, TPortDefinition]>>();

  for (const [portName, portDef] of Object.entries(ports)) {
    const scopeKey = portDef.scope;
    if (!scopeGroups.has(scopeKey)) {
      scopeGroups.set(scopeKey, []);
    }
    scopeGroups.get(scopeKey)!.push([portName, portDef]);
  }

  // Process each scope group independently
  for (const [scope, portsInScope] of scopeGroups.entries()) {
    const isScoped = scope !== undefined;
    // Separate mandatory from regular ports
    const mandatoryPorts = portsInScope.filter(([name]) => isMandatoryPort(name, isScoped));
    const regularPorts = portsInScope.filter(([name]) => !isMandatoryPort(name, isScoped));

    // Find minimum explicit order among regular ports (if any)
    let minRegularExplicitOrder = Infinity;
    for (const [, portDef] of regularPorts) {
      const order = portDef.metadata?.order;
      if (typeof order === "number") {
        minRegularExplicitOrder = Math.min(minRegularExplicitOrder, order);
      }
    }

    // Determine starting order for mandatory ports
    let mandatoryStartOrder = 0;

    // If a regular port has explicit order 0 (or any low value),
    // mandatory ports should be pushed after it
    if (minRegularExplicitOrder !== Infinity && minRegularExplicitOrder === 0) {
      // Count how many regular ports have explicit order 0
      const regularPortsWithOrder0 = regularPorts.filter(([, p]) => p.metadata?.order === 0);
      mandatoryStartOrder = regularPortsWithOrder0.length;
    }

    // Assign orders to mandatory ports (if they don't have explicit order)
    let currentMandatoryOrder = mandatoryStartOrder;
    for (const [, portDef] of mandatoryPorts) {
      if (portDef.metadata?.order === undefined) {
        // Assign implicit order
        if (!portDef.metadata) {
          portDef.metadata = {};
        }
        portDef.metadata.order = currentMandatoryOrder++;
      }
    }

    // Assign orders to regular ports (if they don't have explicit order)
    // Regular ports start after mandatory ports
    let currentRegularOrder = currentMandatoryOrder;
    for (const [, portDef] of regularPorts) {
      if (portDef.metadata?.order === undefined) {
        // Assign implicit order
        if (!portDef.metadata) {
          portDef.metadata = {};
        }
        portDef.metadata.order = currentRegularOrder++;
      }
    }
  }
}
