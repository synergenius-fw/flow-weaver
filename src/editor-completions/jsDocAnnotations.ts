/**
 * Editor Completions - JSDoc Annotations
 *
 * Flow Weaver specific JSDoc annotations for autocompletion.
 */

import type { FlowWeaverCompletion } from './types';

/**
 * Block types where an annotation is valid.
 * - "workflow": inside a @flowWeaver workflow block
 * - "nodeType": inside a @flowWeaver nodeType block
 */
export type AnnotationBlockType = 'workflow' | 'nodeType';

/**
 * Extended completion with block-type awareness.
 */
export type AnnotationCompletion = FlowWeaverCompletion & {
  /** Which block types this annotation is valid in. Undefined = valid in both. */
  blockTypes?: AnnotationBlockType[];
};

/**
 * All Flow Weaver JSDoc annotations with snippet templates.
 */
export const JSDOC_ANNOTATIONS: AnnotationCompletion[] = [
  // Core annotations
  {
    label: '@flowWeaver',
    detail: 'Mark function as Flow Weaver workflow',
    documentation:
      'Indicates this function should be parsed as a Flow Weaver workflow with visual node graph.',
    insertText: '@flowWeaver ',
    insertTextFormat: 'plain',
    kind: 'annotation',
    sortOrder: 0,
  },
  {
    label: '@flowWeaver nodeType',
    detail: 'Mark function as reusable node type',
    documentation: 'Defines a reusable node type that can be instantiated in workflows.',
    insertText: '@flowWeaver nodeType',
    insertTextFormat: 'plain',
    kind: 'annotation',
    sortOrder: 1,
  },

  // Port definitions (nodeType-only)
  {
    label: '@input',
    detail: 'Define input port',
    documentation:
      'Declares an input port for data or control flow.\nFormat: @input name - description',
    insertText: '@input ${1:name}',
    insertTextFormat: 'snippet',
    kind: 'annotation',
    sortOrder: 10,
    blockTypes: ['nodeType'],
  },
  {
    label: '@output',
    detail: 'Define output port',
    documentation:
      'Declares an output port for data or control flow.\nFormat: @output name - description',
    insertText: '@output ${1:name}',
    insertTextFormat: 'snippet',
    kind: 'annotation',
    sortOrder: 11,
    blockTypes: ['nodeType'],
  },
  {
    label: '@step',
    detail: 'Define step (control flow) port',
    documentation:
      'Declares a STEP port for control flow. Shorthand for @input name [type:STEP] or @output name [type:STEP].',
    insertText: '@step ${1:name}',
    insertTextFormat: 'snippet',
    kind: 'annotation',
    sortOrder: 12,
    blockTypes: ['nodeType'],
  },

  // Node declarations (workflow-only)
  {
    label: '@node',
    detail: 'Declare node instance',
    documentation:
      'Declares a node instance in the workflow.\nFormat: @node instanceId NodeTypeName',
    insertText: '@node ${1:id} ${2:NodeType}',
    insertTextFormat: 'snippet',
    kind: 'annotation',
    sortOrder: 20,
    blockTypes: ['workflow'],
  },
  {
    label: '@connect',
    detail: 'Define connection between ports',
    documentation:
      'Connects an output port to an input port.\nFormat: @connect sourceNode.outPort -> targetNode.inPort',
    insertText: '@connect ${1:from}.${2:port} -> ${3:to}.${4:port}',
    insertTextFormat: 'snippet',
    kind: 'annotation',
    sortOrder: 21,
    blockTypes: ['workflow'],
  },
  {
    label: '@fwImport',
    detail: 'Import npm node type',
    documentation:
      'Imports a node type from an npm package.\nFormat: @fwImport name fn from "package"',
    insertText: '@fwImport ${1:name} ${2:fn} from "${3:pkg}"',
    insertTextFormat: 'snippet',
    kind: 'annotation',
    sortOrder: 22,
    blockTypes: ['workflow'],
  },
  {
    label: '@path',
    detail: 'Multi-node execution route',
    documentation:
      'Declare a complete execution route through the graph with scope walking for data ports.\nFormat: @path Start -> nodeA:ok -> nodeB:fail -> Exit',
    insertText: '@path Start -> ${1:node1} -> ${2:node2} -> Exit',
    insertTextFormat: 'snippet',
    kind: 'annotation',
    sortOrder: 25,
    blockTypes: ['workflow'],
  },
  {
    label: '@trigger',
    detail: 'Set workflow trigger (event or cron)',
    documentation:
      'Defines how this workflow is triggered.\n' +
      'Formats:\n  @trigger event="my/event"\n  @trigger cron="0 9 * * *"\n  @trigger event="my/event" cron="0 9 * * *"',
    insertText: '@trigger ${1|event,cron|}="${2:value}"',
    insertTextFormat: 'snippet',
    kind: 'annotation',
    sortOrder: 15,
    blockTypes: ['workflow'],
  },
  {
    label: '@cancelOn',
    detail: 'Cancel on external event',
    documentation:
      'Cancels a running workflow when a matching event arrives.\n' +
      'Format: @cancelOn event="app/user.deleted" match="data.userId"',
    insertText: '@cancelOn event="${1:event/name}" match="${2:data.field}"',
    insertTextFormat: 'snippet',
    kind: 'annotation',
    sortOrder: 16,
    blockTypes: ['workflow'],
  },
  {
    label: '@retries',
    detail: 'Set retry count',
    documentation: 'Number of times to retry on failure.\nFormat: @retries 5',
    insertText: '@retries ${1:3}',
    insertTextFormat: 'snippet',
    kind: 'annotation',
    sortOrder: 17,
    blockTypes: ['workflow'],
  },
  {
    label: '@timeout',
    detail: 'Set function timeout',
    documentation: 'Maximum execution time before function is terminated.\nFormat: @timeout "30m"',
    insertText: '@timeout "${1:30m}"',
    insertTextFormat: 'snippet',
    kind: 'annotation',
    sortOrder: 18,
    blockTypes: ['workflow'],
  },
  {
    label: '@throttle',
    detail: 'Rate limit execution',
    documentation:
      'Limits execution rate to prevent overwhelming downstream services.\n' +
      'Format: @throttle limit=3 period="1m"',
    insertText: '@throttle limit=${1:3} period="${2:1m}"',
    insertTextFormat: 'snippet',
    kind: 'annotation',
    sortOrder: 19,
    blockTypes: ['workflow'],
  },
  {
    label: '@strictTypes',
    detail: 'Strict type checking',
    documentation: 'Enables strict type checking for connections in this workflow.',
    insertText: '@strictTypes',
    insertTextFormat: 'plain',
    kind: 'annotation',
    sortOrder: 24,
    blockTypes: ['workflow'],
  },
  {
    label: '@port',
    detail: 'Pattern port declaration',
    documentation: 'Declares an IN/OUT port for a reusable pattern.',
    insertText: '@port ${1:name}',
    insertTextFormat: 'snippet',
    kind: 'annotation',
    sortOrder: 24,
    blockTypes: ['workflow'],
  },

  // Metadata (both or specific)
  {
    label: '@label',
    detail: 'Set display label',
    documentation: 'Sets a human-readable label for the workflow or node.',
    insertText: '@label "${1:Label}"',
    insertTextFormat: 'snippet',
    kind: 'annotation',
    sortOrder: 30,
  },
  {
    label: '@scope',
    detail: 'Define iteration scope',
    documentation: 'Defines a scope for iteration patterns (forEach, map, etc.).',
    insertText: '@scope ${1:scopeName}',
    insertTextFormat: 'snippet',
    kind: 'annotation',
    sortOrder: 31,
    blockTypes: ['nodeType'],
  },
  {
    label: '@position',
    detail: 'Set Start/Exit position',
    documentation:
      'Sets the visual position of a virtual node (Start or Exit) in the editor.\n' +
      'For regular nodes, use [position: x y] on the @node declaration instead.\n' +
      'Format: @position Start x y',
    insertText: '@position ${1|Start,Exit|} ${2:x} ${3:y}',
    insertTextFormat: 'snippet',
    kind: 'annotation',
    sortOrder: 32,
    blockTypes: ['workflow'],
  },
  {
    label: '@name',
    detail: 'Set node type name',
    documentation: 'Sets the display name for a node type.',
    insertText: '@name ${1:name}',
    insertTextFormat: 'snippet',
    kind: 'annotation',
    sortOrder: 33,
    blockTypes: ['nodeType'],
  },
  {
    label: '@description',
    detail: 'Set description',
    documentation: 'Sets the description for a node type or workflow.',
    insertText: '@description ${1:text}',
    insertTextFormat: 'snippet',
    kind: 'annotation',
    sortOrder: 34,
    blockTypes: ['nodeType'],
  },
  {
    label: '@color',
    detail: 'Set node color',
    documentation: 'Sets the visual color of a node type in the editor.',
    insertText: '@color ${1:color}',
    insertTextFormat: 'snippet',
    kind: 'annotation',
    sortOrder: 35,
    blockTypes: ['nodeType'],
  },
  {
    label: '@icon',
    detail: 'Set node icon',
    documentation: 'Sets the icon for a node type.',
    insertText: '@icon ${1:iconName}',
    insertTextFormat: 'snippet',
    kind: 'annotation',
    sortOrder: 36,
    blockTypes: ['nodeType'],
  },
  {
    label: '@tag',
    detail: 'Add category tag',
    documentation: 'Adds a category tag to a node type for filtering and organization.',
    insertText: '@tag ${1:tagName}',
    insertTextFormat: 'snippet',
    kind: 'annotation',
    sortOrder: 37,
    blockTypes: ['nodeType'],
  },
  {
    label: '@expression',
    detail: 'Mark as expression node',
    documentation:
      'Marks this node type as an expression node (pure data transformation, no control flow).',
    insertText: '@expression',
    insertTextFormat: 'plain',
    kind: 'annotation',
    sortOrder: 38,
    blockTypes: ['nodeType'],
  },
  {
    label: '@pullExecution',
    detail: 'Pull execution mode',
    documentation: 'Enables pull-based execution for this node type.',
    insertText: '@pullExecution',
    insertTextFormat: 'plain',
    kind: 'annotation',
    sortOrder: 39,
    blockTypes: ['nodeType'],
  },
  {
    label: '@executeWhen',
    detail: 'Execution strategy',
    documentation:
      'Sets the execution strategy for this node type.\nValues: CONJUNCTION, DISJUNCTION, CUSTOM',
    insertText: '@executeWhen ${1:CONJUNCTION}',
    insertTextFormat: 'snippet',
    kind: 'annotation',
    sortOrder: 40,
    blockTypes: ['nodeType'],
  },

  // Standard JSDoc (for completeness)
  {
    label: '@param',
    detail: 'Document parameter',
    documentation: 'Standard JSDoc parameter documentation.',
    insertText: '@param {${1:type}} ${2:name} - ${3:description}',
    insertTextFormat: 'snippet',
    kind: 'annotation',
    sortOrder: 50,
  },
  {
    label: '@returns',
    detail: 'Document return value',
    documentation: 'Standard JSDoc return value documentation.',
    insertText: '@returns {${1:type}} ${2:description}',
    insertTextFormat: 'snippet',
    kind: 'annotation',
    sortOrder: 51,
  },
];

