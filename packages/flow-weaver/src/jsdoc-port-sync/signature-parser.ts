/**
 * @module jsdoc-port-sync/signature-parser
 *
 * Parse TypeScript function signatures to extract parameters and return types.
 * Browser-compatible (regex-based, no ts-morph).
 */

import type { TDataType } from "../ast/types";
import {
  FUNC_DECL_START,
  ARROW_START,
  RETURN_OBJECT_REGEX,
  RESERVED_RETURN_FIELDS,
  findBalancedClose,
  splitParams,
} from "./constants";

// =============================================================================
// Types
// =============================================================================

/** Parsed function parameter */
export interface ParsedParam {
  name: string;
  tsType?: string;
  optional: boolean;
  defaultValue?: string;
  position: number;
}

// =============================================================================
// Function Signature Parsing
// =============================================================================

/**
 * Parse function signature to extract parameters.
 * Supports both function declarations and arrow functions.
 * Uses balanced paren matching to handle nested callback types.
 */
export function parseFunctionSignature(functionText: string): {
  params: ParsedParam[];
  functionType: "declaration" | "arrow" | "expression";
} {
  const params: ParsedParam[] = [];
  let functionType: "declaration" | "arrow" | "expression" = "expression";
  let paramsStr = "";

  // Try function declaration first - use balanced matching for nested parens
  const funcDeclMatch = functionText.match(FUNC_DECL_START);
  if (funcDeclMatch && funcDeclMatch.index !== undefined) {
    functionType = "declaration";
    const openParenIndex = funcDeclMatch.index + funcDeclMatch[0].length - 1;
    const closeParenIndex = findBalancedClose(functionText, openParenIndex);
    if (closeParenIndex !== -1) {
      paramsStr = functionText.substring(openParenIndex + 1, closeParenIndex);
    }
  } else {
    // Try arrow function
    const arrowMatch = functionText.match(ARROW_START);
    if (arrowMatch && arrowMatch.index !== undefined) {
      functionType = "arrow";
      const openParenIndex = arrowMatch.index + arrowMatch[0].length - 1;
      const closeParenIndex = findBalancedClose(functionText, openParenIndex);
      if (closeParenIndex !== -1) {
        paramsStr = functionText.substring(openParenIndex + 1, closeParenIndex);
      }
    }
  }

  if (!paramsStr.trim()) {
    return { params, functionType };
  }

  // Parse individual parameters
  const paramTokens = splitParams(paramsStr);

  paramTokens.forEach((paramStr, index) => {
    const param = parseParam(paramStr.trim(), index);
    if (param) {
      params.push(param);
    }
  });

  return { params, functionType };
}

/**
 * Parse a single parameter string like "name?: type = default"
 * Handles multiline callback types with nested parens/braces.
 */
function parseParam(paramStr: string, position: number): ParsedParam | null {
  if (!paramStr) return null;

  const trimmed = paramStr.trim();
  if (!trimmed) return null;

  // Extract name first (must be valid identifier)
  const nameMatch = trimmed.match(/^(\w+)(\?)?/);
  if (!nameMatch) return null;

  const name = nameMatch[1];
  const questionMark = nameMatch[2];
  let rest = trimmed.substring(nameMatch[0].length).trim();

  let tsType: string | undefined;
  let defaultValue: string | undefined;

  // Check for type annotation (: type)
  if (rest.startsWith(":")) {
    rest = rest.substring(1).trim();
    // Find where type ends - either at unbalanced = (not =>) or end of string
    let depth = 0;
    let typeEnd = rest.length;

    for (let i = 0; i < rest.length; i++) {
      const ch = rest[i];
      if (ch === "(" || ch === "{" || ch === "[" || ch === "<") {
        depth++;
      } else if (ch === ")" || ch === "}" || ch === "]" || ch === ">") {
        depth--;
      } else if (ch === "=" && depth === 0) {
        // Check if this is => (arrow) vs = (assignment)
        if (rest[i + 1] === ">") {
          i++; // skip >
          continue;
        }
        typeEnd = i;
        break;
      }
    }

    tsType = rest.substring(0, typeEnd).trim();
    rest = rest.substring(typeEnd).trim();
  }

  // Check for default value (= value)
  if (rest.startsWith("=")) {
    defaultValue = rest.substring(1).trim();
  }

  const hasDefault = defaultValue !== undefined;
  const optional = !!questionMark || hasDefault;

  return {
    name,
    tsType: tsType || undefined,
    optional,
    defaultValue,
    position,
  };
}

