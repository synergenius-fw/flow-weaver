/**
 * Extractor for JSDoc annotation documentation
 *
 * This defines all Flow Weaver JSDoc annotations with their syntax and descriptions.
 * The annotation names correspond to tokens defined in chevrotain-parser/tokens.ts.
 */

import type { TAnnotationDoc, TAnnotationModifierDoc } from '../types.js';

/**
 * Core Flow Weaver annotations - the primary JSDoc tags
 */
export const CORE_ANNOTATIONS: TAnnotationDoc[] = [
  {
    name: '@flowWeaver',
    category: 'marker',
    syntax: '@flowWeaver nodeType | workflow | pattern',
    description:
      'Required marker to identify function purpose. Must be first Flow Weaver annotation.',
    insertText: '@flowWeaver ',
    insertTextFormat: 'plain',
  },
  {
    name: '@flowWeaver nodeType',
    category: 'marker',
    syntax: '@flowWeaver nodeType',
    description: 'Marks function as a reusable node type that can be instantiated in workflows.',
    insertText: '@flowWeaver nodeType',
    insertTextFormat: 'plain',
  },
  {
    name: '@flowWeaver workflow',
    category: 'marker',
    syntax: '@flowWeaver workflow',
    description: 'Marks function as a DAG workflow orchestration.',
    insertText: '@flowWeaver workflow',
    insertTextFormat: 'plain',
  },
  {
    name: '@flowWeaver pattern',
    category: 'marker',
    syntax: '@flowWeaver pattern',
    description: 'Marks function as a reusable subgraph pattern.',
    insertText: '@flowWeaver pattern',
    insertTextFormat: 'plain',
  },
];

/**
 * Port-related annotations
 */
export const PORT_ANNOTATIONS: TAnnotationDoc[] = [
  {
    name: '@input',
    category: 'port',
    syntax: '@input {Type} name [modifiers] - description',
    description:
      'Declares an input port for data or control flow. Type in braces, name required, modifiers in brackets optional.',
    insertText: '@input {${1:Type}} ${2:name}',
    insertTextFormat: 'snippet',
  },
  {
    name: '@output',
    category: 'port',
    syntax: '@output {Type} name [modifiers] - description',
    description:
      'Declares an output port for data or control flow. Type in braces, name required, modifiers in brackets optional.',
    insertText: '@output {${1:Type}} ${2:name}',
    insertTextFormat: 'snippet',
  },
  {
    name: '@step',
    category: 'port',
    syntax: '@step name - description',
    description:
      'Declares a STEP port for control flow. Shorthand for @input {STEP} or @output {STEP}.',
    insertText: '@step ${1:name}',
    insertTextFormat: 'snippet',
  },
];

/**
 * Workflow structure annotations
 */
export const WORKFLOW_ANNOTATIONS: TAnnotationDoc[] = [
  {
    name: '@node',
    category: 'workflow',
    syntax: '@node instanceId NodeTypeName [parent.scope] [modifiers]',
    description:
      'Declares a node instance in the workflow. Can optionally specify parent scope and modifiers.',
    insertText: '@node ${1:id} ${2:NodeType}',
    insertTextFormat: 'snippet',
  },
  {
    name: '@connect',
    category: 'workflow',
    syntax: '@connect sourceNode.outPort -> targetNode.inPort',
    description: 'Connects an output port to an input port. Use arrow syntax for directionality.',
    insertText: '@connect ${1:from}.${2:port} -> ${3:to}.${4:port}',
    insertTextFormat: 'snippet',
  },
  {
    name: '@position',
    category: 'workflow',
    syntax: '@position nodeId x y',
    description: 'Sets the visual position of a node in the editor canvas.',
    insertText: '@position ${1:nodeId} ${2:x} ${3:y}',
    insertTextFormat: 'snippet',
  },
  {
    name: '@fwImport',
    category: 'workflow',
    syntax: '@fwImport nodeName functionName from "packageName"',
    description:
      'Imports an npm package function as a node type. Creates expression node with inferred types.',
    insertText: '@fwImport ${1:nodeName} ${2:functionName} from "${3:package}"',
    insertTextFormat: 'snippet',
  },
  {
    name: '@path',
    category: 'workflow',
    syntax: '@path Start -> nodeA -> nodeB:fail -> Exit',
    description:
      'Declare a complete execution route with scope walking. Steps separated by ->. Suffix :ok (default) or :fail to select onSuccess/onFailure. Data ports auto-resolve by walking backward to the nearest ancestor with a same-name output.',
    insertText: '@path Start -> ${1:node1} -> ${2:node2} -> Exit',
    insertTextFormat: 'snippet',
  },
];

/**
 * Node type metadata annotations
 */
