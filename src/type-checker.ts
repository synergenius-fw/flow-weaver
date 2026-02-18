/**
 * Type Checker Module
 *
 * Provides TypeScript-level type compatibility checking using ts-morph and TypeScript's compiler API.
 * This enables proper structural typing and subtype checking beyond simple string comparison.
 */

import type { Type, TypeChecker } from "ts-morph";
import type { TypeChecker as TSTypeChecker } from "typescript";
import type { TTypeCompatibility } from "./ast/types";

/**
 * Safe runtime coercions that JavaScript handles automatically.
 * These are source -> target pairs where coercion is safe and predictable.
 */
const SAFE_COERCIONS: [string, string][] = [
  ["number", "string"],   // Number.toString()
  ["boolean", "string"],  // Boolean.toString()
];

/**
 * Check if a source type can be safely coerced to a target type at runtime.
 *
 * @param sourceText - The source type as a string
 * @param targetText - The target type as a string
 * @returns true if the coercion is safe
 */
export function isRuntimeCoercible(sourceText: string, targetText: string): boolean {
  const sourceLower = sourceText.toLowerCase();
  const targetLower = targetText.toLowerCase();

  for (const [from, to] of SAFE_COERCIONS) {
    if (sourceLower === from && targetLower === to) {
      return true;
    }
  }

  return false;
}

/**
 * Check type compatibility between two ts-morph Type objects.
 *
 * This uses TypeScript's actual type system for proper structural typing:
 * - Structural typing (duck typing)
 * - Inheritance (Admin extends User)
 * - Generics (Array<T>, Promise<T>)
 * - Union/Intersection types
 * - Type narrowing
 *
 * @param sourceType - The source type (from output port)
 * @param targetType - The target type (from input port)
 * @param typeChecker - Optional ts-morph TypeChecker for advanced assignability checks
 * @returns TTypeCompatibility result
 */
export function checkTypeCompatibility(
  sourceType: Type,
  targetType: Type,
  typeChecker?: TypeChecker
): TTypeCompatibility {
  const sourceText = sourceType.getText();
  const targetText = targetType.getText();

  // Exact string match - fastest path
  if (sourceText === targetText) {
    return {
      isCompatible: true,
      reason: "exact",
      sourceType: sourceText,
      targetType: targetText,
    };
  }

  // Try TypeScript's native assignability check if typeChecker is available
  if (typeChecker) {
    // Access the internal TypeScript compiler's type checker
    const tsTypeChecker = typeChecker.compilerObject as unknown as TSTypeChecker & {
      isTypeAssignableTo?: (source: unknown, target: unknown) => boolean;
    };

    if (tsTypeChecker.isTypeAssignableTo) {
      const isAssignable = tsTypeChecker.isTypeAssignableTo(
        sourceType.compilerType,
        targetType.compilerType
      );

      if (isAssignable) {
        return {
          isCompatible: true,
          reason: "assignable",
          sourceType: sourceText,
          targetType: targetText,
        };
      }
    }
  }

  // Fallback: Check inheritance via base types
  if (isSubtypeViaBaseTypes(sourceType, targetType)) {
    return {
      isCompatible: true,
      reason: "assignable",
      sourceType: sourceText,
      targetType: targetText,
    };
  }

  // Check for safe runtime coercions (NUMBER→STRING, BOOLEAN→STRING)
  if (isRuntimeCoercible(sourceText, targetText)) {
    return {
      isCompatible: true,
      reason: "coercible",
      sourceType: sourceText,
      targetType: targetText,
    };
  }

  // Types are incompatible
  return {
    isCompatible: false,
    reason: "incompatible",
    sourceType: sourceText,
    targetType: targetText,
    errorMessage: `Type '${sourceText}' is not assignable to type '${targetText}'`,
  };
}

/**
 * Check if sourceType is a subtype of targetType via inheritance chain.
 * Uses getBaseTypes() to traverse the type hierarchy.
 */
function isSubtypeViaBaseTypes(sourceType: Type, targetType: Type): boolean {
  const targetText = targetType.getText();
  const visited = new Set<string>();

  function checkBaseTypes(type: Type): boolean {
    const typeText = type.getText();

    // Avoid infinite loops
    if (visited.has(typeText)) return false;
    visited.add(typeText);

    // Check if this type matches target
    if (typeText === targetText) return true;

    // Check base types recursively
    try {
      const baseTypes = type.getBaseTypes();
      for (const baseType of baseTypes) {
        if (checkBaseTypes(baseType)) return true;
      }
    } catch {
      // Some types don't have base types
    }

    return false;
  }

  // Check if source's base types include target
  try {
    const baseTypes = sourceType.getBaseTypes();
    for (const baseType of baseTypes) {
      if (checkBaseTypes(baseType)) return true;
    }
  } catch {
    // Some types don't have base types
  }

  return false;
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