// =============================================================================
// Return Type Parsing
// =============================================================================

/**
 * Parse return statement to extract object field names.
 * Returns unique field names from all return statements.
 */
export function parseReturnFields(functionText: string): string[] {
  const fields = new Set<string>();

  RETURN_OBJECT_REGEX.lastIndex = 0;
  let match;
  while ((match = RETURN_OBJECT_REGEX.exec(functionText)) != null) {
    const objectContent = match[1];
    const fieldParts = objectContent.split(",");

    for (const part of fieldParts) {
      const trimmed = part.trim();
      if (!trimmed) continue;

      // Check for "key: value" pattern
      const colonMatch = trimmed.match(/^(\w+)\s*:/);
      if (colonMatch) {
        const fieldName = colonMatch[1];
        if (!RESERVED_RETURN_FIELDS.includes(fieldName)) {
          fields.add(fieldName);
        }
      } else {
        // Shorthand property - just the identifier
        const shorthandMatch = trimmed.match(/^(\w+)$/);
        if (shorthandMatch) {
          const fieldName = shorthandMatch[1];
          if (!RESERVED_RETURN_FIELDS.includes(fieldName)) {
            fields.add(fieldName);
          }
        }
      }
    }
  }

  return Array.from(fields);
}

/**
 * Parse return body fields WITH inferred types.
 * Analyzes `return { field: value }` statements to infer types from values.
 *
 * @returns Map of field name → inferred TypeScript type
 */
export function parseReturnBodyFieldsWithTypes(functionText: string): Map<string, string> {
  const fields = new Map<string, string>();

  RETURN_OBJECT_REGEX.lastIndex = 0;
  let match;
  while ((match = RETURN_OBJECT_REGEX.exec(functionText)) != null) {
    const objectContent = match[1];
    const fieldParts = objectContent.split(",");

    for (const part of fieldParts) {
      const trimmed = part.trim();
      if (!trimmed) continue;

      // Check for "key: value" pattern
      const colonMatch = trimmed.match(/^(\w+)\s*:\s*(.+)$/);
      if (colonMatch) {
        const fieldName = colonMatch[1];
        const value = colonMatch[2].trim();
        if (!RESERVED_RETURN_FIELDS.includes(fieldName)) {
          const inferredType = inferTypeFromValue(value);
          if (!fields.has(fieldName) || fields.get(fieldName) === "any") {
            fields.set(fieldName, inferredType);
          }
        }
      } else {
        // Shorthand property - just the identifier
        const shorthandMatch = trimmed.match(/^(\w+)$/);
        if (shorthandMatch) {
          const fieldName = shorthandMatch[1];
          if (!RESERVED_RETURN_FIELDS.includes(fieldName) && !fields.has(fieldName)) {
            fields.set(fieldName, "any");
          }
        }
      }
    }
  }

  return fields;
}

/**
 * Infer TypeScript type from a value in return statement.
 * Simple heuristic-based detection.
 */
