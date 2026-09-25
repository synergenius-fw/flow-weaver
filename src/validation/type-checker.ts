/**
 * Type Checker Module
 *
 * String-based type compatibility checking for port connections. Ports carry
 * their TypeScript type as text (the AST is serialisable), so the checks here
 * work on that text.
 */

import type { TTypeCompatibility } from "../ast/types";

/**
 * Safe runtime coercions that JavaScript handles automatically, as
 * source -> target data type pairs. A connection between these types needs no
 * warning: Number.toString() and Boolean.toString() are predictable.
 */
export const SAFE_COERCIONS: ReadonlyArray<readonly [string, string]> = [
  ["NUMBER", "STRING"],
  ["BOOLEAN", "STRING"],
];

/**
 * Check if a source type can be safely coerced to a target type at runtime.
 * Accepts data types (`NUMBER`) and TypeScript primitives (`number`) alike.
 *
 * @param sourceText - The source type as a string
 * @param targetText - The target type as a string
 * @returns true if the coercion is safe
 */
export function isRuntimeCoercible(sourceText: string, targetText: string): boolean {
  const sourceUpper = sourceText.toUpperCase();
  const targetUpper = targetText.toUpperCase();

  for (const [from, to] of SAFE_COERCIONS) {
    if (sourceUpper === from && targetUpper === to) {
      return true;
    }
  }

  return false;
}

const OPAQUE_OBJECT_TYPES = new Set([
  "object",
  "{}",
  "Record<string,unknown>",
  "Record<string,any>",
  "{[key:string]:unknown}",
  "{[key:string]:any}",
  "{[k:string]:unknown}",
  "{[k:string]:any}",
]);

/**
 * True for a type text that names "some object" without describing its shape.
 * Whitespace is ignored so `Record<string, unknown>` and `Record<string,unknown>`
 * are the same type.
 */
export function isOpaqueObjectType(typeText: string): boolean {
  return OPAQUE_OBJECT_TYPES.has(typeText.replace(/\s+/g, ""));
}

/**
 * Check type compatibility using string representations.
 * Fallback for JSON-loaded workflows without ts-morph Type objects.
 *
 * @param sourceText - The source type as a string
 * @param targetText - The target type as a string
 * @returns TTypeCompatibility result
 */
export function checkTypeCompatibilityFromStrings(
  sourceText: string,
  targetText: string
): TTypeCompatibility {
  // Exact string match
  if (sourceText === targetText) {
    return {
      isCompatible: true,
      reason: "exact",
      sourceType: sourceText,
      targetType: targetText,
    };
  }

  // any is compatible with everything
  if (sourceText === "any" || targetText === "any") {
    return {
      isCompatible: true,
      reason: "assignable",
      sourceType: sourceText,
      targetType: targetText,
    };
  }

  // An opaque object type on either side (`object`, `Record<string, unknown>`,
  // `{}`, ...) says nothing about shape, so a structural mismatch cannot be
  // claimed. `unknown` accepts anything as a target.
  if (
    isOpaqueObjectType(sourceText) ||
    isOpaqueObjectType(targetText) ||
    targetText.trim() === "unknown"
  ) {
    return {
      isCompatible: true,
      reason: "assignable",
      sourceType: sourceText,
      targetType: targetText,
    };
  }

  // Check for safe runtime coercions
  if (isRuntimeCoercible(sourceText, targetText)) {
    return {
      isCompatible: true,
      reason: "coercible",
      sourceType: sourceText,
      targetType: targetText,
    };
  }

  // String comparison can't determine structural compatibility
  // Mark as incompatible, but the validator may want to be lenient
  return {
    isCompatible: false,
    reason: "incompatible",
    sourceType: sourceText,
    targetType: targetText,
    errorMessage: `Type '${sourceText}' is not assignable to type '${targetText}'`,
  };
}
