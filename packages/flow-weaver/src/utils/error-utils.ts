/**
 * Utility functions for consistent error handling across the codebase.
 * Replaces 60+ occurrences of: error instanceof Error ? error.message : String(error)
 */

/**
 * Extracts a string message from any error value.
 * Handles Error instances, strings, numbers, null, undefined, and objects.
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * Wraps an error with additional context, preserving the original error as cause.
 * Useful for adding context while propagating errors up the call stack.
 */
export function wrapError(error: unknown, context: string): Error {
  const message = `${context}: ${getErrorMessage(error)}`;
  const wrapped = new Error(message);
  if (error instanceof Error) {
    (wrapped as Error & { cause?: unknown }).cause = error;
  }
  return wrapped;
}
