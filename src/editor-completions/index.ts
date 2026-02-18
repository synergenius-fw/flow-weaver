/**
 * Editor Completions - Public API
 *
 * Editor-agnostic completion utilities for Flow Weaver.
 * Use these with any editor (CodeMirror, VS Code, Monaco, etc.)
 */

// Re-export types
export * from './types';

// Re-export utilities
export {
  parseCompletionContext,
  getWordAtPosition,
  detectSymbolType,
  detectBlockType,
} from './contextParser';
export { getAnnotationCompletions, JSDOC_ANNOTATIONS } from './jsDocAnnotations';
export { getDataTypeCompletions, DATA_TYPES } from './dataTypes';
export { getDefinitionLocation } from './goToDefinition';
export { getAnnotationValueCompletions } from './annotationValues';
export { getModifierCompletions, getModifierValueCompletions } from './modifierCompletions';

// Import for internal use
import type { FlowWeaverCompletion, WorkflowContext } from './types';
import { parseCompletionContext } from './contextParser';
import { getAnnotationCompletions } from './jsDocAnnotations';
import { getDataTypeCompletions } from './dataTypes';
import { getAnnotationValueCompletions } from './annotationValues';
import { getModifierCompletions, getModifierValueCompletions } from './modifierCompletions';

/**
 * Get Flow Weaver completions for the current cursor position.
 *
 * This is the main entry point for editor integrations.
 *
 * @param lineText - The full text of the current line
 * @param cursorOffset - Cursor position within the line (0-based)
 * @param isInJSDoc - Whether the cursor is inside a JSDoc block
 * @param context - Optional workflow context for nodeType/port completions
 * @param precedingBlockLines - Optional lines from start of JSDoc block to cursor line
 * @returns Array of completion suggestions
 *
 * @example
 * ```typescript
 * // In a CodeMirror completion source:
 * const completions = getFlowWeaverCompletions(
 *   " * @inp",
 *   7,
 *   true
 * );
 * // Returns: [{ label: "@input", ... }]
 * ```
 */
export function getFlowWeaverCompletions(
  lineText: string,
  cursorOffset: number,
  isInJSDoc: boolean,
  context?: WorkflowContext,
  precedingBlockLines?: string[]
): FlowWeaverCompletion[] {
  // Parse the context to determine what completions to show
  const completionContext = parseCompletionContext(
    lineText,
    cursorOffset,
    isInJSDoc,
    precedingBlockLines
  );

  if (!completionContext) {
    return [];
  }

  switch (completionContext.type) {
    case 'annotation':
      return getAnnotationCompletions(
        completionContext.prefix,
        completionContext.blockType,
        completionContext.existingAnnotations
      );

    case 'dataType':
      return getDataTypeCompletions(completionContext.prefix);

    case 'nodeType':
      return getNodeTypeCompletions(completionContext.prefix, context);

    case 'nodeId':
      return getNodeIdCompletions(completionContext.prefix, context);

    case 'port':
      return getPortCompletions(
        completionContext.nodeId || '',
        completionContext.portDirection || 'output',
        completionContext.prefix,
        context,
        completionContext.lineText
      );

    case 'annotationValue':
      return getAnnotationValueCompletions(
        completionContext.annotation || '',
        completionContext.prefix
      );

    case 'modifier':
      return getModifierCompletions(completionContext.annotation || null, completionContext.prefix);

    case 'modifierValue':
      return getModifierValueCompletions(
        completionContext.modifier || '',
        completionContext.prefix
      );

    default:
      return [];
  }
}

/**
 * Get nodeType completions from workflow context.
 */
function getNodeTypeCompletions(prefix: string, context?: WorkflowContext): FlowWeaverCompletion[] {
  if (!context?.nodeTypes) {
    return [];
  }

  const lowerPrefix = prefix.toLowerCase();
  return Object.values(context.nodeTypes)
    .filter((nt) => nt.name.toLowerCase().startsWith(lowerPrefix))
    .map((nt) => ({
      label: nt.name,
      detail: nt.category,
      documentation: nt.description,
      insertText: nt.name,
      insertTextFormat: 'plain' as const,
      kind: 'nodeType' as const,
    }));
}

/**
 * Get node instance ID completions from workflow context.
 */
function getNodeIdCompletions(prefix: string, context?: WorkflowContext): FlowWeaverCompletion[] {
  if (!context?.instances) {
    return [];
  }

  const lowerPrefix = prefix.toLowerCase();
  return context.instances
    .filter((inst) => inst.id.toLowerCase().startsWith(lowerPrefix))
    .map((inst) => ({
      label: inst.id,
      detail: inst.nodeType,
      insertText: inst.id,
      insertTextFormat: 'plain' as const,
      kind: 'node' as const,
    }));
}

/**
 * Get port completions for a specific node.
 * When completing target ports (input), sorts type-matching ports first
 * and demotes already-connected ports.
 */
function getPortCompletions(
  nodeId: string,
  direction: 'input' | 'output',
  prefix: string,
  context?: WorkflowContext,
  lineText?: string
): FlowWeaverCompletion[] {
  if (!context?.instances || !context?.nodeTypes) {
    return [];
  }

  // Find the node instance
  const instance = context.instances.find((inst) => inst.id === nodeId);
  if (!instance) {
    return [];
  }

  // Find the node type
  const nodeType = context.nodeTypes[instance.nodeType];
  if (!nodeType) {
    return [];
  }

  // Filter ports by direction
  const directionUpper = direction.toUpperCase();
  const lowerPrefix = prefix.toLowerCase();

  // Resolve source port dataType when completing target (input) ports
  let sourceDataType: string | undefined;
  if (direction === 'input' && lineText) {
    const sourceMatch = lineText.match(/@connect\s+(\w+)\.(\w+)\s*->/);
    if (sourceMatch) {
      const [, srcNodeId, srcPortName] = sourceMatch;
      const srcInstance = context.instances.find((inst) => inst.id === srcNodeId);
      if (srcInstance) {
        const srcNodeType = context.nodeTypes[srcInstance.nodeType];
        if (srcNodeType) {
          const srcPort = srcNodeType.ports.find(
            (p) => p.name === srcPortName && p.direction === 'OUTPUT'
          );
          sourceDataType = srcPort?.dataType;
        }
      }
    }
  }

  // Build set of already-connected ports on this node (for the given direction)
  const connectedPorts = new Set<string>();
  if (context.connections) {
    for (const conn of context.connections) {
      if (direction === 'input' && conn.targetNode === nodeId) {
        connectedPorts.add(conn.targetPort);
      } else if (direction === 'output' && conn.sourceNode === nodeId) {
        connectedPorts.add(conn.sourcePort);
      }
    }
  }

  return nodeType.ports
    .filter((port) => port.direction === directionUpper)
    .filter((port) => port.name.toLowerCase().startsWith(lowerPrefix))
    .map((port) => {
      const isConnected = connectedPorts.has(port.name);
      const isTypeMatch = sourceDataType && port.dataType === sourceDataType;

      let sortOrder = 0;
      if (isTypeMatch) sortOrder = -10;
      if (isConnected) sortOrder = 20;

      return {
        label: port.name,
        detail: isConnected ? `${port.dataType || ''} (connected)`.trim() : port.dataType,
        documentation: port.description,
        insertText: port.name,
        insertTextFormat: 'plain' as const,
        kind: 'port' as const,
        sortOrder,
      };
    })
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}
