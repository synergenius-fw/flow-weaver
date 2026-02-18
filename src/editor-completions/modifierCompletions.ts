/**
 * Editor Completions - Bracket Modifier Completions
 *
 * Completions for bracket modifiers like [placement:TOP], [order:1], [hidden:true]
 * These appear on annotation lines inside brackets.
 */

import type { FlowWeaverCompletion } from './types';

// =============================================================================
// Modifier Definitions
// =============================================================================

type ModifierDef = {
  name: string;
  detail: string;
  documentation?: string;
  /** Which annotation lines this modifier appears on. null = any. */
  annotations: string[] | null;
};

/**
 * Port modifiers - appear on @input, @output, @step lines.
 */
const PORT_MODIFIERS: ModifierDef[] = [
  { name: 'order', detail: 'Port display order', annotations: ['@input', '@output', '@step'] },
  {
    name: 'placement',
    detail: 'Port placement (TOP/BOTTOM)',
    annotations: ['@input', '@output', '@step'],
  },
  { name: 'type', detail: 'Override port data type', annotations: ['@input', '@output', '@step'] },
  { name: 'hidden', detail: 'Hide port from UI', annotations: ['@input', '@output', '@step'] },
  {
    name: 'optional',
    detail: 'Mark port as optional',
    annotations: ['@input', '@output', '@step'],
  },
  {
    name: 'label',
    detail: 'Port display label',
    annotations: ['@input', '@output', '@step', '@node'],
  },
  {
    name: 'expr',
    detail: 'Default expression',
    annotations: ['@input', '@output', '@step', '@node'],
  },
  {
    name: 'minimized',
    detail: 'Start minimized',
    annotations: ['@input', '@output', '@step', '@node'],
  },
  {
    name: 'pullExecution',
    detail: 'Pull execution mode',
    annotations: ['@input', '@output', '@step', '@node'],
  },
];

/**
 * Node modifiers - appear on @node lines.
 */
const NODE_MODIFIERS: ModifierDef[] = [
  { name: 'label', detail: 'Node display label', annotations: ['@node'] },
  { name: 'expr', detail: 'Node expression', annotations: ['@node'] },
  { name: 'minimized', detail: 'Start minimized', annotations: ['@node'] },
  { name: 'pullExecution', detail: 'Pull execution mode', annotations: ['@node'] },
  { name: 'portOrder', detail: 'Port display order', annotations: ['@node'] },
  { name: 'portLabel', detail: 'Port label override', annotations: ['@node'] },
  { name: 'size', detail: 'Node size', annotations: ['@node'] },
];

const ALL_MODIFIERS: ModifierDef[] = [...PORT_MODIFIERS, ...NODE_MODIFIERS];

// Deduplicate by name (some appear in both lists)
const UNIQUE_MODIFIERS: ModifierDef[] = [];
const seen = new Set<string>();
for (const mod of ALL_MODIFIERS) {
  if (!seen.has(mod.name)) {
    seen.add(mod.name);
    // Merge annotations from duplicates
    const allAnnotations = ALL_MODIFIERS.filter((m) => m.name === mod.name).flatMap(
      (m) => m.annotations || []
    );
    UNIQUE_MODIFIERS.push({
      ...mod,
      annotations: allAnnotations.length > 0 ? [...new Set(allAnnotations)] : null,
    });
  }
}

// =============================================================================
// Modifier Value Maps
// =============================================================================

const MODIFIER_VALUES: Record<string, FlowWeaverCompletion[]> = {
  placement: [
    {
      label: 'TOP',
      detail: 'Place port on top',
      insertText: 'TOP',
      insertTextFormat: 'plain',
      kind: 'value',
    },
    {
      label: 'BOTTOM',
      detail: 'Place port on bottom',
      insertText: 'BOTTOM',
      insertTextFormat: 'plain',
      kind: 'value',
    },
  ],
  hidden: [
    {
      label: 'true',
      detail: 'Hide port',
      insertText: 'true',
      insertTextFormat: 'plain',
      kind: 'value',
    },
    {
      label: 'false',
      detail: 'Show port',
      insertText: 'false',
      insertTextFormat: 'plain',
      kind: 'value',
    },
  ],
  optional: [
    {
      label: 'true',
      detail: 'Mark as optional',
      insertText: 'true',
      insertTextFormat: 'plain',
      kind: 'value',
    },
    {
      label: 'false',
      detail: 'Mark as required',
      insertText: 'false',
      insertTextFormat: 'plain',
      kind: 'value',
    },
  ],
  minimized: [
    {
      label: 'true',
      detail: 'Start minimized',
      insertText: 'true',
      insertTextFormat: 'plain',
      kind: 'value',
    },
    {
      label: 'false',
      detail: 'Start expanded',
      insertText: 'false',
      insertTextFormat: 'plain',
      kind: 'value',
    },
  ],
  pullExecution: [
    {
      label: 'true',
      detail: 'Enable pull execution',
      insertText: 'true',
      insertTextFormat: 'plain',
      kind: 'value',
    },
    {
      label: 'false',
      detail: 'Disable pull execution',
      insertText: 'false',
      insertTextFormat: 'plain',
      kind: 'value',
    },
  ],
};

// =============================================================================
// Public API
// =============================================================================

/**
 * Get modifier name completions.
 * Filters by the annotation on the current line if provided.
 */
export function getModifierCompletions(
  lineAnnotation: string | null,
  prefix: string
): FlowWeaverCompletion[] {
  const lowerPrefix = prefix.toLowerCase();

  return UNIQUE_MODIFIERS.filter((mod) => {
    // Filter by prefix
    if (!mod.name.toLowerCase().startsWith(lowerPrefix)) {
      return false;
    }
    // Filter by annotation context if known
    if (lineAnnotation && mod.annotations) {
      return mod.annotations.includes(lineAnnotation);
    }
    return true;
  }).map((mod, i) => ({
    label: mod.name,
    detail: mod.detail,
    documentation: mod.documentation,
    insertText: mod.name + ':',
    insertTextFormat: 'plain' as const,
    kind: 'keyword' as const,
    sortOrder: i,
  }));
}

/**
 * Get modifier value completions.
 */
export function getModifierValueCompletions(
  modifier: string,
  prefix: string
): FlowWeaverCompletion[] {
  const values = MODIFIER_VALUES[modifier];
  if (!values) {
    return [];
  }

  const lowerPrefix = prefix.toLowerCase();
  return values.filter((v) => v.label.toLowerCase().startsWith(lowerPrefix));
}
