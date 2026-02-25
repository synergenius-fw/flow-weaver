/**
 * Editor Completions - Annotation Values
 *
 * Static value completions for annotations that take specific values.
 * E.g., @executeWhen CONJUNCTION, @flowWeaver workflow, @color purple
 */

import type { FlowWeaverCompletion } from './types';

/**
 * Value maps for annotations that accept specific values.
 */
const ANNOTATION_VALUES: Record<string, FlowWeaverCompletion[]> = {
  '@executeWhen': [
    {
      label: 'CONJUNCTION',
      detail: 'All inputs required',
      documentation: 'Node executes when ALL connected input step ports have fired.',
      insertText: 'CONJUNCTION',
      insertTextFormat: 'plain',
      kind: 'value',
      sortOrder: 0,
    },
    {
      label: 'DISJUNCTION',
      detail: 'Any input triggers',
      documentation: 'Node executes when ANY connected input step port has fired.',
      insertText: 'DISJUNCTION',
      insertTextFormat: 'plain',
      kind: 'value',
      sortOrder: 1,
    },
    {
      label: 'CUSTOM',
      detail: 'Custom execution logic',
      documentation: 'Node uses custom logic to determine when to execute.',
      insertText: 'CUSTOM',
      insertTextFormat: 'plain',
      kind: 'value',
      sortOrder: 2,
    },
  ],

  '@flowWeaver': [
    {
      label: 'workflow',
      detail: 'Visual workflow',
      documentation: 'Marks this function as a Flow Weaver workflow with a visual node graph.',
      insertText: 'workflow',
      insertTextFormat: 'plain',
      kind: 'value',
      sortOrder: 0,
    },
    {
      label: 'nodeType',
      detail: 'Reusable node type',
      documentation: 'Defines a reusable node type that can be instantiated in workflows.',
      insertText: 'nodeType',
      insertTextFormat: 'plain',
      kind: 'value',
      sortOrder: 1,
    },
  ],

  '@color': [
    {
      label: 'purple',
      detail: 'Purple node color',
      insertText: 'purple',
      insertTextFormat: 'plain',
      kind: 'value',
      sortOrder: 0,
    },
    {
      label: 'blue',
      detail: 'Blue node color',
      insertText: 'blue',
      insertTextFormat: 'plain',
      kind: 'value',
      sortOrder: 1,
    },
    {
      label: 'green',
      detail: 'Green node color',
      insertText: 'green',
      insertTextFormat: 'plain',
      kind: 'value',
      sortOrder: 2,
    },
    {
      label: 'orange',
      detail: 'Orange node color',
      insertText: 'orange',
      insertTextFormat: 'plain',
      kind: 'value',
      sortOrder: 3,
    },
    {
      label: 'red',
      detail: 'Red node color',
      insertText: 'red',
      insertTextFormat: 'plain',
      kind: 'value',
      sortOrder: 4,
    },
    {
      label: 'teal',
      detail: 'Teal node color',
      insertText: 'teal',
      insertTextFormat: 'plain',
      kind: 'value',
      sortOrder: 5,
    },
    {
      label: 'pink',
      detail: 'Pink node color',
      insertText: 'pink',
      insertTextFormat: 'plain',
      kind: 'value',
      sortOrder: 6,
    },
    {
      label: 'yellow',
      detail: 'Yellow node color',
      insertText: 'yellow',
      insertTextFormat: 'plain',
      kind: 'value',
      sortOrder: 7,
    },
    {
      label: 'cyan',
      detail: 'Cyan node color',
      insertText: 'cyan',
      insertTextFormat: 'plain',
      kind: 'value',
      sortOrder: 8,
    },
  ],
};

/**
 * Get value completions for a specific annotation.
 */
export function getAnnotationValueCompletions(
  annotation: string,
  prefix: string
): FlowWeaverCompletion[] {
  const values = ANNOTATION_VALUES[annotation];
  if (!values) {
    return [];
  }

  const lowerPrefix = prefix.toLowerCase();
  return values.filter((v) => v.label.toLowerCase().startsWith(lowerPrefix));
}
