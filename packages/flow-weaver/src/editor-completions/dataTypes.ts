/**
 * Editor Completions - Data Types
 *
 * Port data types for autocompletion inside {braces}.
 */

import type { FlowWeaverCompletion } from "./types";

/**
 * Common data types for port definitions.
 * These appear when typing inside {braces} after @input or @output.
 */
export const DATA_TYPES: FlowWeaverCompletion[] = [
  // Control flow
  {
    label: "STEP",
    detail: "Control flow port",
    documentation: "A control flow port that triggers execution. Used for sequencing nodes.",
    insertText: "STEP}",
    insertTextFormat: "plain",
    kind: "type",
    sortOrder: 0,
  },

  // Primitive types
  {
    label: "String",
    detail: "Text value",
    documentation: "A string/text value.",
    insertText: "String}",
    insertTextFormat: "plain",
    kind: "type",
    sortOrder: 10,
  },
  {
    label: "Number",
    detail: "Numeric value",
    documentation: "A numeric value (integer or floating point).",
    insertText: "Number}",
    insertTextFormat: "plain",
    kind: "type",
    sortOrder: 11,
  },
  {
    label: "Boolean",
    detail: "True/false value",
    documentation: "A boolean true/false value.",
    insertText: "Boolean}",
    insertTextFormat: "plain",
    kind: "type",
    sortOrder: 12,
  },

  // Complex types
  {
    label: "Array",
    detail: "List of values",
    documentation: "An array/list of values.",
    insertText: "Array}",
    insertTextFormat: "plain",
    kind: "type",
    sortOrder: 20,
  },
  {
    label: "Object",
    detail: "Key-value object",
    documentation: "A JavaScript object with key-value pairs.",
    insertText: "Object}",
    insertTextFormat: "plain",
    kind: "type",
    sortOrder: 21,
  },
  {
    label: "Function",
    detail: "Callable function",
    documentation: "A function reference.",
    insertText: "Function}",
    insertTextFormat: "plain",
    kind: "type",
    sortOrder: 22,
  },

  // Generic
  {
    label: "Any",
    detail: "Any type",
    documentation: "Accepts any type of value.",
    insertText: "Any}",
    insertTextFormat: "plain",
    kind: "type",
    sortOrder: 30,
  },
];

/**
 * Get data type completions filtered by prefix.
 */
export function getDataTypeCompletions(prefix: string): FlowWeaverCompletion[] {
  const lowerPrefix = prefix.toLowerCase();
  return DATA_TYPES.filter((c) =>
    c.label.toLowerCase().startsWith(lowerPrefix)
  );
}