export const METADATA_ANNOTATIONS: TAnnotationDoc[] = [
  {
    name: '@name',
    category: 'metadata',
    syntax: '@name identifier',
    description:
      'Sets the node type identifier. Used to reference this type in @node declarations.',
    insertText: '@name ${1:identifier}',
    insertTextFormat: 'snippet',
  },
  {
    name: '@label',
    category: 'metadata',
    syntax: '@label "Display Name"',
    description: 'Sets a human-readable display label for the node or workflow in the UI.',
    insertText: '@label "${1:Label}"',
    insertTextFormat: 'snippet',
  },
  {
    name: '@description',
    category: 'metadata',
    syntax: '@description Text description',
    description: 'Sets a description that appears as hover tooltip in the UI.',
    insertText: '@description ${1:description}',
    insertTextFormat: 'snippet',
  },
  {
    name: '@scope',
    category: 'metadata',
    syntax: '@scope scopeName',
    description:
      'Declares a scope for nested nodes. Used for iteration patterns (forEach, map, etc.).',
    insertText: '@scope ${1:scopeName}',
    insertTextFormat: 'snippet',
  },
  {
    name: '@executeWhen',
    category: 'metadata',
    syntax: '@executeWhen CONJUNCTION | DISJUNCTION | CUSTOM',
    description:
      'Controls when a node with multiple step inputs executes. CONJUNCTION waits for all, DISJUNCTION fires on first.',
    insertText: '@executeWhen ${1|CONJUNCTION,DISJUNCTION,CUSTOM|}',
    insertTextFormat: 'snippet',
  },
  {
    name: '@pullExecution',
    category: 'metadata',
    syntax: '@pullExecution triggerPort',
    description: 'Enables lazy execution - node runs only when trigger port is pulled.',
    insertText: '@pullExecution ${1:triggerPort}',
    insertTextFormat: 'snippet',
  },
  {
    name: '@expression',
    category: 'metadata',
    syntax: '@expression',
    description:
      'Marks node as pure expression node. No control flow ports (execute/onSuccess/onFailure).',
    insertText: '@expression',
    insertTextFormat: 'plain',
  },
  {
    name: '@strictTypes',
    category: 'metadata',
    syntax: '@strictTypes',
    description: 'Promotes type coercion warnings to errors in this workflow.',
    insertText: '@strictTypes',
    insertTextFormat: 'plain',
  },
  {
    name: '@color',
    category: 'metadata',
    syntax: '@color value',
    description: 'Sets a UI color hint for the node type.',
    insertText: '@color ${1:value}',
    insertTextFormat: 'snippet',
  },
];

/**
 * Standard JSDoc annotations (for completeness in IDE)
 */
export const STANDARD_ANNOTATIONS: TAnnotationDoc[] = [
  {
    name: '@param',
    category: 'standard',
    syntax: '@param {type} name - description',
    description:
      'Standard JSDoc parameter documentation. In workflows, defines Start port (workflow input).',
    insertText: '@param {${1:type}} ${2:name} - ${3:description}',
    insertTextFormat: 'snippet',
  },
  {
    name: '@returns',
    category: 'standard',
    syntax: '@returns {type} description',
    description:
      'Standard JSDoc return documentation. In workflows, defines Exit port (workflow output).',
    insertText: '@returns {${1:type}} ${2:description}',
    insertTextFormat: 'snippet',
  },
];

/**
 * Pattern-specific annotations
 */
export const PATTERN_ANNOTATIONS: TAnnotationDoc[] = [
  {
    name: '@port IN',
    category: 'pattern',
    syntax: '@port IN.name - description',
    description: 'Defines a pattern input port. Use IN instead of Start in patterns.',
    insertText: '@port IN.${1:name}',
    insertTextFormat: 'snippet',
  },
  {
    name: '@port OUT',
    category: 'pattern',
    syntax: '@port OUT.name - description',
    description: 'Defines a pattern output port. Use OUT instead of Exit in patterns.',
    insertText: '@port OUT.${1:name}',
    insertTextFormat: 'snippet',
  },
];

/**
 * Port modifiers - attributes in square brackets after port name
 */
export const PORT_MODIFIERS: TAnnotationModifierDoc[] = [
  {
    name: 'order',
    syntax: '[order:N]',
    description: 'Sets display order for the port. Lower numbers appear higher.',
  },
  {
    name: 'placement',
    syntax: '[placement:TOP|BOTTOM]',
    description: 'Controls port position on the node.',
    enum: ['TOP', 'BOTTOM'],
  },
  {
    name: 'type',
    syntax: '[type:TYPE]',
    description: 'Overrides inferred port data type.',
  },
  {
    name: 'hidden',
    syntax: '[hidden]',
    description: 'Hides port from UI display.',
  },
  {
    name: 'optional',
    syntax: '[optional]',
    description: 'Marks input port as optional (alternative to square brackets around name).',
  },
];

/**
 * Node instance modifiers - attributes in @node declarations
 */
export const NODE_MODIFIERS: TAnnotationModifierDoc[] = [
  {
    name: 'label',
    syntax: '[label:"Display Name"]',
    description: 'Override the display label for this instance.',
  },
  {
    name: 'expr',
    syntax: '[expr:port="value"]',
    description: 'Set an expression value for a port.',
  },
  {
    name: 'minimized',
    syntax: '[minimized]',
    description: 'Collapse the node in the UI.',
  },
  {
    name: 'pullExecution',
    syntax: '[pullExecution:port]',
    description: 'Enable lazy execution for this instance.',
  },
  {
    name: 'portOrder',
    syntax: '[portOrder:port=N]',
    description: 'Override display order for a specific port.',
  },
  {
    name: 'portLabel',
    syntax: '[portLabel:port="Label"]',
    description: 'Override display label for a specific port.',
  },
  {
    name: 'size',
    syntax: '[size:width,height]',
    description: 'Set custom node dimensions.',
  },
];

/**
 * All annotations combined
 */
export const ALL_ANNOTATIONS: TAnnotationDoc[] = [
  ...CORE_ANNOTATIONS,
  ...PORT_ANNOTATIONS,
  ...WORKFLOW_ANNOTATIONS,
  ...METADATA_ANNOTATIONS,
  ...PATTERN_ANNOTATIONS,
  ...STANDARD_ANNOTATIONS,
];

/**
 * Extract all annotation documentation
 */
export function extractAnnotations(): TAnnotationDoc[] {
  return ALL_ANNOTATIONS;
}

/**
 * Extract port modifier documentation
 */
export function extractPortModifiers(): TAnnotationModifierDoc[] {
  return PORT_MODIFIERS;
}

/**
 * Extract node modifier documentation
 */
export function extractNodeModifiers(): TAnnotationModifierDoc[] {
  return NODE_MODIFIERS;
}
