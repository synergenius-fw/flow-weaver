import type { TDataType } from '../ast/types';

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
    // An unknown port type is reported by the validator (INVALID_PORT_TYPE);
    // here it just falls back to the widest TypeScript type.
    return 'unknown';
  }

  // For non-primitive types, use tsType if provided — BUT strip types
  // that contain absolute paths (import("/absolute/path").Type) which
  // break when the file is compiled on a different machine or moved.
  if (
    tsType &&
    (portType === 'OBJECT' || portType === 'ANY' || portType === 'ARRAY' || portType === 'FUNCTION')
  ) {
    // Strip types with absolute import paths — they break on other machines
    if (tsType.includes('import(')) {
      return mapping.typescript;
    }
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
/**
 * Strip a trailing `| undefined` that ts-morph appends to an optional
 * parameter's type. Optionality is tracked separately by the port's `optional`
 * flag, so the captured `tsType` should be the base type without it. ts-morph 28
 * started including `| undefined` in `Parameter.getType().getText()` for `?`
 * params (ts-morph 27 did not), which otherwise leaks into generated code and
 * makes JSDoc signatures (`@input x - string`) mismatch the inferred type.
 *
 * Only call this for params/fields already known to be optional; a required
 * `string | undefined` union is left intact.
 */
export function stripOptionalUndefined(tsType: string): string {
  return tsType
    .replace(/\s*\|\s*undefined\s*$/, '')
    .replace(/^\s*undefined\s*\|\s*/, '')
    .trim();
}

/**
 * True when the whole type is a function type: `Function`, or an arrow (`=>`)
 * at nesting depth 0. An arrow inside `{ }`, `< >`, `( )` or `[ ]` belongs to
 * a member, a type argument or a parenthesised union member, so
 * `{ cb: () => void; id: string }` and `Map<string, () => void>` are objects,
 * while `(x: number) => string` and `((a: string) => void) | undefined` are
 * functions (the latter once the union rule strips `undefined`).
 */
function isFunctionTypeText(text: string): boolean {
  if (text === 'Function') return true;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(' || ch === '[' || ch === '{' || ch === '<') {
      depth++;
    } else if (ch === ')' || ch === ']' || ch === '}') {
      depth--;
    } else if (ch === '>') {
      // The `>` of `=>` closes nothing.
      if (text[i - 1] === '=') {
        if (depth === 0) return true;
      } else {
        depth--;
      }
    }
  }
  return false;
}

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

  // Promise unwrapping: Promise<T> → infer from T
  if (normalized.startsWith('Promise<') && normalized.endsWith('>')) {
    const inner = normalized.slice(8, -1);
    return inferDataTypeFromTS(inner);
  }

  // Function patterns: () => T, (args) => T, Function. Only when the whole
  // type is the function; an arrow nested in an object or generic is not.
  if (isFunctionTypeText(normalized)) {
    return 'FUNCTION';
  }

  // Union types: handle T | undefined and T | null as optional types
  if (normalized.includes('|')) {
    // Split by | and filter out undefined/null
    const parts = normalized.split('|').map((p) => p.trim());
    const nonNullParts = parts.filter((p) => p !== 'undefined' && p !== 'null');

    if (nonNullParts.length === 1) {
      // This is an optional type (T | undefined or T | null) - infer from T.
      // A parenthesised member, as in `(() => void) | undefined`, loses its
      // parentheses so the function rule can see the arrow.
      const single = nonNullParts[0];
      const unwrapped = single.startsWith('(') && single.endsWith(')') && isFunctionTypeText(single.slice(1, -1))
        ? single.slice(1, -1)
        : single;
      return inferDataTypeFromTS(unwrapped);
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
