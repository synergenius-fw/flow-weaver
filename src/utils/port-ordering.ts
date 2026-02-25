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
 * 2. Explicit order metadata is always preserved
 * 3. Mandatory ports without explicit orders get negative slots (-N, ..., -1)
 *    so they always sort before any user-specified [order:0] data port
 * 4. Regular ports without explicit orders fill non-negative slots (0+),
 *    skipping any slots already occupied by explicit orders
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

    // Collect all explicitly occupied order slots
    const occupied = new Set<number>();
    for (const [, portDef] of portsInScope) {
      const order = portDef.metadata?.order;
      if (typeof order === "number") {
        occupied.add(order);
      }
    }

    // Helper: find next available slot starting from `from`
    function nextSlot(from: number): number {
      while (occupied.has(from)) from++;
      occupied.add(from);
      return from;
    }

    // Separate mandatory from regular ports (only those needing implicit orders)
    const mandatoryNeedOrder = portsInScope.filter(
      ([name, def]) => isMandatoryPort(name, isScoped) && def.metadata?.order === undefined
    );
    const regularNeedOrder = portsInScope.filter(
      ([name, def]) => !isMandatoryPort(name, isScoped) && def.metadata?.order === undefined
    );

    // Mandatory ports fill negative slots so they always sort before [order:0] data ports
    let slot = -mandatoryNeedOrder.length;
    for (const [, portDef] of mandatoryNeedOrder) {
      if (!portDef.metadata) portDef.metadata = {};
      slot = nextSlot(slot);
      portDef.metadata.order = slot;
      slot++;
    }

    // Regular ports fill non-negative slots, skipping occupied ones
    slot = Math.max(slot, 0);
    for (const [, portDef] of regularNeedOrder) {
      if (!portDef.metadata) portDef.metadata = {};
      slot = nextSlot(slot);
      portDef.metadata.order = slot;
      slot++;
    }
  }
}
