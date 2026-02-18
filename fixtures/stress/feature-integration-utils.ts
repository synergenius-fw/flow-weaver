/**
 * Feature Integration Test - External Utilities
 *
 * This file contains nodes that will be imported by the main workflow,
 * demonstrating external dependency support (Phase 11).
 */

/**
 * FEATURE TEST: External dependencies, Node metadata, Value-based branching
 *
 * Validates user data and determines if processing should continue.
 * Demonstrates:
 * - Node metadata (label, description, color)
 * - Value-based branching (isValid field)
 * - Success/failure ports
 *
 * @flowWeaver nodeType
 * @label User Validator
 * @description Validates user data - checks userId is not empty and age is valid (0-150)
 * @color #4CAF50
 * @input userId
 * @input age
 * @output userId
 * @output age
 * @output isValid
 */
export function validateUser(execute: boolean, userId: string, age: number) {
  if (!execute) return { onSuccess: false, onFailure: false, userId: '', age: 0, isValid: false };
  const isValid = !!(userId && userId.length > 0 && age > 0 && age < 150);
  return { onSuccess: isValid, onFailure: !isValid, userId, age, isValid };
}