/**
 * Connection-related annotation names for boost detection.
 */
const CONNECTION_ANNOTATIONS = new Set(['connect', 'path']);

/**
 * Get annotation completions filtered by prefix and optional block type.
 * Applies context-aware sorting boosts based on existing annotations.
 */
export function getAnnotationCompletions(
  prefix: string,
  blockType?: 'workflow' | 'nodeType' | null,
  existingAnnotations?: string[]
): FlowWeaverCompletion[] {
  const lowerPrefix = prefix.toLowerCase();
  const existing = existingAnnotations ? new Set(existingAnnotations) : undefined;

  return JSDOC_ANNOTATIONS
    .filter((c) => {
      // Filter by prefix
      if (!c.label.toLowerCase().startsWith('@' + lowerPrefix)) {
        return false;
      }
      // Filter by block type if known
      if (blockType && c.blockTypes) {
        return c.blockTypes.includes(blockType);
      }
      return true;
    })
    .map((c) => {
      if (!existing) return c;

      let boost = 0;
      const annotationName = c.label.replace('@', '');

      if (blockType === 'workflow') {
        // Workflow: has @node but no connection annotations → boost connection annotations
        const hasNode = existing.has('node');
        const hasConnection = [...CONNECTION_ANNOTATIONS].some((a) => existing.has(a));
        if (hasNode && !hasConnection && CONNECTION_ANNOTATIONS.has(annotationName)) {
          boost = -10;
        }
      } else if (blockType === 'nodeType') {
        // NodeType: no @input → boost @input; has @input but no @output → boost @output
        const hasInput = existing.has('input');
        const hasOutput = existing.has('output');
        if (!hasInput && annotationName === 'input') {
          boost = -10;
        } else if (hasInput && !hasOutput && annotationName === 'output') {
          boost = -10;
        }
      }

      if (boost === 0) return c;
      return { ...c, sortOrder: (c.sortOrder ?? 0) + boost };
    })
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}
