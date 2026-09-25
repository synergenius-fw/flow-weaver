/**
 * Port reference helpers.
 *
 * Pure functions over TPortReference with no dependency on validation, so the
 * query layer can compare references without importing the manipulation
 * helpers (which validate, and validation reads the query layer).
 */

import type { TPortReference } from "../ast/types";

/**
 * Validates and normalizes port reference format
 * Accepts either string format ("nodeId.portName") or object format ({ node, port })
 *
 * @param ref - Port reference to validate
 * @returns Validated TPortReference object
 * @throws {Error} If format is invalid
 *
 * @example
 * ```typescript
 * // String format
 * const ref1 = validatePortReference("processor1.input");
 * // Returns: { node: "processor1", port: "input" }
 *
 * // Object format
 * const ref2 = validatePortReference({ node: "processor1", port: "input" });
 * // Returns: { node: "processor1", port: "input" }
 *
 * // Invalid format throws error
 * validatePortReference("invalid"); // Throws: Invalid port reference format
 * ```
 */
export function validatePortReference(
  ref: string | TPortReference,
): TPortReference {
  if (typeof ref === "string") {
    const parts = ref.split(".");
    if (parts.length !== 2) {
      throw new Error(
        `Invalid port reference format: "${ref}". Expected "nodeId.portName"`,
      );
    }
    return { node: parts[0], port: parts[1] };
  }

  if (!ref.node || !ref.port) {
    throw new Error(
      `Invalid port reference: missing node or port property`,
    );
  }

  return ref;
}

/**
 * Checks if two port references point to the same port
 * Compares both node ID and port name for equality
 *
 * @param a - First port reference
 * @param b - Second port reference
 * @returns True if both references point to the same port
 *
 * @example
 * ```typescript
 * const ref1 = { node: "processor1", port: "input" };
 * const ref2 = { node: "processor1", port: "input" };
 * const ref3 = { node: "processor1", port: "output" };
 *
 * portReferencesEqual(ref1, ref2); // true
 * portReferencesEqual(ref1, ref3); // false
 * ```
 */
export function portReferencesEqual(
  a: TPortReference,
  b: TPortReference,
): boolean {
  // Include scope in comparison - scoped ports are different from non-scoped ports
  return a.node === b.node && a.port === b.port && (a.scope ?? null) === (b.scope ?? null);
}

/**
 * Formats a port reference object as a string
 * Converts { node, port } to "node.port" format
 *
 * @param ref - Port reference to format
 * @returns String representation in "node.port" format
 *
 * @example
 * ```typescript
 * const ref = { node: "processor1", port: "input" };
 * const str = formatPortReference(ref);
 * // Returns: "processor1.input"
 * ```
 */
export function formatPortReference(ref: TPortReference): string {
  return `${ref.node}.${ref.port}`;
}
