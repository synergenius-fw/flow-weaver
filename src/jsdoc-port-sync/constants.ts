/**
 * @module jsdoc-port-sync/constants
 *
 * Regex patterns and helper functions for JSDoc port parsing.
 * Browser-compatible (no ts-morph dependency).
 *
 * NOTE: Port parsing now uses Chevrotain. These patterns are for
 * JSDoc block detection, validation, and edge cases only.
 */

import { isExecutePort, isSuccessPort, isFailurePort, isScopedMandatoryPort } from "../constants";

// =============================================================================
// JSDoc Block Regex
// =============================================================================

/** Match JSDoc block */
export const JSDOC_BLOCK_REGEX = /\/\*\*[\s\S]*?\*\//;

// =============================================================================
// Port Tag Detection (not parsing - Chevrotain handles that)
// =============================================================================

/** Detect port-related lines (input, output, step) */
export const PORT_TAG_REGEX = /^\s*\*\s*@(input|output|step)\b/;

/** Regex to detect orphan incomplete lines (tag but no name) */
export const ORPHAN_PORT_LINE_REGEX = /^\s*\*\s*@(input|output|step)\s*$/;

/** Detect @scope declarations (global flag for iterating) */
export const SCOPE_TAG_REGEX = /@scope\s+(\w+)/g;

// =============================================================================
// Function Signature Regexes
// =============================================================================

/** Match function declaration start: function name( */
export const FUNC_DECL_START = /(?:async\s+)?function\s+\w+\s*\(/;

/** Match arrow function start: const/let/var name = ( */
export const ARROW_START = /(?:const|let|var)\s+\w+\s*=\s*(?:async\s*)?\(/;

/** Match return object: return { ... } */
export const RETURN_OBJECT_REGEX = /return\s*\{([^}]+)\}/g;

// =============================================================================
// Reserved Names
// =============================================================================

/** Reserved parameter names to skip */
export const RESERVED_PARAMS = ["execute"];

/** Reserved return field names to skip */
export const RESERVED_RETURN_FIELDS = ["onSuccess", "onFailure"];

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Check if a port name is a reserved STEP port.
 * Includes both external (execute, onSuccess, onFailure) and scoped (start, success, failure).
 */
export function isReservedStepPort(name: string): boolean {
  return isExecutePort(name) || isSuccessPort(name) || isFailurePort(name) || isScopedMandatoryPort(name);
}

/**
 * Find the index of the closing paren/brace that matches the opening at startIndex.
 */
export function findBalancedClose(text: string, startIndex: number): number {
  const openChar = text[startIndex];
  const closeChar = openChar === "(" ? ")" : openChar === "{" ? "}" : "]";
  let depth = 1;
  for (let i = startIndex + 1; i < text.length; i++) {
    if (text[i] === openChar) depth++;
    else if (text[i] === closeChar) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Split parameters string by comma, handling nested braces, parens, and angles
 */
export function splitParams(paramsStr: string): string[] {
  const result: string[] = [];
  let current = "";
  let braceDepth = 0;
  let angleDepth = 0;
  let parenDepth = 0;

  for (const char of paramsStr) {
    if (char === "{") braceDepth++;
    else if (char === "}") braceDepth--;
    else if (char === "<") angleDepth++;
    else if (char === ">" && angleDepth > 0) angleDepth--;
    else if (char === "(") parenDepth++;
    else if (char === ")") parenDepth--;
    else if (char === "," && braceDepth === 0 && angleDepth === 0 && parenDepth === 0) {
      result.push(current);
      current = "";
      continue;
    }
    current += char;
  }

  if (current.trim()) {
    result.push(current);
  }

  return result;
}
