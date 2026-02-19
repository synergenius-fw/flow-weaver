/* eslint-disable no-console */
import type { TDataType } from './ast/types';

export type TypeScriptType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'unknown'
  | 'unknown[]'
  | 'void'
  | 'Function'
  | 'Record<string, unknown>'
  | '(...args: unknown[]) => unknown';

export interface PortTypeMapping {
  readonly typescript: TypeScriptType;
  readonly description?: string;
}

export const PORT_TYPE_MAPPINGS: Record<TDataType, PortTypeMapping> = {
  STRING: {
    typescript: 'string',
    description: 'Text value',
  },
  NUMBER: {
    typescript: 'number',
    description: 'Numeric value',
  },
  BOOLEAN: {
    typescript: 'boolean',
    description: 'True or false value',
  },
  ARRAY: {
    typescript: 'unknown[]',
    description: 'Array of values',
  },
  OBJECT: {
    typescript: 'Record<string, unknown>',
    description: 'Object with properties',
  },
  FUNCTION: {
    typescript: '(...args: unknown[]) => unknown',
    description: 'Function or callback',
  },
  ANY: {
    typescript: 'unknown',
    description: 'Any type of value',
  },
  STEP: {
    typescript: 'boolean',
    description: 'Control flow signal (boolean in public API)',
  },
} as const;

export function mapToTypeScript(portType: TDataType, tsType?: string): TypeScriptType | string {
  const mapping = PORT_TYPE_MAPPINGS[portType];
  if (!mapping) {
    console.warn(`Unknown port type: ${portType}, defaulting to 'unknown'`);
    return 'unknown';
  }

  // For non-primitive types, use tsType if provided
  if (
    tsType &&
    (portType === 'OBJECT' || portType === 'ANY' || portType === 'ARRAY' || portType === 'FUNCTION')
  ) {
    return tsType;
  }

  return mapping.typescript;
}

export function isValidPortType(type: string): type is TDataType {
  return type in PORT_TYPE_MAPPINGS;
}

export function getAllPortTypes(): ReadonlyArray<TDataType> {
  return Object.keys(PORT_TYPE_MAPPINGS) as Array<TDataType>;
}

export function getPortTypeDescription(portType: TDataType): string | undefined {
  return PORT_TYPE_MAPPINGS[portType]?.description;
}

/**
 * Infer TDataType from a TypeScript type string.
 * This is the reverse mapping: TypeScript type → Flow Weaver semantic type.
 *
 * @param tsType - The TypeScript type string (e.g., "string", "number[]", "User")
 * @returns The corresponding TDataType for color/category mapping
 *
 * @example
 * inferDataTypeFromTS("string") // → "STRING"
 * inferDataTypeFromTS("number") // → "NUMBER"
 * inferDataTypeFromTS("boolean") // → "BOOLEAN"
 * inferDataTypeFromTS("User[]") // → "ARRAY"
 * inferDataTypeFromTS("Array<number>") // → "ARRAY"
 * inferDataTypeFromTS("Map<string, User>") // → "OBJECT"
 * inferDataTypeFromTS("(x: number) => string") // → "FUNCTION"
 */
export function inferDataTypeFromTS(tsType: string): TDataType {
  const normalized = tsType.trim();

  // Exact primitive matches
  if (normalized === 'string') return 'STRING';
  if (normalized === 'number') return 'NUMBER';
  if (normalized === 'boolean') return 'BOOLEAN';

  // Any/unknown fallback
  if (normalized === 'any' || normalized === 'unknown' || normalized === 'never') {
    return 'ANY';
  }

  // Void (rare, but handle it)
  if (normalized === 'void' || normalized === 'undefined' || normalized === 'null') {
    return 'ANY';
  }

  // Array patterns: T[], Array<T>, ReadonlyArray<T>
  if (
    normalized.endsWith('[]') ||
    normalized.startsWith('Array<') ||
    normalized.startsWith('ReadonlyArray<')
  ) {
    return 'ARRAY';
  }

  // Function patterns: () => T, (args) => T, Function
  if (normalized.includes('=>') || normalized === 'Function' || normalized.startsWith('(')) {
    return 'FUNCTION';
  }

  // Promise unwrapping: Promise<T> → infer from T
  if (normalized.startsWith('Promise<') && normalized.endsWith('>')) {
    const inner = normalized.slice(8, -1);
    return inferDataTypeFromTS(inner);
  }

  // Union types: handle T | undefined and T | null as optional types
  if (normalized.includes('|')) {
    // Split by | and filter out undefined/null
    const parts = normalized.split('|').map((p) => p.trim());
    const nonNullParts = parts.filter((p) => p !== 'undefined' && p !== 'null');

    if (nonNullParts.length === 1) {
      // This is an optional type (T | undefined or T | null) - infer from T
      return inferDataTypeFromTS(nonNullParts[0]);
    }

    // True union type - default to ANY
    return 'ANY';
  }

  // Intersection types: if contains &, default to OBJECT
  if (normalized.includes('&')) {
    return 'OBJECT';
  }

  // Generic object types (Map, Set, Record, etc.) → OBJECT
  // Any remaining complex type → OBJECT
  return 'OBJECT';
}
