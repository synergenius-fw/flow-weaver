/**
 * Branded Port Types
 *
 * Provides compile-time type safety for port handling using TypeScript's
 * branded types pattern. Prevents accidental mixing of port categories.
 *
 * Categories:
 * - MandatoryPort: Reserved ports (execute, onSuccess, onFailure, start, success, failure)
 * - ScopedPort: Ports belonging to a scope (forEach, map, etc.)
 * - RegularPort: All other ports
 */

import type { TPortDefinition } from '../ast/types';

// =============================================================================
// Port Name Constants
// =============================================================================

/**
 * Reserved port name constants.
 * Use these instead of magic strings.
 */
export const PortName = {
  // External mandatory ports
  EXECUTE: 'execute',
  ON_SUCCESS: 'onSuccess',
  ON_FAILURE: 'onFailure',

  // Scoped mandatory ports
  START: 'start',
  SUCCESS: 'success',
  FAILURE: 'failure',
} as const;

export type PortNameType = (typeof PortName)[keyof typeof PortName];

/**
 * External mandatory port names.
 */
export const EXTERNAL_MANDATORY_PORTS = [
  PortName.EXECUTE,
  PortName.ON_SUCCESS,
  PortName.ON_FAILURE,
] as const;

/**
 * Scoped mandatory port names.
 */
export const SCOPED_MANDATORY_PORTS = [
  PortName.START,
  PortName.SUCCESS,
  PortName.FAILURE,
] as const;

// =============================================================================
// Branded Types
// =============================================================================

/**
 * Brand symbol for MandatoryPort.
 */
declare const MandatoryPortBrand: unique symbol;

/**
 * Brand symbol for ScopedPort.
 */
declare const ScopedPortBrand: unique symbol;

/**
 * Brand symbol for RegularPort.
 */
declare const RegularPortBrand: unique symbol;

/**
 * A mandatory port (execute, onSuccess, onFailure, or scoped equivalents).
 * Cannot be assigned from RegularPort.
 */
export type MandatoryPort = TPortDefinition & {
  readonly [MandatoryPortBrand]: never;
};

/**
 * A scoped port (has a scope property).
 * Enforces that scope is defined.
 */
export type ScopedPort = TPortDefinition & {
  readonly scope: string;
  readonly [ScopedPortBrand]: never;
};

/**
 * A regular port (not mandatory, not scoped).
 */
export type RegularPort = TPortDefinition & {
  readonly [RegularPortBrand]: never;
};

/**
 * Union of all branded port types.
 */
export type BrandedPort = MandatoryPort | ScopedPort | RegularPort;

/**
 * Named port with brand information.
 */
export interface NamedMandatoryPort {
  name: string;
  port: MandatoryPort;
}

/**
 * Named scoped port.
 */
export interface NamedScopedPort {
  name: string;
  port: ScopedPort;
  scope: string;
}

/**
 * Named regular port.
 */
export interface NamedRegularPort {
  name: string;
  port: RegularPort;
}

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Type guard to check if a port is mandatory.
 * Works for both external (execute, onSuccess, onFailure) and scoped (start, success, failure).
 */
export function isMandatoryPort(
  name: string,
  port: TPortDefinition
): port is MandatoryPort {
  const isScoped = port.scope !== undefined;

  if (isScoped) {
    return (SCOPED_MANDATORY_PORTS as readonly string[]).includes(name);
  }

  return (EXTERNAL_MANDATORY_PORTS as readonly string[]).includes(name);
}

/**
 * Type guard to check if a port is scoped.
 */
export function isScopedPort(
  port: TPortDefinition | undefined
): port is ScopedPort {
  return port !== undefined && typeof port.scope === 'string';
}

/**
 * Type guard to check if a port is regular (not mandatory).
 */
export function isRegularPort(
  name: string,
  port: TPortDefinition
): port is RegularPort {
  return !isMandatoryPort(name, port);
}

// =============================================================================
// Assertion Functions
// =============================================================================

/**
 * Assert that a port is mandatory and return typed version.
 * @throws Error if port is not mandatory
 */
export function toMandatoryPort(
  name: string,
  port: TPortDefinition
): NamedMandatoryPort {
  if (!isMandatoryPort(name, port)) {
    throw new Error(`"${name}" is not a mandatory port`);
  }
  return { name, port: port as MandatoryPort };
}

/**
 * Assert that a port is scoped and return typed version.
 * @throws Error if port is not scoped
 */
export function toScopedPort(port: TPortDefinition): ScopedPort {
  if (!isScopedPort(port)) {
    throw new Error(`Port is not a scoped port (no scope property)`);
  }
  return port as ScopedPort;
}

// =============================================================================
// Ordered Ports
// =============================================================================

/**
 * Entry in an ordered port list.
 */
export interface OrderedPortEntry<T extends TPortDefinition = TPortDefinition> {
  name: string;
  port: T;
  order: number;
}

/**
 * Array of ports with ordering information.
 */
export type OrderedPorts<T extends TPortDefinition = TPortDefinition> = OrderedPortEntry<T>[];

/**
 * Get the order value from a port's metadata.
 * Returns Infinity if no order is set.
 */
export function getPortOrder(port: TPortDefinition): number {
  const order = port.metadata?.order;
  return typeof order === 'number' ? order : Infinity;
}

/**
 * Create an ordered port list from a port record.
 * Sorts by metadata.order, with unordered ports at the end.
 */
export function createOrderedPorts<T extends TPortDefinition>(
  ports: Record<string, T>
): OrderedPorts<T> {
  const entries: OrderedPorts<T> = Object.entries(ports).map(([name, port]) => ({
    name,
    port,
    order: getPortOrder(port),
  }));

  // Sort by order (lower first), then by name for stable sort
  entries.sort((a, b) => {
    if (a.order !== b.order) {
      return a.order - b.order;
    }
    return a.name.localeCompare(b.name);
  });

  return entries;
}

// =============================================================================
// Utility Types
// =============================================================================

/**
 * Extract mandatory ports from a port record.
 */
export type ExtractMandatoryPorts<T extends Record<string, TPortDefinition>> = {
  [K in keyof T as K extends 'execute' | 'onSuccess' | 'onFailure' | 'start' | 'success' | 'failure'
    ? K
    : never]: T[K];
};

/**
 * Extract regular (non-mandatory) ports from a port record.
 */
export type ExtractRegularPorts<T extends Record<string, TPortDefinition>> = {
  [K in keyof T as K extends 'execute' | 'onSuccess' | 'onFailure' | 'start' | 'success' | 'failure'
    ? never
    : K]: T[K];
};
