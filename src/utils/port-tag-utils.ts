/**
 * Port tag validation utilities
 * Shared logic for determining port tag types (@input, @output, @step)
 */

import type { TPortDefinition } from "../ast/types";
import { isExecutePort, isSuccessPort, isFailurePort, isScopedMandatoryPort } from "../constants";

/**
 * Check if a port name is a reserved STEP port.
 * Includes both external (execute, onSuccess, onFailure) and scoped (start, success, failure).
 */
export function isReservedStepPort(name: string): boolean {
  return isExecutePort(name) || isSuccessPort(name) || isFailurePort(name) || isScopedMandatoryPort(name);
}

/**
 * Determine if a port should use the @step tag.
 * Returns true only for custom STEP ports (not reserved ones).
 */
export function shouldUseStepTag(portName: string, port: TPortDefinition): boolean {
  if (port.dataType !== "STEP") return false;

  // Reserved STEP ports use @input/@output, not @step
  const isExternalReserved = isExecutePort(portName) || isSuccessPort(portName) || isFailurePort(portName);
  if (isExternalReserved) return false;

  // Scoped mandatory ports also use @input/@output
  if (port.scope && isScopedMandatoryPort(portName)) return false;

  return true;
}

/**
 * Get the JSDoc tag type for a port.
 * - Custom STEP ports → "step"
 * - Reserved STEP ports → direction ("input" or "output")
 * - Data ports → direction ("input" or "output")
 */
export function getPortTagType(
  portName: string,
  port: TPortDefinition,
  direction: "input" | "output"
): "input" | "output" | "step" {
  if (shouldUseStepTag(portName, port)) {
    return "step";
  }
  return direction;
}