function inferTypeFromValue(value: string): string {
  value = value.trim();

  if (value.startsWith("[")) return "any[]";
  if (value.startsWith("{")) return "any";
  if (/^["'`]/.test(value)) return "string";
  if (/^-?\d+(\.\d+)?$/.test(value)) return "number";
  if (value === "true" || value === "false") return "boolean";
  if (value === "null" || value === "undefined") return "any";

  return "any";
}

/**
 * Parse return type annotation fields from function signature.
 * Matches:
 * - function foo(): { fieldName: type, ... }
 * - const foo: TFlowWeaverNodeType<{...}, { fieldName: type, ... }> = ...
 */
export function parseReturnTypeFields(functionText: string): string[] {
  // Try standard return type syntax first: ): { ... } or )=> { ... }
  let returnTypeMatch = functionText.match(/\)\s*:\s*\{([^}]+)\}\s*(?:\{|=>)/);

  // If not found, try TFlowWeaverNodeType<InputType, OutputType> syntax
  if (!returnTypeMatch) {
    const genericStart = functionText.indexOf("TFlowWeaverNodeType<");
    if (genericStart !== -1) {
      let braceCount = 0;
      let inFirstParam = false;
      let firstParamEnd = -1;
      let secondParamStart = -1;
      let secondParamEnd = -1;

      for (let i = genericStart + "TFlowWeaverNodeType<".length; i < functionText.length; i++) {
        const char = functionText[i];

        if (char === "{") {
          if (!inFirstParam && braceCount === 0) {
            inFirstParam = true;
          } else if (firstParamEnd !== -1 && secondParamStart === -1) {
            secondParamStart = i + 1;
          }
          braceCount++;
        } else if (char === "}") {
          braceCount--;
          if (braceCount === 0) {
            if (inFirstParam && firstParamEnd === -1) {
              firstParamEnd = i;
              inFirstParam = false;
            } else if (secondParamStart !== -1) {
              secondParamEnd = i;
              break;
            }
          }
        }
      }

      if (secondParamStart !== -1 && secondParamEnd !== -1) {
        const objectContent = functionText.substring(secondParamStart, secondParamEnd);
        returnTypeMatch = [functionText, objectContent] as RegExpMatchArray;
      }
    }
  }

  if (!returnTypeMatch) return [];

  const fields: string[] = [];
  const objectContent = returnTypeMatch[1];
  const fieldParts = objectContent.split(/[,;]/);

  for (const part of fieldParts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    const colonMatch = trimmed.match(/^(\w+)\s*:/);
    if (colonMatch) {
      const fieldName = colonMatch[1];
      if (!RESERVED_RETURN_FIELDS.includes(fieldName)) {
        fields.push(fieldName);
      }
    }
  }

  return fields;
}

/**
 * Parse return type fields WITH their TypeScript types.
 * Returns array of { name, tsType } for each field in the return type.
 */
export function parseReturnTypeFieldsWithTypes(functionText: string): Array<{ name: string; tsType: string }> {
  const fields: Array<{ name: string; tsType: string }> = [];

  // Match return type: ): { field: type; ... } or ): Promise<{ field: type; ... }>
  const returnTypeMatch = functionText.match(/\)\s*:\s*(?:Promise\s*<\s*)?\{([^}]+)\}/);
  if (!returnTypeMatch) return fields;

  const returnTypeContent = returnTypeMatch[1];

  // Parse individual fields: name: type or name?: type
  const fieldRegex = /(\w+)\s*\??\s*:\s*([^;,}]+)/g;
  let match;
  while ((match = fieldRegex.exec(returnTypeContent)) != null) {
    const [, name, tsType] = match;
    fields.push({ name, tsType: tsType.trim() });
  }

  return fields;
}

/**
 * Split object type fields by comma or semicolon, respecting nested angle brackets,
 * square brackets, braces, and parentheses.
 * e.g. "report: Record<string, unknown>; count: number" → ["report: Record<string, unknown>", "count: number"]
 */
function splitObjectFields(content: string): string[] {
  const result: string[] = [];
  let current = "";
  let angleDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  let parenDepth = 0;

  for (const char of content) {
    if (char === "<") angleDepth++;
    else if (char === ">" && angleDepth > 0) angleDepth--;
    else if (char === "[") bracketDepth++;
    else if (char === "]" && bracketDepth > 0) bracketDepth--;
    else if (char === "{") braceDepth++;
    else if (char === "}" && braceDepth > 0) braceDepth--;
    else if (char === "(") parenDepth++;
    else if (char === ")" && parenDepth > 0) parenDepth--;
    else if ((char === "," || char === ";") && angleDepth === 0 && bracketDepth === 0 && braceDepth === 0 && parenDepth === 0) {
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

/**
 * Parse input type fields from TFlowWeaverNodeType<{inputs}, {outputs}> syntax.
 * Returns field names and their types from the first type parameter (input type).
 */
export function parseInputTypeFields(functionText: string): Array<{ name: string; tsType: string }> {
  const genericStart = functionText.indexOf("TFlowWeaverNodeType<");
  if (genericStart === -1) return [];

  let braceCount = 0;
  let firstParamStart = -1;
  let firstParamEnd = -1;

  for (let i = genericStart + "TFlowWeaverNodeType<".length; i < functionText.length; i++) {
    const char = functionText[i];

    if (char === "{") {
      if (braceCount === 0) {
        firstParamStart = i + 1;
      }
      braceCount++;
    } else if (char === "}") {
      braceCount--;
      if (braceCount === 0) {
        firstParamEnd = i;
        break;
      }
    }
  }

  if (firstParamStart === -1 || firstParamEnd === -1) return [];

  const objectContent = functionText.substring(firstParamStart, firstParamEnd);
  const fields: Array<{ name: string; tsType: string }> = [];

  const fieldParts = splitObjectFields(objectContent);
  for (const part of fieldParts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    const colonMatch = trimmed.match(/^(\w+)\s*:\s*(.+)$/);
    if (colonMatch) {
      fields.push({ name: colonMatch[1], tsType: colonMatch[2].trim() });
    }
  }

  return fields;
}

// =============================================================================
// Type Mapping
// =============================================================================

/**
 * Map TypeScript type to port type.
 */
export function tsTypeToPortType(tsType: string | undefined): TDataType {
  if (!tsType) return "ANY";

  const normalized = tsType.trim().toLowerCase();

  switch (normalized) {
    case "number":
      return "NUMBER";
    case "string":
      return "STRING";
    case "boolean":
      return "BOOLEAN";
    case "any[]":
    case "array":
      return "ARRAY";
    case "object":
      return "OBJECT";
    case "function":
      return "FUNCTION";
    default:
      return "ANY";
  }
}

/**
 * Map port type to TypeScript type string.
 */
export function portTypeToTsType(portType: TDataType): string {
  switch (portType) {
    case "NUMBER":
      return "number";
    case "STRING":
      return "string";
    case "BOOLEAN":
      return "boolean";
    case "ARRAY":
      return "any[]";
    case "OBJECT":
      return "any";
    case "FUNCTION":
      return "(...args: any[]) => any";
    case "STEP":
      return "boolean";
    case "ANY":
    default:
      return "any";
  }
}

// =============================================================================
// Callback Type Parsing
// =============================================================================

/**
 * Parse callback type string to extract params and return type.
 * E.g., "(execute: boolean, item: string) => { result: number }"
 */
export function parseCallbackType(callbackType: string): {
  params: Array<{ name: string; typeStr: string }>;
  returnType: string;
  returnFields: Array<{ name: string; typeStr: string }>;
} {
  const params: Array<{ name: string; typeStr: string }> = [];
  const returnFields: Array<{ name: string; typeStr: string }> = [];
  let returnType = "";

  const arrowIdx = callbackType.indexOf("=>");
  if (arrowIdx === -1) return { params, returnType, returnFields };

  const beforeArrow = callbackType.substring(0, arrowIdx).trim();
  const openParen = beforeArrow.indexOf("(");
  const closeParen = beforeArrow.lastIndexOf(")");
  if (openParen === -1 || closeParen === -1) return { params, returnType, returnFields };

  const paramsStr = beforeArrow.substring(openParen + 1, closeParen);
  const paramTokens = splitParams(paramsStr);

  for (const token of paramTokens) {
    const trimmed = token.trim();
    if (!trimmed) continue;
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx !== -1) {
      const name = trimmed.substring(0, colonIdx).trim().replace(/\?$/, "");
      const typeStr = trimmed.substring(colonIdx + 1).trim();
      params.push({ name, typeStr });
    }
  }

  returnType = callbackType.substring(arrowIdx + 2).trim();

  const returnMatch = returnType.match(/^\{\s*([\s\S]*?)\s*\}$/);
  if (returnMatch) {
    const fieldsStr = returnMatch[1];
    const fieldParts = fieldsStr.split(/[;\n]/).filter(s => s.trim());
    for (const part of fieldParts) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const colonIdx = trimmed.indexOf(":");
      if (colonIdx !== -1) {
        const name = trimmed.substring(0, colonIdx).trim();
        const typeStr = trimmed.substring(colonIdx + 1).trim();
        returnFields.push({ name, typeStr });
      }
    }
  }

  return { params, returnType, returnFields };
}

/**
 * Build callback type string from scoped ports, preserving existing non-scoped params.
 * Scoped OUTPUT ports → callback parameters
 * Scoped INPUT ports → callback return type
 */
export function buildCallbackType(
  callbackParams: Array<[string, { dataType: TDataType; metadata?: { order?: number } }]>,
  callbackReturns: Array<[string, { dataType: TDataType; metadata?: { order?: number } }]>,
  existingCallbackType?: string,
): string {
  const scopedParamNames = new Set(callbackParams.map(([name]) => name));
  const scopedReturnNames = new Set(callbackReturns.map(([name]) => name));

  const isParamsMultiline = existingCallbackType?.includes("(\n") || false;
  const isReturnMultiline = existingCallbackType?.match(/=>\s*\{\n/) != null;

  const scopedParamsList = callbackParams
    .sort((a, b) => (a[1].metadata?.order ?? Infinity) - (b[1].metadata?.order ?? Infinity))
    .map(([name, port]) => `${name}: ${portTypeToTsType(port.dataType)}`);

  let preservedParams: string[] = [];
  let preservedReturns: string[] = [];
  if (existingCallbackType) {
    const parsed = parseCallbackType(existingCallbackType);
    preservedParams = parsed.params
      .filter(({ name }) => !scopedParamNames.has(name))
      .map(({ name, typeStr }) => `${name}: ${typeStr}`);
    preservedReturns = parsed.returnFields
      .filter(({ name }) => !scopedReturnNames.has(name))
      .map(({ name, typeStr }) => `${name}: ${typeStr}`);
  }

  const allParamsList = [...preservedParams, ...scopedParamsList].filter(Boolean);

  const scopedReturnFields = callbackReturns
    .sort((a, b) => (a[1].metadata?.order ?? Infinity) - (b[1].metadata?.order ?? Infinity))
    .map(([name, port]) => `${name}: ${portTypeToTsType(port.dataType)}`);

  const allReturnFields = [...preservedReturns, ...scopedReturnFields];

  let paramsStr: string;
  if (isParamsMultiline && allParamsList.length > 0) {
    paramsStr = `\n    ${allParamsList.join(",\n    ")},\n  `;
  } else {
    paramsStr = allParamsList.join(", ");
  }

  if (isReturnMultiline && allReturnFields.length > 0) {
    const returnFieldsStr = allReturnFields.map(f => `    ${f};`).join("\n");
    return `(${paramsStr}) => {\n${returnFieldsStr}\n  }`;
  } else {
    const returnFieldsStr = allReturnFields.join("; ");
    return `(${paramsStr}) => { ${returnFieldsStr} }`;
  }
}

/**
 * Check if callback signature already has all required ports.
 * Returns true if no update needed.
 */
export function callbackHasAllPorts(
  callbackType: string,
  callbackParams: Array<[string, unknown]>,
  callbackReturns: Array<[string, unknown]>,
): boolean {
  for (const [name] of callbackParams) {
    const paramRegex = new RegExp(`\\b${name}\\s*:`);
    if (!paramRegex.test(callbackType)) return false;
  }

  for (const [name] of callbackReturns) {
    const arrowIdx = callbackType.indexOf("=>");
    if (arrowIdx === -1) return false;
    const returnPart = callbackType.substring(arrowIdx);
    const returnRegex = new RegExp(`\\b${name}\\s*:`);
    if (!returnRegex.test(returnPart)) return false;
  }

  return true;
}
